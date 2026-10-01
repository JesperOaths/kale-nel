#!/usr/bin/env bash
set -uo pipefail
MAC=8C:C8:CD:8B:06:3B
SER=993e96d0
LOG=/tmp/v1034-bt-screensaver-wake.log
rm -f "$LOG"

bluetoothctl pairable on >/dev/null 2>&1 || true
bluetoothctl agent NoInputNoOutput >/dev/null 2>&1 || true
bluetoothctl default-agent >/dev/null 2>&1 || true
bluetoothctl --timeout 25 scan bredr >"$LOG" 2>&1 &
scan_pid=$!

for _ in $(seq 1 30); do
  grep -qE 'Discovery started|Discovering: yes' "$LOG" 2>/dev/null && break
  sleep 0.1
done
if ! grep -qE 'Discovery started|Discovering: yes' "$LOG" 2>/dev/null; then
  kill "$scan_pid" >/dev/null 2>&1 || true
  wait "$scan_pid" 2>/dev/null || true
  echo RESULT=DISCOVERY_NOT_STARTED
  exit 2
fi

# Samsung manual: any remote button wakes the BT READY screen saver.
# Use a +1/-1 pair so the net volume is unchanged if the receiver is awake.
for cmd in volume_up volume_down; do
  adb -s "$SER" shell am broadcast     -n com.bruis.s5irbridge/.IrReceiver     -a com.bruis.s5irbridge.SEND     --es device ht_e6500     --es command "$cmd" >/tmp/v1034-ir.out 2>/tmp/v1034-ir.err || true
  sleep 0.35
done

visible=0
for _ in $(seq 1 48); do
  if bluetoothctl info "$MAC" >/tmp/v1034-info.out 2>&1; then visible=1; break; fi
  sleep 0.25
done

kill "$scan_pid" >/dev/null 2>&1 || true
wait "$scan_pid" 2>/dev/null || true
bluetoothctl scan off >/dev/null 2>&1 || true

echo "VISIBLE=$visible"
tail -80 "$LOG" 2>/dev/null || true
if [ "$visible" -eq 1 ]; then
  cat /tmp/v1034-info.out
  /home/jespern/c720p-home-hub/bin/c720p-samsung-bluetooth-connect.sh || true
  bluetoothctl info "$MAC" 2>&1 || true
  pactl get-default-sink 2>&1 || true
  pactl list short sinks 2>&1 || true
  echo RESULT=BT_SCREENSAVER_WAKE_FOUND_SAMSUNG
  exit 0
fi
echo RESULT=BT_SCREENSAVER_WAKE_NO_SAMSUNG
exit 3
