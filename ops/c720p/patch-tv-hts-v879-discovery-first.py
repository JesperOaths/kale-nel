#!/usr/bin/env python3
from pathlib import Path
import shutil,time,subprocess

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
HELPER=BASE/"bin/c720p-bluetooth-helper-server.py"
CONN=BASE/"bin/c720p-samsung-bluetooth-connect.sh"
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"v879-discovery-first-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
shutil.copy2(HELPER,BACK/HELPER.name)
shutil.copy2(CONN,BACK/CONN.name)

# Restore the source command used by the proven 2026-09-26 successful run.
s=HELPER.read_text(encoding="utf-8")
s=s.replace("post_json('/ht-e6500/function-fast', timeout=5)",
            "post_json('/ht-e6500/source', timeout=5)")
s=s.replace("'phase':'function'","'phase':'source_input'")
s=s.replace("'action':'prepower_function_cycle'","'action':'prepower_source_input_cycle'")
s=s.replace("'action':'deterministic_function_to_bt'","'action':'deterministic_source_input_to_bt'")
s=s.replace("'action':'adaptive_function_until_bt_ready'","'action':'adaptive_source_input_until_bt_ready'")
s=s.replace("f'connect_after_function_{cycle}'","f'connect_after_source_input_{cycle}'")
HELPER.write_text(s,encoding="utf-8")

c=CONN.read_text(encoding="utf-8")
c=c.replace("--es command function","--es command source_input")
c=c.replace("function-cycle","source-cycle")
c=c.replace("FUNCTION press","source-input press")

old='''  timeout 10 bluetoothctl scan bredr >/tmp/c720p-hts-bt-scan.out 2>&1 &
  scan_pid=$!
  sleep 0.8

  # Pair while discovery is still running. BlueZ can create/recreate the
  # device object as soon as the receiver advertises during BT READY.
  timeout 8 bluetoothctl --agent NoInputNoOutput pair "$MAC" 2>&1 || true
  sleep 0.35
  timeout 3 bluetoothctl trust "$MAC" >/dev/null 2>&1 || true
  if ! is_connected; then
    timeout 7 bluetoothctl connect "$MAC" 2>&1 || true
  fi
  sleep 0.6
'''
new='''  timeout 12 bluetoothctl scan bredr >/tmp/c720p-hts-bt-scan.out 2>&1 &
  scan_pid=$!

  # A removed/expired BlueZ device object cannot be paired by MAC until
  # discovery has recreated it. The HT-E6500 takes roughly two seconds to
  # transition WAIT -> READY, so wait for the object instead of racing pair.
  seen=0
  for _ in $(seq 1 24); do
    if bluetoothctl info "$MAC" >/dev/null 2>&1; then
      seen=1
      break
    fi
    sleep 0.25
  done

  if [ "$seen" -eq 1 ]; then
    # This mirrors the proven 2026-09-26 path: direct connect first. With the
    # agent active, BlueZ can pair as part of connect when the receiver is READY.
    timeout 9 bluetoothctl connect "$MAC" 2>&1 || true
    if ! is_connected; then
      timeout 8 bluetoothctl --agent NoInputNoOutput pair "$MAC" 2>&1 || true
      sleep 0.35
      timeout 3 bluetoothctl trust "$MAC" >/dev/null 2>&1 || true
      timeout 9 bluetoothctl connect "$MAC" 2>&1 || true
    fi
  fi
  sleep 0.6
'''
if old not in c:
    raise SystemExit("current quick_pair_connect block not found")
c=c.replace(old,new,1)
CONN.write_text(c,encoding="utf-8")
CONN.chmod(0o755)

subprocess.run(["python3","-m","py_compile",str(HELPER)],check=True)
subprocess.run(["bash","-n",str(CONN)],check=True)
subprocess.run(["systemctl","--user","restart","c720p-bluetooth-helper.service"],check=True)
time.sleep(1)
print("BACKUP="+str(BACK))
print("HELPER_ACTIVE="+subprocess.run(["systemctl","--user","is-active","c720p-bluetooth-helper.service"],text=True,capture_output=True).stdout.strip())
print("RESULT=V879_DISCOVERY_FIRST_PATCHED")
