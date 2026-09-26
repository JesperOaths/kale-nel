from pathlib import Path
import shutil, datetime, re, subprocess, time, json, urllib.request

ts=datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
base=Path("/home/jespern/c720p-home-hub")
helper=base/"bin/c720p-bluetooth-helper-server.py"
connector=base/"bin/c720p-samsung-bluetooth-connect.sh"

for p in (helper,connector):
    shutil.copy2(p,str(p)+f".backup-deterministic-bt-{ts}")

# Make the connector pair immediately while the receiver is in BT READY,
# before falling back to arbitrary source cycling.
s=connector.read_text(encoding="utf-8")
anchor='''if ! is_connected; then
  echo "Fast connect to $NAME ($MAC)"
  try_connect || true
fi

if ! is_connected; then
'''
replacement='''if ! is_connected; then
  echo "Fast connect to $NAME ($MAC)"
  try_connect || true
fi

if ! is_connected; then
  echo "Immediate pair/connect while receiver should be in BT READY"
  bluetoothctl scan off >/dev/null 2>&1 || true
  bluetoothctl cancel-pairing "$MAC" >/dev/null 2>&1 || true
  sleep 0.3
  if quick_pair_connect; then
    echo "Paired and connected in deterministic BT READY window"
  fi
fi

if ! is_connected; then
'''
if anchor not in s:
    raise SystemExit("connector anchor not found")
s=s.replace(anchor,replacement,1)
connector.write_text(s,encoding="utf-8")

# Replace adaptive 8-source search in the HTTP orchestrator with:
# fast-connect -> deterministic BT menu -> connector pair/trust/connect -> sink verify.
s=helper.read_text(encoding="utf-8")
start=s.index("def connect_audio(steps):")
end=s.index("\ndef arm_s5_display(steps):",start)
old=s[start:end]
new=r'''def connect_audio(steps):
    live = read_state()
    if live.get("bluetooth_connected") and live.get("audio_sink_present") and live.get("audio_sink_default"):
        sink = live.get("audio_sink") or "bluez_sink.8C_C8_CD_8B_06_3B.a2dp_sink"
        sinks = run(["pactl","list","short","sinks"], timeout=3)
        inputs = run(["pactl","list","short","sink-inputs"], timeout=3)
        sink_index = None
        for line in (sinks.get("stdout") or "").splitlines():
            parts=line.split()
            if len(parts) > 1 and parts[1] == sink:
                sink_index=parts[0]
                break
        wrong=[]
        if sink_index is not None:
            for line in (inputs.get("stdout") or "").splitlines():
                parts=line.split()
                if len(parts) > 1 and parts[1] != sink_index:
                    wrong.append(line)
        if sink_index is not None and not wrong:
            result={
                "bluetooth_connected": True,
                "audio_sink_present": True,
                "audio_sink_default": True,
                "audio_sink": sink,
                "streams_moved": True,
                "fast_path": "already_connected_default_sink_and_streams_correct",
            }
            steps.append({"stage":"acer_bluetooth_audio","action":"fast_verify_existing_audio_route","result":result})
            return {"ok":True,"result":result,"adaptive_source_cycles":0}

    # Cheap first attempt in case the receiver is already on BT but BlueZ merely
    # dropped the link.
    if _quick_bt_connect(steps,"quick_connect_current_hts_source",timeout=5):
        live2=read_state()
        if live2.get("audio_sink_present") and live2.get("audio_sink_default"):
            steps.append({"stage":"acer_bluetooth_audio","action":"fast_reconnect_existing_bt_source","result":live2})
            return {"ok":True,"result":live2,"adaptive_source_cycles":0}

    # Deterministically select Bluetooth on the receiver. This route anchors the
    # HT-E6500 at BD/DVD and sends exactly seven FUNCTION presses to BT.
    btmode=post_json("/ht-e6500/bluetooth-mode", timeout=25)
    steps.append({"stage":"hts_bluetooth","action":"deterministic_bd_dvd_to_bt","result":btmode})
    if not btmode.get("ok"):
        return {"ok":False,"failure":"HTS_BLUETOOTH_MODE_FAILED","result":btmode}

    # Clear stale scan/pair activity that can make BlueZ return
    # org.bluez.Error.InProgress / br-connection-busy.
    clear=run(["bash","-lc",
        "bluetoothctl scan off >/dev/null 2>&1 || true; "
        "bluetoothctl cancel-pairing 8C:C8:CD:8B:06:3B >/dev/null 2>&1 || true; "
        "sleep 0.3"], timeout=3)
    steps.append({"stage":"acer_bluetooth_audio","action":"clear_stale_bluez_activity","result":clear})

    res=run([CONNECT], timeout=70)
    stdout=res.get("stdout") or ""
    parsed=None
    # Prefer the canonical state file written by the connector; its stdout also
    # contains progress logs and is not guaranteed to be pure JSON.
    try:
        parsed=json.loads(Path(STATE).read_text(encoding="utf-8"))
    except Exception:
        pos=stdout.rfind("{")
        if pos >= 0:
            try: parsed=json.loads(stdout[pos:])
            except Exception: parsed=None
    res["state_json"]=parsed
    res["adaptive_function_cycles"]=0
    res["deterministic_bt_mode"]=True
    steps.append({"stage":"acer_bluetooth_audio","action":"pair_connect_select_sink","result":res})
    if not res.get("ok") or not isinstance(parsed,dict) or not parsed.get("bluetooth_connected"):
        return {"ok":False,"failure":"SAMSUNG_DEVICE_NOT_CONNECTED","result":res}
    if not parsed.get("audio_sink_present"):
        return {"ok":False,"failure":"SAMSUNG_AUDIO_SINK_NOT_FOUND","result":res}
    if not parsed.get("audio_sink_default"):
        return {"ok":False,"failure":"DEFAULT_SINK_NOT_CHANGED","result":res}
    return {"ok":True,"result":parsed,"adaptive_source_cycles":0}
'''
s=s[:start]+new+s[end:]
helper.write_text(s,encoding="utf-8")

subprocess.run(["python3","-m","py_compile",str(helper)],check=True)
subprocess.run(["bash","-n",str(connector)],check=True)
subprocess.run(["systemctl","--user","restart","c720p-bluetooth-helper.service"],check=True)
time.sleep(1)
print("BT_HELPER="+subprocess.run(["systemctl","--user","is-active","c720p-bluetooth-helper.service"],text=True,capture_output=True).stdout.strip())
with urllib.request.urlopen("http://127.0.0.1:8790/health",timeout=5) as r:
    h=json.load(r)
print("BT_HEALTH_OK="+str(bool(h.get("ok"))).lower())
print("RESULT=DETERMINISTIC_BT_PIPELINE_PATCHED")
