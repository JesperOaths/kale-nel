#!/usr/bin/env python3
import json, shutil, subprocess, time
from datetime import datetime
from pathlib import Path

CFG=Path("/opt/homeassistant/config")
SRC=CFG/"www/c720p-extra-row-v80.html"
DST=CFG/"www/c720p-extra-row-v81.html"
IMAGE="ghcr.io/home-assistant/home-assistant:stable"

def run(cmd,check=True):
    p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    if check and p.returncode:
        raise SystemExit(p.stdout)
    return p.stdout

s=SRC.read_text()
css=r"""
<style id="C720P_FIT_768_V81">
/* V81: preserve control usability while reclaiming enough vertical space for the scene row. */
.radBox{padding:5px 8px 6px!important}
.radTop{margin-bottom:3px!important;min-height:25px!important}
.radBox .title{font-size:18px!important}
.ambientSummary{font-size:7.5px!important;margin-top:1px!important}
.mode{font-size:7.5px!important;padding:2px 5px!important}

.sensorStrip{gap:4px!important;margin:0 0 4px!important}
.miniSensor{
  min-height:46px!important;
  padding:4px 5px 13px!important;
  border-radius:8px!important;
}
.sensorName{font-size:7.5px!important}
.sensorTemp{font-size:19px!important;margin-top:3px!important}
.sensorHum{right:5px!important;bottom:4px!important;font-size:12px!important}
.sensorBatt{width:24px!important;height:12px!important;font-size:6.5px!important}

.radBody{
  grid-template-columns:minmax(0,.78fr) 16px minmax(0,1.18fr)!important;
  grid-template-rows:36px 22px!important;
  min-height:60px!important;
  gap:2px 4px!important;
}
.radBody > .metric:first-child .number{font-size:24px!important}
.radBody > .metric:nth-child(3) .number{font-size:34px!important}
.degree{font-size:11px!important}
.arrow{font-size:17px!important}
.slider{height:22px!important}

.radControls{gap:6px!important;margin-top:2px!important}
.radControls button{
  height:34px!important;
  border-radius:9px!important;
  font-size:16px!important;
}
.radControls #minus,.radControls #plus{font-size:15px!important}
.radControls .preset{font-size:14px!important}
</style>
"""
if "C720P_FIT_768_V81" not in s:
    s=s.replace("</head>",css+"</head>",1)
DST.write_text(s)
print("V81_BUILD=OK",len(s))

# Stop HA before storage edit.
print(run(["docker","stop","--time","25","homeassistant"]),end="")
patch=r'''
from pathlib import Path
import json,shutil
from datetime import datetime
p=Path("/config/.storage/lovelace.c720p_hub")
d=json.loads(p.read_text())
b=p.with_name(p.name+".before-fit-768-v81-"+datetime.now().strftime("%Y%m%d_%H%M%S"))
shutil.copy2(p,b)
counts={"voice":0,"weather":0,"extra":0}
def walk(x):
    if isinstance(x,dict):
        if x.get("type")=="iframe":
            u=str(x.get("url",""))
            if "c720p-voice-banner.html" in u:
                # Original V55 content/min-height is preserved; remove only surplus iframe whitespace.
                x["aspect_ratio"]="28.5%"
                counts["voice"]+=1
            elif "c720p-weather-row.html" in u:
                x["aspect_ratio"]="13.1%"
                counts["weather"]+=1
            elif "c720p-extra-row-v80.html" in u or "c720p-extra-row-v81.html" in u:
                x["url"]="/local/c720p-extra-row-v81.html?v=FIT_768_V81_20261004"
                x["aspect_ratio"]="13.6%"
                counts["extra"]+=1
        for v in x.values(): walk(v)
    elif isinstance(x,list):
        for v in x: walk(v)
walk(d)
if counts["voice"]<1 or counts["weather"]!=1 or counts["extra"]!=1:
    raise SystemExit("Unexpected patch counts "+repr(counts))
p.write_text(json.dumps(d,indent=2,ensure_ascii=False))
json.loads(p.read_text())
print("BACKUP="+str(b))
print("PATCH_COUNTS="+repr(counts))
'''
print(run(["docker","run","--rm","-i","-v","/opt/homeassistant/config:/config",IMAGE,"python","-c",patch]),end="")
print(run(["docker","start","homeassistant"]),end="")

for _ in range(50):
    code=run(["curl","-sS","-o","/dev/null","-w","%{http_code}","--max-time","3","http://127.0.0.1:8123/"],check=False).strip()
    if code=="200":
        print("HA_HTTP=200")
        break
    time.sleep(2)
else:
    raise SystemExit("HA HTTP timeout")

run(["systemctl","--user","restart","c720p-home-hub-kiosk.service"],check=False)
time.sleep(12)

# Bring HA forward and recover compositor if needed.
win=run(["bash","-lc","DISPLAY=:0 xdotool search --onlyvisible --name 'C720P Hub.*Home Assistant' 2>/dev/null | tail -1 || true"],check=False).strip()
if win:
    run(["bash","-lc",f"DISPLAY=:0 xdotool windowraise {win} windowactivate {win}"],check=False)
time.sleep(2)
subprocess.run(["bash","-lc","DISPLAY=:0 xfce4-screenshooter -f -s /tmp/c720p-fit-v81.png"],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
run(["ffmpeg","-y","-loglevel","error","-i","/tmp/c720p-fit-v81.png","-vf","scale=455:-2","-q:v","14","/tmp/c720p-fit-v81-preview.jpg"])
print("KIOSK="+run(["systemctl","--user","is-active","c720p-home-hub-kiosk.service"],check=False).strip())
print("SCREENSHOT=/tmp/c720p-fit-v81.png")
