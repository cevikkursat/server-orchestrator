#!/usr/bin/env bash
# =============================================================================
#  Panel host setup and hardening.
#
#  Supported: Debian 12, Ubuntu 22.04/24.04, Fedora, RHEL/Rocky/AlmaLinux 9,
#             Arch Linux, openSUSE Leap/Tumbleweed, and Ubuntu under WSL2
#             (see deploy/install-windows.ps1). systemd is required.
#
#  Usage (as root):
#    ADMIN_USER=admin SSH_PUBKEY="ssh-ed25519 AAAA... you@pc" bash install.sh
#
#  Optional environment variables:
#    SSH_PORT=22            SSH port
#    SWAP_SIZE=4G           swap file size (skipped under WSL)
#    TZ_NAME=               timezone, e.g. Europe/Berlin (empty: keep the current one)
#    TS_AUTHKEY=            Tailscale auth key (empty: you get a login link)
#    TS_HOSTNAME=panel      Tailscale machine name
#    SSH_TAILSCALE_ONLY=0   1: close SSH to the internet, Tailscale only (careful!)
#    PANEL_DRY_RUN=0        1 (or --dry-run): print what would be done, change nothing
#    PANEL_WSL=             1/0: force WSL detection on/off (for tests)
#
#  Steps:
#    1. System update + automatic security updates
#    2. Admin user with sudo + SSH key
#    3. SSH hardening (no root login, no passwords)
#    4. Firewall: only SSH, 80, 443 (ufw or firewalld)
#    5. fail2ban (SSH brute-force protection)
#    6. Swap + sysctl
#    7. Docker Engine + compose plugin, log size limits
#    8. /opt/panel directories
#    9. Tailscale: the panel is reachable only from your tailnet
#       (tailscale serve -> 127.0.0.1:8443 -> Caddy)
#
#  Safe to run again (idempotent).
# =============================================================================
set -euo pipefail

DRY_RUN="${PANEL_DRY_RUN:-0}"
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY_RUN=1 ;;
    -h | --help) sed -n '2,34p' "$0"; exit 0 ;;
    *) echo "Unknown option: $arg" >&2; exit 2 ;;
  esac
done

ADMIN_USER="${ADMIN_USER:-}"
SSH_PUBKEY="${SSH_PUBKEY:-}"
SSH_PORT="${SSH_PORT:-22}"
SWAP_SIZE="${SWAP_SIZE:-4G}"
# TIMEZONE is the old name of TZ_NAME and is still accepted
TZ_NAME="${TZ_NAME:-${TIMEZONE:-}}"
TS_AUTHKEY="${TS_AUTHKEY:-}"
TS_HOSTNAME="${TS_HOSTNAME:-panel}"
SSH_TAILSCALE_ONLY="${SSH_TAILSCALE_ONLY:-0}"

if [[ -t 1 ]]; then
  C_G=$'\e[1;32m' C_Y=$'\e[1;33m' C_R=$'\e[1;31m' C_B=$'\e[1;34m' C_0=$'\e[0m'
else
  C_G="" C_Y="" C_R="" C_B="" C_0=""
fi
log()  { echo "${C_G}[+]${C_0} $*"; }
warn() { echo "${C_Y}[!]${C_0} $*"; }
note() { echo "${C_B}[i]${C_0} $*"; }
die()  { echo "${C_R}[x]${C_0} $*" >&2; exit 1; }

is_dry() { [[ "$DRY_RUN" == "1" ]]; }

# Runs a command that changes the system. In dry-run mode it is only printed.
run() {
  if is_dry; then
    echo "    + $*"
  else
    "$@"
  fi
}

# write_file PATH [MODE] <<EOF ... EOF : writes stdin to PATH (only printed in dry-run mode)
write_file() {
  local path="$1" mode="${2:-}" content
  content=$(cat)
  if is_dry; then
    echo "    + write $path${mode:+ (mode $mode)}:"
    printf '%s\n' "$content" | sed 's/^/        | /'
    return 0
  fi
  mkdir -p "$(dirname "$path")"
  printf '%s\n' "$content" >"$path"
  [[ -z "$mode" ]] || chmod "$mode" "$path"
}

# append_line FILE LINE : appends LINE unless FILE already contains it exactly
append_line() {
  if is_dry; then
    echo "    + ensure line in $1: $2"
    return 0
  fi
  touch "$1"
  grep -qxF -- "$2" "$1" || printf '%s\n' "$2" >>"$1"
}

