#!/usr/bin/env bash
set -uo pipefail
MAC=8C:C8:CD:8B:06:3B
LOG=/tmp/v1041-endpoint-ring-scan.log
rm -f "$LOG"

bluetoothctl --timeout 50 scan bredr >"$LOG" 2>&1 &
spid=$!

for _ in $(seq 1 30); do
  grep -qE 'Discovery started|Discovering: yes' "$LOG" 2>/dev/null && break
  sleep 0.1
done

found=0
cycle=0
for i in $(seq 1 8); do
  curl -sS -X POST --max-time 8 http://127.0.0.1:8789/ht-e6500/source-input-fast >/tmp/v1041-source.json 2>/dev/null || true
  for _ in $(seq 1 12); do
    sleep 0.25
    if grep -qi "$MAC" "$LOG" 2>/dev/null && bluetoothctl info "$MAC" >/dev/null 2>&1; then
      found=1
      cycle=$i
      break 2
    fi
  done
done

kill "$spid" >/dev/null 2>&1 || true
wait "$spid" 2>/dev/null || true
bluetoothctl scan off >/dev/null 2>&1 || true

echo "FOUND=$found"
echo "FOUND_CYCLE=$cycle"
