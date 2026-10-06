#!/usr/bin/env python3
import json, subprocess, time, tarfile, shutil
from datetime import datetime
from pathlib import Path

CFG=Path("/opt/homeassistant/config")
WWW=CFG/"www"
DASH=CFG/".storage/lovelace.c720p_hub"
IMAGE="ghcr.io/home-assistant/home-assistant:stable"
ARCHIVES=sorted(Path("/home/jespern/c720p-home-hub/backups/ui-cleanup").glob("c720p-ui-superseded-*.tar.gz"), reverse=True)

def run(cmd,check=True):
    p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    if check and p.returncode:
        raise SystemExit(p.stdout)
    return p.stdout

# Restore the original middle-row component source from the verified cleanup archive.
if not ARCHIVES:
    raise SystemExit("No cleanup archive found")
archive=ARCHIVES[0]
member="www/c720p-tv-surround.html"
with tarfile.open(archive,"r:gz") as t:
    try:
        raw=t.extractfile(member).read().decode()
    except Exception as e:
        raise SystemExit(f"Could not restore {member}: {e}")

# Preserve its original visual design and placement, but replace the brittle old
# surround action with the current verified async pipeline/state model.
start=raw.find("<script>")
end=raw.rfind("</script>")
if start < 0 or end < 0:
    raise SystemExit("Original TV/surround component has no script block")

script=r'''<script>
const statusEl=document.getElementById("status");
const surroundBtn=document.getElementById("surround");
const host=location.hostname;
const wait=ms=>new Promise(r=>setTimeout(r,ms));

async function post8789(path,label){
  statusEl.textContent=label+"…"; statusEl.className="status";
  try{
    const r=await fetch("http://"+host+":8789"+path,{method:"POST",cache:"no-store"});
    const j=await r.json().catch(()=>({ok:r.ok}));
    if(!r.ok || j.ok===false) throw new Error(j.failure||j.error||("HTTP "+r.status));
    statusEl.textContent=label+" ready"; statusEl.className="status ok";
  }catch(e){
    statusEl.textContent=label+" failed"; statusEl.className="status bad";
  }
}

async function helper(path,opts={}){
  const c=new AbortController(),timer=setTimeout(()=>c.abort(),opts.timeout||6000);
  try{
    const r=await fetch("http://"+host+":8790"+path,{
      method:opts.method||"GET",cache:"no-store",signal:c.signal
    });
    const j=await r.json().catch(()=>({}));
    if(!r.ok) throw new Error(j.failure||j.state||("HTTP "+r.status));
    return j;
  }finally{clearTimeout(timer)}
}
function liveReady(s){
  return !!(s&&s.live_ready===true&&s.bluetooth_connected===true&&s.audio_sink_present===true&&s.audio_sink_default===true);
}
async function paintSurround(){
  try{
    const s=await helper("/state",{timeout:4000});
    surroundBtn.classList.remove("ok","bad");
    if(s.pipeline_running||s.pipeline_state==="running"){
      statusEl.textContent="TV → HDMI 3 → HTS Bluetooth…";
      statusEl.className="status";
      surroundBtn.textContent="Connecting surround…";
      surroundBtn.disabled=true;
    }else if(liveReady(s)){
      statusEl.textContent="Samsung Bluetooth audio verified";
      statusEl.className="status ok";
      surroundBtn.textContent="Surround ready";
      surroundBtn.disabled=false;
    }else if(s.pipeline_state==="failed"){
      statusEl.textContent=String(s.pipeline_failure||s.last_pipeline_failure||"Surround failed").replaceAll("_"," ");
      statusEl.className="status bad";
      surroundBtn.textContent="Retry TV → HDMI 3 → Bluetooth";
      surroundBtn.disabled=false;
    }else{
      statusEl.textContent="Ready";
      statusEl.className="status";
      surroundBtn.textContent="TV → HDMI 3 → Samsung Bluetooth";
      surroundBtn.disabled=false;
    }
  }catch(e){
    statusEl.textContent="Surround helper offline";
    statusEl.className="status bad";
    surroundBtn.textContent="Retry TV → HDMI 3 → Bluetooth";
    surroundBtn.disabled=false;
  }
}
async function surroundReady(){
  surroundBtn.disabled=true;
  statusEl.textContent="Starting TV → HDMI 3 → HTS Bluetooth…";
  statusEl.className="status";
  try{
    await helper("/pipeline/bluetooth-fast",{method:"POST",timeout:6500});
    const deadline=Date.now()+95000;
    while(Date.now()<deadline){
      await wait(1200);
      const s=await helper("/state",{timeout:4000});
      if(liveReady(s)||(!s.pipeline_running&&s.pipeline_state==="failed")) break;
    }
  }catch(e){
    statusEl.textContent=String(e?.message||e).replaceAll("_"," ");
    statusEl.className="status bad";
  }
  await paintSurround();
}
surroundBtn.onclick=surroundReady;
document.getElementById("tvOn").onclick=()=>post8789("/grundig-tv/on","TV on");
document.getElementById("tvOff").onclick=()=>post8789("/grundig-tv/off","TV off");
document.getElementById("htDown").onclick=()=>post8789("/ht-e6500/volume/down","HTS volume");
document.getElementById("htUp").onclick=()=>post8789("/ht-e6500/volume/up","HTS volume");
paintSurround();
setInterval(paintSurround,4000);
</script>'''
restored=raw[:start]+script+raw[end+9:]
target=WWW/"c720p-tv-surround.html"