have() { command -v "$1" &>/dev/null; }
unit_exists() { systemctl list-unit-files "$1" 2>/dev/null | grep -q "^$1"; }

# ---------------------------------------------------------------------------
# Detection
# ---------------------------------------------------------------------------
[[ -r /etc/os-release ]] || die "/etc/os-release not found; cannot detect the distribution."
# shellcheck disable=SC1091
. /etc/os-release
OS_ID="${ID:-unknown}"
OS_LIKE="${ID_LIKE:-}"
OS_VER="${VERSION_ID:-}"
OS_MAJOR="${OS_VER%%.*}"
OS_PRETTY="${PRETTY_NAME:-$OS_ID $OS_VER}"

FAMILY=""
case " $OS_ID $OS_LIKE " in
  *" ubuntu "* | *" debian "*) FAMILY=debian ;;
  *" fedora "*)
    # RHEL clones list "rhel fedora" or "centos rhel fedora" in ID_LIKE
    case " $OS_ID $OS_LIKE " in
      *" rhel "* | *" centos "*) FAMILY=rhel ;;
      *) FAMILY=fedora ;;
    esac
    ;;
  *" rhel "* | *" centos "*) FAMILY=rhel ;;
  *" arch "*) FAMILY=arch ;;
  *" suse "* | *" opensuse "* | *" sles "*) FAMILY=suse ;;
esac
case "$OS_ID" in
  rhel | rocky | almalinux | centos) FAMILY=rhel ;;
  fedora) FAMILY=fedora ;;
  opensuse-* | sles | sled) FAMILY=suse ;;
  arch | manjaro | endeavouros) FAMILY=arch ;;
esac

[[ -n "$FAMILY" ]] || die "Unsupported distribution: $OS_PRETTY.
    Supported: Debian 12, Ubuntu 22.04/24.04, Fedora, RHEL/Rocky/AlmaLinux 9,
    Arch Linux, openSUSE Leap/Tumbleweed. (Alpine, Gentoo, Void, NixOS etc. are not supported.)"

IS_WSL=0
if [[ -n "${WSL_DISTRO_NAME:-}" || -e /proc/sys/fs/binfmt_misc/WSLInterop ]] ||
  grep -qiE 'microsoft|wsl' /proc/sys/kernel/osrelease 2>/dev/null; then
  IS_WSL=1
fi
# Test override (e.g. dry runs in containers on Docker Desktop, whose kernel is a WSL2 kernel)
[[ -n "${PANEL_WSL:-}" ]] && IS_WSL="$PANEL_WSL"

# Known-good versions; anything else in a supported family gets a warning but continues.
TESTED=1
case "$OS_ID:$OS_VER" in
  ubuntu:22.04 | ubuntu:24.04 | debian:12 | fedora:* | arch:* | opensuse-tumbleweed:* | opensuse-leap:15.*) ;;
  rhel:9* | rocky:9* | almalinux:9*) ;;
  *) TESTED=0 ;;
esac

case "$FAMILY" in
  debian) FIREWALL=ufw; ADMIN_GROUP=sudo ;;
  arch) FIREWALL=ufw; ADMIN_GROUP=wheel ;;
  fedora | rhel | suse) FIREWALL=firewalld; ADMIN_GROUP=wheel ;;
esac
[[ "$IS_WSL" == "1" ]] && FIREWALL=none

if unit_exists ssh.service || [[ "$FAMILY" == debian ]]; then SSH_UNIT=ssh; else SSH_UNIT=sshd; fi

SELINUX=disabled
if have getenforce; then SELINUX=$(getenforce 2>/dev/null | tr '[:upper:]' '[:lower:]' || echo disabled); fi

log "Detected: $OS_PRETTY (family: $FAMILY, firewall: $FIREWALL, SELinux: $SELINUX, WSL: $([[ $IS_WSL == 1 ]] && echo yes || echo no))"
is_dry && note "DRY RUN: nothing will be changed; commands are only printed."
[[ "$TESTED" == "1" ]] || warn "$OS_PRETTY is not a tested version; continuing with the $FAMILY steps."

if [[ $EUID -ne 0 ]]; then
  if is_dry; then warn "Not root (ignored in dry-run)."; else die "Run as root (sudo -i)."; fi
fi
if [[ -z "$ADMIN_USER" ]]; then
  if is_dry; then
    ADMIN_USER="admin"
    warn "ADMIN_USER not set; using 'admin' for the dry run."
  else
    die "ADMIN_USER is required."
  fi
