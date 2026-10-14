#!/usr/bin/env python3
"""Guarded, single-attempt S9 pedestrian gate v9 upgrade from an immutable commit.

Runs only on the C720P as its authorized management job. Camera remains
untouched if preflight/build/signature/model checks or idle-window gates fail.
Never touches SD recordings, edits Home Assistant, or deletes an old APK.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys
import time
import urllib.request
import zipfile

HOME=Path("/home/jespern/c720p-home-hub")
REPO_BUILD=HOME/"build/s9-native-security"
SOURCE="ops/c720p/s9-native-security"
DEVICE="192.168.178.250:5555"
PACKAGE="nl.kalenel.s9security"
EXPECTED_CERT="0ca669482a7b5bc4698eae4ba43897b913177f87907418a8231b95e830675bb5"
REQUIRED_MODEL="2254b01065c1f69ff501e9501042441b85323710e3d5a7b6be04a5084b647651"
EXPECTED_GATE="person_spatiotemporal_transport_v9"
STATUS_URL="http://127.0.0.1:18808/status"
BACK=HOME/"backups/s9-pedestrian-gate-v9"

def run(argv,timeout=65,env=None):
    p=subprocess.run(argv,text=True,capture_output=True,timeout=timeout,env=env)
    if p.returncode:
        raise RuntimeError("command_failed_"+Path(argv[0]).name+"_"+str(p.returncode)+"_"+p.stderr[-190:])
    return p.stdout.strip()

def adb(*args,timeout=65):
    return run(["adb","-s",DEVICE,*args],timeout)

def status():
    with urllib.request.urlopen(STATUS_URL,timeout=12) as r:
        if r.status!=200:raise RuntimeError("native_status_http_error")
        return json.load(r)

def healthy(s,expected_version=None):
    return (s.get("ok") is True and s.get("mode")=="watching"
      and s.get("native_4k_enabled") is True
      and s.get("garden_zone")=="near"
      and s.get("garden_roi_mask_version")=="owner_drawn_sloped_garden_v6"
      and s.get("garden_person_gate_backend")=="gpu"
      and s.get("garden_person_gate_ready") is True
      and s.get("preroll_ready") is True
      and float(s.get("temperature_c",100))<38.5
      and int(s.get("sd_free_bytes") or 0)>15*1024**3
      and int(s.get("last_frame_age_ms") or 999999)<2000
      and (expected_version is None or s.get("motion_detector")==expected_version))

def free_bytes():
    v=os.statvfs(str(HOME))
    return v.f_bavail*v.f_frsize

def cert(apk):
    data=run(["apksigner","verify","--print-certs",str(apk)],90)
    if EXPECTED_CERT not in data:
        raise RuntimeError("apk_signer_does_not_match_production")
    return True

def file_sha(path):
    h=hashlib.sha256()
    with open(path,"rb") as f:
        for b in iter(lambda:f.read(1024*1024),b""):h.update(b)
    return h.hexdigest()

def embedded_sha(path,name):
    with zipfile.ZipFile(path) as z:
        names=z.namelist()
        matches=[x for x in names if x==name or x=="assets/"+name]
        if len(matches)!=1:raise RuntimeError("model_asset_missing_"+name)
        return hashlib.sha256(z.read(matches[0])).hexdigest()

def pull_current_apk():
    listing=adb("shell","pm","path",PACKAGE,timeout=20)
    paths=[line.partition(":")[2].strip() for line in listing.splitlines()
       if line.startswith("package:") and line.endswith("base.apk")]
    if len(paths)!=1:raise RuntimeError("ambiguous_installed_base_apk")
    BACK.mkdir(parents=True,exist_ok=True,mode=0o700)
    dest=BACK/("before-v9-"+datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")+".apk")
    adb("pull",paths[0],str(dest),timeout=120)
    if dest.stat().st_size<5_000_000:raise RuntimeError("rollback_apk_too_small")
    cert(dest)
    return dest

def launch():
    adb("shell","am","start","-n",PACKAGE+"/.CameraActivity","--ez","enable_native_camera","true",timeout=35)

def check_boot(expected):
    deadline=time.monotonic()+105
    while time.monotonic()<deadline:
        time.sleep(3)
        try:
            adb("forward","tcp:18808","tcp:8808",timeout=15)
            s=status()
            if healthy(s,expected):return s
        except Exception:pass
    raise RuntimeError("new_camera_not_healthy_or_wrong_gate")

def main():
    ref=os.environ.get("S9_SECURITY_REF","").strip()
    if not re.fullmatch("[0-9a-f]{40}",ref):raise RuntimeError("immutable_source_sha_required")
    if free_bytes()<320*1024**2:
        print("S9_PEDESTRIAN_V9_DEFERRED_C720P_DISK",free_bytes(),flush=True);return
    baseline=status()
    if baseline.get("motion_detector")==EXPECTED_GATE:
        print("S9_PEDESTRIAN_V9_ALREADY_ACTIVE",flush=True);return
    if not healthy(baseline):
        print("S9_PEDESTRIAN_V9_DEFERRED_UNSAFE_INITIAL_HEALTH",json.dumps({
            k:baseline.get(k) for k in ("mode","temperature_c","garden_person_gate_ready","preroll_ready","sd_free_bytes","garden_zone")}),flush=True)
        return
    # Check source-compatibility prerequisites before disk-intensive compilation.
    if not (HOME/"build/s9-person-ml-v1/assets/face_embedding.tflite").is_file():
        raise RuntimeError("preserved_face_model_unavailable")
    if file_sha(HOME/"build/s9-person-ml-v1/assets/face_embedding.tflite")!=REQUIRED_MODEL:
        raise RuntimeError("unverified_face_model_change")
    if free_bytes()<320*1024**2:
        print("S9_PEDESTRIAN_V9_DEFERRED_LOW_DISK",flush=True);return
    # Compile/pin all twenty sources. No Camera2 interruption during building.
    build_env={**os.environ,"S9_SECURITY_REF":ref,"S9_FACE_MODEL_SHA256":REQUIRED_MODEL}
    run(["bash",str(HOME/"repo/ops/c720p/s9-native-security/compile-only.sh")],timeout=240,env=build_env)
    run(["bash",str(HOME/"repo/ops/c720p/s9-native-security/package-only.sh")],timeout=180,env=build_env)
    apk=REPO_BUILD/"s9-native-security.apk"
    if not apk.is_file() or apk.stat().st_size<8_000_000:
        raise RuntimeError("compiled_apk_missing")
    for stamp in (".source-commit",".compiled-commit","s9-native-security.apk.source-commit"):
        if (REPO_BUILD/stamp).read_text().strip()!=ref:raise RuntimeError("build_source_stamp_mismatch")
    cert(apk)
    if embedded_sha(apk,"face_embedding.tflite")!=REQUIRED_MODEL:
        raise RuntimeError("new_apk_face_model_mismatch")
    if free_bytes()<140*1024**2:
        print("S9_PEDESTRIAN_V9_DEFERRED_POSTBUILD_LOW_DISK",flush=True);return
    # Safely copy current APK and match both detection model and labels.
    backup=pull_current_apk()
    for name in ("detect.tflite","labelmap.txt","face_embedding.tflite"):
        if embedded_sha(backup,name)!=embedded_sha(apk,name):
            raise RuntimeError("model_or_label_change_blocked_"+name)
    with zipfile.ZipFile(apk) as z:
        dex=z.read("classes.dex")
        for required in (b"person_spatiotemporal_transport_v9",
                         b"Continuous4KEncoder",b"Encoded4KRing",
                         b"GardenPreRoll"):
            if required not in dex:raise RuntimeError("required_4k_person_logic_missing")
    # Three independent idle checks, protecting pre-roll + unfinished clips.
    previous=None
    for _ in range(3):
        snap=status()
        if not healthy(snap) or (previous is not None and
            snap.get("recorded")!=previous.get("recorded")):
            print("S9_PEDESTRIAN_V9_DEFERRED_ACTIVE_MOTION",flush=True);return
        previous=snap
        time.sleep(6)
    if not healthy(status()):
        print("S9_PEDESTRIAN_V9_DEFERRED_LATE_EVENT",flush=True);return
    changed=False
    try:
        changed=True
        adb("shell","am","force-stop",PACKAGE,timeout=20)
        result=adb("install","-r","-g",str(apk),timeout=175)
        if "Success" not in result:raise RuntimeError("install_not_confirmed")
        launch()
        after=check_boot(EXPECTED_GATE)
        start_frames=int(after.get("frames") or 0)
        time.sleep(9)
        later=status()
        if not healthy(later,EXPECTED_GATE):raise RuntimeError("camera_failed_after_initial_recovery")
        if int(later.get("frames") or 0)-start_frames<40:raise RuntimeError("camera_frame_progress_missing")
        if later.get("garden_person_requires_local_motion_or_spatial_translation") is not True:
            raise RuntimeError("v9_movement_gate_not_active")
        if later.get("garden_motion_strong_only_extends_recording") is not True:
            raise RuntimeError("v9_recording_continuation_not_active")
        print("S9_PEDESTRIAN_V9_LIVE_HEALTH_PASS",json.dumps({
           "detector":later.get("motion_detector"),"gpu":later.get("garden_person_gate_backend"),
           "4k":later.get("native_4k_enabled"),"preroll":later.get("preroll_ready"),
           "fps":later.get("sensor_result_fps"),"temperature":later.get("temperature_c"),
           "sd_free":later.get("sd_free_bytes"),"rollback":str(backup),
           "not_human_validated":True
        }),flush=True)
    except BaseException as exc:
        print("S9_PEDESTRIAN_V9_ROLLBACK_START",type(exc).__name__,str(exc)[:180],flush=True)
        if changed:
            try:
                adb("shell","am","force-stop",PACKAGE,timeout=20)
                old=adb("install","-r","-g",str(backup),timeout=175)
                if "Success" not in old:raise RuntimeError("old_install_failed")
                launch()
                restored=check_boot(None)
                print("S9_PEDESTRIAN_V9_ROLLBACK_HEALTH",restored.get("motion_detector"),flush=True)
            except BaseException as rb:
                print("S9_PEDESTRIAN_V9_ROLLBACK_FAILED",str(rb)[:180],flush=True)
        raise

if __name__=="__main__":
    main()
