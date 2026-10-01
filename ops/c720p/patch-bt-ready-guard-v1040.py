#!/usr/bin/env python3
from pathlib import Path
import shutil, time, subprocess

TARGET = Path("/home/jespern/c720p-home-hub/bin/c720p-samsung-bluetooth-connect.sh")
s = TARGET.read_text(encoding="utf-8")

# Restore the last certified source-settle timing if the failed v1039 timing is present.
s = s.replace(
'''  # Continuous BlueZ discovery is already running. Non-BT sources do not need
  # a two-second blind pause; 0.8s here plus the following 1.5s visibility
  # window still gives BT >2s to transition WAIT -> READY.
  sleep 0.8
}''',
'''  # Give the HT-E6500 its proven source-settle / BT WAIT -> READY window.
  # Continuous BlueZ discovery still removes the expensive per-cycle scan setup.
  sleep 2.0
}''',
1,
)

anchor = '''cycles_used=0

if ! is_connected && is_paired; then
  echo "Fast connect to already-paired $NAME ($MAC)"
  try_connect || true
elif ! is_connected; then
  echo "$NAME is not paired; discovery will recreate its BlueZ object"
fi

if ! is_connected; then
  echo "Starting one continuous BR/EDR discovery session for the source ring"
  RING_SCAN_PID=
  if start_ring_discovery; then
    echo "Checking current HTS source before cycling"
    if wait_live_seen 12; then connect_seen_device || true; fi
    if ! is_connected; then
      for i in $(seq 1 "$SOURCE_CYCLES"); do
        cycles_used="$i"
        cycle_source "$i"
        echo "Checking Samsung visibility after custom-input-cycle $i"
        if wait_live_seen 6 && connect_seen_device; then
          echo "Paired and connected after custom-input-cycle $i"
          break
        fi
      done
    fi
    stop_ring_discovery
  else
    echo "BlueZ discovery did not enter running state"
    stop_ring_discovery
  fi
fi
'''

replacement = '''has_audio_sink(){
  mac_us=$(printf '%s' "$MAC" | tr ':' '_')
  pactl list short sinks 2>/dev/null | grep -qiE "$mac_us|$NAME"
}

transport_ready(){
  is_connected && has_audio_sink
}

cycles_used=0

# BlueZ can briefly retain Connected: yes after the HTS leaves BT while the
# A2DP sink has already vanished. Do not let that stale flag skip source search.
if ! transport_ready && is_paired; then
  echo "Samsung transport is not audio-ready; trying a direct reconnect first"
  try_connect || true
elif ! transport_ready; then
  echo "$NAME is not audio-ready; discovery will recreate/refresh its BlueZ object"
fi

if ! transport_ready; then
  echo "Starting one continuous BR/EDR discovery session for the source ring"
  RING_SCAN_PID=
  if start_ring_discovery; then
    echo "Checking current HTS source before cycling"
    if wait_live_seen 12; then connect_seen_device || true; fi
    if ! transport_ready; then
      for i in $(seq 1 "$SOURCE_CYCLES"); do
        cycles_used="$i"
        cycle_source "$i"
        echo "Checking Samsung visibility after custom-input-cycle $i"
        if wait_live_seen 6 && connect_seen_device; then
          echo "Bluetooth link acquired after custom-input-cycle $i"
          break
        fi
      done
    fi
    stop_ring_discovery
  else
    echo "BlueZ discovery did not enter running state"
    stop_ring_discovery
  fi
fi
'''

if anchor not in s:
    if "STALE_CONNECTED_REQUIRES_A2DP_SINK" in s:
        print("PATCH=ALREADY_PRESENT")
        raise SystemExit(0)
    raise SystemExit("acquisition_block_anchor_not_found")

stamp = time.strftime("%Y%m%d_%H%M%S")
backup = Path("/home/jespern/c720p-backups") / ("v1040-bt-ready-guard-" + stamp)
backup.mkdir(parents=True, exist_ok=True)
shutil.copy2(TARGET, backup / (TARGET.name + ".before"))

s = s.replace(anchor, replacement, 1)
s = s.replace("#!/usr/bin/env bash", "#!/usr/bin/env bash\n# STALE_CONNECTED_REQUIRES_A2DP_SINK", 1)
TARGET.write_text(s, encoding="utf-8")
subprocess.run(["bash", "-n", str(TARGET)], check=True)

print("PATCH=APPLIED")
print("BACKUP=" + str(backup))
print("SOURCE_SETTLE_SECONDS=2.0")
print("STALE_CONNECTED_REQUIRES_A2DP_SINK=1")