fi
if [[ ! -d /run/systemd/system ]]; then
  if is_dry; then
    warn "systemd is not running (normal in a test container; ignored in dry-run)."
  elif [[ "$IS_WSL" == "1" ]]; then
    die "systemd is not running in this WSL distro. Add '[boot]' 'systemd=true' to /etc/wsl.conf, run 'wsl --shutdown' and try again."
  else
    die "systemd is required (OpenRC/runit etc. are not supported)."
  fi
fi

# ---------------------------------------------------------------------------
# Package helpers
# ---------------------------------------------------------------------------
export DEBIAN_FRONTEND=noninteractive

pkg_update_upgrade() {
  case "$FAMILY" in
    debian) run apt-get update -y; run apt-get upgrade -y ;;
    fedora | rhel) run dnf -y upgrade --refresh ;;
    arch) run pacman -Syu --noconfirm ;;
    suse)
      run zypper --non-interactive refresh
      if [[ "$OS_ID" == opensuse-tumbleweed ]]; then
        run zypper --non-interactive dist-upgrade --auto-agree-with-licenses
      else
        run zypper --non-interactive update --auto-agree-with-licenses
      fi
      ;;
  esac
}

pkg_install() {
  case "$FAMILY" in
    debian) run apt-get install -y "$@" ;;
    fedora | rhel) run dnf -y install "$@" ;;
    arch) run pacman -S --needed --noconfirm "$@" ;;
    suse) run zypper --non-interactive install --auto-agree-with-licenses "$@" ;;
  esac
}

enable_epel() {
  [[ "$FAMILY" == rhel ]] || return 0
  rpm -q epel-release &>/dev/null && return 0
  if [[ "$OS_ID" == rhel ]]; then
    run dnf -y install "https://dl.fedoraproject.org/pub/epel/epel-release-latest-${OS_MAJOR}.noarch.rpm"
  else
    run dnf -y install epel-release
  fi
}

enable_auto_updates() {
  case "$FAMILY" in
    debian)
      run dpkg-reconfigure -f noninteractive unattended-upgrades
      ;;
    fedora | rhel)
      # dnf4: dnf-automatic, dnf5 (Fedora 41+): dnf5-plugin-automatic
      pkg_install dnf-automatic 2>/dev/null || pkg_install dnf5-plugin-automatic ||
        { warn "Could not install dnf-automatic; automatic updates not enabled."; return 0; }
      local conf=/etc/dnf/automatic.conf
      if [[ -f "$conf" ]]; then
        run sed -i -E 's/^#?\s*apply_updates\s*=.*/apply_updates = yes/; s/^#?\s*upgrade_type\s*=.*/upgrade_type = security/' "$conf"
      else
        write_file "$conf" <<'EOF'
[commands]
upgrade_type = security
apply_updates = yes
EOF
      fi
      # dnf5 (Fedora 41+) ships dnf5-automatic.timer, dnf4 dnf-automatic.timer
      local t=dnf-automatic.timer
      if unit_exists dnf5-automatic.timer || { ! unit_exists "$t" && have dnf5; }; then t=dnf5-automatic.timer; fi
      run systemctl enable --now "$t"
      ;;
    suse)
      if [[ "$OS_ID" == opensuse-tumbleweed ]]; then
        note "Tumbleweed is rolling: automatic updates are not enabled. Run 'zypper dup' regularly."
        return 0
      fi
      write_file /etc/systemd/system/panel-security-patch.service <<'EOF'
[Unit]
Description=Install security patches (zypper)
After=network-online.target
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/zypper --non-interactive patch --category security --auto-agree-with-licenses
EOF
      write_file /etc/systemd/system/panel-security-patch.timer <<'EOF'
[Unit]
Description=Daily security patches (zypper)

[Timer]
OnCalendar=daily
RandomizedDelaySec=1h
Persistent=true

[Install]
WantedBy=timers.target
EOF
      run systemctl daemon-reload
      run systemctl enable --now panel-security-patch.timer
      ;;
    arch)
      note "Arch Linux: automatic updates are not enabled (unattended upgrades are unsafe on Arch). Run 'pacman -Syu' regularly."
      ;;
  esac
}

