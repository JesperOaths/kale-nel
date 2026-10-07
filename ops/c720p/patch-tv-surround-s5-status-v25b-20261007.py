#!/usr/bin/env python3
from pathlib import Path
import datetime,re,shutil,subprocess

HOME=Path("/home/jespern")
WWW=Path("/opt/homeassistant/config/www")
UI=WWW/"c720p-tv-surround-v21.html"
ROW=WWW/"c720p-weather-row.html"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=HOME/"c720p-backups"/f"tv-surround-s5-status-v25b-{STAMP}"
BACK.mkdir(parents=True,exist_ok=True)
for p in (UI,ROW):
    shutil.copy2(p,BACK/(p.name+".before"))

s=UI.read_text(encoding="utf-8")
a=s.find("async function ensureIR(){")
b=s.find("\nasync function volumeAction(",a)
if a<0 or b<0:
    raise SystemExit("ensureIR/volumeAction boundary not found")

fn=r'''async function ensureIR(){
  if(irReady)return true;
  let lastError=null,phoneSeen=false;
  status("Checking S5 network IR bridge…");
  try{
    await req(8789,"/s5/reconnect","POST",26000);
  }catch(err){lastError=err}
  await wait(650);
  try{
    const h=await req(8789,"/health","GET",10000);
    phoneSeen=!!(h.s5_lan&&h.s5_lan.present);
    irReady=!!(h.s5_connected||(h.s5_http&&h.s5_http.ok));
    if(irReady){
      pill(e.irP,"IR",true);
      status(h.s5_transport==="http"?"S5 HTTP IR bridge ready":"S5 network ADB ready","ok");
      return true;
    }
  }catch(err){lastError=err}
  irReady=false;
  e.irP.textContent=phoneSeen?"S5 ONLINE":"IR OFFLINE";
  e.irP.className="pill unknown";
  if(phoneSeen){
    status("S5 is on Wi-Fi · ADB/IR service offline · automatic recovery armed","bad");
    throw new Error("S5 online but ADB/IR service offline");
  }
  status("S5 not reachable · automatic ADB/HTTP recovery armed","bad");
  throw new Error("S5 IR bridge unavailable"+(lastError?": "+String(lastError?.message||lastError):""));
}
'''
s=s[:a]+fn+s[b:]

# Normalize any prior action marker to the precise-status marker.
s=re.sub(r'C720P_TV_SURROUND_ACTIONS_V\d+_[A-Z0-9_]+',
         'C720P_TV_SURROUND_ACTIONS_V17_PRECISE_S5_HEALTH',s,count=1)
if "C720P_TV_SURROUND_ACTIONS_V17_PRECISE_S5_HEALTH" not in s:
    # If the page lost its explicit action marker, add one before the action JS.
    anchor="async function ensureIR(){"
    s=s.replace(anchor,"// C720P_TV_SURROUND_ACTIONS_V17_PRECISE_S5_HEALTH\n"+anchor,1)

UI.write_text(s,encoding="utf-8")

r=ROW.read_text(encoding="utf-8")
r,n=re.subn(r'c720p-tv-surround-v21\.html(?:\?v=[^"\']*)?',
            'c720p-tv-surround-v21.html?v=TV_S5_STATUS_V25B_20261007',r)
if n<1:
    raise SystemExit("TV iframe reference not found")
ROW.write_text(r,encoding="utf-8")

u=UI.read_text(encoding="utf-8")
checks={
 "marker":"C720P_TV_SURROUND_ACTIONS_V17_PRECISE_S5_HEALTH" in u,
 "precise_status":"S5 is on Wi-Fi · ADB/IR service offline" in u,
 "tv_on":'await req(8789,"/grundig-tv/on"' in u,
 "hdmi3":'await req(8789,"/grundig-tv/hdmi3-fast"' in u,
 "hts":'/ht-e6500/ensure-on' in u,
 "volume":'/ht-e6500/volume/' in u,
 "cache":"TV_S5_STATUS_V25B_20261007" in ROW.read_text(encoding="utf-8"),
}
if not all(checks.values()):
    raise SystemExit("post-write validation failed: "+repr(checks))

w=subprocess.run(["bash","-lc","DISPLAY=:0 xdotool search --onlyvisible --name 'C720P Hub.*Home Assistant' 2>/dev/null | tail -1 || true"],text=True,capture_output=True).stdout.strip()
if w:
    subprocess.run(["bash","-lc",f"DISPLAY=:0 xdotool windowraise {w} windowactivate {w} key --clearmodifiers ctrl+r"],check=False)

print("BACKUP="+str(BACK))
print("CHECKS="+repr(checks))
print("RESULT=TV_SURROUND_S5_STATUS_V25B_APPLIED")
