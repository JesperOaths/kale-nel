#!/usr/bin/env python3
from pathlib import Path
import datetime, re, shutil, subprocess, time

HOME=Path("/home/jespern")
BASE=HOME/"c720p-home-hub"
HELPER=BASE/"bin/c720p-bluetooth-helper-server.py"
UI=Path("/opt/homeassistant/config/www/c720p-tv-surround-v21.html")
ROW=Path("/opt/homeassistant/config/www/c720p-weather-row.html")
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"tv-surround-v23-bt-fallback-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
for p in (HELPER,UI,ROW):
    shutil.copy2(p,BACK/(p.name+".before"))

# ---- 8790: software-volume fallback for an already-connected HT-E6500 A2DP sink. ----
h=HELPER.read_text(encoding="utf-8")
if "BT_VOLUME_SINK =" not in h:
    anchor="S5_DISPLAY_GUARD = str(BASE / 'bin/c720p-s5-display-guard.sh')\n"
    insert="""S5_DISPLAY_GUARD = str(BASE / 'bin/c720p-s5-display-guard.sh')
BT_VOLUME_SINK = 'bluez_sink.8C_C8_CD_8B_06_3B.a2dp_sink'
"""
    if anchor not in h:
        raise SystemExit("helper constant anchor missing")
    h=h.replace(anchor,insert,1)

if "def bluetooth_sink_volume(" not in h:
    marker="\n\nclass Handler(BaseHTTPRequestHandler):"
    fn=r'''
def bluetooth_sink_volume(direction):
    """Adjust the C720P software volume when the HT-E6500 is already connected.
    This is a safe fallback for volume +/- when the S5 IR bridge is absent."""
    direction=str(direction or "").lower()
    if direction not in {"up","down"}:
        return 400, {"ok":False,"state":"invalid_direction"}
    live=read_state()
    sink=live.get("audio_sink") or BT_VOLUME_SINK
    if not (live.get("bluetooth_connected") and live.get("audio_sink_present")):
        return 409, {
            "ok":False,
            "state":"hts_bluetooth_not_connected",
            "bluetooth_connected":bool(live.get("bluetooth_connected")),
            "audio_sink_present":bool(live.get("audio_sink_present")),
        }
    current=run(["pactl","get-sink-volume",sink],timeout=6)
    text=current.get("stdout") or ""
    m=re.search(r"(\d+)%",text)
    if not current.get("ok") or not m:
        return 500, {"ok":False,"state":"volume_read_failed","result":current}
    before=max(0,min(100,int(m.group(1))))
    after=max(0,min(100,before+(5 if direction=="up" else -5)))
    changed=run(["pactl","set-sink-volume",sink,f"{after}%"],timeout=6)
    verify=run(["pactl","get-sink-volume",sink],timeout=6)
    ok=bool(changed.get("ok") and verify.get("ok"))
    return (200 if ok else 500), {
        "ok":ok,
        "state":"volume_changed" if ok else "volume_change_failed",
        "direction":direction,
        "sink":sink,
        "before_percent":before,
        "requested_percent":after,
        "set_result":changed,
        "verify":verify,
        "transport":"c720p_pulseaudio_bluetooth_sink",
    }

'''
    if marker not in h:
        raise SystemExit("helper Handler anchor missing")
    h=h.replace(marker,"\n"+fn+marker,1)

route_anchor="""        if path == '/bluetooth/connect-only':
            res=run([CONNECT],timeout=120); return respond(self,200 if res.get('ok') else 500,res)
"""
if "/volume/up" not in h:
    route_insert="""        if path in {'/volume/up','/volume/down'}:
            status,payload=bluetooth_sink_volume(path.rsplit('/',1)[-1]); return respond(self,status,payload)
"""
    if route_anchor not in h:
        raise SystemExit("helper POST route anchor missing")
    h=h.replace(route_anchor,route_insert+route_anchor,1)

# Helper now uses re for volume parsing.
if not re.search(r"^import re\b",h,flags=re.M):
    # Keep the existing odd import/shebang order intact; just add re with stdlib imports.
    h=h.replace("import json, os, subprocess, time\n","import json, os, re, subprocess, time\n",1)

HELPER.write_text(h,encoding="utf-8")

# ---- Active TV/surround card: let backend state logic own S5 discovery. ----
u=UI.read_text(encoding="utf-8")
u=u.replace(
    "C720P_TV_SURROUND_ACTIONS_V14_S5_SELFHEAL_PIPELINE_FALLTHROUGH",
    "C720P_TV_SURROUND_ACTIONS_V15_BACKEND_SELFHEAL_BT_VOLUME_FALLBACK",
)

old_hts='''e.hts.onclick=()=>action(htsState===true?"Turning HTS off":"Turning HTS on",async()=>{
  await ensureIR();
  return req(8789,htsState===true?"/ht-e6500/ensure-off":"/ht-e6500/ensure-on","POST",30000);
},1800);'''
new_hts='''e.hts.onclick=()=>action(htsState===true?"Turning HTS off":"Turning HTS on",
  ()=>req(8789,htsState===true?"/ht-e6500/ensure-off":"/ht-e6500/ensure-on","POST",36000),1800);'''