# ---------------------------------------------------------------------------
# Firewall helpers (ufw or firewalld). Docker writes its own iptables/nftables rules for
# published ports and bypasses both; that is why apps never publish ports (only Caddy does).
# ---------------------------------------------------------------------------
fw_cmd() { # firewall-cmd while firewalld runs, firewall-offline-cmd before it starts
  if systemctl is-active --quiet firewalld 2>/dev/null; then
    run firewall-cmd --permanent "$@"
  else
    run firewall-offline-cmd "$@"
  fi
}
fw_zone() { firewall-cmd --get-default-zone 2>/dev/null || firewall-offline-cmd --get-default-zone 2>/dev/null || echo public; }

firewall_setup() { # allow SSH, 80/tcp, 443/tcp, 443/udp; deny the rest
  case "$FIREWALL" in
    ufw)
      run ufw default deny incoming
      run ufw default allow outgoing
      run ufw allow "$SSH_PORT"/tcp comment 'SSH'
      run ufw allow 80/tcp comment 'HTTP'
      run ufw allow 443/tcp comment 'HTTPS'
      run ufw allow 443/udp comment 'HTTP/3'
      run ufw --force enable
      if is_dry || unit_exists ufw.service; then run systemctl enable ufw; fi
      ;;
    firewalld)
      local zone
      zone=$(fw_zone)
      note "firewalld zone: $zone"
      fw_cmd --zone="$zone" --add-port="$SSH_PORT"/tcp
      fw_cmd --zone="$zone" --add-service=http
      fw_cmd --zone="$zone" --add-service=https
      fw_cmd --zone="$zone" --add-port=443/udp
      run systemctl enable --now firewalld
      run firewall-cmd --reload
      ;;
    none)
      note "WSL: no Linux firewall is configured; Windows Defender Firewall is the edge (install-windows.ps1 opens 80/443)."
      ;;
  esac
}

firewall_trust_iface() { # $1: interface that may reach everything (tailscale0)
  case "$FIREWALL" in
    ufw) run ufw allow in on "$1" comment 'Tailscale' ;;
    firewalld)
      fw_cmd --zone=trusted --add-interface="$1"
      run firewall-cmd --reload
      ;;
    none) ;;
  esac
}

firewall_close_ssh_public() { # SSH only through the trusted tailscale0 interface
  case "$FIREWALL" in
    ufw)
      run ufw allow in on tailscale0 to any port "$SSH_PORT" proto tcp comment 'SSH (Tailscale)'
      run ufw delete allow "$SSH_PORT"/tcp || true
      ;;
    firewalld)
      local zone
      zone=$(fw_zone)
      fw_cmd --zone="$zone" --remove-port="$SSH_PORT"/tcp || true
      fw_cmd --zone="$zone" --remove-service=ssh || true
      run firewall-cmd --reload
      ;;
    none) ;;
  esac
}

# ---------------------------------------------------------------------------
# Other helpers
# ---------------------------------------------------------------------------
size_to_mib() { # 4G -> 4096, 512M -> 512
  local n="${1%[GgMm]}" u="${1: -1}"
  case "$u" in G | g) echo $((n * 1024)) ;; M | m) echo "$n" ;; *) echo $(($1 / 1048576)) ;; esac
}

make_swapfile() {
  local fs mib
  fs=$(stat -f -c %T / 2>/dev/null || echo unknown)
  mib=$(size_to_mib "$SWAP_SIZE")
  case "$fs" in
    btrfs)
      # Copy-on-write files cannot be swap files on btrfs
      if btrfs filesystem mkswapfile --help &>/dev/null || is_dry; then
        run btrfs filesystem mkswapfile --size "${mib}m" /swapfile
      else
        run truncate -s 0 /swapfile
        run chattr +C /swapfile
        run dd if=/dev/zero of=/swapfile bs=1M count="$mib" status=none
        run chmod 600 /swapfile
        run mkswap /swapfile
      fi
      ;;
    xfs)
      run dd if=/dev/zero of=/swapfile bs=1M count="$mib" status=none
      run chmod 600 /swapfile
      run mkswap /swapfile
      ;;
    *)
      if ! run fallocate -l "$SWAP_SIZE" /swapfile; then
        run dd if=/dev/zero of=/swapfile bs=1M count="$mib" status=none
      fi
      run chmod 600 /swapfile
      run mkswap /swapfile
      ;;
  esac
  run chmod 600 /swapfile
  run swapon /swapfile
  append_line /etc/fstab '/swapfile none swap sw 0 0'
}

