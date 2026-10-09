#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$HOME/c720p-home-hub"
BIN="$ROOT/bin"
UNIT="$HOME/.config/systemd/user"
mkdir -p "$BIN" "$UNIT"
curl -fsSL https://raw.githubusercontent.com/JesperOaths/kale-nel/8e8e57f725dbf7b4109707f0a5b064888c16126f/ops/c720p/s9-person-ml-v1/local-sd-catalog.py -o "$BIN/c720p-s9-local-sd-catalog.py.new"
python3 -m py_compile "$BIN/c720p-s9-local-sd-catalog.py.new"
mv "$BIN/c720p-s9-local-sd-catalog.py.new" "$BIN/c720p-s9-local-sd-catalog.py"
chmod 700 "$BIN/c720p-s9-local-sd-catalog.py"
cat > "$UNIT/c720p-s9-local-sd-catalog.service" <<EOF
[Unit]
Description=Build verified local S9 microSD Security clip catalog
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 $BIN/c720p-s9-local-sd-catalog.py
TimeoutStartSec=160
Nice=12
CPUQuota=20%
IOSchedulingClass=best-effort
IOSchedulingPriority=7
EOF
cat > "$UNIT/c720p-s9-local-sd-catalog.timer" <<'EOF'
[Unit]
Description=Refresh S9 local SD security clips
[Timer]
OnBootSec=4min
OnUnitInactiveSec=3min
RandomizedDelaySec=12s
AccuracySec=25s
Persistent=true
[Install]
WantedBy=timers.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now c720p-s9-local-sd-catalog.timer
systemctl --user start c720p-s9-local-sd-catalog.service
systemctl --user is-active c720p-s9-local-sd-catalog.timer
