#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$HOME/.config/systemd/user"
cp deploy/openunum.service "$HOME/.config/systemd/user/openunum.service"
systemctl --user daemon-reload
systemctl --user enable --now openunum.service
systemctl --user status openunum.service --no-pager
