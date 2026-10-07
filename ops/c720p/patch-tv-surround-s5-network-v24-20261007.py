#!/usr/bin/env python3
from pathlib import Path
import datetime, re, shutil, subprocess, time, json, urllib.request

HOME=Path("/home/jespern")
WWW=Path("/opt/homeassistant/config/www")
UI=WWW/"c720p-tv-surround-v21.html"
ROW=WWW/"c720p-weather-row.html"
SYSTEMD=HOME/".config/systemd/user"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"tv-surround-s5-network-v24-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
for p in (UI,ROW,SYSTEMD/"openclaw-s5-adb-connect.timer"):
    if p.exists(): shutil.copy2(p,BACK/(p.name+".before"))

s=UI.read_text(encoding="utf-8")
old='''  busy=true;availability();status("Starting TV → HDMI 3 → HTS Bluetooth…");
  try{
    if(!irReady&&!mediaReady){
      status("Finding S5 IR bridge for Surround…");
      await ensureIR();
    }
    await req(8790,"/pipeline/bluetooth-fast","POST",8000);'''
new='''  busy=true;availability();status("Turning TV on…");
  try{
    await req(8789,"/grundig-tv/on","POST",24000);
    status("TV on · selecting HDMI 3…");
    await req(8789,"/grundig-tv/hdmi3-fast","POST",16000);
    if(!irReady&&!mediaReady){
      status("TV on · HDMI 3 selected · reconnecting S5 over network ADB…");
      try{await ensureIR()}
      catch(_){
        status("TV on · HDMI 3 selected · S5 ADB offline · HTS waiting for S5","bad");
        return;
      }
    }
    await req(8790,"/pipeline/bluetooth-fast","POST",8000);'''
if old not in s:
    raise SystemExit("macro preflight anchor not found")
s=s.replace(old,new,1)
s=s.replace("C720P_TV_SURROUND_ACTIONS_V15_BACKEND_SELFHEAL_BT_VOLUME_FALLBACK",
            "C720P_TV_SURROUND_ACTIONS_V16_TV_INDEPENDENT_S5_NETWORK_ADB")
UI.write_text(s,encoding="utf-8")

r=ROW.read_text(encoding="utf-8")
r,n=re.subn(r'/local/c720p-tv-surround-v21\.html\?v=[^"\']+',
            '/local/c720p-tv-surround-v21.html?v=TV_S5_NETWORK_V24_20261007',r)
if n<1:
    r,n=re.subn(r'/local/c720p-tv-surround-v21\.html',
                '/local/c720p-tv-surround-v21.html?v=TV_S5_NETWORK_V24_20261007',r,count=1)
if n<1: raise SystemExit("weather row iframe anchor not found")
ROW.write_text(r,encoding="utf-8")

timer=SYSTEMD/"openclaw-s5-adb-connect.timer"
timer.write_text("""[Unit]
Description=Fast reconnect for Galaxy S5 ADB over Wi-Fi

[Timer]
OnBootSec=20s
OnUnitActiveSec=30s
AccuracySec=5s
Persistent=true
Unit=openclaw-s5-adb-connect.service

[Install]
WantedBy=timers.target
""",encoding="utf-8")

subprocess.run(["systemctl","--user","daemon-reload"],check=True)
subprocess.run(["systemctl","--user","enable","--now","openclaw-s5-adb-connect.timer"],check=True)
subprocess.run(["systemctl","--user","enable","--now","c720p-s5-rediscover.timer"],check=True)
subprocess.run(["systemctl","--user","start","openclaw-s5-adb-connect.service"],check=False)

def http(path,method="GET",port=8789,timeout=30):
    req=urllib.request.Request(f"http://127.0.0.1:{port}{path}",method=method)
    try:
        with urllib.request.urlopen(req,timeout=timeout) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        return {"ok":False,"error":str(e)}

tv_on=http("/grundig-tv/on","POST",8789,40)
hdmi3=http("/grundig-tv/hdmi3-fast","POST",8789,25)
health=http("/health","GET",8789,12)
hts=None
pipeline=None
if health.get("s5_connected"):
    hts=http("/ht-e6500/ensure-on","POST",8789,40)
    pipeline=http("/pipeline/bluetooth-fast","POST",8790,12)

tv_final=http("/grundig-tv/power-state","GET",8789,12)

w=subprocess.run(["bash","-lc","DISPLAY=:0 xdotool search --onlyvisible --name 'C720P Hub.*Home Assistant' 2>/dev/null | tail -1 || true"],capture_output=True,text=True).stdout.strip()
if w:
    subprocess.run(["bash","-lc",f"DISPLAY=:0 xdotool windowraise {w} windowactivate {w} key --clearmodifiers ctrl+r"],check=False)

print("BACKUP="+str(BACK))
print("UI_MARKER="+("ok" if "C720P_TV_SURROUND_ACTIONS_V16_TV_INDEPENDENT_S5_NETWORK_ADB" in UI.read_text() else "missing"))
print("FAST_ADB_TIMER_ACTIVE="+subprocess.run(["systemctl","--user","is-active","openclaw-s5-adb-connect.timer"],capture_output=True,text=True).stdout.strip())
print("LAN_REDISCOVERY_TIMER_ACTIVE="+subprocess.run(["systemctl","--user","is-active","c720p-s5-rediscover.timer"],capture_output=True,text=True).stdout.strip())
print("TV_ON="+json.dumps(tv_on,sort_keys=True)[:5000])
print("HDMI3="+json.dumps(hdmi3,sort_keys=True)[:5000])
print("S5_HEALTH="+json.dumps(health,sort_keys=True)[:5000])
print("HTS="+json.dumps(hts,sort_keys=True)[:5000] if hts is not None else "HTS_SKIPPED_SAFELY_S5_NETWORK_ADB_OFFLINE")
print("PIPELINE="+json.dumps(pipeline,sort_keys=True)[:5000] if pipeline is not None else "PIPELINE_SKIPPED_SAFELY_S5_NETWORK_ADB_OFFLINE")
print("TV_FINAL="+json.dumps(tv_final,sort_keys=True)[:5000])
print("RESULT=TV_SURROUND_S5_NETWORK_V24_APPLIED")
