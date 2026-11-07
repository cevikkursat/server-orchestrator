#!/usr/bin/env bash
# =============================================================================
#  Installs the panel updater (once, as root):
#    sudo bash /opt/panel/src/deploy/install-updater.sh
#
#  When the panel asks for an update it creates /opt/panel/data/updater/request;
#  a systemd path unit sees it and runs deploy/update.sh as ADMIN_USER
#  (their SSH key is used for git, their docker group membership for docker).
#  Works on every supported distro and in WSL2 with systemd enabled.
# =============================================================================
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root: sudo bash $0" >&2; exit 1; }
[[ -d /run/systemd/system ]] || { echo "systemd is required (in WSL: [boot] systemd=true in /etc/wsl.conf)." >&2; exit 1; }

SRC=/opt/panel/src
# Default: the owner of the code (the user who ran git clone)
ADMIN_USER="${ADMIN_USER:-$(stat -c %U "$SRC")}"
ADMIN_GROUP=$(id -gn "$ADMIN_USER")
DIR=/opt/panel/data/updater

if ! command -v jq >/dev/null; then
  if command -v apt-get >/dev/null; then apt-get install -y jq
  elif command -v dnf >/dev/null; then dnf -y install jq
  elif command -v zypper >/dev/null; then zypper --non-interactive install jq
  elif command -v pacman >/dev/null; then pacman -S --needed --noconfirm jq
  else echo "Install jq first." >&2; exit 1
  fi
fi

install -d -m 750 -o "$ADMIN_USER" -g "$ADMIN_GROUP" "$DIR"

cat >/etc/systemd/system/panel-updater.service <<EOF
[Unit]
Description=Panel updater
After=docker.service network-online.target

[Service]
Type=oneshot
User=$ADMIN_USER
ExecStart=/bin/bash $SRC/deploy/update.sh
TimeoutStartSec=45min
EOF

cat >/etc/systemd/system/panel-updater.path <<EOF
[Unit]
Description=Watch for panel update requests

[Path]
PathExists=$DIR/request
Unit=panel-updater.service

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now panel-updater.path >/dev/null
date -Iseconds >"$DIR/installed"
chown "$ADMIN_USER:$ADMIN_GROUP" "$DIR/installed"
echo "Updater installed (user: $ADMIN_USER). Panel -> Settings -> Panel update."
