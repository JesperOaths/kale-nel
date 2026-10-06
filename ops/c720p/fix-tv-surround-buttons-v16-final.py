#!/usr/bin/env python3
from pathlib import Path
import urllib.request, subprocess, os, time, shutil, datetime

BASE=Path("/home/jespern/c720p-home-hub")
CTRL=BASE/"bin/c720p-tv-fast-controller.py"
UI=Path("/opt/homeassistant/config/www/c720p-tv-surround.html")
UNIT=Path.home()/".config/systemd/user/c720p-tv-fast-controller.service"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=BASE/"backups"/("tv-buttons-v16-final-"+STAMP)
BACK.mkdir(parents=True,exist_ok=True)

for p in (CTRL,UI,UNIT):
    if p.exists(): shutil.copy2(p,BACK/(p.name+".before"))

src="https://raw.githubusercontent.com/JesperOaths/kale-nel/417e3a8e4a3e7e8894e2f82896af3cfa4f181439/ops/c720p/c720p-tv-fast-controller-v10.py"
raw=urllib.request.urlopen(src,timeout=20).read().decode().replace("PORT=8792","PORT=8793",1)
CTRL.write_text(raw)
os.chmod(CTRL,0o755)
subprocess.run(["python3","-m","py_compile",str(CTRL)],check=True)

UNIT.parent.mkdir(parents=True,exist_ok=True)
UNIT.write_text("""[Unit]
Description=C720P TV and surround button controller
After=network-online.target ht-e6500-surround.service c720p-bluetooth-helper.service
Wants=network-online.target
[Service]
Type=simple
ExecStart=/usr/bin/python3 /home/jespern/c720p-home-hub/bin/c720p-tv-fast-controller.py
Restart=on-failure
RestartSec=1
[Install]
WantedBy=default.target
""")
subprocess.run(["systemctl","--user","daemon-reload"],check=True)
subprocess.run(["systemctl","--user","enable","--now","c720p-tv-fast-controller.service"],check=True)
subprocess.run(["systemctl","--user","restart","c720p-tv-fast-controller.service"],check=True)
time.sleep(1)

# Replace only the behavior script; preserve the existing visual design.
s=UI.read_text()
a=s.find('<script id="C720P_TV_SURROUND_BUTTONS_')
if a<0: a=s.rfind("<script")
b=s.find("</script>",a)
if a<0 or b<0: raise SystemExit("TV/surround behavior script not found")

