#!/usr/bin/env python3
from __future__ import annotations
import datetime, json, os, pathlib, py_compile, shutil, subprocess, time

HOME=pathlib.Path("/home/jespern")
HUB=HOME/"c720p-home-hub"
BIN=HUB/"bin"
STATE=HUB/"state"
UNITS=HOME/".config/systemd/user"
HA=pathlib.Path("/opt/homeassistant/config")
AUTOMATIONS=HA/"automations.yaml"
PYTHON=HUB/"person-detector/venv/bin/python"
SCRIPT=BIN/"c720p-frontcam-motion-living-lamp.py"
UNIT=UNITS/"c720p-frontcam-motion-living-lamp.service"
MARK_A="# BEGIN C720P_FRONTCAM_MOTION_LIVING_LAMP_V1"
MARK_B="# END C720P_FRONTCAM_MOTION_LIVING_LAMP_V1"
DIAG_A="# BEGIN C720P_LIVING_LAMP_RELAY_DIAG_V1"
DIAG_B="# END C720P_LIVING_LAMP_RELAY_DIAG_V1"
stamp=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
backup=HOME/"c720p-backups"/f"frontcam-motion-lamp-v2-{stamp}"
backup.mkdir(parents=True,exist_ok=True)
for p in (SCRIPT,UNIT,AUTOMATIONS):
    if p.exists(): shutil.copy2(p,backup/(p.name+".before"))

