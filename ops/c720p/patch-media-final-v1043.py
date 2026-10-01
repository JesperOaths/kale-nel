#!/usr/bin/env python3
from pathlib import Path
import shutil, time, subprocess

BASE = Path("/home/jespern/c720p-home-hub/bin")
SERVER = BASE / "ht-e6500-surround-server.py"
CONNECTOR = BASE / "c720p-samsung-bluetooth-connect.sh"
STAMP = time.strftime("%Y%m%d_%H%M%S")
BACKUP = Path("/home/jespern/c720p-backups") / f"v1043-media-final-{STAMP}"
BACKUP.mkdir(parents=True, exist_ok=True)

server = SERVER.read_text(encoding="utf-8")
connector = CONNECTOR.read_text(encoding="utf-8")

server_marker = "# C720P_HTS_OFF_FAST_FINAL_V1043"
connector_marker = "# C720P_HTS_MENU_EXIT_GUARD_V1043"

if server_marker not in server:
    old_verify = '''    deadline = time.monotonic() + 8.0
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
'''
    new_verify = '''    # C720P_HTS_OFF_FAST_FINAL_V1043
    # ON still requires live receiver presence. For OFF, BlueZ can retain
    # Connected: yes long after the receiver has dropped its A2DP transport.
    # Confirm OFF from the combination of no HTS network presence and no
    # Samsung A2DP sink; never send a second POWER toggle.
    deadline = time.monotonic() + (8.0 if want_on else 5.0)
    time.sleep(0.55)
    while True:
        final = receiver_present(fast=True)
        checks.append(final)
        if want_on:
            if bool(final.get("present")):
                confirmed = True
                break
        else:
            net_final = final.get("network") if isinstance(final.get("network"), dict) else {}
            sink_probe = run(["pactl", "list", "short", "sinks"], timeout=2)
            sink_text = ((sink_probe.get("stdout") or "") + "\n" + (sink_probe.get("stderr") or "")).lower()
            mac_us = HT_E6500_BT_MAC.upper().replace(":", "_").lower()
            samsung_sink_present = bool(mac_us in sink_text or "samsunghts-8b063b" in sink_text)
            final["audio_sink_present"] = samsung_sink_present
            if not bool(net_final.get("present")) and not samsung_sink_present:
                confirmed = True
                break
        if time.monotonic() >= deadline:
            break
        time.sleep(0.35)
'''
    if old_verify not in server:
        raise SystemExit("server_verification_anchor_missing")
    shutil.copy2(SERVER, BACKUP / (SERVER.name + ".before"))
    server = server.replace(old_verify, new_verify, 1)

    old_power = '''    # A command shadow is never independent evidence.  It is retained only as
    # UI/debug context.  Live network/BlueZ presence may prove ON; absence does
    # not prove OFF because this receiver can have networking/Bluetooth asleep.
    power_state="on" if live_present else "unknown"
    present=live_present
'''
    new_power = '''    # A verified/reconciled OFF shadow is allowed to override a stale BlueZ
    # Connected: yes flag. A raw commanded shadow is still not independent
    # evidence; only these post-verification sources are authoritative for OFF.
    verified_off_shadow = bool(
        shadow_fresh
        and shadow_state == "off"
        and str(shadow.get("source") or "") in {
            "verified_absence_after_single_power_toggle",
            "reconciled_absence_after_off_toggle",
        }
        and not bool(net.get("present"))
    )
    if verified_off_shadow:
        power_state="off"
    elif live_present:
        power_state="on"
    else:
        power_state="unknown"
    present=live_present
'''
    if old_power not in server:
        raise SystemExit("server_power_state_anchor_missing")
    server = server.replace(old_power, new_power, 1)

if connector_marker not in connector:
    old_ring = '''if ! transport_ready; then
  echo "Starting one continuous BR/EDR discovery session for the source ring"
'''
    new_ring = '''if ! transport_ready; then
  # C720P_HTS_MENU_EXIT_GUARD_V1043
  # Source/Input is context-sensitive when an HTS menu is open. Normalize the
  # OSD through the existing surround service before source acquisition.
  # This never touches receiver power.
  timeout 10 curl -sS -X POST "$SURROUND_BASE/ht-e6500/exit" >/dev/null 2>&1 || true
  sleep 0.6
  echo "Starting one continuous BR/EDR discovery session for the source ring"
'''
    if old_ring not in connector:
        raise SystemExit("connector_source_ring_anchor_missing")
    shutil.copy2(CONNECTOR, BACKUP / (CONNECTOR.name + ".before"))
    connector = connector.replace(old_ring, new_ring, 1)

SERVER.write_text(server, encoding="utf-8")
CONNECTOR.write_text(connector, encoding="utf-8")

subprocess.run(["python3", "-m", "py_compile", str(SERVER)], check=True)
subprocess.run(["bash", "-n", str(CONNECTOR)], check=True)

print("RESULT=PATCH_APPLIED")
print("BACKUP=" + str(BACKUP))
print("HTS_OFF_FAST_FINAL=1")
print("HTS_MENU_EXIT_GUARD=1")
print("POWER_RETRY_ADDED=0")
