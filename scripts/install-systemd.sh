#!/usr/bin/env bash
set -euo pipefail
mkdir -p "$HOME/.config/systemd/user"
cp deploy/openunum.service "$HOME/.config/systemd/user/openunum.service"
cp deploy/openunum-autonomy-cycle.service "$HOME/.config/systemd/user/openunum-autonomy-cycle.service"
cp deploy/openunum-autonomy-cycle.timer "$HOME/.config/systemd/user/openunum-autonomy-cycle.timer"
systemctl --user daemon-reload
systemctl --user enable --now openunum.service
systemctl --user enable --now openunum-autonomy-cycle.timer
systemctl --user status openunum.service --no-pager
systemctl --user status openunum-autonomy-cycle.timer --no-pager
