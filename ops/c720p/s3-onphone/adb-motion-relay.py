#!/usr/bin/env python3
"""Low-CPU relay for on-device S3 motion events over Wi-Fi ADB logcat.
Never pulls screenshots/video and never runs image analysis on the hub.
"""
from __future__ import annotations
import json, os, pathlib, re, select, signal, subprocess, time, urllib.request
ROOT=pathlib.Path("/home/jespern/c720p-home-hub")
CONFIG=ROOT/"config/s3-bedroom-motion.json"
STATE=ROOT/"state/s3-bedroom-onphone.json"
ENDPOINT="192.168.178.47:5555"
PACKAGE="nl.kalenel.s3motion/.MotionActivity"
SERIAL="3230cf48843b9027"
MODEL="GT-I9300"
QUIT=False
def stop(*_):
    global QUIT
    QUIT=True
signal.signal(signal.SIGTERM,stop)
signal.signal(signal.SIGINT,stop)
def adb(*args,timeout=9):
    return subprocess.run(["adb","-s",ENDPOINT,*args],capture_output=True,text=True,timeout=timeout)
def check():
    try:
        model=adb("shell","getprop","ro.product.model",timeout=5).stdout.strip().replace("_","-")
        serial=adb("shell","getprop","ro.serialno",timeout=5).stdout.strip()
        return model==MODEL and serial==SERIAL
    except (OSError,subprocess.TimeoutExpired):
        return False
def connect():
    try:
        r=subprocess.run(["adb","connect",ENDPOINT],capture_output=True,timeout=8)
        return r.returncode==0
    except (OSError,subprocess.TimeoutExpired):return False
def state(**kw):
    STATE.parent.mkdir(parents=True,exist_ok=True)
    obj={"source":"S3 on-device motion via Wi-Fi ADB",
         "hub_image_analysis":False,"captures_sent":0,"endpoint":ENDPOINT,
         "updated_at":int(time.time()),**kw}
    tmp=STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(obj,indent=2)+"\n")
    os.replace(tmp,STATE)
def send(url,session,seq):
    body=json.dumps({"source":"s3-onphone","motion":True,"session":session,"seq":seq}).encode()
    req=urllib.request.Request(url,data=body,
      headers={"Content-Type":"application/json"},method="POST")
    with urllib.request.urlopen(req,timeout=4) as r:return 200<=r.status<300
def attr(line,key):
    m=re.search(r"\b"+key+r"=([^\s]+)",line)
    return m.group(1) if m else ""
def main():
    cfg=json.loads(CONFIG.read_text())
    webhook=cfg["webhook"]
    last_motion_id=None
    if STATE.exists():
        try:last_motion_id=json.loads(STATE.read_text()).get("last_motion_id")
        except Exception:pass
    while not QUIT:
        if not check():
            connect()
        if not check():
            state(ok=False,status="s3_wifi_adb_unavailable",last_motion_id=last_motion_id)
            time.sleep(10)
            continue
        try:
            result=adb("shell","am","start","-n",PACKAGE,timeout=10)
            if result.returncode:
                state(ok=False,status="camera_app_launch_failed",
                      message=result.stderr[-180:],last_motion_id=last_motion_id)
                time.sleep(10);continue
            # Tail one previous line to avoid replaying historic MOTION events.
            p=subprocess.Popen(["adb","-s",ENDPOINT,"logcat","-v","brief",
                                  "-T","1","-s","S3MOTION:I","*:S"],
                 stdout=subprocess.PIPE,stderr=subprocess.DEVNULL,
                 bufsize=1,text=True)
            last_heartbeat=time.monotonic()
            current_session=None
            state(ok=True,status="waiting_for_on_phone_heartbeat",
                  last_motion_id=last_motion_id)
            while not QUIT:
                if p.poll() is not None:break
                ready,_,_=select.select([p.stdout],[],[],5)
                if ready:
                    line=p.stdout.readline()
                    if not line:break
                    if "S3MOTION" not in line:continue
                    event=line.split(":",1)[-1].strip()
                    sess=attr(event,"session")
                    if "READY " in event or "HEARTBEAT " in event:
                        current_session=sess or current_session
                        last_heartbeat=time.monotonic()
                        state(ok=True,status="armed_on_device",
                              session=current_session,
                              luma=attr(event,"luma"),
                              dark=attr(event,"dark"),
                              last_motion_id=last_motion_id)
                    elif "MOTION " in event and sess==current_session:
                        seq=attr(event,"seq")
                        motion_id=f"{sess}:{seq}"
                        if motion_id!=last_motion_id and attr(event,"dark")=="1":
                            try:
                                sent=send(webhook,sess,seq)
                            except Exception:
                                sent=False
                            if sent:
                                last_motion_id=motion_id
                                state(ok=True,status="motion_delivered",
                                  last_motion_id=last_motion_id,session=sess,
                                  last_delivery_at=int(time.time()))
                if time.monotonic()-last_heartbeat>45:break
            p.terminate()
            try:p.wait(timeout=2)
            except subprocess.TimeoutExpired:p.kill()
        except (OSError,subprocess.TimeoutExpired) as e:
            state(ok=False,status="relay_exception",error=type(e).__name__,
                  last_motion_id=last_motion_id)
        time.sleep(5)
    return 0
if __name__=="__main__":
    raise SystemExit(main())
