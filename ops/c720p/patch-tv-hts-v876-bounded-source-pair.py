#!/usr/bin/env python3
from pathlib import Path
import shutil,time,subprocess

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
HELPER=BASE/"bin/c720p-bluetooth-helper-server.py"
CONNECTOR=BASE/"bin/c720p-samsung-bluetooth-connect.sh"
STAMP=time.strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"v876-bounded-source-pair-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
for p in (HELPER,CONNECTOR):
    shutil.copy2(p,BACK/(p.name+".before"))

# Restore proven source-cycle + pair-after-each-cycle behavior, while retaining
# the newer serialized BlueZ pairing implementation.
c=CONNECTOR.read_text(encoding="utf-8")
c=c.replace("SOURCE_CYCLES=0","SOURCE_CYCLES=8",1)
old='''if ! is_connected; then
  echo "Immediate pair/connect while receiver should be in BT READY"
  timeout 3 bluetoothctl scan off >/dev/null 2>&1 || true
  sleep 0.3
  if quick_pair_connect; then
    echo "Paired and connected in deterministic BT READY window"
  fi
fi

if ! is_connected; then
  # The orchestrator has already put the receiver on BT deterministically.
  # Stay on BT and retry pairing once; source cycling here would move away from BT.
  echo "Retry pair/connect once while staying in BT READY"
  sleep 0.35
  quick_pair_connect || true
fi
'''
new='''if ! is_connected; then
  echo "Initial pair/connect attempt on current HTS source"
  quick_pair_connect || true
fi

if ! is_connected; then
  # Proven 2026-09-26 recovery behavior: the HT-E6500 Input/FUNCTION ring
  # contains eight sources. After every source-input press, immediately test
  # the short BT READY pairing window instead of relying on passive discovery.
  for i in $(seq 1 "$SOURCE_CYCLES"); do
    cycle_source "$i"
    echo "Quick pair/connect after source-cycle $i"
    if quick_pair_connect; then
      echo "Paired and connected after source-cycle $i"
      break
    fi
  done
fi
'''
if old not in c:
    raise SystemExit("current connector deterministic-only block not found")
c=c.replace(old,new,1)
CONNECTOR.write_text(c,encoding="utf-8")
subprocess.run(["bash","-n",str(CONNECTOR)],check=True)

s=HELPER.read_text(encoding="utf-8")
new_connect=r'''def connect_audio(steps):
    live = read_state()
    if live.get("bluetooth_connected") and live.get("audio_sink_present") and live.get("audio_sink_default"):
        sink = live.get("audio_sink") or "bluez_sink.8C_C8_CD_8B_06_3B.a2dp_sink"
        sinks = run(["pactl","list","short","sinks"], timeout=3)
        inputs = run(["pactl","list","short","sink-inputs"], timeout=3)
        sink_index = None
        for line in (sinks.get("stdout") or "").splitlines():
            parts=line.split()
            if len(parts)>1 and parts[1]==sink:
                sink_index=parts[0]; break
        wrong=[]
        if sink_index is not None:
            for line in (inputs.get("stdout") or "").splitlines():
                parts=line.split()
                if len(parts)>1 and parts[1] != sink_index:
                    wrong.append(line)
        if sink_index is not None and not wrong:
            result={
                "bluetooth_connected":True,
                "audio_sink_present":True,
                "audio_sink_default":True,
                "audio_sink":sink,
                "streams_moved":True,
                "fast_path":"already_connected_default_sink_and_streams_correct",
            }
            steps.append({"stage":"acer_bluetooth_audio","action":"fast_verify_existing_audio_route","result":result})
            return {"ok":True,"result":result,"adaptive_source_cycles":0}

    if _quick_bt_connect(steps,"quick_connect_current_hts_source",timeout=3):
        # Let the connector normalize sink/default/streams even after a quick link.
        pass

    # Single owner for source acquisition: the connector performs a bounded
    # source_input ring and attempts pair/connect after every source press.
    res=run([CONNECT], timeout=190)
    stdout=res.get("stdout") or ""
    parsed=None
    try:
        parsed=json.loads(Path(STATE).read_text(encoding="utf-8"))
    except Exception:
        pos=stdout.rfind("{")
        if pos >= 0:
            try: parsed=json.loads(stdout[pos:])
            except Exception: parsed=None
    res["state_json"]=parsed
    steps.append({"stage":"acer_bluetooth_audio","action":"bounded_source_cycle_pair_connect_select_sink","result":res})
    if not isinstance(parsed,dict) or not parsed.get("bluetooth_connected"):
        return {"ok":False,"failure":"SAMSUNG_DEVICE_NOT_CONNECTED","result":res}
    if not parsed.get("audio_sink_present"):
        return {"ok":False,"failure":"SAMSUNG_AUDIO_SINK_NOT_FOUND","result":res}
    if not parsed.get("audio_sink_default"):
        return {"ok":False,"failure":"DEFAULT_SINK_NOT_CHANGED","result":res}
    return {"ok":True,"result":parsed,"adaptive_source_cycles":parsed.get("source_cycles",8)}


'''
a=s.index("def connect_audio(steps):")
b=s.index("\ndef arm_s5_display(steps):",a)
s=s[:a]+new_connect+s[b:]
HELPER.write_text(s,encoding="utf-8")
subprocess.run(["python3","-m","py_compile",str(HELPER)],check=True)
subprocess.run(["systemctl","--user","restart","c720p-bluetooth-helper.service"],check=True)
time.sleep(1)
print("BACKUP="+str(BACK))
print("CONNECTOR_SOURCE_CYCLES_8="+str("SOURCE_CYCLES=8" in CONNECTOR.read_text()).lower())
print("HELPER_ACTIVE="+subprocess.run(["systemctl","--user","is-active","c720p-bluetooth-helper.service"],text=True,capture_output=True).stdout.strip())
print("RESULT=V876_BOUNDED_SOURCE_PAIR_PATCHED")
