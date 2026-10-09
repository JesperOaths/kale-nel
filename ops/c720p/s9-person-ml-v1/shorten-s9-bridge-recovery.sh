#!/usr/bin/env bash
set -Eeuo pipefail
UNIT="$HOME/.config/systemd/user/c720p-s9-edge-bridge.timer"
cp -a "$UNIT" "$UNIT.before-rapid-recovery"
python3 - "$UNIT" <<'PY'
from pathlib import Path
import sys
p=Path(sys.argv[1]);s=p.read_text()
assert "OnUnitActiveSec=45s" in s
assert "AccuracySec=10s" in s
s=s.replace("OnUnitActiveSec=45s","OnUnitActiveSec=15s").replace("AccuracySec=10s","AccuracySec=3s")
p.write_text(s)
PY
systemctl --user daemon-reload
systemctl --user restart c720p-s9-edge-bridge.timer
systemctl --user start c720p-s9-edge-bridge.service
systemctl --user is-active c720p-s9-edge-bridge.timer
