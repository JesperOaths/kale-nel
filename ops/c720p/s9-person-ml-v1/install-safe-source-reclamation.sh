#!/usr/bin/env bash
# Automatic phone-internal staging cleanup after *two* verified durable copies.
set -Eeuo pipefail
umask 077
ROOT="$HOME/c720p-home-hub"
UNIT="$HOME/.config/systemd/user"
mkdir -p "$ROOT/bin" "$UNIT"
SOURCE="https://raw.githubusercontent.com/JesperOaths/kale-nel/18c0f48340fca11f50bc70ef72e65907ac120b50/ops/c720p/s9-person-ml-v1/clean-verified-ipwebcam-source.py"
curl -fsSL "$SOURCE" -o "$ROOT/bin/c720p-s9-staging-cleanup.py.new"
python3 -m py_compile "$ROOT/bin/c720p-s9-staging-cleanup.py.new"
mv "$ROOT/bin/c720p-s9-staging-cleanup.py.new" "$ROOT/bin/c720p-s9-staging-cleanup.py"
chmod 700 "$ROOT/bin/c720p-s9-staging-cleanup.py"
cat > "$UNIT/c720p-s9-staging-cleanup.service" <<EOF
[Unit]
Description=Remove only doubly-verified IP Webcam internal staging, preserve S9 microSD+Drive
After=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/bin/python3 $ROOT/bin/c720p-s9-staging-cleanup.py --apply
TimeoutStartSec=240
Nice=14
CPUQuota=25%
IOSchedulingClass=best-effort
IOSchedulingPriority=7
EOF
cat > "$UNIT/c720p-s9-staging-cleanup.timer" <<'EOF'
[Unit]
Description=Safe S9 temporary internal video staging reclamation
[Timer]
OnBootSec=9min
OnUnitInactiveSec=12min
RandomizedDelaySec=25s
AccuracySec=30s
Persistent=true
Unit=c720p-s9-staging-cleanup.service
[Install]
WantedBy=timers.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now c720p-s9-staging-cleanup.timer
echo TIMER_ENABLED:
systemctl --user is-active c720p-s9-staging-cleanup.timer
