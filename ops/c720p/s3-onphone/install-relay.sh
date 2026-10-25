#!/usr/bin/env bash
set -euo pipefail
ROOT=/home/jespern/c720p-home-hub
UNITS=/home/jespern/.config/systemd/user
SRC=https://raw.githubusercontent.com/JesperOaths/kale-nel/b84b02912225feb6b5bc7aafdcc04b5f2189e8cc/ops/c720p/s3-onphone/adb-motion-relay.py
mkdir -p "$ROOT/bin" "$UNITS"
curl -fsSL "$SRC" -o "$ROOT/bin/s3-bedroom-onphone-relay.py"
chmod 755 "$ROOT/bin/s3-bedroom-onphone-relay.py"
python3 -m py_compile "$ROOT/bin/s3-bedroom-onphone-relay.py"
test -f "$ROOT/config/s3-bedroom-motion.json"
# Stop/disable CPU-heavy hub-side screenshots and OpenCV analysis.
systemctl --user disable --now c720p-s3-bedroom-motion.service || true
cat > "$UNITS/c720p-s3-bedroom-onphone-relay.service" <<'UNIT'
[Unit]
Description=Relay native S3 motion events over Wi-Fi ADB (no hub image processing)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
ExecStart=/usr/bin/python3 /home/jespern/c720p-home-hub/bin/s3-bedroom-onphone-relay.py
Restart=always
RestartSec=8
WorkingDirectory=/home/jespern/c720p-home-hub

[Install]
WantedBy=default.target
UNIT
systemctl --user daemon-reload
systemctl --user enable --now c720p-s3-bedroom-onphone-relay.service
systemctl --user show c720p-s3-bedroom-onphone-relay.service -p ActiveState -p NRestarts
systemctl --user show c720p-s3-bedroom-motion.service -p ActiveState
echo S3_ONPHONE_RELAY_INSTALLED
