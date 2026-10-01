#!/usr/bin/env python3
from pathlib import Path
import shutil, time, subprocess

TARGET = Path("/home/jespern/c720p-home-hub/bin/c720p-samsung-bluetooth-connect.sh")
MARKER = "# C720P_BT_RING_STABLE_V1040"
text = TARGET.read_text(encoding="utf-8")

if MARKER in text:
    print("RESULT=ALREADY_APPLIED")
    raise SystemExit(0)

if "Starting one continuous BR/EDR discovery session for the source ring" not in text:
    raise SystemExit("continuous_discovery_ring_missing")

if "sleep 0.8" not in text:
    if "sleep 2.0" in text:
        print("RESULT=ALREADY_STABLE_2S")
        raise SystemExit(0)
    raise SystemExit("expected_source_settle_not_found")

stamp = time.strftime("%Y%m%d_%H%M%S")
backup_dir = Path("/home/jespern/c720p-backups") / f"v1040-bt-ring-stability-{stamp}"
backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(TARGET, backup_dir / (TARGET.name + ".before"))

text = text.replace(
    '  # Continuous BlueZ discovery is already running. Non-BT sources do not need\n'
    '  # a two-second blind pause; 0.8s here plus the following 1.5s visibility\n'
    '  # window still gives BT >2s to transition WAIT -> READY.\n'
    '  sleep 0.8\n',
    '  # C720P_BT_RING_STABLE_V1040\n'
    '  # 0.8s was certified too aggressive: the receiver could become visible\n'
    '  # without pairing/A2DP completing. Keep the proven 2.0s source settle.\n'
    '  sleep 2.0\n',
    1,
)

if MARKER not in text:
    text = text.replace("  sleep 0.8\n", "  " + MARKER + "\n  sleep 2.0\n", 1)

TARGET.write_text(text, encoding="utf-8")
subprocess.run(["bash", "-n", str(TARGET)], check=True)

print("RESULT=PATCH_APPLIED")
print("SOURCE_SETTLE_SECONDS=2.0")
print("BACKUP=" + str(backup_dir))
