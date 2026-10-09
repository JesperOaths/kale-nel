#!/usr/bin/env python3
"""No Samsung HTS power toggles from the TV/HDMI3/Bluetooth pipeline.

The HTS power key is a toggle: loss of Bluetooth visibility NEVER proves OFF.
Pipeline is source-only; explicit HTS On/Off controls own power changes.
Also use verified S5 Wi-Fi ADB for source cycling (not USB).
"""
from pathlib import Path
import ast,datetime,json,re,shutil,subprocess,sys
BASE=Path("/home/jespern/c720p-home-hub")
HELPER=BASE/"bin/c720p-bluetooth-helper-server.py"
CONNECTOR=BASE/"bin/c720p-samsung-bluetooth-connect.sh"
MARK="C720P_HTS_PIPELINE_NO_POWER_TOGGLE_V126"
src=HELPER.read_text()
sh=CONNECTOR.read_text()
if MARK in src and MARK in sh:
 print(json.dumps({"ok":True,"already_applied":True}));sys.exit(0)
start=src.index("def prepare_hts_bluetooth(steps):")
end=src.index("\ndef _quick_bt_connect(",start)
fn=src[start:end]
assert fn.count('power_on = post_json("/ht-e6500/on", timeout=20)')==1
assert fn.count('if not explicit_off:')==1
anchor='''    # Unknown is not OFF. First try to acquire BT without touching power.
    if not explicit_off:
'''
replacement='''    # C720P_HTS_PIPELINE_NO_POWER_TOGGLE_V126
    # Switching inputs must NEVER send the Samsung POWER key. It is a toggle.
    # A receiver in DVD, AUX, HDMI or FM can be physically ON yet disappear
    # from Bluetooth and its IP neighbor table. False "OFF" inference here
    # used to switch it OFF and strand the audio pipeline.
    if explicit_off:
        return {
            "hts_power": "known_off_not_toggled",
            "hts_input": "failed",
            "failure": "HTS_OFF_USE_SEPARATE_POWER_BUTTON",
            "power_toggle_sent": False,
            "evidence": power,
        }
    # Unknown or user-reported ON: sweep sources first, without POWER.
    if not explicit_off:
'''
assert fn.count(anchor)==1
fn=fn.replace(anchor,replacement,1)
tail_begin=fn.index('    # The receiver is explicitly OFF, or a full source sweep found no live BT')
fn=fn[:tail_begin]+'''    # Source search did not establish live Bluetooth. Fail without toggling
    # HTS power; advise the separate power control if the unit is actually OFF.
    return {
        "hts_power": "user_reported_on_no_toggle" if power.get("reported") else "unobservable_no_toggle",
        "hts_input": "adaptive_source_search_required",
        "failure": "SAMSUNG_BLUETOOTH_NOT_DETECTED_AFTER_SOURCE_SWEEP",
        "power_toggle_sent": False,
        "evidence": power,
    }


'''
assert 'post_json("/ht-e6500/on"' not in fn
src=src[:start]+fn+src[end:]
# Correct stale docstring: helper no longer powers on automatically.
src=src.replace('''      2. If OFF is explicitly known from a verified command shadow, power on.
      3. Otherwise sweep sources first; success proves the receiver was already on.
      4. Only after a failed sweep use the guarded single-toggle ON route.
      5. After boot, hand off to connect_audio() for the final source sweep.''',
'''      2. If confirmed OFF, report that the separate HTS On control is needed.
      3. Otherwise sweep source modes, with no power toggle.
      4. If Bluetooth appears, connect audio; otherwise report not detected.''',1)
assert src.count(MARK)==1
# The source-ring script used the USB-only serial even after restoring Wi-Fi ADB.
assert sh.count("timeout 8 adb -s 993e96d0 shell am broadcast")==1
assert sh.count("SOURCE_CYCLES=8")==1
sh=sh.replace("SOURCE_CYCLES=8",
'''SOURCE_CYCLES=8
# C720P_HTS_PIPELINE_NO_POWER_TOGGLE_V126
S5_IR_TARGET="[fd00::1:7a4b:87ff:fe80:eee0]:5555"
S5_EXPECTED_SERIAL="993e96d0"''',1)
sh=sh.replace('''cycle_source(){
  echo''','''cycle_source(){
  # Re-establish network transport and refuse to address a different phone.
  timeout 7 adb connect "$S5_IR_TARGET" >/dev/null 2>&1 || true
  local serial
  serial="$(timeout 6 adb -s "$S5_IR_TARGET" shell getprop ro.serialno 2>/dev/null | tr -d '\\r' || true)"
  if [ "$serial" != "$S5_EXPECTED_SERIAL" ]; then
    fail S5_WIRELESS_IR_IDENTITY_NOT_VERIFIED "S5 Wi-Fi identity mismatch; no IR issued" 31
  fi
  echo''',1)
sh=sh.replace("timeout 8 adb -s 993e96d0 shell am broadcast",
              'timeout 8 adb -s "$S5_IR_TARGET" shell am broadcast',1)
sh=sh.replace('''via S5 USB IR''','''via S5 Wi-Fi IR''')
if '--dry-run' in sys.argv:
 print(json.dumps({"ok":True,"dry_run":True,"no_power_in_pipeline":True,
 "verified_wifi_source_cycle":True,"separate_HTS_power_control":True}))
 sys.exit(0)
stamp=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
backup=Path("/home/jespern/c720p-backups")/("hts-pipeline-power-toggling-v126-"+stamp)
backup.mkdir(parents=True,exist_ok=False)
for p in [HELPER,CONNECTOR]:shutil.copy2(p,backup/(p.name+".before"))
try:
 for p,val in [(HELPER,src),(CONNECTOR,sh)]:
  mode=p.stat().st_mode;p.write_text(val);p.chmod(mode)
 checks=[["python3","-m","py_compile",str(HELPER)],["bash","-n",str(CONNECTOR)]]
 for cmd in checks:
  p=subprocess.run(cmd,capture_output=True,text=True,timeout=12)
  if p.returncode:raise RuntimeError(str(cmd)+": "+p.stderr)
 r=subprocess.run(["systemctl","--user","restart","c720p-bluetooth-helper.service"],capture_output=True,text=True,timeout=27)
 if r.returncode:raise RuntimeError(r.stderr)
 print(json.dumps({"ok":True,"version":"V126","backup":str(backup),
 "pipeline_never_toggles_hts":True,"source_controls_via_wireless_adb":True}))
except BaseException:
 for p in [HELPER,CONNECTOR]:shutil.copy2(backup/(p.name+".before"),p)
 subprocess.run(["systemctl","--user","restart","c720p-bluetooth-helper.service"],timeout=25)
 raise