if old_hts in u:
    u=u.replace(old_hts,new_hts,1)
elif "await ensureIR();\n  return req(8789,htsState" in u:
    raise SystemExit("unexpected HTS handler shape")

old_up='e.up.onclick=()=>action("HTS volume +",async()=>{await ensureIR();return req(8789,"/ht-e6500/volume/up","POST",12000)},250);'
old_down='e.down.onclick=()=>action("HTS volume −",async()=>{await ensureIR();return req(8789,"/ht-e6500/volume/down","POST",12000)},250);'
volume_fn=r'''async function volumeAction(dir){
  try{
    const m=await req(8790,"/state","GET",4500);
    if(m.live_ready&&m.bluetooth_connected&&m.audio_sink_present){
      return req(8790,"/volume/"+dir,"POST",7000);
    }
  }catch(_){}
  try{
    return await req(8789,"/ht-e6500/volume/"+dir,"POST",15000);
  }catch(irErr){
    try{
      const m=await req(8790,"/state","GET",4500);
      if(m.live_ready&&m.bluetooth_connected&&m.audio_sink_present){
        return req(8790,"/volume/"+dir,"POST",7000);
      }
    }catch(_){}
    throw irErr;
  }
}
'''
if "async function volumeAction(" not in u:
    pos=u.find("\ne.tv.onclick=")
    if pos<0: raise SystemExit("TV handler anchor missing")
    u=u[:pos]+"\n"+volume_fn+u[pos:]
if old_up in u:
    u=u.replace(old_up,'e.up.onclick=()=>action("HTS volume +",()=>volumeAction("up"),250);',1)
if old_down in u:
    u=u.replace(old_down,'e.down.onclick=()=>action("HTS volume −",()=>volumeAction("down"),250);',1)

old_macro='''    if(!mediaReady){
      try{await ensureIR()}
      catch(err){status("S5 IR bridge offline · trying verified Bluetooth surround path…")}
    }
    await req(8790,"/pipeline/bluetooth-fast","POST",8000);'''
if old_macro in u:
    u=u.replace(old_macro,'    await req(8790,"/pipeline/bluetooth-fast","POST",8000);',1)

u=u.replace(
    'label(e.macro,"Find IR + connect surround","tap to rediscover S5 · TV → HDMI 3 → Bluetooth");',
    'label(e.macro,"Connect surround","TV → HDMI 3 → Bluetooth · S5 IR auto-retry");'
)
u=u.replace(
    'status("TV works · tap an HTS control to rediscover the S5 IR bridge");',
    'status("TV ready · S5 IR offline; Bluetooth path will still be tried");'
)

UI.write_text(u,encoding="utf-8")

r=ROW.read_text(encoding="utf-8")
r,n=re.subn(
    r'c720p-tv-surround-v21\.html(?:\?v=[^"\']*)?',
    'c720p-tv-surround-v21.html?v=BUTTONS_V23_BT_FALLBACK_20261007',
    r,
)
if n<1:
    raise SystemExit("weather-row TV iframe missing")
ROW.write_text(r,encoding="utf-8")

subprocess.run(["python3","-m","py_compile",str(HELPER)],check=True)
subprocess.run(["systemctl","--user","restart","c720p-bluetooth-helper.service"],check=True)
time.sleep(2)

# Static/runtime verification.
hh=HELPER.read_text(encoding="utf-8")
uu=UI.read_text(encoding="utf-8")
rr=ROW.read_text(encoding="utf-8")
assert "def bluetooth_sink_volume(" in hh
assert "/volume/up" in hh and "/volume/down" in hh
assert "C720P_TV_SURROUND_ACTIONS_V15_BACKEND_SELFHEAL_BT_VOLUME_FALLBACK" in uu
assert '()=>volumeAction("up")' in uu and '()=>volumeAction("down")' in uu
assert "await ensureIR();\n  return req(8789,htsState" not in uu
assert "BUTTONS_V23_BT_FALLBACK_20261007" in rr

probe=subprocess.run(
    ["bash","-lc","curl -sS --max-time 8 http://127.0.0.1:8790/health; echo; curl -sS --max-time 8 http://127.0.0.1:8790/state; echo; systemctl --user is-active c720p-s5-rediscover.timer; systemctl --user is-enabled c720p-s5-rediscover.timer"],
    text=True,capture_output=True,timeout=30,
)

w=subprocess.run(
    ["bash","-lc","DISPLAY=:0 xdotool search --onlyvisible --name 'C720P Hub.*Home Assistant' 2>/dev/null | tail -1 || true"],
    text=True,capture_output=True,
).stdout.strip()
if w:
    subprocess.run(["bash","-lc",f"DISPLAY=:0 xdotool windowraise {w} windowactivate {w} key --clearmodifiers ctrl+r"],check=False)

print("BACKUP="+str(BACK))
print("HELPER_VOLUME_FALLBACK=true")
print("HTS_UI_BACKEND_SELFHEAL=true")
print("TV_CARD_CACHE_V23=true")
print("RUNTIME_PROBE="+probe.stdout[:5000].replace("\n"," | "))
print("RESULT=TV_SURROUND_V23_BT_FALLBACK_APPLIED")
