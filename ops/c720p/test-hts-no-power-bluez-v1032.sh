#!/usr/bin/env bash
set -uo pipefail
MAC=8C:C8:CD:8B:06:3B
SER=993e96d0
LOG=/tmp/v1032-no-power-source-ring-scan.log
rm -f "$LOG"

bluetoothctl pairable on >/dev/null 2>&1 || true
bluetoothctl agent NoInputNoOutput >/dev/null 2>&1 || true
bluetoothctl default-agent >/dev/null 2>&1 || true
bluetoothctl --timeout 55 scan bredr >"$LOG" 2>&1 &
scan_pid=$!

started=0
for _ in $(seq 1 30); do
  if grep -qE 'Discovery started|Discovering: yes' "$LOG" 2>/dev/null; then started=1; break; fi
  sleep 0.1
done
echo "DISCOVERY_STARTED=$started"
if [ "$started" -ne 1 ]; then
  kill "$scan_pid" >/dev/null 2>&1 || true
  wait "$scan_pid" 2>/dev/null || true
  echo "RESULT=DISCOVERY_NOT_STARTED"
  exit 2
fi

visible=0
visible_cycle=-1
for cycle in $(seq 0 8); do
  if bluetoothctl info "$MAC" >/tmp/v1032-samsung-info.out 2>&1; then
    visible=1; visible_cycle=$cycle; break
  fi
  [ "$cycle" -eq 8 ] && break
  echo "SOURCE_INPUT_CYCLE=$((cycle+1))"
  adb -s "$SER" shell am broadcast     -n com.bruis.s5irbridge/.IrReceiver     -a com.bruis.s5irbridge.SEND     --es device ht_e6500     --es command source_input >/tmp/v1032-ir.out 2>/tmp/v1032-ir.err || true
  for probe in $(seq 1 12); do
    sleep 0.25
    if bluetoothctl info "$MAC" >/tmp/v1032-samsung-info.out 2>&1; then
      visible=1; visible_cycle=$((cycle+1)); break 2
    fi
  done
done

kill "$scan_pid" >/dev/null 2>&1 || true
wait "$scan_pid" 2>/dev/null || true
bluetoothctl scan off >/dev/null 2>&1 || true

echo "VISIBLE=$visible"
echo "VISIBLE_CYCLE=$visible_cycle"
echo "===SCAN_TAIL==="
tail -80 "$LOG" 2>/dev/null || true
if [ "$visible" -eq 1 ]; then
  echo "===SAMSUNG_INFO==="
  cat /tmp/v1032-samsung-info.out
  echo "RESULT=SAMSUNG_VISIBLE_NO_POWER_TOGGLE"
  exit 0
fi
echo "RESULT=SAMSUNG_NOT_VISIBLE_NO_POWER_TOGGLE"
exit 3
