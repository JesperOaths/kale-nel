#!/usr/bin/env python3
"""Samsung HT-E6500 Bluetooth source selection: FUNCTION rather than SOURCE.

The Samsung HT-E6500 manual instructs FUNCTION until 'BT', 'WAIT', 'READY'.
Keep BR/EDR discovery running throughout the whole bounded input sweep.
Never transmit the HTS POWER key in this pipeline.
"""
from pathlib import Path
import datetime,json,re,shutil,subprocess,sys
P=Path('/home/jespern/c720p-home-hub/bin/c720p-samsung-bluetooth-connect.sh')
s=P.read_text()
MARK='C720P_HTS_MANUAL_FUNCTION_BT_V128'
if MARK in s:
 print(json.dumps({'ok':True,'already_applied':True}));sys.exit(0)
assert s.count('SOURCE_CYCLES=8')==1
assert s.count('--es command source_input')==1
assert s.count('HTS custom-input-cycle')==1
assert s.count('bluetoothctl --timeout 45 scan bredr')==1
s=s.replace('SOURCE_CYCLES=8', '''# C720P_HTS_MANUAL_FUNCTION_BT_V128
# The HT-E6500's documented pairing sequence uses FUNCTION until BT, WAIT,
# READY, never the SOURCE_INPUT code. Keep POWER strictly separate.
SOURCE_CYCLES=8''',1)
s=s.replace('--es command source_input','--es command function',1)
s=s.replace('HTS custom-input-cycle','HTS FUNCTION-to-BT cycle',1)
s=s.replace('''  # Give the HT-E6500 its proven source-settle / BT WAIT -> READY window.
  # Continuous BlueZ discovery still removes the expensive per-cycle scan setup.
  sleep 2.0''','''  # Samsung manual: BT -> WAIT 2 seconds -> READY.
  # Allow READY to advertise before scanning/connecting.
  sleep 2.6''',1)
s=s.replace('bluetoothctl --timeout 45 scan bredr',
'''bluetoothctl --timeout 155 scan bredr''',1)
# Never require a *new scan line* from an already paired speaker.
# Some BlueZ versions suppress discovery announcements for cached devices,
# even while a fresh RFCOMM/A2DP connection becomes possible.
s=s.replace('''        if wait_live_seen 6 && connect_seen_device; then
          echo "Bluetooth link acquired after custom-input-cycle $i"
          break
        fi''','''        # Try already-paired MAC even if discovery suppressed its advertisement.
        # These calls cannot toggle the receiver's IR power.
        if wait_live_seen 4; then
          echo "Samsung Bluetooth appeared in live discovery at FUNCTION cycle $i"
        fi
        timeout 4 bluetoothctl connect "$MAC" >/dev/null 2>&1 || true
        if is_connected || (wait_live_seen 3 && connect_seen_device); then
          echo "Bluetooth link acquired after HTS FUNCTION cycle $i"
          break
        fi''',1)
assert '--es command source_input' not in s
assert s.count(MARK)==1
assert 'bluetoothctl --timeout 155 scan bredr' in s
if '--dry-run' in sys.argv:
 print(json.dumps({'ok':True,'dry_run':True,'function_source':True,
   'scan_remains_active':True,'tries_cached_paired_mac':True,'no_hts_power':True}))
 sys.exit(0)
stamp=datetime.datetime.now().strftime('%Y%m%d_%H%M%S')
bak=Path('/home/jespern/c720p-backups')/('hts-manual-function-bt-v128-'+stamp)
bak.mkdir(parents=True,exist_ok=False)
shutil.copy2(P,bak/(P.name+'.before'))
try:
 mode=P.stat().st_mode
 P.write_text(s);P.chmod(mode)
 check=subprocess.run(['bash','-n',str(P)],capture_output=True,text=True,timeout=15)
 if check.returncode:raise RuntimeError(check.stderr)
 print(json.dumps({'ok':True,'version':'V128','backup':str(bak),'function_selects_bt':True,'scan_duration_s':155,'no_power_toggles':True}))
except BaseException:
 shutil.copy2(bak/(P.name+'.before'),P)
 raise
