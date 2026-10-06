#!/usr/bin/env python3
from pathlib import Path
import re,shutil,subprocess,time,urllib.request,json,datetime,os

BASE=Path("/home/jespern/c720p-home-hub")
CTRL=BASE/"bin/c720p-tv-fast-controller.py"
UI=Path("/opt/homeassistant/config/www/c720p-tv-surround.html")
ROW=Path("/opt/homeassistant/config/www/c720p-weather-row.html")
UNIT=Path.home()/".config/systemd/user/c720p-tv-fast-controller.service"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACK=BASE/"backups"/("tv-buttons-v15-"+STAMP)
BACK.mkdir(parents=True,exist_ok=True)

def run(cmd,check=True,timeout=30):
    p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,timeout=timeout)
    if check and p.returncode: raise SystemExit(p.stdout)
    return p.stdout

def req(path,method="GET",timeout=8):
    u="http://127.0.0.1:8792"+path
    q=urllib.request.Request(u,method=method)
    try:
        with urllib.request.urlopen(q,timeout=timeout) as r:
            return r.status,json.load(r)
    except Exception as e:
        return 0,{"error":type(e).__name__+":"+str(e)}

for p in (CTRL,UI,ROW,UNIT):
    if p.exists(): shutil.copy2(p,BACK/(p.name+".before"))

url="https://raw.githubusercontent.com/JesperOaths/kale-nel/417e3a8e4a3e7e8894e2f82896af3cfa4f181439/ops/c720p/c720p-tv-fast-controller-v10.py"
urllib.request.urlretrieve(url,CTRL)
raw=CTRL.read_text().replace("PORT=8792","PORT=8793",1)
CTRL.write_text(raw)
os.chmod(CTRL,0o755)
run(["python3","-m","py_compile",str(CTRL)])

