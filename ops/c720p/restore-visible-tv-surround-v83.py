#!/usr/bin/env python3
import json, shutil, subprocess, time
from datetime import datetime
from pathlib import Path

CFG=Path("/opt/homeassistant/config")
SRC=CFG/"www/c720p-extra-row-v82.html"
DST=CFG/"www/c720p-extra-row-v83.html"
IMAGE="ghcr.io/home-assistant/home-assistant:stable"

def run(cmd,check=True):
    p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    if check and p.returncode:
        raise SystemExit(p.stdout)
    return p.stdout

s=SRC.read_text()
marker="C720P_VISIBLE_TV_SURROUND_V83"
addon=r'''
<style id="C720P_VISIBLE_TV_SURROUND_V83">
.mediaBox{
  position:relative!important;
  display:grid!important;
  grid-template-rows:76px minmax(0,1fr)!important;
  gap:5px!important;
  padding:5px!important;
  cursor:default!important;
  overflow:hidden!important;
}
.mediaBox>.head,
.mediaBox>.playing,
.mediaBox>#mediaStatus,
.mediaBox>.mediaBtns{display:none!important}
.mediaBox>.c720p-photo-live-big{
  position:relative!important;
  inset:auto!important;
  grid-row:2!important;
  width:100%!important;
  height:100%!important;
  min-width:0!important;
  min-height:0!important;
  border:0!important;
  border-radius:8px!important;
  background:#05070b!important;
  z-index:1!important;
}
#c720p-surround-v83{
  grid-row:1!important;
  min-width:0!important;
  min-height:0!important;
  padding:7px 8px!important;
  border-radius:9px!important;
  display:grid!important;
  grid-template-columns:minmax(0,1fr) 102px!important;
  gap:8px!important;
  align-items:center!important;
  background:
    radial-gradient(circle at 8% 0%,rgba(32,197,232,.18),transparent 48%),
    linear-gradient(145deg,rgba(16,29,39,.98),rgba(7,13,19,.99))!important;
  border:1px solid rgba(72,210,237,.35)!important;
  box-shadow:inset 0 1px rgba(255,255,255,.045),0 3px 10px rgba(0,0,0,.18)!important;
  z-index:3!important;
}
.c720p-surround-copy{min-width:0!important}
.c720p-surround-title{
  font-size:15px!important;
  line-height:1!important;
  font-weight:950!important;
  color:#f6fbff!important;
  white-space:nowrap!important;
}
.c720p-surround-line{
  margin-top:5px!important;
  display:flex!important;
  align-items:center!important;
  gap:5px!important;
  min-width:0!important;
}
.c720p-surround-chip{
  display:inline-flex!important;
  align-items:center!important;
  height:20px!important;
  padding:0 6px!important;
  border-radius:999px!important;
  font-size:8px!important;
  line-height:1!important;
  font-weight:950!important;
  letter-spacing:.025em!important;
  white-space:nowrap!important;
  color:#cceaf2!important;
  background:rgba(32,197,232,.09)!important;
  border:1px solid rgba(32,197,232,.23)!important;
}
#c720p-surround-state-v83.ready{
  color:#baffc9!important;
  border-color:rgba(104,232,139,.42)!important;
  background:rgba(68,190,105,.14)!important;
}
#c720p-surround-state-v83.busy{
  color:#ffe2a6!important;
  border-color:rgba(255,190,83,.42)!important;
  background:rgba(255,172,46,.13)!important;
}
#c720p-surround-state-v83.fail{
  color:#ffc0ba!important;
  border-color:rgba(255,108,96,.45)!important;
  background:rgba(255,89,75,.12)!important;
}
#c720p-surround-connect-v83{
  width:102px!important;
  height:52px!important;
  border-radius:10px!important;
  border:1px solid rgba(69,215,240,.46)!important;
  background:linear-gradient(180deg,rgba(32,197,232,.22),rgba(32,197,232,.10))!important;
  color:#ecfbff!important;
  font-size:11px!important;
  line-height:1.05!important;
  font-weight:950!important;
  padding:4px 6px!important;
  touch-action:manipulation!important;
}
#c720p-surround-connect-v83:disabled{opacity:.62!important}
#c720p-surround-connect-v83.ready{
  border-color:rgba(104,232,139,.48)!important;
  background:linear-gradient(180deg,rgba(68,190,105,.23),rgba(68,190,105,.11))!important;
  color:#d9ffe3!important;
}
#c720p-surround-detail-v83{
  margin-top:4px!important;
  font-size:8px!important;
  line-height:1!important;
  color:#91a6b3!important;
  white-space:nowrap!important;
  overflow:hidden!important;
  text-overflow:ellipsis!important;
}
</style>
<script id="C720P_VISIBLE_TV_SURROUND_V83">
(()=>{
"use strict";
const host=location.hostname;
const wait=ms=>new Promise(r=>setTimeout(r,ms));
function ready(s){return !!(s&&s.live_ready===true&&s.bluetooth_connected===true&&s.audio_sink_present===true&&s.audio_sink_default===true)}
async function getState(){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),4500);
  try{const r=await fetch("http://"+host+":8790/state",{cache:"no-store",signal:c.signal});return await r.json()}
  finally{clearTimeout(t)}
}
async function start(){
  const c=new AbortController(),t=setTimeout(()=>c.abort(),6500);
  try{
    const r=await fetch("http://"+host+":8790/pipeline/bluetooth-fast",{method:"POST",cache:"no-store",signal:c.signal});
    const j=await r.json().catch(()=>({}));
    if(!r.ok)throw new Error(j.failure||j.state||("HTTP "+r.status));
    return j;
  }finally{clearTimeout(t)}
}
function mount(){
  const box=document.querySelector(".mediaBox");
  if(!box)return;
  let p=document.getElementById("c720p-surround-v83");
  if(!p){
    p=document.createElement("section");
    p.id="c720p-surround-v83";
    p.innerHTML='<div class="c720p-surround-copy"><div class="c720p-surround-title">TV + Surround</div><div class="c720p-surround-line"><span class="c720p-surround-chip">TV → HDMI 3</span><span id="c720p-surround-state-v83" class="c720p-surround-chip">CHECKING</span></div><div id="c720p-surround-detail-v83">Grundig TV · Samsung HT-E6500</div></div><button id="c720p-surround-connect-v83" type="button">CONNECT<br>SURROUND</button>';
    box.insertBefore(p,box.firstChild);
  }
  const btn=document.getElementById("c720p-surround-connect-v83");
  const chip=document.getElementById("c720p-surround-state-v83");
  const detail=document.getElementById("c720p-surround-detail-v83");
  let busy=false;
  async function paint(){
    try{
      const s=await getState();
      chip.className="c720p-surround-chip";
      btn.classList.remove("ready");
      if(s.pipeline_running||s.pipeline_state==="running"){
        chip.textContent="CONNECTING";chip.classList.add("busy");
        detail.textContent="TV → HDMI 3 → HTS Bluetooth";
        btn.textContent="WORKING…";btn.disabled=true;busy=true;
      }else if(ready(s)){
        chip.textContent="READY";chip.classList.add("ready");
        detail.textContent="HT-E6500 Bluetooth audio verified";
        btn.innerHTML="SURROUND<br>READY";btn.classList.add("ready");btn.disabled=false;busy=false;
      }else if(s.pipeline_state==="failed"){
        chip.textContent="FAILED";chip.classList.add("fail");
        detail.textContent=String(s.pipeline_failure||s.last_pipeline_failure||"Connection failed").replaceAll("_"," ");
        btn.innerHTML="RETRY<br>SURROUND";btn.disabled=false;busy=false;
      }else{
        chip.textContent="OFF";
        detail.textContent="TV + HT-E6500 ready to connect";
        btn.innerHTML="CONNECT<br>SURROUND";btn.disabled=false;busy=false;
      }
    }catch(e){
      chip.textContent="OFFLINE";chip.className="c720p-surround-chip fail";
      detail.textContent="Surround helper unavailable";
      btn.innerHTML="RETRY<br>SURROUND";btn.disabled=false;busy=false;
    }
  }
  btn.onclick=async e=>{
    e.preventDefault();e.stopPropagation();
    if(busy)return;
    busy=true;btn.disabled=true;chip.textContent="STARTING";chip.className="c720p-surround-chip busy";detail.textContent="Powering TV and selecting HDMI 3…";
    try{
      await start();
      const end=Date.now()+95000;
      while(Date.now()<end){
        await wait(1200);
        const s=await getState();
        if(ready(s)||(!s.pipeline_running&&s.pipeline_state==="failed"))break;
      }
    }catch(e){
      detail.textContent=String(e?.message||e).replaceAll("_"," ");
    }finally{busy=false;await paint()}
  };
  paint();
  setInterval(paint,2500);
}
document.readyState==="loading"?document.addEventListener("DOMContentLoaded",mount,{once:true}):mount();
})();
</script>
'''
if marker not in s:
    s=s.replace("</body>",addon+"</body>",1)
