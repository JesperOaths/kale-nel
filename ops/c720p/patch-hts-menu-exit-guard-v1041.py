#!/usr/bin/env python3
from pathlib import Path
import shutil, time, subprocess

TARGET = Path("/home/jespern/c720p-home-hub/bin/c720p-samsung-bluetooth-connect.sh")
MARKER = "# C720P_HTS_MENU_EXIT_GUARD_V1041"
text = TARGET.read_text(encoding="utf-8")

if MARKER in text:
    print("RESULT=ALREADY_APPLIED")
    raise SystemExit(0)

anchor = '''if ! is_connected; then
  echo "Starting one continuous BR/EDR discovery session for the source ring"
'''
if anchor not in text:
    raise SystemExit("source_ring_anchor_missing")

stamp = time.strftime("%Y%m%d_%H%M%S")
backup_dir = Path("/home/jespern/c720p-backups") / f"v1041-hts-menu-exit-guard-{stamp}"
backup_dir.mkdir(parents=True, exist_ok=True)
shutil.copy2(TARGET, backup_dir / (TARGET.name + ".before"))

replacement = '''if ! is_connected; then
  # C720P_HTS_MENU_EXIT_GUARD_V1041
  # Source/Input is context-sensitive while an HTS menu is open. Normalize the
  # UI through the surround service before the bounded source ring. No power
  # command is involved.
  timeout 10 curl -sS -X POST "$SURROUND_BASE/ht-e6500/exit" >/dev/null 2>&1 || true
  sleep 0.6
  echo "Starting one continuous BR/EDR discovery session for the source ring"
'''

text = text.replace(anchor, replacement, 1)
TARGET.write_text(text, encoding="utf-8")
subprocess.run(["bash", "-n", str(TARGET)], check=True)

print("RESULT=PATCH_APPLIED")
print("MENU_EXIT_GUARD=1")
print("POWER_COMMANDS_ADDED=0")
print("BACKUP=" + str(backup_dir))
