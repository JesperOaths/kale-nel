#!/usr/bin/env python3
"""Fix the C720P Eco living-room timer/action mismatch (14 October 2026).

This only changes the long Eco maximum-on automation. The distinct five-minute
camera-motion timers and their explicit manual ownership rules stay unchanged.
The Eco countdown already uses the combined living-room proxy, whose off action
turns off the physical ceiling light AND the plug lamp.
"""
import argparse
import datetime
import json
import os
from pathlib import Path
import shutil
import sqlite3
import subprocess
import tempfile
import time

PATH = Path("/opt/homeassistant/config/packages/c720p_energy_saver_v1.yaml")
START = "  - id: c720p_energy_saver_living_lamp_v1\n"
END = "  - id: c720p_living_camera_ownership_reset\n"
OLD_CONDITIONS = '''      - condition: state
        entity_id: input_boolean.c720p_living_camera_owned
        state: "on"
      - condition: state
        entity_id: switch.lamp_woonkamer_socket_1
        state: "on"
'''
NEW_CONDITIONS = '''      - condition: state
        entity_id: light.c720p_ui_living_room_lights
        state: "on"
'''
OLD_ELAPSED = "states.switch.lamp_woonkamer_socket_1.last_changed"
NEW_ELAPSED = "states.light.c720p_ui_living_room_lights.last_changed"
OLD_ACTION = '''    action:
      - action: switch.turn_off
        target:
          entity_id: switch.lamp_woonkamer_socket_1
      - action: input_boolean.turn_off
        target:
          entity_id: input_boolean.c720p_living_camera_owned
'''
NEW_ACTION = '''    action:
      # Eco is the configured maximum continuous ON time, independent of who
      # turned on the light. Manual control remains exempt from the separate
      # five-minute MOTION timer, not from the explicitly enabled Eco cap.
      - action: light.turn_off
        target:
          entity_id: light.c720p_ui_living_room_lights
      # One transient integration miss must not leave the ceiling powered.
      - delay: "00:00:03"
      - if:
          - condition: state
            entity_id: light.c720p_ui_living_room_lights
            state: "on"
        then:
          - action: light.turn_off
            target:
              entity_id: light.woonkamer_plafond
          - action: switch.turn_off
            target:
              entity_id: switch.lamp_woonkamer_socket_1
      - action: input_boolean.turn_off
        target:
          entity_id: input_boolean.c720p_living_camera_owned
      - action: timer.cancel
        target:
          entity_id: timer.c720p_living_camera_motion
'''

def patch(source):
    if source.count(START) != 1 or source.count(END) != 1:
        raise RuntimeError("Unexpected or missing Eco automation boundaries")
    head, tail = source.split(START, 1)
    target, rest = tail.split(END, 1)
    # Do not modify the bedtime/bedroom Eco, five-minute motion, or presence logic.
    if (NEW_CONDITIONS in target and NEW_ELAPSED in target
            and NEW_ACTION in target):
        return source, False
    for old in (OLD_CONDITIONS, OLD_ELAPSED, OLD_ACTION):
        if target.count(old) != 1:
            raise RuntimeError("Eco source drift; safe patch refused")
    if "states.light.c720p_ui_living_room_lights.last_changed" not in head:
        raise RuntimeError("Displayed living-room countdown no longer uses group")
    target = (target.replace(OLD_CONDITIONS, NEW_CONDITIONS, 1)
                    .replace(OLD_ELAPSED, NEW_ELAPSED, 1)
                    .replace(OLD_ACTION, NEW_ACTION, 1))
    out = head + START + target + END + rest
    assert out.split(START, 1)[0] == head
    assert out.split(END, 1)[1] == rest
    return out, True

def run(args, timeout=100):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError("Command failed: " + " ".join(args[:3]) +
                           "\n" + (result.stdout + result.stderr)[-1400:])
    return result.stdout

def replace_atomically(path, data):
    fd, name = tempfile.mkstemp(prefix=".eco-expiry-", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
        shutil.copystat(path, name)
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def verify_automation_enabled():
    code = '''import sqlite3
db=sqlite3.connect("file:/config/home-assistant_v2.db?mode=ro",uri=True)
for entity in ["automation.c720p_eco_guard_living_lamp_auto_off",
               "automation.c720p_eco_guard_bedroom_auto_off"]:
 row=db.execute("select s.state from states s join states_meta m on s.metadata_id=m.metadata_id where m.entity_id=? order by s.state_id desc limit 1",(entity,)).fetchone()
 if not row or row[0]!="on": raise SystemExit(entity+" not enabled: "+str(row))
print("ECO_AUTOMATIONS_ENABLED")
'''
    return run(["docker", "exec", "homeassistant", "python", "-c", code], 20).strip()

def check_config():
    run(["docker", "exec", "homeassistant", "python", "-m",
         "homeassistant", "--script", "check_config", "-c", "/config"], 130)

def restart_and_wait():
    run(["docker", "restart", "-t", "30", "homeassistant"], 90)
    for attempt in range(65):
        x = subprocess.run(["curl", "-fsS", "--max-time", "2", "-o",
                            "/dev/null", "http://127.0.0.1:8123/"],
                           capture_output=True)
        if x.returncode == 0:
            time.sleep(6)
            return
        time.sleep(2)
    raise RuntimeError("HA failed health check after restart")

def main():
    p = argparse.ArgumentParser()
    p.add_argument("--apply", action="store_true")
    args = p.parse_args()
    if not PATH.exists():
        raise RuntimeError("Original Eco package missing")
    before = PATH.read_text()
    after, changed = patch(before)
    if not changed:
        print(json.dumps({"status": "already_applied", "enabled": verify_automation_enabled()}))
        return
    print(json.dumps({"status": "validated_patch", "changed": changed,
                      "physical_lights_toggled": False}))
    if not args.apply:
        print("DRY_RUN_ONLY")
        return
    backup_dir = Path("/home/jespern/c720p-backups")
    backup_dir.mkdir(exist_ok=True, parents=True)
    name = "eco-before-expiry-" + datetime.datetime.now().strftime("%Y%m%dT%H%M%S") + ".yaml"
    backup = backup_dir / name
    shutil.copy2(PATH, backup)
    try:
        replace_atomically(PATH, after)
        check_config()
        restart_and_wait()
        if PATH.read_text() != after:
            raise RuntimeError("On-disk configuration was unexpectedly changed")
        enabled = verify_automation_enabled()
        print(json.dumps({"status": "deployed", "config_check": "passed",
                          "automation": enabled, "backup": str(backup),
                          "physical_lights_toggled": False}))
    except Exception:
        replace_atomically(PATH, before)
        try:
            restart_and_wait()
        except Exception as rollback_error:
            print("ROLLBACK_RESTART_FAILED: " + str(rollback_error))
        raise

if __name__ == "__main__":
    main()
