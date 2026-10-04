#!/usr/bin/env python3
import json, shutil, subprocess, time
from datetime import datetime
from pathlib import Path

CFG=Path("/opt/homeassistant/config")
V79=CFG/"www/c720p-extra-row-v79.html"
V80=CFG/"www/c720p-extra-row-v80.html"
DASH=CFG/".storage/lovelace.c720p_hub"
IMAGE="ghcr.io/home-assistant/home-assistant:stable"

def run(cmd, check=True):
    p=subprocess.run(cmd,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    if check and p.returncode:
        raise SystemExit(p.stdout)
    return p.stdout

# Build V80 from the proven V79 component, with control-first radiator layout.
s=V79.read_text()
s=s.replace('id="minus">-</button>','id="minus">−0.5</button>')
s=s.replace('id="plus">+</button>','id="plus">+0.5</button>')
s=s.replace('id="preset" class="preset">Comfort 20</button>','id="preset" class="preset">20°C</button>')
marker="C720P_RADIATOR_CONTROLS_V80"
css=r"""
<style id="C720P_RADIATOR_CONTROLS_V80">
/* V80: radiator controls are primary again; ambient sensors remain readable but secondary. */
.row{
  grid-template-columns:minmax(0,1.13fr) minmax(320px,.92fr) minmax(0,1.24fr)!important;
}
.radBox{
  padding:7px 9px 8px!important;
  border-color:rgba(255,159,50,.52)!important;
  background:
    radial-gradient(circle at 50% 53%,rgba(255,159,50,.19),transparent 54%),
    linear-gradient(155deg,#182530,#070c12 78%)!important;
}
.radTop{margin-bottom:4px!important;min-height:29px!important}
.radBox .title{font-size:19px!important;line-height:1!important}
.ambientSummary{font-size:8px!important;margin-top:2px!important}
.mode{font-size:8px!important;padding:3px 6px!important;max-width:118px!important}

.sensorStrip{
  grid-template-columns:repeat(3,minmax(0,1fr))!important;
  gap:5px!important;
  margin:0 0 5px!important;
}
.miniSensor{
  min-height:53px!important;
  padding:5px 6px 15px!important;
  border-radius:9px!important;
  background:linear-gradient(180deg,rgba(32,197,232,.085),rgba(255,255,255,.025))!important;
}
.sensorName{font-size:8px!important}
.sensorTemp{font-size:22px!important;margin-top:4px!important}
.sensorHum{
  right:6px!important;
  bottom:5px!important;
  font-size:13px!important;
}
.sensorBatt{
  width:27px!important;
  height:13px!important;
  border-width:1.5px!important;
  font-size:7px!important;
}
.sensorBatt::after{right:-4px!important;top:3px!important;width:2px!important;height:5px!important}

.radBody{
  grid-template-columns:minmax(0,.78fr) 18px minmax(0,1.18fr)!important;
  grid-template-rows:43px 27px!important;
  gap:3px 4px!important;
  min-height:73px!important;
}
.radBody .label{font-size:8px!important}
.radBody > .metric:first-child .number{
  font-size:26px!important;
  color:#c9d9e6!important;
  text-shadow:none!important;
}
.radBody > .metric:nth-child(3) .number{
  font-size:38px!important;
  color:#ffad48!important;
  text-shadow:0 0 18px rgba(255,159,50,.24)!important;
}
.degree{font-size:12px!important}
.arrow{font-size:19px!important}
.slider{
  height:27px!important;
  margin:0!important;
  cursor:pointer!important;
  accent-color:#ff9f32!important;
}

.radControls{
  grid-template-columns:1fr .8fr 1fr!important;
  gap:7px!important;
  margin-top:4px!important;
}
.radControls button{
  height:42px!important;
  border-radius:10px!important;
  font-size:18px!important;
  border:1px solid rgba(255,159,50,.24)!important;
  background:rgba(255,159,50,.09)!important;
  box-shadow:inset 0 1px rgba(255,255,255,.04)!important;
  touch-action:manipulation!important;
}
.radControls #minus,.radControls #plus{
  font-size:17px!important;
  color:#fff!important;
}
.radControls .preset{
  font-size:15px!important;
  color:#ffd095!important;
  background:rgba(255,159,50,.17)!important;
  border-color:rgba(255,159,50,.38)!important;
}
.radControls button:active{
  transform:scale(.96)!important;
  background:rgba(255,159,50,.26)!important;
}
</style>
"""
if marker not in s:
    s=s.replace("</head>",css+"</head>",1)
V80.write_text(s)
print("V80_BUILD=OK",len(s))

# Stop HA before editing Lovelace storage.
run(["docker","stop","--time","25","homeassistant"])

patch=r'''
from pathlib import Path
import json,shutil
from datetime import datetime

p=Path("/config/.storage/lovelace.c720p_hub")
d=json.loads(p.read_text())
b=p.with_name(p.name+".before-eco-bedroom-voice-v55-radiator-v80-"+datetime.now().strftime("%Y%m%d_%H%M%S"))
shutil.copy2(p,b)

VOICE_URL="/local/c720p-voice-banner.html?c720p_build=VOICE_V55_RESTORED_20261004"
ECO_URL="/local/c720p-eco-timer-dual-v4.html?v=BEDROOM_HOME_V4_20261004"
RAD_URL="/local/c720p-extra-row-v80.html?v=RADIATOR_CONTROLS_V80_20261004"

voice_count=eco_removed=wrappers_flattened=rad_count=0

def is_voice(x):
    return isinstance(x,dict) and x.get("type")=="iframe" and "c720p-voice-banner" in str(x.get("url",""))
def is_eco(x):
    return isinstance(x,dict) and x.get("type")=="iframe" and "c720p-eco-timer-dual" in str(x.get("url",""))

def iframe(url,aspect):
    return {
      "type":"iframe","url":url,"aspect_ratio":aspect,
      "card_mod":{"style":"ha-card { border:0 !important; box-shadow:none !important; background:transparent !important; outline:0 !important; overflow:hidden !important; } iframe { border:0 !important; outline:0 !important; background:transparent !important; }"}
    }

def normalize(x):
    global voice_count,eco_removed,wrappers_flattened,rad_count
    if isinstance(x,dict):
        if x.get("type")=="iframe":
            u=str(x.get("url",""))
            if "c720p-voice-banner" in u:
                x["url"]=VOICE_URL
                x["aspect_ratio"]="32.05%"
                voice_count+=1
            elif "c720p-extra-row-v79.html" in u or "c720p-extra-row-v80.html" in u:
                x["url"]=RAD_URL
                x["aspect_ratio"]="15.2%"
                rad_count+=1
        for k,v in list(x.items()):
            if isinstance(v,list):
                new=[]
                for e in v:
                    if is_eco(e):
                        eco_removed+=1
                        continue
                    normalize(e)
                    # Flatten the old timer+voice wrapper after timer removal.
                    if isinstance(e,dict) and e.get("type")=="vertical-stack":
                        cards=e.get("cards")
                        if isinstance(cards,list):
                            cards=[c for c in cards if not is_eco(c)]
                            e["cards"]=cards
                            if len(cards)==1 and is_voice(cards[0]):
                                new.append(cards[0])
                                wrappers_flattened+=1
                                continue
                    new.append(e)
                x[k]=new
            else:
                normalize(v)
    elif isinstance(x,list):
        for e in x: normalize(e)

normalize(d)

# Put one generous Eco timer into the newly freed Bedroom space on Home.
view=d["data"]["config"]["views"][0]
home_grid=view["cards"][0]["cards"][0]
bed=None
for stack in home_grid.get("cards",[]):
    if not isinstance(stack,dict) or stack.get("type")!="vertical-stack": continue
    cards=stack.get("cards",[])
    if cards and isinstance(cards[0],dict) and cards[0].get("entity")=="light.c720p_ui_bedroom_lights":
        bed=stack
        break
if bed is None:
    raise SystemExit("Bedroom stack not found")
bed["cards"]=[c for c in bed.get("cards",[]) if not is_eco(c)]
bed["cards"].append(iframe(ECO_URL,"23%"))

p.write_text(json.dumps(d,indent=2,ensure_ascii=False))
json.loads(p.read_text())

# Final topology counts.
eco_total=voice_total=rad_total=0
def count(x):
    global eco_total,voice_total,rad_total
    if isinstance(x,dict):
        if is_eco(x): eco_total+=1
        if is_voice(x): voice_total+=1
        if x.get("type")=="iframe" and "c720p-extra-row-v80.html" in str(x.get("url","")): rad_total+=1
        for v in x.values(): count(v)
    elif isinstance(x,list):
        for v in x: count(v)
count(d)
if eco_total!=1:
    raise SystemExit("Expected exactly one Eco timer, got "+str(eco_total))
print("BACKUP="+str(b))
print("DASH_PATCH=OK voice=%d eco_removed=%d wrappers=%d radiators=%d"%(voice_count,eco_removed,wrappers_flattened,rad_count))
print("FINAL_TOPOLOGY voice=%d eco=%d radiator=%d"%(voice_total,eco_total,rad_total))
'''
out=run(["docker","run","--rm","-i","-v","/opt/homeassistant/config:/config",IMAGE,"python","-c",patch])
print(out,end="")

run(["docker","start","homeassistant"])
for _ in range(50):
    try:
        code=run(["curl","-sS","-o","/dev/null","-w","%{http_code}","--max-time","3","http://127.0.0.1:8123/"],check=False).strip()
        if code=="200":
            print("HA_HTTP=200")
            break
    except Exception:
        pass
    time.sleep(2)
else:
    raise SystemExit("HA did not return HTTP 200")

run(["systemctl","--user","restart","c720p-home-hub-kiosk.service"],check=False)
time.sleep(12)

# Bring HA to front; recover compositor if necessary.
def bring_front():
    return run(["bash","-lc","DISPLAY=:0 xdotool search --onlyvisible --name 'C720P Hub.*Home Assistant' 2>/dev/null | tail -1 || true"],check=False).strip()
win=bring_front()
if win:
    run(["bash","-lc",f"DISPLAY=:0 xdotool windowraise {win} windowactivate {win}"],check=False)
time.sleep(2)
run(["bash","-lc","DISPLAY=:0 xfce4-screenshooter -f -s /tmp/c720p-v80-final.png"],check=False)

# Produce both overview and useful close-ups.
run(["ffmpeg","-y","-loglevel","error","-i","/tmp/c720p-v80-final.png","-vf","scale=455:-2","-q:v","14","/tmp/c720p-v80-overview.jpg"])
run(["ffmpeg","-y","-loglevel","error","-i","/tmp/c720p-v80-final.png","-vf","crop=650:360:330:10","-q:v","9","/tmp/c720p-v80-topcrop.jpg"],check=False)
run(["ffmpeg","-y","-loglevel","error","-i","/tmp/c720p-v80-final.png","-vf","crop=500:260:430:480","-q:v","9","/tmp/c720p-v80-radcrop.jpg"],check=False)
print("KIOSK="+run(["systemctl","--user","is-active","c720p-home-hub-kiosk.service"],check=False).strip())
print("FILES=/tmp/c720p-v80-overview.jpg,/tmp/c720p-v80-topcrop.jpg,/tmp/c720p-v80-radcrop.jpg")
