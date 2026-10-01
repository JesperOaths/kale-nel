#!/usr/bin/env python3
from pathlib import Path
import shutil, time

TARGET = Path("/home/jespern/c720p-home-hub/bin/c720p-samsung-bluetooth-connect.sh")
MARKER = "# C720P_BLUEZ_NATIVE_DISCOVERY_V1032"
s = TARGET.read_text(encoding="utf-8")
if MARKER in s:
    print("PATCH=ALREADY_PRESENT")
    raise SystemExit(0)

stamp=time.strftime("%Y%m%d_%H%M%S")
backup=Path("/home/jespern/c720p-backups")/("v1032-bluez-native-discovery-"+stamp)
backup.mkdir(parents=True,exist_ok=True)
shutil.copy2(TARGET,backup/"c720p-samsung-bluetooth-connect.sh.before")

old = '''  timeout 12 bluetoothctl scan bredr >/tmp/c720p-hts-bt-scan.out 2>&1 &
  scan_pid=$!

  # A removed/expired BlueZ device object cannot be paired by MAC until
'''
new = '''  # C720P_BLUEZ_NATIVE_DISCOVERY_V1032
  # BlueZ 5.82 is reliable with its own non-interactive timeout. Wrapping
  # bluetoothctl itself in GNU timeout can return after SetDiscoveryFilter
  # without Discovery actually entering the running state.
  rm -f /tmp/c720p-hts-bt-scan.out
  bluetoothctl --timeout 12 scan bredr >/tmp/c720p-hts-bt-scan.out 2>&1 &
  scan_pid=$!

  discovery_started=0
  for _ in $(seq 1 20); do
    if grep -qE 'Discovery started|Discovering: yes' /tmp/c720p-hts-bt-scan.out 2>/dev/null; then
      discovery_started=1
      break
    fi
    sleep 0.1
  done
  if [ "$discovery_started" -ne 1 ]; then
    # One bounded retry. Do not touch HTS power or source here.
    kill "$scan_pid" >/dev/null 2>&1 || true
    wait "$scan_pid" 2>/dev/null || true
    rm -f /tmp/c720p-hts-bt-scan.out
    bluetoothctl --timeout 12 scan bredr >/tmp/c720p-hts-bt-scan.out 2>&1 &
    scan_pid=$!
    for _ in $(seq 1 20); do
      if grep -qE 'Discovery started|Discovering: yes' /tmp/c720p-hts-bt-scan.out 2>/dev/null; then
        discovery_started=1
        break
      fi
      sleep 0.1
    done
  fi

  # A removed/expired BlueZ device object cannot be paired by MAC until
'''
if old not in s:
    raise SystemExit("expected_scan_block_not_found")
s=s.replace(old,new,1)

TARGET.write_text(s,encoding="utf-8")
TARGET.chmod(TARGET.stat().st_mode | 0o111)
print("PATCH=APPLIED")
print("BACKUP="+str(backup))
print("MARKER="+MARKER)
