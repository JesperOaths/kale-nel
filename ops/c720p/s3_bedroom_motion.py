#!/usr/bin/env python3
"""Standalone S3 -> ADB camera preview -> motion -> bedroom webhook.

Intentionally isolated from the S3 security/recording and S5/S9+ services.
Does not store frames or turn on lights when no camera frame is available.
"""
from __future__ import annotations
import argparse
import collections
import json
import os
from pathlib import Path
import signal
import subprocess
import time
import urllib.request

import cv2
import numpy as np

cv2.setNumThreads(1)
ROOT = Path("/home/jespern/c720p-home-hub")
STATE = ROOT / "state/s3-bedroom-motion.json"
CONF = ROOT / "config/s3-bedroom-motion.json"
SERIAL = "3230cf48843b9027"
MODEL = "GT-I9300"
DEFAULT_ENDPOINT = "192.168.178.47:5555"
PERIOD = 0.8
STOP = False

def stop(*_):
    global STOP
    STOP = True

def adb(endpoint, *args, timeout=7):
    return subprocess.run(["adb", "-s", endpoint, *args],
                          stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                          timeout=timeout, check=False)

def connect(endpoint):
    try:
        r = subprocess.run(["adb", "connect", endpoint],
                           capture_output=True, timeout=8, check=False)
        return r.returncode == 0
    except (OSError, subprocess.TimeoutExpired):
        return False

def verified(endpoint):
    try:
        m = adb(endpoint, "shell", "getprop", "ro.product.model", timeout=5).stdout.decode(errors="replace").strip()
        s = adb(endpoint, "shell", "getprop", "ro.serialno", timeout=5).stdout.decode(errors="replace").strip()
        return m == MODEL and s == SERIAL
    except (OSError, subprocess.TimeoutExpired):
        return False

def stop_legacy_webcam(endpoint):
    """Only after GT-I9300 serial verification; never touch the S5 or S9+."""
    try:
        r = adb(endpoint, "shell", "pm", "list", "packages", timeout=8)
        for line in r.stdout.decode(errors="replace").splitlines():
            if not line.startswith("package:"):
                continue
            pkg = line.removeprefix("package:").strip()
            if pkg.startswith("com.pas.webcam"):
                adb(endpoint, "shell", "am", "force-stop", pkg, timeout=6)
    except (OSError, subprocess.TimeoutExpired):
        pass

def active_camera_client(endpoint):
    """Do not arm on a static camera-app window with no physical camera session."""
    try:
        r = adb(endpoint, "shell", "dumpsys", "media.camera", timeout=9)
        text = r.stdout.decode(errors="replace")
        return "Active Camera Clients:" in text and "Active Camera Clients:\\n[]" not in text
    except (OSError, subprocess.TimeoutExpired):
        return False

def screenshot(endpoint):
    try:
        r = adb(endpoint, "exec-out", "screencap", "-p", timeout=7)
        if r.returncode or not r.stdout:
            return None
        buf = r.stdout.replace(b"\r\n", b"\n") if not r.stdout.startswith(b"\x89PNG\r\n\x1a\n") else r.stdout
        frame = cv2.imdecode(np.frombuffer(buf, dtype=np.uint8), cv2.IMREAD_COLOR)
        if frame is None or min(frame.shape[:2]) < 140:
            return None
        h, w = frame.shape[:2]
        frame = frame[int(h*.12):int(h*.78), int(w*.07):int(w*.93)]
        return cv2.resize(frame, (160, 120), interpolation=cv2.INTER_AREA)
    except (OSError, subprocess.TimeoutExpired, cv2.error):
        return None

def atomic_state(data):
    STATE.parent.mkdir(parents=True, exist_ok=True)
    temp = STATE.with_suffix(".tmp")
    temp.write_text(json.dumps(data, sort_keys=True, indent=2) + "\n")
    os.replace(temp, STATE)

