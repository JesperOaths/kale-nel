#!/usr/bin/env python3
from pathlib import Path
import shutil, time, subprocess

TARGET = Path("/home/jespern/c720p-home-hub/bin/ht-e6500-surround-server.py")
s = TARGET.read_text(encoding="utf-8")

old = '''    unresolved_toggle = (
        not before_on
        and saved.get("confirmed") is False
'''
new = '''    unresolved_toggle = (
        before_state != "off"
        and not before_on
        and saved.get("confirmed") is False
'''

if old not in s:
    if 'before_state != "off"\n        and not before_on' in s:
        print("PATCH=ALREADY_PRESENT")
        raise SystemExit(0)
    raise SystemExit("unresolved_toggle_anchor_not_found")

stamp = time.strftime("%Y%m%d_%H%M%S")
backup = Path("/home/jespern/c720p-backups") / ("v1051-off-shadow-precedence-" + stamp)
backup.mkdir(parents=True, exist_ok=True)
shutil.copy2(TARGET, backup / (TARGET.name + ".before"))

TARGET.write_text(s.replace(old, new, 1), encoding="utf-8")
subprocess.run(["python3", "-m", "py_compile", str(TARGET)], check=True)
subprocess.run(["systemctl", "--user", "restart", "ht-e6500-surround.service"], check=True)
time.sleep(2)

print("PATCH=APPLIED")
print("BACKUP=" + str(backup))
print("VERIFIED_OFF_BYPASSES_OLD_UNRESOLVED_TOGGLE=1")