detector=r'''#!/home/jespern/c720p-home-hub/person-detector/venv/bin/python
from __future__ import annotations
import json, os, pathlib, signal, time, urllib.request
import cv2
import numpy as np

cv2.setNumThreads(1)
DEVICE="/dev/video0"
WIDTH=160
HEIGHT=120
TARGET_PERIOD=0.50
QUIET_REARM_SECONDS=4.0
TRIGGER_COOLDOWN_SECONDS=15.0
BACKGROUND_ALPHA_QUIET=0.05
BACKGROUND_ALPHA_MOTION=0.003
SETTLE_SECONDS=2.5
WEBHOOK="http://127.0.0.1:8123/api/webhook/c720p_frontcam_living_lamp_20261007_b83f5aa1"
BASE=pathlib.Path("/home/jespern/c720p-home-hub")
STATE=BASE/"state/frontcam-motion-living-lamp.json"
LOG=BASE/"logs/frontcam-motion-living-lamp.log"
STOP=False

def log(msg):
    line=time.strftime("%Y-%m-%d %H:%M:%S")+" "+str(msg)
    print(line,flush=True)
    LOG.parent.mkdir(parents=True,exist_ok=True)
    try:
        with LOG.open("a") as f:f.write(line+"\n")
    except Exception: pass

def atomic_json(data):
    STATE.parent.mkdir(parents=True,exist_ok=True)
    tmp=STATE.with_suffix(".tmp"); tmp.write_text(json.dumps(data,indent=2)+"\n"); os.replace(tmp,STATE)

def post_motion():
    req=urllib.request.Request(WEBHOOK,data=b'{"source":"c720p-frontcam","motion":true}',
        headers={"Content-Type":"application/json"},method="POST")
    try:
        with urllib.request.urlopen(req,timeout=4) as r:return True,int(getattr(r,"status",200))
    except Exception as e:return False,type(e).__name__+":"+str(e)[:160]

def open_camera():
    cap=cv2.VideoCapture(DEVICE,cv2.CAP_V4L2)
    if not cap.isOpened(): return None
    cap.set(cv2.CAP_PROP_FOURCC,cv2.VideoWriter_fourcc(*"MJPG"))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,WIDTH); cap.set(cv2.CAP_PROP_FRAME_HEIGHT,HEIGHT)
    cap.set(cv2.CAP_PROP_FPS,5); cap.set(cv2.CAP_PROP_BUFFERSIZE,1)
    # Auto exposure performed better than every tested manual value in the
    # illuminated room and is no worse in darkness. Keep hardware auto exposure.
    cap.set(cv2.CAP_PROP_AUTO_EXPOSURE,3.0)
    return cap

def preprocess(frame):
    g=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
    if g.shape[1]!=WIDTH or g.shape[0]!=HEIGHT:
        g=cv2.resize(g,(WIDTH,HEIGHT),interpolation=cv2.INTER_AREA)
    return cv2.GaussianBlur(g,(5,5),0)

def thresholds(luma):
    # The C720P front camera becomes almost black (luma ~8) with the living-room
    # lamp off. In that mode its sensor noise is also extremely low, so a much
    # smaller frame-difference threshold is useful and still cheap.
    if luma < 20:
        return {"mode":"dark","delta":3,"changed":0.05,"contour":12.0,"confirm":3}
    if luma < 45:
        return {"mode":"dim","delta":6,"changed":0.14,"contour":28.0,"confirm":2}
    return {"mode":"normal","delta":18,"changed":0.65,"contour":95.0,"confirm":2}

def on_signal(*_):
    global STOP
    STOP=True
signal.signal(signal.SIGTERM,on_signal); signal.signal(signal.SIGINT,on_signal)

def main():
    cap=None; bg=None; warm=0; candidate_streak=0; last_motion_at=0.0; last_trigger_at=0.0
    trigger_count=0; armed=True; camera_failures=0; last_write=0.0; settle_until=0.0
    latest={}
    log("FRONTCAM_MOTION_V2 starting; adaptive dark-room detection; no images stored")
    while not STOP:
        loop_started=time.monotonic()
        if cap is None:
            cap=open_camera()
            if cap is None:
                camera_failures+=1
                atomic_json({"ok":False,"camera":DEVICE,"camera_failures":camera_failures,
                             "error":"camera_open_failed","updated_at":time.time()})
                time.sleep(5); continue
            bg=None; warm=0; candidate_streak=0; camera_failures=0
            log("camera opened at 160x120 low-CPU motion mode")
        ok,frame=cap.read()
        if not ok or frame is None:
            camera_failures+=1
            try:cap.release()
            except Exception:pass
            cap=None; time.sleep(1); continue

        g=preprocess(frame); luma=float(np.mean(g)); frame_std=float(np.std(g)); now=time.time()
        if bg is None:
            bg=g.astype(np.float32); warm=1; time.sleep(TARGET_PERIOD); continue

        warm+=1; ref=cv2.convertScaleAbs(bg); ref_luma=float(np.mean(ref))
        th=thresholds(luma)
        diff=cv2.absdiff(g,ref)
        mask=(diff>=th["delta"]).astype(np.uint8)*255
        mask=cv2.morphologyEx(mask,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
        changed_pct=float(cv2.countNonZero(mask))*100.0/float(WIDTH*HEIGHT)
        contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        largest=max((float(cv2.contourArea(c)) for c in contours),default=0.0)

        # Lamp switching and webcam auto-exposure produce near-global changes.
        # They are lighting transitions, not human motion. Snap the background to
        # the new level and allow the camera a short settle period.
        abrupt=bool(changed_pct>=55.0 or abs(luma-ref_luma)>=40.0)
        if abrupt:
            bg=g.astype(np.float32); candidate_streak=0; settle_until=now+SETTLE_SECONDS
            candidate=False
        elif now<settle_until or warm<10:
            candidate=False; candidate_streak=0
            cv2.accumulateWeighted(g,bg,BACKGROUND_ALPHA_QUIET)
        else:
            candidate=bool(changed_pct>=th["changed"] and largest>=th["contour"])
            if candidate:
                candidate_streak+=1; last_motion_at=now
            else:
                candidate_streak=0
            alpha=BACKGROUND_ALPHA_MOTION if candidate else BACKGROUND_ALPHA_QUIET
            cv2.accumulateWeighted(g,bg,alpha)

        confirmed=bool(candidate and candidate_streak>=th["confirm"])
        if not armed and now-last_motion_at>=QUIET_REARM_SECONDS: armed=True

        webhook_ok=None; webhook_status=None
        if confirmed and armed and now-last_trigger_at>=TRIGGER_COOLDOWN_SECONDS:
            webhook_ok,webhook_status=post_motion()
            if webhook_ok:
                trigger_count+=1; last_trigger_at=now; armed=False
                log(f"motion trigger mode={th['mode']} luma={luma:.1f} changed={changed_pct:.2f}% contour={largest:.0f}")
            else: log(f"motion webhook failed: {webhook_status}")

        latest={
            "ok":True,"version":"frontcam-motion-v2","camera":DEVICE,
            "analysis_size":[WIDTH,HEIGHT],"analysis_hz_target":round(1/TARGET_PERIOD,2),
            "stores_images":False,"light_mode":th["mode"],"pixel_delta":th["delta"],
            "changed_percent":round(changed_pct,3),"largest_contour_area":round(largest,1),
            "luma":round(luma,1),"frame_std":round(frame_std,2),
            "background_luma":round(ref_luma,1),"abrupt_light_change":abrupt,
            "settling":bool(now<settle_until),"candidate":candidate,"confirmed_motion":confirmed,
            "candidate_streak":candidate_streak,"armed":armed,"last_motion_at":last_motion_at or None,
            "last_trigger_at":last_trigger_at or None,"trigger_count":trigger_count,
            "last_webhook_ok":webhook_ok,"last_webhook_status":webhook_status,
            "camera_failures":camera_failures,"updated_at":now}
        if now-last_write>=2.0 or webhook_ok is not None:
            atomic_json(latest); last_write=now

        elapsed=time.monotonic()-loop_started
        if elapsed<TARGET_PERIOD: time.sleep(TARGET_PERIOD-elapsed)
    if cap is not None: cap.release()
    latest["stopped_at"]=time.time(); atomic_json(latest)
    log("FRONTCAM_MOTION_V2 stopped")
    return 0
if __name__=="__main__": raise SystemExit(main())
'''
SCRIPT.write_text(detector); SCRIPT.chmod(0o755); py_compile.compile(str(SCRIPT),doraise=True)

