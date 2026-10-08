#!/usr/bin/env python3
from __future__ import annotations
import datetime, pathlib, shutil, subprocess, textwrap, time, json, py_compile

HOME=pathlib.Path("/home/jespern")
HUB=HOME/"c720p-home-hub"
SCRIPT=HUB/"bin/c720p-frontcam-motion-living-lamp.py"
UNIT=HOME/".config/systemd/user/c720p-frontcam-motion-living-lamp.service"
STAMP=datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
BACKUP=HOME/"c720p-backups"/f"frontcam-motion-v4-{STAMP}"
BACKUP.mkdir(parents=True,exist_ok=True)
for p in (SCRIPT,UNIT):
    if p.exists(): shutil.copy2(p,BACKUP/(p.name+".before"))

detector = r'''#!/home/jespern/c720p-home-hub/person-detector/venv/bin/python
from __future__ import annotations
import json, os, pathlib, signal, time, urllib.request
import cv2
import numpy as np

cv2.setNumThreads(1)
DEVICE="/dev/video0"
WIDTH=160
HEIGHT=120
TARGET_PERIOD=0.50
QUIET_REARM_SECONDS=3.0
TRIGGER_COOLDOWN_SECONDS=12.0
BACKGROUND_ALPHA_QUIET=0.05
BACKGROUND_ALPHA_MOTION=0.002
SETTLE_SECONDS=2.0
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
    tmp=STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(data,indent=2)+"\n")
    os.replace(tmp,STATE)

def post_motion():
    req=urllib.request.Request(
        WEBHOOK,
        data=b'{"source":"c720p-frontcam","motion":true}',
        headers={"Content-Type":"application/json"},
        method="POST")
    try:
        with urllib.request.urlopen(req,timeout=4) as r:
            return True,int(getattr(r,"status",200))
    except Exception as e:
        return False,type(e).__name__+":"+str(e)[:160]

def open_camera():
    cap=cv2.VideoCapture(DEVICE,cv2.CAP_V4L2)
    if not cap.isOpened(): return None
    cap.set(cv2.CAP_PROP_FOURCC,cv2.VideoWriter_fourcc(*"MJPG"))
    cap.set(cv2.CAP_PROP_FRAME_WIDTH,WIDTH)
    cap.set(cv2.CAP_PROP_FRAME_HEIGHT,HEIGHT)
    cap.set(cv2.CAP_PROP_FPS,5)
    cap.set(cv2.CAP_PROP_BUFFERSIZE,1)
    # Explicitly restore sane webcam controls. Earlier diagnostics intentionally
    # pushed brightness/contrast to their maxima; leaving those values in the
    # hardware made the live image overexposed and reduced motion contrast.
    cap.set(cv2.CAP_PROP_BRIGHTNESS,0.0)
    cap.set(cv2.CAP_PROP_CONTRAST,0.0)
    cap.set(cv2.CAP_PROP_AUTO_EXPOSURE,3.0)
    return cap

def preprocess(frame):
    g=cv2.cvtColor(frame,cv2.COLOR_BGR2GRAY)
    if g.shape[1]!=WIDTH or g.shape[0]!=HEIGHT:
        g=cv2.resize(g,(WIDTH,HEIGHT),interpolation=cv2.INTER_AREA)
    return cv2.GaussianBlur(g,(5,5),0)

def thresholds(luma):
    # Darkness is deliberately sensitive: the sensor is nearly noise-free at
    # luma ~8, so small coherent changes are meaningful. Confirmation across
    # two frames prevents single-frame speckles from becoming triggers.
    if luma < 20:
        return {"mode":"dark","delta":2,"changed":0.025,"contour":6.0,"confirm":2}
    if luma < 45:
        return {"mode":"dim","delta":4,"changed":0.08,"contour":18.0,"confirm":2}
    return {"mode":"normal","delta":18,"changed":0.65,"contour":95.0,"confirm":2}

def metrics(mask):
    changed=float(cv2.countNonZero(mask))*100.0/float(WIDTH*HEIGHT)
    contours,_=cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
    largest=max((float(cv2.contourArea(c)) for c in contours),default=0.0)
    return changed,largest

def on_signal(*_):
    global STOP
    STOP=True
signal.signal(signal.SIGTERM,on_signal)
signal.signal(signal.SIGINT,on_signal)

def main():
    cap=None
    bg=None
    prev=None
    warm=0
    candidate_streak=0
    last_motion_at=0.0
    last_trigger_at=0.0
    trigger_count=0
    armed=True
    camera_failures=0
    last_write=0.0
    settle_until=0.0
    latest={}
    log("FRONTCAM_MOTION_V4 starting; fast dark-room motion, 2s light-transition settle; no images stored")
    while not STOP:
        loop_started=time.monotonic()
        if cap is None:
            cap=open_camera()
            if cap is None:
                camera_failures+=1
                atomic_json({"ok":False,"version":"frontcam-motion-v4","camera":DEVICE,
                             "camera_failures":camera_failures,"error":"camera_open_failed",
                             "updated_at":time.time()})
                time.sleep(5); continue
            bg=None; prev=None; warm=0; candidate_streak=0; camera_failures=0
            log("camera opened at 160x120 low-CPU motion mode; brightness/contrast reset")
        ok,frame=cap.read()
        if not ok or frame is None:
            camera_failures+=1
            try: cap.release()
            except Exception: pass
            cap=None; time.sleep(1); continue

        g=preprocess(frame)
        luma=float(np.mean(g))
        frame_std=float(np.std(g))
        now=time.time()
        if bg is None:
            bg=g.astype(np.float32); prev=g.copy(); warm=1
            time.sleep(TARGET_PERIOD); continue

        warm+=1
        ref=cv2.convertScaleAbs(bg)
        ref_luma=float(np.mean(ref))
        th=thresholds(luma)

        bgdiff=cv2.absdiff(g,ref)
        bgmask=(bgdiff>=th["delta"]).astype(np.uint8)*255
        if th["mode"]!="dark":
            bgmask=cv2.morphologyEx(bgmask,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
        bg_changed,bg_largest=metrics(bgmask)

        if prev is None:
            prev=g.copy()
        tdiff=cv2.absdiff(g,prev)
        temporal_delta=max(2,th["delta"]-1) if th["mode"]=="dark" else th["delta"]
        tmask=(tdiff>=temporal_delta).astype(np.uint8)*255
        if th["mode"]=="normal":
            tmask=cv2.morphologyEx(tmask,cv2.MORPH_OPEN,np.ones((2,2),np.uint8))
        temporal_changed,temporal_largest=metrics(tmask)

        # Lamp switching / auto-exposure changes most of the frame at once.
        # Snap the reference immediately and settle only two seconds. The old
        # eight-second quarantine was long enough to miss someone entering
        # just after the lamp was switched off.
        abrupt=bool(bg_changed>=50.0 or abs(luma-ref_luma)>=35.0)
        if abrupt:
            bg=g.astype(np.float32)
            prev=g.copy()
            candidate_streak=0
            settle_until=now+SETTLE_SECONDS
            candidate=False
            source="lighting-transition"
        elif now<settle_until or warm<8:
            candidate=False
            source="settling"
            candidate_streak=0
            cv2.accumulateWeighted(g,bg,0.50)
            prev=g.copy()
        else:
            bg_candidate=bool(bg_changed>=th["changed"] and bg_largest>=th["contour"])
            # Frame-to-frame evidence is especially useful in the dark, where
            # a walking silhouette can be weak against the long-term background
            # but still moves coherently between adjacent samples.
            temporal_candidate=bool(
                th["mode"] in ("dark","dim")
                and temporal_changed>=max(0.02,th["changed"]*0.65)
                and temporal_largest>=max(5.0,th["contour"]*0.65)
                and temporal_changed<45.0)
            candidate=bool(bg_candidate or temporal_candidate)
            source="temporal" if temporal_candidate and not bg_candidate else ("background" if bg_candidate else "none")
            if candidate:
                candidate_streak+=1
                last_motion_at=now
            else:
                candidate_streak=0
            cv2.accumulateWeighted(g,bg,BACKGROUND_ALPHA_MOTION if candidate else BACKGROUND_ALPHA_QUIET)
            prev=g.copy()

        confirmed=bool(candidate and candidate_streak>=th["confirm"])
        if not armed and now-last_motion_at>=QUIET_REARM_SECONDS:
            armed=True

        webhook_ok=None
        webhook_status=None
        if confirmed and armed and now-last_trigger_at>=TRIGGER_COOLDOWN_SECONDS:
            webhook_ok,webhook_status=post_motion()
            if webhook_ok:
                trigger_count+=1; last_trigger_at=now; armed=False
                log(f"motion trigger mode={th['mode']} source={source} luma={luma:.1f} bg={bg_changed:.2f}%/{bg_largest:.0f} temporal={temporal_changed:.2f}%/{temporal_largest:.0f}")
            else:
                log(f"motion webhook failed: {webhook_status}")

        latest={
            "ok":True,"version":"frontcam-motion-v4","camera":DEVICE,
            "analysis_size":[WIDTH,HEIGHT],"analysis_hz_target":round(1/TARGET_PERIOD,2),
            "stores_images":False,"light_mode":th["mode"],"pixel_delta":th["delta"],
            "changed_percent":round(bg_changed,3),"largest_contour_area":round(bg_largest,1),
            "temporal_changed_percent":round(temporal_changed,3),
            "temporal_largest_contour_area":round(temporal_largest,1),
            "motion_source":source,"luma":round(luma,1),"frame_std":round(frame_std,2),
            "background_luma":round(ref_luma,1),"abrupt_light_change":abrupt,
            "settling":bool(now<settle_until),"candidate":candidate,
            "confirmed_motion":confirmed,"candidate_streak":candidate_streak,
            "armed":armed,"last_motion_at":last_motion_at or None,
            "last_trigger_at":last_trigger_at or None,"trigger_count":trigger_count,
            "last_webhook_ok":webhook_ok,"last_webhook_status":webhook_status,
            "camera_failures":camera_failures,"updated_at":now}
        if now-last_write>=2.0 or webhook_ok is not None:
            atomic_json(latest); last_write=now

        elapsed=time.monotonic()-loop_started
        if elapsed<TARGET_PERIOD:
            time.sleep(TARGET_PERIOD-elapsed)

    if cap is not None: cap.release()
    latest["stopped_at"]=time.time()
    atomic_json(latest)
    log("FRONTCAM_MOTION_V4 stopped")
    return 0

if __name__=="__main__":
    raise SystemExit(main())
'''
SCRIPT.write_text(detector)
SCRIPT.chmod(0o755)
py_compile.compile(str(SCRIPT),doraise=True)

subprocess.run(["systemctl","--user","daemon-reload"],check=True,timeout=20)
subprocess.run(["systemctl","--user","restart",UNIT.name],check=True,timeout=30)
time.sleep(8)
show=subprocess.run(["systemctl","--user","show",UNIT.name,"-p","ActiveState","-p","MainPID","-p","CPUUsageNSec","-p","MemoryCurrent"],
                    text=True,capture_output=True,timeout=10).stdout.strip()
state={}
try: state=json.loads((HUB/"state/frontcam-motion-living-lamp.json").read_text())
except Exception as e: state={"error":str(e)}
print(json.dumps({"ok":True,"version":"frontcam-motion-v4","backup":str(BACKUP),"service":show,"state":state},indent=2))
