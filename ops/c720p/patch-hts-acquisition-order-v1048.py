#!/usr/bin/env python3
from pathlib import Path
import ast, json, shutil, subprocess, time

TARGET = Path("/home/jespern/c720p-home-hub/bin/c720p-bluetooth-helper-server.py")
s = TARGET.read_text(encoding="utf-8")
tree = ast.parse(s)
node = next((n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "prepare_hts_bluetooth"), None)
if node is None:
    raise SystemExit("prepare_hts_bluetooth_not_found")

replacement = r'''def prepare_hts_bluetooth(steps):
    """Acquire HTS Bluetooth without blindly toggling an already-on receiver.

    Order:
      1. Fast-path an existing Bluetooth/audio connection.
      2. If OFF is explicitly known from a verified command shadow, power on.
      3. Otherwise sweep sources first; success proves the receiver was already on.
      4. Only after a failed sweep use the guarded single-toggle ON route.
      5. After boot, hand off to connect_audio() for the final source sweep.
    """
    before = bt_connected_info()
    steps.append({"stage":"hts_bluetooth","check":"initial_bluetooth_connection","result":before})
    if before.get("connected"):
        return {
            "hts_power":"confirmed_on_by_active_bluetooth",
            "hts_input":"confirmed_bluetooth_by_active_connection",
            "skipped_ir":True,
            "evidence":before,
        }

    power = get_json("/ht-e6500/power-state", timeout=8)
    steps.append({"stage":"hts_power","check":"initial_power_state","result":power})

    presence = power.get("presence") if isinstance(power.get("presence"), dict) else {}
    shadow = presence.get("shadow") if isinstance(presence.get("shadow"), dict) else {}
    shadow_state = str(shadow.get("state") or "").lower()
    shadow_source = str(shadow.get("source") or "")
    explicit_off = bool(
        str(power.get("state") or "").lower() == "off"
        or (
            shadow_state == "off"
            and shadow_source == "verified_absence_after_single_power_toggle"
        )
    )

    def read_connector_state():
        try:
            obj = json.loads(Path(STATE).read_text(encoding="utf-8"))
            return obj if isinstance(obj, dict) else {}
        except Exception:
            return {}

    def source_ring_probe(label, timeout=60):
        res = run([CONNECT], timeout=timeout)
        parsed = read_connector_state()
        res["state_json"] = parsed
        ok = bool(
            isinstance(parsed, dict)
            and parsed.get("bluetooth_connected")
            and parsed.get("audio_sink_present")
            and parsed.get("audio_sink_default")
        )
        steps.append({
            "stage":"hts_bluetooth",
            "action":label,
            "result":res,
        })
        return ok, parsed, res

    # Unknown is not OFF. First try to acquire BT without touching power.
    if not explicit_off:
        acquired, parsed, probe = source_ring_probe("source_ring_before_any_power_toggle")
        if acquired:
            return {
                "hts_power":"existing_on_confirmed_by_source_ring",
                "hts_input":"confirmed_bluetooth_by_active_connection",
                "power_toggle_sent":False,
                "preconnected_audio":True,
                "source_cycles":parsed.get("source_cycles"),
                "evidence":power,
            }

    # The receiver is explicitly OFF, or a full source sweep found no live BT
    # path. Use the guarded ON route: exactly one toggle at most, never retry.
    power_on = post_json("/ht-e6500/on", timeout=20)
    steps.append({
        "stage":"hts_power",
        "action":"guarded_ensure_on_after_failed_or_known_off_source_probe",
        "result":power_on,
    })
    if not power_on.get("ok"):
        return {
            "hts_power":"failed",
            "hts_input":"failed",
            "failure":"HTS_POWER_COMMAND_FAILED",
            "single_power_toggle_limit":True,
            "evidence":power_on,
        }

    # Give the physical receiver a real boot window before the final source sweep.
    time.sleep(15.0)
    return {
        "hts_power":"commanded_on_unverified",
        "hts_input":"source_cycle_ready",
        "power_toggle_sent":power_on.get("action") == "single_power_toggle",
        "single_power_toggle_limit":True,
        "evidence":power,
        "power_result":power_on,
    }
'''

lines = s.splitlines(keepends=True)
new_s = ''.join(lines[:node.lineno-1]) + replacement + "\n\n" + ''.join(lines[node.end_lineno:])

stamp = time.strftime("%Y%m%d_%H%M%S")
backup = Path("/home/jespern/c720p-backups") / ("v1048-hts-acquisition-order-" + stamp)
backup.mkdir(parents=True, exist_ok=True)
shutil.copy2(TARGET, backup / (TARGET.name + ".before"))

TARGET.write_text(new_s, encoding="utf-8")
subprocess.run(["python3", "-m", "py_compile", str(TARGET)], check=True)
subprocess.run(["systemctl", "--user", "restart", "c720p-bluetooth-helper.service"], check=True)
time.sleep(2)

print("PATCH=APPLIED")
print("BACKUP=" + str(backup))
print("SOURCE_SWEEP_BEFORE_POWER_TOGGLE=1")
print("GUARDED_ON_ROUTE=1")
print("BOOT_WAIT_SECONDS=15")