# Write through HA container to preserve ownership.
write_py="from pathlib import Path; import sys; Path(sys.argv[1]).write_bytes(sys.stdin.buffer.read())"
p=subprocess.run(["docker","exec","-i","homeassistant","python","-c",write_py,"/config/www/c720p-tv-surround.html"],
                 input=restored.encode(),stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
if p.returncode:
    raise SystemExit(p.stdout.decode(errors="replace"))
print("TV_SURROUND_FILE_RESTORED=OK")

# V82 was the lower row immediately before the incorrect TV-in-camera change.
if not (WWW/"c720p-extra-row-v82.html").exists():
    # Recover it from archive if cleanup removed it again.
    with tarfile.open(archive,"r:gz") as t:
        raw82=t.extractfile("www/c720p-extra-row-v81.html").read()
    # V82 may be absent in archive; if so do not fabricate it.
    raise SystemExit("V82 missing; explicit recovery required")
print("V82_PRESENT=OK")

# Safe Lovelace edit: revert only V84/V83 lower-row URL to V82.
run(["docker","stop","--time","25","homeassistant"])
patch=r'''
from pathlib import Path
import json,shutil
from datetime import datetime
p=Path("/config/.storage/lovelace.c720p_hub")
d=json.loads(p.read_text())
b=p.with_name(p.name+".before-restore-weather-tv-"+datetime.now().strftime("%Y%m%d_%H%M%S"))
shutil.copy2(p,b)
n=0
def walk(x):
  global n
  if isinstance(x,dict):
    u=str(x.get("url",""))
    if "c720p-extra-row-v84.html" in u or "c720p-extra-row-v83.html" in u:
      x["url"]="/local/c720p-extra-row-v82.html?v=CAMERA_ROW_RESTORED_V82_20261006"
      n+=1
    for v in x.values(): walk(v)
  elif isinstance(x,list):
    for v in x: walk(v)
walk(d)
if n!=1:
  raise SystemExit("Expected exactly one V83/V84 lower-row iframe, got "+str(n))
p.write_text(json.dumps(d,indent=2,ensure_ascii=False))
json.loads(p.read_text())
print("DASH_BACKUP="+str(b))
print("LOWER_ROW_REVERTED_TO_V82="+str(n))
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

print("TV_SURROUND_HTTP="+run(["curl","-sS","-o","/dev/null","-w","%{http_code}","--max-time","5","http://127.0.0.1:8123/local/c720p-tv-surround.html"],check=False).strip())
print("WEATHER_ROW_HTTP="+run(["curl","-sS","-o","/dev/null","-w","%{http_code}","--max-time","5","http://127.0.0.1:8123/local/c720p-weather-row.html"],check=False).strip())

run(["systemctl","--user","restart","c720p-home-hub-kiosk.service"],check=False)
time.sleep(15)
win=run(["bash","-lc","DISPLAY=:0 xdotool search --onlyvisible --name 'C720P Hub.*Home Assistant' 2>/dev/null | tail -1 || true"],check=False).strip()
if win:
    run(["bash","-lc",f"DISPLAY=:0 xdotool windowraise {win} windowactivate {win}"],check=False)
time.sleep(2)
subprocess.run(["bash","-lc","DISPLAY=:0 xfce4-screenshooter -f -s /tmp/c720p-tv-weather-restored.png"],check=False)
run(["ffmpeg","-y","-loglevel","error","-i","/tmp/c720p-tv-weather-restored.png","-vf","scale=455:-2","-q:v","14","/tmp/c720p-tv-weather-restored-preview.jpg"])
run(["ffmpeg","-y","-loglevel","error","-i","/tmp/c720p-tv-weather-restored.png","-vf","crop=680:250:660:300","-q:v","8","/tmp/c720p-tv-weather-restored-middle.jpg"],check=False)
run(["ffmpeg","-y","-loglevel","error","-i","/tmp/c720p-tv-weather-restored.png","-vf","crop=520:250:825:445","-q:v","8","/tmp/c720p-tv-weather-restored-lower-right.jpg"],check=False)
print("KIOSK="+run(["systemctl","--user","is-active","c720p-home-hub-kiosk.service"],check=False).strip())
print("FILES=/tmp/c720p-tv-weather-restored-preview.jpg,/tmp/c720p-tv-weather-restored-middle.jpg,/tmp/c720p-tv-weather-restored-lower-right.jpg")