host_addresses() { # global addresses on this host's interfaces (for the .env hint)
  local a=""
  have hostname && a=$(hostname -I 2>/dev/null || true)
  if [[ -z "${a// /}" ]] && have ip; then
    a=$(ip -br addr 2>/dev/null | awk '$1 != "lo" {for (i = 3; i <= NF; i++) print $i}' | cut -d/ -f1 | tr '\n' ' ' || true)
  fi
  a=$(echo "$a" | tr -s ' ')
  echo "${a:-unknown}"
}

# Account has no usable password ('!', '*', '!!', empty)?
no_password() {
  local h
  h=$(getent shadow "$1" | cut -d: -f2)
  [[ -z "$h" || "$h" == '!'* || "$h" == '*'* ]]
}

# ---------------------------------------------------------------------------
log "1/9 System update"
case "$FAMILY" in
  debian)
    PKGS=(ca-certificates curl gnupg git htop jq rsync iproute2 unattended-upgrades)
    [[ "$IS_WSL" == "1" ]] || PKGS+=(ufw fail2ban python3-systemd)
    ;;
  fedora | rhel)
    PKGS=(ca-certificates curl gnupg2 git htop jq rsync iproute)
    [[ "$IS_WSL" == "1" ]] || PKGS+=(firewalld fail2ban python3-systemd)
    [[ "$SELINUX" == disabled ]] || PKGS+=(policycoreutils-python-utils)
    ;;
  arch)
    PKGS=(ca-certificates curl gnupg git htop jq rsync iproute2)
    [[ "$IS_WSL" == "1" ]] || PKGS+=(ufw fail2ban python-systemd)
    ;;
  suse)
    PKGS=(ca-certificates curl gpg2 git htop jq rsync iproute2)
    [[ "$IS_WSL" == "1" ]] || PKGS+=(firewalld fail2ban python3-systemd)
    [[ "$SELINUX" == disabled ]] || PKGS+=(policycoreutils-python-utils)
    ;;
esac
pkg_update_upgrade
enable_epel
pkg_install "${PKGS[@]}"
if [[ -n "$TZ_NAME" ]]; then
  run timedatectl set-timezone "$TZ_NAME" || warn "Could not set timezone '$TZ_NAME'."
else
  note "Timezone unchanged ($(timedatectl show -p Timezone --value 2>/dev/null || echo unknown)); set TZ_NAME to change it."
fi
enable_auto_updates

# ---------------------------------------------------------------------------
log "2/9 Admin user: $ADMIN_USER"
if ! id "$ADMIN_USER" &>/dev/null; then
  if [[ "$FAMILY" == debian ]]; then
    run adduser --disabled-password --gecos "" "$ADMIN_USER"
  else
    run useradd -m -U -s /bin/bash "$ADMIN_USER"
  fi
fi
run usermod -aG "$ADMIN_GROUP" "$ADMIN_USER"
if [[ "$FAMILY" == arch || "$FAMILY" == suse ]]; then
  # Arch ships %wheel commented out; openSUSE asks for the root password (targetpw) by default
  write_file /etc/sudoers.d/90-panel-admin 0440 <<EOF
Defaults:$ADMIN_USER !targetpw
$ADMIN_USER ALL=(ALL:ALL) ALL
EOF
  is_dry || visudo -cf /etc/sudoers.d/90-panel-admin >/dev/null || die "Invalid sudoers drop-in."
fi

if is_dry && ! id "$ADMIN_USER" &>/dev/null; then
  USER_HOME="/home/$ADMIN_USER" USER_GROUP="$ADMIN_USER"
else
  USER_HOME=$(getent passwd "$ADMIN_USER" | cut -d: -f6)
  USER_GROUP=$(id -gn "$ADMIN_USER")
fi
AUTH_KEYS="$USER_HOME/.ssh/authorized_keys"
run install -d -m 700 -o "$ADMIN_USER" -g "$USER_GROUP" "$USER_HOME/.ssh"
run touch "$AUTH_KEYS"
if [[ -n "$SSH_PUBKEY" ]]; then
  append_line "$AUTH_KEYS" "$SSH_PUBKEY"
elif [[ -s /root/.ssh/authorized_keys ]]; then
  # Copy the key the provider put on root
  if is_dry; then
    echo "    + copy /root/.ssh/authorized_keys to $AUTH_KEYS"
  else
    cat /root/.ssh/authorized_keys >>"$AUTH_KEYS"
    sort -u "$AUTH_KEYS" -o "$AUTH_KEYS"
  fi
