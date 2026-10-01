#!/usr/bin/env python3
from pathlib import Path
import shutil, time, subprocess

TARGET = Path("/home/jespern/c720p-home-hub/bin/ht-e6500-surround-server.py")
s = TARGET.read_text(encoding="utf-8")

# Fast pre-command receiver probe for power actions.
old = '    before = receiver_present()\n    before_state = str(before.get("power_state")'
new = '    before = receiver_present(fast=True)\n    before_state = str(before.get("power_state")'
if old in s:
    s = s.replace(old, new, 1)
elif new not in s:
    raise SystemExit("fast_before_anchor_not_found")

# Give OFF a little more fast-poll time while keeping the route bounded.
s = s.replace(
    'deadline = time.monotonic() + (8.0 if want_on else 6.0)',
    'deadline = time.monotonic() + 8.0',
    1,
)

anchor = '''    if live_present:
        _write_hts_power_shadow("on","live_receiver_presence",
                                bluetooth=bt_present,network=bool(net.get("present")))

    shadow=_read_hts_power_shadow()
'''
replacement = '''    if live_present:
        _write_hts_power_shadow("on","live_receiver_presence",
                                bluetooth=bt_present,network=bool(net.get("present")))

    # Delayed OFF reconciliation: an explicitly-issued single OFF toggle can
    # outlive the HTTP verification window while BlueZ tears down. If the last
    # power result was an OFF toggle issued from live presence and the receiver
    # is now absent, promote that to a verified OFF command shadow.
    if not live_present and STATE_FILE.exists():
        try:
            saved = json.loads(STATE_FILE.read_text(encoding="utf-8"))
        except Exception:
            saved = {}
        pb = saved.get("presence_before") if isinstance(saved.get("presence_before"), dict) else {}
        try:
            saved_age = max(0, int(time.time()) - int(saved.get("updated_at") or 0))
        except Exception:
            saved_age = None
        prior_live = bool(
            pb.get("live_present")
            or pb.get("connected")
            or pb.get("bluetooth_present")
            or (isinstance(pb.get("network"), dict) and pb.get("network",{}).get("present"))
        )
        if (
            saved.get("ok") is True
            and saved.get("action") == "single_power_toggle"
            and saved.get("wanted") == "off"
            and prior_live
            and saved_age is not None
            and 1 <= saved_age <= 300
        ):
            _write_hts_power_shadow(
                "off",
                "reconciled_absence_after_off_toggle",
                previous_state="on",
                reconciled_after_seconds=saved_age,
            )

    shadow=_read_hts_power_shadow()
'''
if "reconciled_absence_after_off_toggle" not in s:
    if anchor not in s:
        raise SystemExit("reconciliation_anchor_not_found")
    s = s.replace(anchor, replacement, 1)

stamp = time.strftime("%Y%m%d_%H%M%S")
backup = Path("/home/jespern/c720p-backups") / ("v1049-hts-off-reconcile-" + stamp)
backup.mkdir(parents=True, exist_ok=True)
shutil.copy2(TARGET, backup / (TARGET.name + ".before"))

TARGET.write_text(s, encoding="utf-8")
subprocess.run(["python3", "-m", "py_compile", str(TARGET)], check=True)
subprocess.run(["systemctl", "--user", "restart", "ht-e6500-surround.service"], check=True)
time.sleep(2)

print("PATCH=APPLIED")
print("BACKUP=" + str(backup))
print("FAST_PRE_POWER_PROBE=1")
print("OFF_VERIFY_SECONDS=8")
print("DELAYED_OFF_RECONCILIATION=1")
