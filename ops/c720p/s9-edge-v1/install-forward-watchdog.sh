#!/usr/bin/env bash
set -Eeuo pipefail
UNITDIR="$HOME/.config/systemd/user"
BIN="$HOME/c720p-home-hub/bin"
mkdir -p "$UNITDIR" "$BIN"
cat > "$BIN/c720p-s9-edge-bridge-health.sh" <<'EOF'
#!/usr/bin/env bash
set -Eeuo pipefail
PHONE="192.168.178.250:5555"
if ! /usr/bin/adb -s "$PHONE" get-state 2>/dev/null | grep -q '^device$';then
 /usr/bin/adb connect "$PHONE" >/dev/null
fi
if ! /usr/bin/adb forward --list | grep -F "$PHONE tcp:18798 tcp:8798" >/dev/null;then
 /usr/bin/adb -s "$PHONE" forward tcp:18798 tcp:8798 >/dev/null
fi
if ! /usr/bin/adb forward --list | grep -F "$PHONE tcp:18799 tcp:8799" >/dev/null;then
 /usr/bin/adb -s "$PHONE" forward tcp:18799 tcp:8799 >/dev/null
fi
curl -fsS --max-time 3 http://127.0.0.1:18798/status |
 python3 -c 'import json,sys;d=json.load(sys.stdin);assert d.get("ok") and d.get("frame_age_ms",9999)<4000, "s9_edge_stale"; print("ok frames="+str(d.get("frames"))+" events="+str(d.get("event_seq")))'
curl -fsS --max-time 3 http://127.0.0.1:18799/status |
 python3 -c 'import json,sys;d=json.load(sys.stdin);assert d.get("ok") and d.get("model_ready") and d.get("frame_age_ms",9999)<4000, "s9_gpu_ml_stale"; print("person_model="+str(d.get("backend"))+" inferences="+str(d.get("inferences")))'
EOF
chmod 700 "$BIN/c720p-s9-edge-bridge-health.sh"
cat > "$UNITDIR/c720p-s9-edge-bridge.service" <<EOF
[Unit]
Description=Maintain private S9+ edge detector ADB bridge
After=network-online.target
[Service]
Type=oneshot
ExecStart=$BIN/c720p-s9-edge-bridge-health.sh
TimeoutStartSec=20
EOF
cat > "$UNITDIR/c720p-s9-edge-bridge.timer" <<'EOF'
[Unit]
Description=Revalidate S9+ on-device motion bridge
[Timer]
OnBootSec=40s
OnUnitActiveSec=45s
AccuracySec=10s
Unit=c720p-s9-edge-bridge.service
[Install]
WantedBy=timers.target
EOF
systemctl --user daemon-reload
systemctl --user enable --now c720p-s9-edge-bridge.timer
systemctl --user start c720p-s9-edge-bridge.service
systemctl --user status c720p-s9-edge-bridge.service --no-pager -l | head -15
