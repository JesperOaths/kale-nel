#!/usr/bin/env python3
from pathlib import Path
import shutil, time

TARGET = Path("/opt/homeassistant/config/www/c720p-tv-surround.html")
MARKER = "C720P_HTS_OFF_UI_WINDOW_V1053"
text = TARGET.read_text(encoding="utf-8")

if MARKER in text:
    print("RESULT=ALREADY_APPLIED")
    raise SystemExit(0)

old = '  const deadline=Date.now()+(target==="on"?75000:14000);'
new = '''  // C720P_HTS_OFF_UI_WINDOW_V1053
  // HT-E6500/BlueZ teardown can remain observable for ~37s after the single
  // guarded POWER command. Poll until real BT+A2DP disappearance instead of
  // falsely timing out at 14s. This does not resend POWER.
  const deadline=Date.now()+(target==="on"?75000:45000);'''

if old not in text:
    raise SystemExit("hts_deadline_anchor_missing")

stamp = time.strftime("%Y%m%d_%H%M%S")
backup = Path("/home/jespern/c720p-backups") / f"v1053-hts-ui-off-window-{stamp}"
backup.mkdir(parents=True, exist_ok=True)
shutil.copy2(TARGET, backup / (TARGET.name + ".before"))

TARGET.write_text(text.replace(old,new,1), encoding="utf-8")
print("PATCH=APPLIED")
print("VERSION=v1053")
print("HTS_OFF_UI_MAX_SECONDS=45")
print("POWER_RETRY_ADDED=0")
print("BACKUP="+str(backup))