DST.write_text(s)
print("V83_BUILD=OK",len(s))

# Parse check.
p=subprocess.run([
    "chromium","--headless","--no-sandbox","--disable-gpu","--disable-dev-shm-usage",
    "--dump-dom",f"file://{DST}"
],text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=25)
err=p.stderr or ""
if "SyntaxError" in err or "Uncaught" in err:
    raise SystemExit(err)
print("V83_PARSE=OK")

# Patch Lovelace safely.
run(["docker","stop","--time","25","homeassistant"])
patch=r'''
from pathlib import Path
import json,shutil
from datetime import datetime
p=Path("/config/.storage/lovelace.c720p_hub")
d=json.loads(p.read_text())
b=p.with_name(p.name+".before-visible-surround-v83-"+datetime.now().strftime("%Y%m%d_%H%M%S"))
shutil.copy2(p,b)
n=0
def walk(x):
  global n
  if isinstance(x,dict):
    if x.get("type")=="iframe" and "c720p-extra-row-v82.html" in str(x.get("url","")):
      x["url"]="/local/c720p-extra-row-v83.html?v=VISIBLE_TV_SURROUND_V83_20261004"
      n+=1
    for v in x.values(): walk(v)
  elif isinstance(x,list):
    for v in x: walk(v)
walk(d)
if n!=1: raise SystemExit("expected one V82 iframe, got "+str(n))
p.write_text(json.dumps(d,indent=2,ensure_ascii=False))
json.loads(p.read_text())
print("BACKUP="+str(b))
print("V83_REFS="+str(n))
'''
print(run(["docker","run","--rm","-i","-v","/opt/homeassistant/config:/config",IMAGE,"python","-c",patch]),end="")
run(["docker","start","homeassistant"])
for _ in range(50):
    code=run(["curl","-sS","-o","/dev/null","-w","%{http_code}","--max-time","3","http://127.0.0.1:8123/"],check=False).strip()
    if code=="200":
        print("HA_HTTP=200")
        break
    time.sleep(2)