fi
run chown "$ADMIN_USER:$USER_GROUP" "$AUTH_KEYS"
run chmod 600 "$AUTH_KEYS"

# ---------------------------------------------------------------------------
log "3/9 SSH hardening"
if [[ "$IS_WSL" == "1" ]]; then
  note "WSL: skipped. Administer the machine through Windows (OpenSSH for Windows / RDP), then 'wsl -d <distro> -u root'."
elif is_dry || [[ -s "$AUTH_KEYS" ]]; then
  # Root login is about to be disabled, so the user MUST have a sudo password or we lock ourselves out.
  if ! is_dry && no_password "$ADMIN_USER"; then
    [[ -t 0 ]] || die "$ADMIN_USER has no password and the terminal is not interactive. Run 'passwd $ADMIN_USER' first."
    log "Set a sudo password for $ADMIN_USER:"
    until passwd "$ADMIN_USER"; do warn "Try again."; done
  fi
  # sshd uses the FIRST value it reads and reads sshd_config.d alphabetically. Cloud images ship
  # 50-cloud-init.conf with "PasswordAuthentication yes", so our file must come first (00-).
  run rm -f /etc/ssh/sshd_config.d/99-panel-hardening.conf
  write_file /etc/ssh/sshd_config.d/00-panel-hardening.conf <<EOF
Port $SSH_PORT
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
PubkeyAuthentication yes
MaxAuthTries 3
LoginGraceTime 30
X11Forwarding no
AllowUsers $ADMIN_USER
EOF
  # Some distros (older openSUSE) do not include sshd_config.d from the main config
  if [[ -f /etc/ssh/sshd_config ]] && ! grep -qiE '^\s*Include\s+/etc/ssh/sshd_config\.d/' /etc/ssh/sshd_config; then
    run sed -i '1i Include /etc/ssh/sshd_config.d/*.conf' /etc/ssh/sshd_config
  fi
  if [[ "$SSH_PORT" != "22" ]]; then
    # SELinux only lets sshd bind to ports labelled ssh_port_t
    if [[ "$SELINUX" != disabled ]]; then
      run semanage port -a -t ssh_port_t -p tcp "$SSH_PORT" 2>/dev/null ||
        run semanage port -m -t ssh_port_t -p tcp "$SSH_PORT"
    fi
    # Ubuntu 24.04 starts SSH via socket activation; the port comes from the socket unit
    if unit_exists ssh.socket; then
      write_file /etc/systemd/system/ssh.socket.d/port.conf <<EOF
[Socket]
ListenStream=
ListenStream=$SSH_PORT
EOF
      [[ "$FIREWALL" == ufw ]] && run ufw allow "$SSH_PORT"/tcp comment 'SSH'
      [[ "$FIREWALL" == firewalld ]] && fw_cmd --add-port="$SSH_PORT"/tcp
      run systemctl daemon-reload
      run systemctl restart ssh.socket
    fi
  fi
  if is_dry; then
    run sshd -t
    run systemctl restart "$SSH_UNIT"
  else
    sshd -t && { systemctl restart "$SSH_UNIT" || systemctl enable --now "$SSH_UNIT"; }
    # Verify the effective setting (another file may override ours)
    if sshd -T 2>/dev/null | grep -qx 'passwordauthentication no' && sshd -T 2>/dev/null | grep -qx 'permitrootlogin no'; then
      log "SSH: root and password logins disabled. Only '$ADMIN_USER' can log in, with a key."
    else
      warn "Another file overrides the SSH settings! Check: sshd -T | grep -E 'passwordauth|permitroot'"
    fi
  fi
else
  warn "authorized_keys is EMPTY. SSH hardening SKIPPED so you are not locked out."
  warn "Run the script again with SSH_PUBKEY."
fi

# ---------------------------------------------------------------------------
log "4/9 Firewall ($FIREWALL)"
firewall_setup

# ---------------------------------------------------------------------------
log "5/9 fail2ban"
if [[ "$IS_WSL" == "1" ]]; then
  note "WSL: skipped (no public SSH inside WSL)."
else
  BANACTION=""
  [[ "$FIREWALL" == firewalld ]] && BANACTION="banaction = firewallcmd-rich-rules"
  write_file /etc/fail2ban/jail.d/sshd.local <<EOF
[sshd]
enabled  = true
port     = $SSH_PORT
backend  = systemd
maxretry = 5
findtime = 10m
bantime  = 1h
$BANACTION
EOF
  run systemctl enable --now fail2ban
  run systemctl restart fail2ban