def webhook(url, strength, luma):
    body = json.dumps({"source":"s3-bedroom","motion":True,
                       "strength":round(strength,2),"luma":round(luma,1)}).encode()
    req = urllib.request.Request(url, data=body,
                 headers={"Content-Type":"application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=4) as r:
        return 200 <= r.status < 300

class Motion:
    def __init__(self):
        self.bg = None
        self.prev_luma = None
        self.hits = collections.deque(maxlen=4)
        self.dark = True
        self.last_trigger = 0
        self.last_frame = 0
        self.frames = 0

    def update(self, frame):
        g = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
        g = cv2.GaussianBlur(g, (5,5), 0)
        mean, std = float(np.mean(g)), float(np.std(g))
        if std < 7:
            return dict(valid=False, candidate=False, motion=False,
                        luma=mean, changed=0, reason="blank_or_flat_preview")
        if mean >= 66:
            self.dark = False
        elif mean <= 51:
            self.dark = True
        if self.bg is None:
            self.bg = g.astype(np.float32)
            self.prev_luma = mean
            return dict(valid=True, candidate=False, motion=False,
                        luma=mean, changed=0, reason="calibrating")
        previous = cv2.convertScaleAbs(self.bg)
        delta = cv2.absdiff(g, previous)
        mask = cv2.threshold(delta, 23, 255, cv2.THRESH_BINARY)[1]
        mask = cv2.medianBlur(mask, 3)
        mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, np.ones((3,3),np.uint8))
        changed = float(np.count_nonzero(mask)) / mask.size
        components, _ = cv2.findContours(mask,cv2.RETR_EXTERNAL,cv2.CHAIN_APPROX_SIMPLE)
        largest = max((cv2.contourArea(c) for c in components),default=0.0)/mask.size
        global_change = changed > .47 or abs(mean - self.prev_luma) > 17
        candidate = not global_change and .018 <= changed <= .39 and largest >= .009
        self.hits.append(candidate)
        motion = sum(self.hits) >= 3 and self.dark
        cv2.accumulateWeighted(g,self.bg,.003 if candidate else .055)
        self.prev_luma = mean
        self.frames += 1
        return dict(valid=True,candidate=candidate,motion=motion,
                    luma=mean,changed=round(changed,4),largest=round(largest,4),
                    dark=self.dark,reason="global_change" if global_change else "analyzed")

def self_test():
    detector = Motion()
    base = np.full((120,160,3),36,np.uint8)
    cv2.rectangle(base,(30,30),(70,90),(65,65,65),-1)
    assert detector.update(base)["valid"]
    for x in (70,73,77,81,85):
        f=base.copy()
        cv2.rectangle(f,(x,25),(x+22,105),(135,135,135),-1)
        out=detector.update(f)
    assert out["motion"],out
    bright=np.clip(f.astype(np.int16)+100,0,255).astype(np.uint8)
    out=detector.update(bright)
    assert not out["motion"],out
    print("SELF_TEST_OK")
    return 0

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--self-test",action="store_true")
    parser.add_argument("--probe",action="store_true")
    parser.add_argument("--observe-only",action="store_true")
    args=parser.parse_args()
    if args.self_test:
        return self_test()
    cfg=json.loads(CONF.read_text()) if CONF.exists() else {}
    endpoint=cfg.get("adb_endpoint",DEFAULT_ENDPOINT)
    target=cfg.get("webhook","")
    observe=args.observe_only or not target
    detector=Motion()
    last_retry=0
    camera_started=False
    failures=0
    last_camera_check=0.0
    hardware_live=False
    last_frame_bytes=None
    identical_count=0
    while not STOP:
        now=time.monotonic()
        if not verified(endpoint):
            if now-last_retry>60 or last_retry==0:
                last_retry=now
                connect(endpoint)
            if not verified(endpoint):
                atomic_state({"ok":False,"source":"S3 ADB camera",
                              "status":"adb_unavailable","endpoint":endpoint,
                              "spotlights_only":True,"updated_at":time.time()})
                camera_started=False
                detector=Motion()
                if args.probe:
                    return 2
                time.sleep(5)
                continue
        if not camera_started:
            try:
                stop_legacy_webcam(endpoint)
                adb(endpoint,"shell","monkey","-p","net.sourceforge.opencamera",
                    "-c","android.intent.category.LAUNCHER","1",timeout=8)
                camera_started=True
            except (OSError, subprocess.TimeoutExpired):
                time.sleep(3)
                continue
        if now-last_camera_check > 12 or last_camera_check == 0:
            last_camera_check=now
            hardware_live=active_camera_client(endpoint)
        if not hardware_live:
            atomic_state({"ok":False,"source":"S3 ADB camera",
                          "status":"camera_session_unavailable",
                          "updated_at":time.time()})
            if args.probe:
                return 5
            time.sleep(4)
            continue
        frame=screenshot(endpoint)
        if frame is not None:
            frame_bytes=frame.tobytes()
            identical_count=identical_count+1 if frame_bytes == last_frame_bytes else 0
            last_frame_bytes=frame_bytes
            if identical_count >= 8:
                atomic_state({"ok":False,"source":"S3 ADB camera",
                              "status":"frozen_camera_preview",
                              "updated_at":time.time()})
                if args.probe:
                    return 6
                time.sleep(2)
                continue
        if frame is None:
            failures+=1
            camera_started=failures < 5
            atomic_state({"ok":False,"source":"S3 ADB camera",
                          "status":"capture_unavailable","failures":failures,
                          "updated_at":time.time()})
            if args.probe:
                return 3
            time.sleep(3)
            continue
        failures=0
        data=detector.update(frame)
        if args.probe:
            print(json.dumps(data))
            return 0 if data["valid"] else 4
        fired=False
        if (data["motion"] and data["valid"] and not observe
                and now-detector.last_trigger>16 and detector.frames>=8):
            try:
                fired=webhook(target,data["largest"]*100,data["luma"])
                if fired:
                    detector.last_trigger=now
            except Exception:
                fired=False
        atomic_state({"ok":True,"source":"S3 ADB camera",
                       "status":"observing" if observe else "armed",
                       "motion":data["motion"],"webhook_sent":fired,
                       "updated_at":time.time(),**data})
        time.sleep(max(0,PERIOD-(time.monotonic()-now)))
    return 0

if __name__=="__main__":
    signal.signal(signal.SIGTERM,stop)
    signal.signal(signal.SIGINT,stop)
    raise SystemExit(main())