else:
    raise SystemExit("HA did not return 200")

run(["systemctl","--user","restart","c720p-home-hub-kiosk.service"],check=False)
time.sleep(12)

# Foreground HA and capture overview + right lower area.
win=run(["bash","-lc","DISPLAY=:0 xdotool search --onlyvisible --name 'C720P Hub.*Home Assistant' 2>/dev/null | tail -1 || true"],check=False).strip()
if win:
    run(["bash","-lc",f"DISPLAY=:0 xdotool windowraise {win} windowactivate {win}"],check=False)
time.sleep(2)
subprocess.run(["bash","-lc","DISPLAY=:0 xfce4-screenshooter -f -s /tmp/c720p-v83-surround.png"],check=False)
run(["ffmpeg","-y","-loglevel","error","-i","/tmp/c720p-v83-surround.png","-vf","scale=455:-2","-q:v","14","/tmp/c720p-v83-overview.jpg"])
run(["ffmpeg","-y","-loglevel","error","-i","/tmp/c720p-v83-surround.png","-vf","crop=520:300:820:430","-q:v","8","/tmp/c720p-v83-surround-crop.jpg"],check=False)

print("KIOSK="+run(["systemctl","--user","is-active","c720p-home-hub-kiosk.service"],check=False).strip())
print("V83_HTTP="+run(["curl","-sS","-o","/tmp/v83-live","-w","%{http_code}","--max-time","5","http://127.0.0.1:8123/local/c720p-extra-row-v83.html"],check=False).strip())
print("V83_MARKER="+str("C720P_VISIBLE_TV_SURROUND_V83" in Path("/tmp/v83-live").read_text(errors="ignore")))
print("OVERVIEW=/tmp/c720p-v83-overview.jpg")
print("CROP=/tmp/c720p-v83-surround-crop.jpg")
