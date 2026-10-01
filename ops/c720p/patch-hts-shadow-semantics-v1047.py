#!/usr/bin/env python3
from pathlib import Path
import shutil, time, subprocess

TARGET = Path("/home/jespern/c720p-home-hub/bin/ht-e6500-surround-server.py")
s = TARGET.read_text(encoding="utf-8")

anchor = '''    # A previous unconfirmed toggle is a temporary interlock. While it is fresh
'''
insert = '''    # A fresh verified/commanded OFF shadow is positive evidence for the next
    # ON request. Conversely, an OFF request against the same fresh shadow must
    # not emit another toggle.
    commanded_state = str(before.get("commanded_state") or "").lower()
    if bool(before.get("shadow_fresh")) and commanded_state == "off":
        if want_on:
            before_state = "off"
            before_on = False
        else:
            return {
                "ok": True,
                "confirmed": True,
                "state": "off",
                "action": "none_recent_guarded_off_command",
                "wanted": wanted,
                "presence_before": before,
                "presence_after": before,
                "guard": "fresh_off_shadow_prevents_double_toggle",
            }

'''
if "fresh_off_shadow_prevents_double_toggle" not in s:
    if anchor not in s:
        raise SystemExit("fresh_off_anchor_not_found")
    s = s.replace(anchor, insert + anchor, 1)

old = '''    if before_on == bool(want_on):
        return {
'''
new = '''    if before_state in {"on", "off"} and before_on == bool(want_on):
        return {
'''
if old in s:
    s = s.replace(old, new, 1)
elif new not in s:
    raise SystemExit("known_state_guard_anchor_not_found")

stamp = time.strftime("%Y%m%d_%H%M%S")
backup = Path("/home/jespern/c720p-backups") / ("v1047-hts-shadow-semantics-" + stamp)
backup.mkdir(parents=True, exist_ok=True)
shutil.copy2(TARGET, backup / (TARGET.name + ".before"))

TARGET.write_text(s, encoding="utf-8")
subprocess.run(["python3", "-m", "py_compile", str(TARGET)], check=True)
subprocess.run(["systemctl", "--user", "restart", "ht-e6500-surround.service"], check=True)
time.sleep(2)

print("PATCH=APPLIED")
print("BACKUP=" + str(backup))
print("FRESH_OFF_CAN_POWER_ON=1")
print("UNKNOWN_OFF_NO_FALSE_CONFIRM=1")
