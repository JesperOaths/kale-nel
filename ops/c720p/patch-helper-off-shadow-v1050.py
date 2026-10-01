#!/usr/bin/env python3
from pathlib import Path
import shutil, time, subprocess

TARGET = Path("/home/jespern/c720p-home-hub/bin/c720p-bluetooth-helper-server.py")
s = TARGET.read_text(encoding="utf-8")

old = '''            shadow_state == "off"
            and shadow_source == "verified_absence_after_single_power_toggle"
'''
new = '''            shadow_state == "off"
            and shadow_source in {
                "verified_absence_after_single_power_toggle",
                "reconciled_absence_after_off_toggle",
            }
'''
if old not in s:
    if "reconciled_absence_after_off_toggle" in s:
        print("PATCH=ALREADY_PRESENT")
        raise SystemExit(0)
    raise SystemExit("explicit_off_source_anchor_not_found")

stamp = time.strftime("%Y%m%d_%H%M%S")
backup = Path("/home/jespern/c720p-backups") / ("v1050-helper-off-shadow-" + stamp)
backup.mkdir(parents=True, exist_ok=True)
shutil.copy2(TARGET, backup / (TARGET.name + ".before"))

TARGET.write_text(s.replace(old, new, 1), encoding="utf-8")
subprocess.run(["python3", "-m", "py_compile", str(TARGET)], check=True)
subprocess.run(["systemctl", "--user", "restart", "c720p-bluetooth-helper.service"], check=True)
time.sleep(2)

print("PATCH=APPLIED")
print("BACKUP=" + str(backup))
print("RECONCILED_OFF_ACCEPTED=1")
