#!/usr/bin/env bash
set -Eeuo pipefail
umask 077
ROOT="$HOME/c720p-home-hub"
UNIT="$HOME/.config/systemd/user"
mkdir -p "$ROOT/bin" "$UNIT"
SRC="https://raw.githubusercontent.com/JesperOaths/kale-nel/827df5923ca4ce170f282b6643eda550eee8ddc9/ops/c720p/s9-person-ml-v1/s9-phone-drive-sync.py"
curl -fsSL --retry 2 "$SRC" -o "$ROOT/bin/c720p-s9-phone-drive-sync.py.new"
python3 -m py_compile "$ROOT/bin/c720p-s9-phone-drive-sync.py.new"
mv "$ROOT/bin/c720p-s9-phone-drive-sync.py.new" "$ROOT/bin/c720p-s9-phone-drive-sync.py"
chmod 700 "$ROOT/bin/c720p-s9-phone-drive-sync.py"
cat > "$UNIT/c720p-s9-phone-drive-sync.service" <<EOF
[Unit]
Description=Verify and index S9+ microSD clips to private Drive
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 $ROOT/bin/c720p-s9-phone-drive-sync.py
TimeoutStartSec=600
Nice=12
CPUQuota=30%
IOSchedulingClass=best-effort
IOSchedulingPriority=7
EOF
cat > "$UNIT/c720p-s9-phone-drive-sync.timer" <<'EOF'
[Unit]
Description=Secure S9+ phone video and thumbnail archiver
[Timer]
OnBootSec=4min
OnUnitInactiveSec=7min
RandomizedDelaySec=35s
AccuracySec=30s
Persistent=true
Unit=c720p-s9-phone-drive-sync.service
[Install]
WantedBy=timers.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now c720p-s9-phone-drive-sync.timer
systemctl --user is-enabled c720p-s9-phone-drive-sync.timer
systemctl --user is-active c720p-s9-phone-drive-sync.timer