fi

# ---------------------------------------------------------------------------
log "6/9 Swap ($SWAP_SIZE) and sysctl"
if [[ "$IS_WSL" == "1" ]]; then
  note "WSL: swap skipped; WSL manages memory and swap via %UserProfile%\\.wslconfig."
elif swapon --show 2>/dev/null | grep -q '/swapfile'; then
  note "/swapfile already active."
else
  make_swapfile
fi
write_file /etc/sysctl.d/99-panel.conf <<EOF
vm.swappiness=10
vm.vfs_cache_pressure=50
fs.inotify.max_user_watches=524288
# The panel's DNS binds to the Tailscale addresses; if Docker starts before Tailscale at boot,
# allow binding before the address exists (otherwise the panel container does not start)
net.ipv4.ip_nonlocal_bind=1
net.ipv6.ip_nonlocal_bind=1
EOF
if is_dry; then run sysctl --system; else sysctl --system >/dev/null || warn "Some sysctl settings were not applied."; fi

# ---------------------------------------------------------------------------
log "7/9 Docker"
install_docker() {
  case "$FAMILY" in
    debian)
      local repo=debian codename="${VERSION_CODENAME:-}"
      if [[ "$OS_ID" == ubuntu || " $OS_LIKE " == *" ubuntu "* ]]; then
        repo=ubuntu codename="${UBUNTU_CODENAME:-$codename}"
      fi
      run install -m 0755 -d /etc/apt/keyrings
      run curl -fsSL "https://download.docker.com/linux/$repo/gpg" -o /etc/apt/keyrings/docker.asc
      run chmod a+r /etc/apt/keyrings/docker.asc
      write_file /etc/apt/sources.list.d/docker.list <<EOF
deb [arch=$(dpkg --print-architecture 2>/dev/null || echo amd64) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/$repo $codename stable
EOF
      run apt-get update -y
      pkg_install docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
    fedora | rhel)
      local repo=fedora
      [[ "$FAMILY" == rhel ]] && repo=centos
      [[ "$OS_ID" == rhel ]] && repo=rhel
      run curl -fsSL "https://download.docker.com/linux/$repo/docker-ce.repo" -o /etc/yum.repos.d/docker-ce.repo
      # --allowerasing replaces conflicting podman-docker / runc packages
      run dnf -y install --allowerasing docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
      ;;
    arch | suse)
      pkg_install docker docker-compose
      # The panel builds through its own buildx; the host one is only nice to have
      pkg_install docker-buildx || warn "docker-buildx not available from the distro repos."
      ;;
  esac
}
if have dockerd; then
  note "Docker Engine already installed."
else
  install_docker
fi

# Keep container logs from filling the disk
if is_dry || [[ ! -f /etc/docker/daemon.json ]]; then
  write_file /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": { "max-size": "10m", "max-file": "3" },
  "live-restore": true
}
EOF
  run systemctl restart docker || true
fi
run systemctl enable --now docker
run usermod -aG docker "$ADMIN_USER"
if ! is_dry && ! docker compose version &>/dev/null; then
  warn "'docker compose' (v2 plugin) is not available. Install your distro's compose v2 plugin."
fi
if [[ "$SELINUX" == enforcing ]]; then
  note "SELinux is enforcing (left as is). The panel and Caddy run with 'label=disable' (see docker-compose.yml)"
  note "so their host mounts (/, docker.sock, /opt/panel) work. Do not relabel / with ':z'."
fi

# NOTE: Docker bypasses ufw/firewalld for published ports (it writes iptables/nftables rules
# directly). That is why app containers NEVER use "ports:"; everything goes through Caddy
# on the 'panel-apps' network. Only Caddy publishes 80/443.

# The panel cleans unused images/build cache itself (Settings -> Disk cleanup).
# Remove the cron job left by older installs.
run rm -f /etc/cron.weekly/docker-prune

# ---------------------------------------------------------------------------
log "8/9 Panel directories"
run install -d -m 750 -o "$ADMIN_USER" -g "$USER_GROUP" /opt/panel /opt/panel/data /opt/panel/backups /opt/panel/compose

