#!/usr/bin/env python3
from pathlib import Path
import shutil,time,subprocess

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
CONNECTOR=BASE/"bin/c720p-samsung-bluetooth-connect.sh"
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"v876-discovery-window-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
shutil.copy2(CONNECTOR,BACK/"c720p-samsung-bluetooth-connect.sh.before")

s=CONNECTOR.read_text(encoding="utf-8")
a=s.index("quick_pair_connect(){")
b=s.index("\n}\n\nif ! is_connected",a)+2

new=r'''quick_pair_connect(){
  # Proven 2026-09-26 behavior: keep BR/EDR inquiry alive while the
  # HT-E6500 is in its short BT READY window. Do NOT remove the device:
  # a known/trusted BlueZ object is useful state, not stale state.
  timeout 3 bluetoothctl pairable on >/dev/null 2>&1 || true
  timeout 3 bluetoothctl agent NoInputNoOutput >/dev/null 2>&1 || true
  timeout 3 bluetoothctl default-agent >/dev/null 2>&1 || true
  timeout 3 bluetoothctl trust "$MAC" >/dev/null 2>&1 || true

  timeout 10 bluetoothctl scan bredr >/tmp/c720p-hts-bt-scan.out 2>&1 &
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

  kill "$scan_pid" >/dev/null 2>&1 || true
  wait "$scan_pid" 2>/dev/null || true
  timeout 3 bluetoothctl scan off >/dev/null 2>&1 || true

  is_connected
}'''

s=s[:a]+new+s[b:]
CONNECTOR.write_text(s,encoding="utf-8")
CONNECTOR.chmod(0o755)
subprocess.run(["bash","-n",str(CONNECTOR)],check=True)
print("BACKUP="+str(BACK))
print("RESULT=V876_DISCOVERY_PAIR_WINDOW_PATCHED")