js=r'''<script id="C720P_TV_SURROUND_BUTTONS_V16_PORT8793">
"use strict";
const B="http://"+location.hostname+":8793",$=id=>document.getElementById(id);
const E={hts:$("hts"),tv:$("tv"),up:$("vup"),down:$("vdown"),macro:$("macro"),spotify:$("spotify"),status:$("status"),tp:$("tvPill"),hp:$("htsPill")};
let S=null,busy=false;const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function req(p,m="GET",to=15000){const c=new AbortController(),t=setTimeout(()=>c.abort(),to);try{const r=await fetch(B+p,{method:m,cache:"no-store",signal:c.signal});let j={};try{j=await r.json()}catch{}if(!r.ok||j.ok===false)throw new Error(j.error||j.failure||j.state||("HTTP "+r.status));return j}finally{clearTimeout(t)}}
function msg(t,k=""){E.status.textContent=t;E.status.style.color=k==="ok"?"#76e6a5":k==="bad"?"#ff7c6e":"#9aa9b7"}
function pill(e,l,v){e.textContent=l+" "+(v==="on"?"ON":v==="off"?"OFF":"?");e.className="pill "+(v==="on"?"on":v==="off"?"off":"unknown")}
function lock(v){busy=v;for(const x of [E.hts,E.tv,E.up,E.down,E.macro,E.spotify])x.disabled=v}
function render(){if(!S)return;pill(E.tp,"TV",S.tv);pill(E.hp,"HTS",S.hts);E.tv.classList.toggle("on",S.tv==="on");E.hts.classList.toggle("on",S.hts==="on");E.tv.childNodes[0].nodeValue=S.tv==="on"?"Turn TV off":S.tv==="off"?"Turn TV on":"TV state unknown";E.hts.childNodes[0].nodeValue=S.hts==="on"?"Turn HTS off":"Turn HTS on";E.tv.querySelector(".sub").textContent=S.tv==="unknown"?"Conflicting state · refresh":"Grundig Android TV";E.hts.querySelector(".sub").textContent=S.hts==="unknown"?"Safe ensure-on":"Samsung HT-E6500";if(!busy){E.tv.disabled=S.tv==="unknown";E.hts.disabled=false}const ready=!!S.live_ready,running=!!S.pipeline_running||S.pipeline_state==="running";E.macro.classList.toggle("on",ready);const sub=E.macro.querySelector(".sub");if(running){E.macro.childNodes[0].nodeValue="Connecting surround";sub.textContent="TV → HDMI 3 → HTS Bluetooth";msg("Surround connection in progress…")}else if(ready){E.macro.childNodes[0].nodeValue="Surround ready";sub.textContent="HDMI 3 · Samsung Bluetooth verified";if(!busy)msg("TV + HTS Bluetooth audio verified","ok")}else{E.macro.childNodes[0].nodeValue="TV → HDMI 3 → Bluetooth";sub.textContent="TV · input · HTS · C720P audio";if(!busy)msg(S.pipeline_failure?String(S.pipeline_failure).replaceAll("_"," "):"Controls ready",S.pipeline_failure?"bad":"")}}
async function refresh(){try{S=await req("/state","GET",8000);render()}catch(e){msg("Button controller unavailable","bad")}}
async function act(label,path,to=30000,settle=700){if(busy)return;lock(true);msg(label+"…");try{await req(path,"POST",to);await wait(settle);await refresh();msg(label+" ✓","ok")}catch(e){msg(label+" failed: "+String(e.message||e).replaceAll("_"," ").slice(0,74),"bad")}finally{lock(false);render()}}
E.tv.onclick=()=>act(S?.tv==="on"?"Turning TV off":"Turning TV on","/tv/toggle",35000,1300);
E.hts.onclick=()=>act(S?.hts==="on"?"Turning HTS off":"Turning HTS on","/hts/toggle",35000,1800);
E.up.onclick=()=>act("HTS volume +","/volume/up",12000,250);
E.down.onclick=()=>act("HTS volume −","/volume/down",12000,250);
E.spotify.onclick=()=>act("Opening Spotify","/spotify/open",12000,400);
E.macro.onclick=async()=>{if(busy)return;lock(true);msg("Starting TV → HDMI 3 → HTS Bluetooth…");try{await req("/macro/start","POST",12000);const end=Date.now()+105000;while(Date.now()<end){await wait(1300);S=await req("/state","GET",8000);render();if(S.live_ready){msg("Surround ready · Bluetooth audio verified","ok");break}if(!S.pipeline_running&&S.pipeline_state==="failed")throw new Error(S.pipeline_failure||S.last_pipeline_failure||"pipeline failed")}}catch(e){msg("Surround failed: "+String(e.message||e).replaceAll("_"," ").slice(0,74),"bad")}finally{lock(false);await refresh()}};
refresh();setInterval(()=>{if(!busy)refresh()},2500);
</script>'''
UI.write_text(s[:a]+js+s[b+9:])

# Cache-bust the nested card if present.
ROW=Path("/opt/homeassistant/config/www/c720p-weather-row.html")
if ROW.exists():
    r=ROW.read_text()
    import re
    r=re.sub(r'c720p-tv-surround\.html(?:\?v=[^"\']*)?',"c720p-tv-surround.html?v=BUTTONS_V16_8793_20261006",r)
    ROW.write_text(r)

# Verify controller and UI.
with urllib.request.urlopen("http://127.0.0.1:8793/health",timeout=5) as x:
    print("HEALTH="+x.read().decode())
with urllib.request.urlopen("http://127.0.0.1:8793/state",timeout=8) as x:
    print("STATE="+x.read().decode())
print("SERVICE="+subprocess.run(["systemctl","--user","is-active","c720p-tv-fast-controller.service"],text=True,capture_output=True).stdout.strip())
print("UI_V16="+str("C720P_TV_SURROUND_BUTTONS_V16_PORT8793" in UI.read_text()))

# Reload kiosk without restarting HA.
w=subprocess.run(["bash","-lc","DISPLAY=:0 xdotool search --onlyvisible --name 'C720P Hub.*Home Assistant' 2>/dev/null | tail -1 || true"],text=True,capture_output=True).stdout.strip()
if w:
    subprocess.run(["bash","-lc",f"DISPLAY=:0 xdotool windowraise {w} windowactivate {w} key --clearmodifiers ctrl+r"],check=False)
time.sleep(7)
print("RESULT=TV_BUTTONS_V16_DEPLOYED")