# ---------------------------------------------------------------------------
# The panel is closed to the internet; only devices on your tailnet can open it.
# `tailscale serve` forwards raw TCP on the host's Tailscale addresses :443 to 127.0.0.1:8443
# (Caddy) with a PROXY header carrying the device's Tailscale IP. Caddy terminates TLS: the
# panel's .ts.net certificate comes from tailscaled, "Tailscale only" domains use Let's Encrypt.
log "9/9 Tailscale"
if ! have tailscale; then
  run sh -c 'curl -fsSL https://tailscale.com/install.sh | sh'
fi
run systemctl enable --now tailscaled

if is_dry; then
  run tailscale up --hostname "$TS_HOSTNAME" "${TS_AUTHKEY:+--authkey=<TS_AUTHKEY>}"
elif ! tailscale status &>/dev/null; then
  if [[ -n "$TS_AUTHKEY" ]]; then
    tailscale up --authkey "$TS_AUTHKEY" --hostname "$TS_HOSTNAME"
  else
    log "Open the link below in a browser and approve this machine with your Tailscale account:"
    tailscale up --hostname "$TS_HOSTNAME"
  fi
fi
firewall_trust_iface tailscale0

if is_dry; then
  TS_NAME="<machine>.<tailnet>.ts.net" TS_IP="100.x.y.z" TS_IP6="fd7a:..."
  run tailscale serve --bg --tcp=443 --proxy-protocol=2 tcp://127.0.0.1:8443
else
  TS_NAME=$(tailscale status --json | jq -r '.Self.DNSName' | sed 's/\.$//')
  TS_IP=$(tailscale ip -4 2>/dev/null | head -1)
  TS_IP6=$(tailscale ip -6 2>/dev/null | head -1)
  tailscale serve reset >/dev/null 2>&1 || true
  if tailscale serve --bg --tcp=443 --proxy-protocol=2 tcp://127.0.0.1:8443 >/dev/null 2>&1; then
    log "Panel (Tailscale only): https://$TS_NAME"
  else
    warn "tailscale serve failed. Try manually:  tailscale serve --bg --tcp=443 --proxy-protocol=2 tcp://127.0.0.1:8443"
  fi
  # Only a check that a certificate can be issued (Caddy fetches it from tailscaled itself).
  # Written to a temp dir so the private key is not left in the working directory.
  CERT_TMP=$(mktemp -d)
  if ! tailscale cert --cert-file "$CERT_TMP/c.crt" --key-file "$CERT_TMP/c.key" "$TS_NAME" >/dev/null 2>&1; then
    warn "Could not get a Tailscale certificate: enable 'MagicDNS' and 'HTTPS Certificates' under DNS in the Tailscale admin console."
  fi
  rm -rf "$CERT_TMP"
fi

# Optional: close SSH to the internet too (Tailscale only). If Tailscale breaks you can only
# reach the server through your provider's web console; use it only if you know what you do.
if [[ "$SSH_TAILSCALE_ONLY" == "1" && "$IS_WSL" != "1" ]]; then
  if [[ -n "$TS_IP" ]]; then
    firewall_close_ssh_public
    log "SSH is now reachable only over Tailscale: ssh $ADMIN_USER@$TS_IP"
  else
    warn "Tailscale is not connected; SSH left open to the internet for safety."
  fi
fi

echo
log "Setup finished."
if [[ "$IS_WSL" == "1" ]]; then
  ADDR_HINT="the Windows host's LAN/public IPv4 (mirrored networking) or this distro's eth0 address (NAT mode, see install-windows.ps1)"
else
  ADDR_HINT="addresses on this server's interfaces: $(host_addresses)
     (the public IPs from your provider; 100.x / fd7a: are Tailscale and 172.x are Docker, do not use those)"
fi
cat <<EOF

Next steps:
  1) Test the login in a NEW terminal (do not close this session!):
       ssh -p $SSH_PORT $ADMIN_USER@<server-ip>
  2) Install Tailscale on your computer and phone and sign in with the same account.
  3) Put the panel code in /opt/panel/src (git clone or rsync), as $ADMIN_USER.
  4) cd /opt/panel/src/deploy && cp .env.example .env && nano .env
       PANEL_DOMAIN=$TS_NAME
       TAILSCALE_IPV4=$TS_IP
       TAILSCALE_IPV6=$TS_IP6
       PUBLIC_IPV4 / PUBLIC_IPV6: $ADDR_HINT
  5) docker compose up -d --build
  6) docker logs panel   -> copy the first-run setup token
  7) From a device on your tailnet open https://$TS_NAME and finish the setup.
  8) To update the panel from the panel:  sudo bash /opt/panel/src/deploy/install-updater.sh

EOF