s=AUTOMATIONS.read_text()
main_block=f'''{MARK_A}
- id: c720p_frontcam_motion_living_lamp_v1
  alias: C720P front camera motion - Living room lamp only
  description: >-
    Laptop front-camera motion trigger. Turns on only the living-room plug lamp;
    the living-room ceiling light is deliberately excluded.
  triggers:
    - trigger: webhook
      webhook_id: c720p_frontcam_living_lamp_20261007_b83f5aa1
      allowed_methods:
        - POST
      local_only: true
  conditions:
    - condition: state
      entity_id: switch.lamp_woonkamer_socket_1
      state: "off"
  actions:
    - action: switch.turn_on
      target:
        entity_id: switch.lamp_woonkamer_socket_1
  mode: single
{MARK_B}'''
if MARK_A in s and MARK_B in s:
    i=s.index(MARK_A); j=s.index(MARK_B,i)+len(MARK_B); s=s[:i]+main_block+s[j:]
else:
    s=s.rstrip()+"\n\n"+main_block+"\n"
# Remove the temporary relay diagnostic automation.
if DIAG_A in s and DIAG_B in s:
    i=s.index(DIAG_A); j=s.index(DIAG_B,i)+len(DIAG_B); s=s[:i].rstrip()+"\n"+s[j:].lstrip("\n")
AUTOMATIONS.write_text(s.rstrip()+"\n")

check=subprocess.run(["docker","exec","homeassistant","python","-m","homeassistant","--script","check_config","-c","/config"],
                     text=True,capture_output=True,timeout=180)
if check.returncode!=0:
    shutil.copy2(backup/(AUTOMATIONS.name+".before"),AUTOMATIONS)
    shutil.copy2(backup/(SCRIPT.name+".before"),SCRIPT)
    raise SystemExit("HA_CONFIG_CHECK_FAILED: "+(check.stdout+check.stderr)[-4000:])

subprocess.run(["systemctl","--user","restart",UNIT.name],check=True,timeout=30)
subprocess.run(["docker","restart","homeassistant"],check=True,timeout=45)
deadline=time.time()+120; ha_up=False
while time.time()<deadline:
    r=subprocess.run(["curl","-fsS","--max-time","3","http://127.0.0.1:8123/"],
                     stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
    if r.returncode==0: ha_up=True; break
    time.sleep(2)
time.sleep(8)
service=subprocess.run(["systemctl","--user","show",UNIT.name,"-p","ActiveState","-p","MainPID","-p","CPUUsageNSec","-p","MemoryCurrent"],
                       text=True,capture_output=True,timeout=10).stdout.strip()
state={}
try: state=json.loads((STATE/"frontcam-motion-living-lamp.json").read_text())
except Exception as e: state={"state_read_error":str(e)}
print(json.dumps({"ok":True,"version":"frontcam-motion-lamp-v2","backup":str(backup),
 "ha_config_check":"pass","ha_returned":ha_up,"service":service,"state":state,
 "target":"switch.lamp_woonkamer_socket_1","ceiling_excluded":"light.woonkamer_plafond",
 "low_light_strategy":"adaptive thresholds at luma<20 plus global-light-change suppression",
 "images_stored":False},indent=2))