UNIT.parent.mkdir(parents=True,exist_ok=True)
UNIT.write_text("""[Unit]
Description=C720P TV and surround fast controller
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
run(["systemctl","--user","daemon-reload"])
run(["systemctl","--user","enable","--now","c720p-tv-fast-controller.service"])
run(["systemctl","--user","restart","c720p-tv-fast-controller.service"])
time.sleep(1)

hc,h=req("/health")
sc,st=req("/state")
if hc!=200 or not h.get("ok"): raise SystemExit("8793 health failed "+repr((hc,h)))
if sc!=200: raise SystemExit("8793 state failed "+repr((sc,st)))
print("CTRL_HEALTH=",h)
print("CTRL_STATE=",{k:st.get(k) for k in ("tv","hts","live_ready","pipeline_state","pipeline_running")})

src=UI.read_text()
start=src.find('<script id="C720P_TV_SURROUND_BUTTONS_')
if start<0: start=src.rfind("<script")
end=src.find("</script>",start)
if start<0 or end<0: raise SystemExit("button script not found")

js=r'''<script id="C720P_TV_SURROUND_BUTTONS_V16_PORT8793">
"use strict";
const BASE="http://"+location.hostname+":8792";
const $=id=>document.getElementById(id);
const E={hts:$("hts"),tv:$("tv"),vup:$("vup"),vdown:$("vdown"),macro:$("macro"),spotify:$("spotify"),status:$("status"),tvPill:$("tvPill"),htsPill:$("htsPill")};
let S=null,busy=false;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
async function req(path,method="GET",timeout=12000){
 const c=new AbortController(),t=setTimeout(()=>c.abort(),timeout);
 try{
  const r=await fetch(BASE+path,{method,cache:"no-store",signal:c.signal});
  let j={};try{j=await r.json()}catch(e){}
  if(!r.ok||j.ok===false)throw new Error(j.error||j.failure||j.state||("HTTP "+r.status));
  return j;
 }finally{clearTimeout(t)}
}
function status(t,k=""){E.status.textContent=t;E.status.style.color=k==="ok"?"#76e6a5":k==="bad"?"#ff7c6e":"#9aa9b7"}
function pill(el,label,s){el.textContent=label+" "+(s==="on"?"ON":s==="off"?"OFF":"?");el.className="pill "+(s==="on"?"on":s==="off"?"off":"unknown")}
function setBusy(v){busy=v;for(const b of [E.hts,E.tv,E.vup,E.vdown,E.macro,E.spotify])b.disabled=v}
function render(){
 if(!S)return;
 pill(E.tvPill,"TV",S.tv);pill(E.htsPill,"HTS",S.hts);
 E.tv.classList.toggle("on",S.tv==="on");
 E.hts.classList.toggle("on",S.hts==="on");
 E.tv.childNodes[0].nodeValue=S.tv==="on"?"Turn TV off":S.tv==="off"?"Turn TV on":"TV state unknown";
 E.hts.childNodes[0].nodeValue=S.hts==="on"?"Turn HTS off":"Turn HTS on";
 const tvsub=E.tv.querySelector(".sub"),htsub=E.hts.querySelector(".sub");
 if(tvsub)tvsub.textContent=S.tv==="unknown"?"State conflict · refresh":"Grundig Android TV";
 if(htsub)htsub.textContent=S.hts==="unknown"?"Safe ensure-on available":"Samsung HT-E6500";
 if(!busy)E.tv.disabled=S.tv==="unknown";
 if(!busy)E.hts.disabled=false;
 const ready=!!S.live_ready,running=!!S.pipeline_running||S.pipeline_state==="running";
 E.macro.classList.toggle("on",ready);
 const ms=E.macro.querySelector(".sub");
 if(running){E.macro.childNodes[0].nodeValue="Connecting surround";if(ms)ms.textContent="TV → HDMI 3 → HTS Bluetooth";status("Surround connection in progress…")}
 else if(ready){E.macro.childNodes[0].nodeValue="Surround ready";if(ms)ms.textContent="HDMI 3 · Samsung Bluetooth verified";status("TV + HTS Bluetooth audio verified","ok")}
 else{E.macro.childNodes[0].nodeValue="TV → HDMI 3 → Bluetooth";if(ms)ms.textContent="TV · input · HTS · C720P audio";if(!busy)status(S.pipeline_failure?String(S.pipeline_failure).replaceAll("_"," "):"Controls ready",S.pipeline_failure?"bad":"")}
}
async function refresh(){try{S=await req("/state","GET",7000);render()}catch(e){status("Controller unavailable: "+String(e.message||e),"bad")}}
async function action(label,path,timeout=25000,settle=700){
 if(busy)return;setBusy(true);status(label+"…");
 try{await req(path,"POST",timeout);await wait(settle);await refresh();status(label+" ✓","ok")}
 catch(e){status(label+" failed: "+String(e.message||e).replaceAll("_"," ").slice(0,76),"bad")}
 finally{setBusy(false);render()}
}
E.tv.onclick=()=>action(S?.tv==="on"?"Turning TV off":"Turning TV on","/tv/toggle",30000,1200);
E.hts.onclick=()=>action(S?.hts==="on"?"Turning HTS off":"Turning HTS on","/hts/toggle",30000,1600);
E.vup.onclick=()=>action("HTS volume +","/volume/up",10000,250);
E.vdown.onclick=()=>action("HTS volume −","/volume/down",10000,250);
E.spotify.onclick=()=>action("Opening Spotify","/spotify/open",12000,400);
E.macro.onclick=async()=>{
 if(busy)return;setBusy(true);status("Starting TV → HDMI 3 → HTS Bluetooth…");
 try{
  await req("/macro/start","POST",10000);
  const end=Date.now()+105000;
  while(Date.now()<end){
   await wait(1200);S=await req("/state","GET",7000);render();
   if(S.live_ready){status("Surround ready · Bluetooth audio verified","ok");break}
   if(!S.pipeline_running&&S.pipeline_state==="failed")throw new Error(S.pipeline_failure||S.last_pipeline_failure||"pipeline failed");
  }
 }catch(e){status("Surround failed: "+String(e.message||e).replaceAll("_"," ").slice(0,76),"bad")}
 finally{setBusy(false);await refresh()}
};
refresh();setInterval(()=>{if(!busy)refresh()},2500);
</script>'''
UI.write_text(src[:start]+js+src[end+9:])

row=ROW.read_text()
row=re.sub(r'c720p-tv-surround\.html(?:\?v=[^"\']*)?',"c720p-tv-surround.html?v=BUTTONS_V16_8793_20261006",row)
ROW.write_text(row)

# Browser parse check.
p=subprocess.run(["chromium","--headless","--no-sandbox","--disable-gpu","--disable-dev-shm-usage","--dump-dom","file://"+str(UI)],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=20)
if "SyntaxError" in p.stderr or "Uncaught" in p.stderr: raise SystemExit(p.stderr)
print("UI_PARSE=OK")
print("UI_MARKER=" + str("C720P_TV_SURROUND_BUTTONS_V15_FAST_CONTROLLER" in UI.read_text()))
print("SERVICE="+run(["systemctl","--user","is-active","c720p-tv-fast-controller.service"],check=False).strip())

# Reload only the kiosk page; no HA restart.
win=run(["bash","-lc","DISPLAY=:0 xdotool search --onlyvisible --name 'C720P Hub.*Home Assistant' 2>/dev/null | tail -1 || true"],check=False).strip()
if win:
    run(["bash","-lc",f"DISPLAY=:0 xdotool windowraise {win} windowactivate {win} key --clearmodifiers ctrl+r"],check=False)
time.sleep(8)
subprocess.run(["bash","-lc","DISPLAY=:0 xfce4-screenshooter -f -s /tmp/c720p-tv-buttons-v15.png"],check=False)
print("SCREENSHOT=/tmp/c720p-tv-buttons-v15.png")
