#!/usr/bin/env python3
from pathlib import Path
import shutil, time, subprocess

TARGET = Path("/home/jespern/c720p-home-hub/bin/ht-e6500-surround-server.py")
s = TARGET.read_text(encoding="utf-8")

old = '''    # Event-driven verification; return as soon as the requested receiver state is observable.
    checks = []
    final = None
    confirmed = False
    deadline = time.monotonic() + (9.0 if want_on else 8.0)
    time.sleep(0.35)
    while True:
        final = receiver_present()
        checks.append(final)
        final_state = str(final.get("power_state") or "unknown").lower()
        if final_state == wanted or bool(final.get("present")) == bool(want_on):
            confirmed = True
            break
        if time.monotonic() >= deadline:
            break
        time.sleep(0.55)

    result = {
'''

new = '''    # Event-driven verification after a single power command. Use the fast
    # live probe: the slow hcitool-name path can consume most of the verification
    # window by itself.
    checks = []
    final = None
    confirmed = False
    deadline = time.monotonic() + (8.0 if want_on else 6.0)
    time.sleep(0.55)
    while True:
        final = receiver_present(fast=True)
        checks.append(final)
        if bool(final.get("present")) == bool(want_on):
            confirmed = True
            break
        if time.monotonic() >= deadline:
            break
        time.sleep(0.35)

    # During shutdown live presence can briefly overwrite the just-written OFF
    # shadow while Bluetooth tears down. Re-assert OFF only after absence has
    # actually been observed.
    if confirmed and not want_on:
        _write_hts_power_shadow(
            "off",
            "verified_absence_after_single_power_toggle",
            previous_state=before_state,
        )

    result = {
'''

if old not in s:
    if "verified_absence_after_single_power_toggle" in s:
        print("PATCH=ALREADY_PRESENT")
        raise SystemExit(0)
    raise SystemExit("verification_block_not_found")

stamp = time.strftime("%Y%m%d_%H%M%S")
backup = Path("/home/jespern/c720p-backups") / ("v1046-hts-power-verify-" + stamp)
backup.mkdir(parents=True, exist_ok=True)
shutil.copy2(TARGET, backup / (TARGET.name + ".before"))

TARGET.write_text(s.replace(old, new, 1), encoding="utf-8")
subprocess.run(["python3", "-m", "py_compile", str(TARGET)], check=True)
subprocess.run(["systemctl", "--user", "restart", "ht-e6500-surround.service"], check=True)
time.sleep(2)

print("PATCH=APPLIED")
print("BACKUP=" + str(backup))
print("FAST_POST_POWER_VERIFY=1")
print("VERIFIED_OFF_SHADOW=1")
