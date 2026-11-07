#!/usr/bin/env bash
# Closes SSH to the internet and leaves it open only over Tailscale. Lockout-safe:
#   sudo bash ssh-tailscale-only.sh            -> applies, and REVERTS by itself after 5 minutes
#   (log in over Tailscale from a new terminal, then)
#   sudo bash ssh-tailscale-only.sh --confirm  -> cancels the revert, makes it permanent
#   sudo bash ssh-tailscale-only.sh --revert   -> opens SSH to the internet again
# Works with ufw (Debian/Ubuntu/Arch) and firewalld (Fedora/RHEL/openSUSE).
set -euo pipefail
# Do not fail silently: say where it stopped
trap 'echo "ERROR: line $LINENO failed; if nothing was changed, SSH is as it was." >&2' ERR

[[ $EUID -eq 0 ]] || { echo "Run with sudo"; exit 1; }
# awk reads all output (if it exited early sshd would get SIGPIPE and pipefail would stop the script silently)
PORT=$( { sshd -T 2>/dev/null || true; } | awk '$1=="port"{p=$2} END{print p}')
PORT=${PORT:-22}
echo "SSH port: $PORT"
TIMER=panel-ssh-revert

if command -v ufw >/dev/null && ufw status 2>/dev/null | grep -q 'Status: active'; then
  FW=ufw
  REVERT_CMD=(/bin/sh -c "ufw allow $PORT/tcp comment SSH")
elif command -v firewall-cmd >/dev/null && firewall-cmd --state >/dev/null 2>&1; then
  FW=firewalld
  ZONE=$(firewall-cmd --get-default-zone)
  REVERT_CMD=(/bin/sh -c "firewall-cmd --zone=$ZONE --add-port=$PORT/tcp && firewall-cmd --permanent --zone=$ZONE --add-port=$PORT/tcp")
else
  echo "No active ufw or firewalld found; nothing to do."
  exit 1
fi

revert() {
  "${REVERT_CMD[@]}" >/dev/null
  echo "SSH is open to the internet again (port $PORT)."
}

show_rules() {
  if [[ "$FW" == ufw ]]; then
    ufw status | grep -E "^$PORT|SSH" || true
  else
    echo "zone $ZONE: $(firewall-cmd --zone="$ZONE" --list-ports) $(firewall-cmd --zone="$ZONE" --list-services)"
    echo "trusted: $(firewall-cmd --zone=trusted --list-interfaces)"
  fi
}

case "${1:-}" in
  --revert | --geri-al)
    systemctl stop "$TIMER.timer" 2>/dev/null || true
    revert
    exit 0
    ;;
  --confirm | --onayla)
    if systemctl stop "$TIMER.timer" 2>/dev/null; then
      echo "Confirmed: SSH is now permanently reachable only over Tailscale."
    else
      echo "No pending revert (already confirmed, or the timer expired and reverted)."
    fi
    show_rules
    exit 0
    ;;
  "") ;;
  *)
    echo "Unknown option: $1"
    exit 1
    ;;
esac

TS_IP=$( { tailscale ip -4 2>/dev/null || true; } | awk 'NR==1')
if [[ -z "$TS_IP" ]] || ! tailscale status >/dev/null 2>&1; then
  echo "Tailscale is not connected; SSH left open to the internet."
  exit 1
fi

if [[ "$FW" == ufw ]]; then
  # Allow SSH from the Tailscale interface (explicit, even if a general 'Tailscale' rule exists)
  ufw allow in on tailscale0 to any port "$PORT" proto tcp comment 'SSH (Tailscale)' >/dev/null
  # Close SSH from the internet (IPv4 + IPv6)
  ufw delete allow "$PORT"/tcp >/dev/null 2>&1 || true
  ufw delete allow OpenSSH >/dev/null 2>&1 || true
else
  # tailscale0 in the trusted zone reaches every port, SSH included
  firewall-cmd --zone=trusted --add-interface=tailscale0 >/dev/null 2>&1 || true
  firewall-cmd --permanent --zone=trusted --add-interface=tailscale0 >/dev/null 2>&1 || true
  for p in "" --permanent; do
    # shellcheck disable=SC2086 # $p is empty or one flag
    firewall-cmd $p --zone="$ZONE" --remove-port="$PORT"/tcp >/dev/null 2>&1 || true
    # shellcheck disable=SC2086
    firewall-cmd $p --zone="$ZONE" --remove-service=ssh >/dev/null 2>&1 || true
  done
fi

# Safety net: revert unless --confirm arrives within 5 minutes
systemctl stop "$TIMER.timer" 2>/dev/null || true
systemctl reset-failed "$TIMER.service" "$TIMER.timer" 2>/dev/null || true
systemd-run --quiet --unit="$TIMER" --on-active=300 --timer-property=AccuracySec=1s "${REVERT_CMD[@]}"

cat <<EOF

SSH is now reachable only over Tailscale. Unless confirmed within 5 MINUTES it is reverted automatically.

  1) WITHOUT closing this session, open a new terminal and log in via the Tailscale address:
       ssh -p $PORT $(logname 2>/dev/null || echo user)@$TS_IP
  2) If that worked, run there:
       sudo bash $(realpath "$0") --confirm

If you cannot log in, do nothing; after 5 minutes SSH opens to the internet again by itself.
EOF
