#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
UNIT="$HOME/.config/systemd/user"
mkdir -p "$UNIT"
cat > "$UNIT/c720p-s9-native-camera-bridge.service" <<'EOF'
[Unit]
Description=S9+ Camera2 native security ADB localhost preview/status relay
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/adb connect 192.168.178.250:5555
ExecStart=/usr/bin/adb -s 192.168.178.250:5555 forward tcp:18808 tcp:8808
TimeoutStartSec=28
Nice=12
CPUQuota=12%
EOF
cat > "$UNIT/c720p-s9-native-camera-bridge.timer" <<'EOF'
[Unit]
Description=Restore native security localhost ADB forward
[Timer]
OnBootSec=90s
OnUnitInactiveSec=75s
RandomizedDelaySec=10s
Unit=c720p-s9-native-camera-bridge.service
[Install]
WantedBy=timers.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now c720p-s9-native-camera-bridge.timer
systemctl --user start c720p-s9-native-camera-bridge.service
systemctl --user is-active c720p-s9-native-camera-bridge.timer
