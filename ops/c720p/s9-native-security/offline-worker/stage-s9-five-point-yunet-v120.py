#!/usr/bin/env python3
"""Stage pinned YuNet landmark model on isolated S9+ microSD; NO inference.

Requires a healthy COOL native-4K recorder before even a tiny transfer.
The model supplies real five-point landmarks, unlike a guessed head box.
A staged weight file alone never certifies face geometry or person identity.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import urllib.request

PHONE="192.168.178.250:5555"
ROOT="/storage/9C33-6BBD/S9OfflineModels"
NAME="face_five_point_yunet_2023mar.onnx"
SRC=("https://huggingface.co/opencv/opencv_zoo/resolve/main/"
     "models/face_detection_yunet/face_detection_yunet_2023mar.onnx?download=true")
SHA="8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
BYTES=232589
CAMERA="http://127.0.0.1:18808/status"
def adb(*args,timeout=25):
 result=subprocess.run(["adb","-s",PHONE,*args],capture_output=True,
                       text=True,timeout=timeout)
 if result.returncode:
  raise RuntimeError("phone_transfer_or_health_unavailable")
 return result.stdout.strip()
def digest(name):
 # Only test -s code 1 with NO stderr confirms actual absence.
 # An ADB connection failure or permission error must abort, not overwrite.
 check=subprocess.run(["adb","-s",PHONE,"shell","test","-s",name],
                      capture_output=True,text=True,timeout=20)
 if check.returncode==1 and not check.stderr.strip():return None
 if check.returncode!=0:raise RuntimeError("phone_model_presence_indeterminate")
 result=subprocess.run(["adb","-s",PHONE,"shell","sha256sum",name],
                       capture_output=True,text=True,timeout=20)
 if result.returncode:raise RuntimeError("phone_model_hash_indeterminate")
 line=result.stdout.strip().split()
 if len(line)<2 or not re.fullmatch(r"[a-f0-9]{64}",line[0]):
  raise RuntimeError("unknown_phone_model_digest")
 return line[0]
def health():
 with urllib.request.urlopen(CAMERA,timeout=12) as r:
  if r.status!=200:raise RuntimeError("native_recorder_unavailable")
  raw=r.read(65537)
 if len(raw)>65536:raise RuntimeError("oversize_camera_status")
 s=json.loads(raw)
 if (s.get("ok") is not True or s.get("mode")!="watching"
     or s.get("native_4k_enabled") is not True
     or s.get("continuous_4k_ready") is not True
     or s.get("continuous_4k_dropped_output_frames")!=0
     or s.get("continuous_4k_error")
     or type(s.get("temperature_c")) not in (int,float)
     or not 0<s["temperature_c"]<=39.5
     or type(s.get("continuous_4k_buffered_ms")) is not int
     or s["continuous_4k_buffered_ms"]<6500
     or type(s.get("sd_free_bytes")) is not int
     or s["sd_free_bytes"]<20*1024**3
     or any(s.get(k) is True for k in
       ("recording_active","recording_in_progress","garden_person_gate_busy",
        "face_backfill_queued","appearance_backfill_queued",
        "movement_4k_backfill_queued","historical_import_queued"))):
  raise RuntimeError("capture_not_cool_idle_healthy")
 return s
def space():
 fs=os.statvfs("/home/jespern/c720p-home-hub")
 if fs.f_bavail*fs.f_frsize<850*1024**2:
  raise RuntimeError("hub_disk_reserve_low")
def stage():
 space();health()
 pid=adb("shell","pidof nl.kalenel.s9security")
 if not re.fullmatch(r"[0-9 ]+",pid):
  raise RuntimeError("camera_pid_unavailable")
 path=ROOT+"/"+NAME;part=path+".stage-v120"
 prior=digest(path)
 if prior==SHA:
  print("S9_FIVE_POINT_YUNET_MODEL_VERIFIED "+
    json.dumps({"result":"existing","sha256":SHA,
     "landmark_inference_verified":False,"camera_apk_modified":False}),flush=True)
  return
 if prior is not None:
  raise RuntimeError("different_model_already_staged")
 if subprocess.run(["adb","-s",PHONE,"shell","test","-e",part],
                   capture_output=True,timeout=14).returncode==0:
  raise RuntimeError("unknown_existing_partial_model")
 req=urllib.request.Request(SRC,headers={"User-Agent":"S9-FivePoint-Stage/1"})
 with urllib.request.urlopen(req,timeout=40) as response:
  if response.status!=200:raise RuntimeError("model_source_unavailable")
  model=response.read(BYTES+1)
 if len(model)!=BYTES or hashlib.sha256(model).hexdigest()!=SHA:
  raise RuntimeError("upstream_model_not_pinned_sha256")
 health()
 with tempfile.TemporaryDirectory(prefix="s9-yunet-") as root:
  local=Path(root)/NAME;local.write_bytes(model)
  try:
   pushed=subprocess.run(["adb","-s",PHONE,"push",str(local),part],
                         capture_output=True,timeout=60)
   if pushed.returncode:raise RuntimeError("phone_push_failed")
   if digest(part)!=SHA:raise RuntimeError("phone_partial_sha_mismatch")
   # Camera process, frame buffer and temperature must remain protected.
   health()
   if adb("shell","pidof nl.kalenel.s9security")!=pid:
    raise RuntimeError("camera_pid_changed_during_model_stage")
   if digest(path) is not None:
    raise RuntimeError("model_target_appeared_concurrently")
   adb("shell","mv",part,path)
   if digest(path)!=SHA:raise RuntimeError("phone_final_sha_mismatch")
  finally:
   subprocess.run(["adb","-s",PHONE,"shell","rm","-f",part],
                  capture_output=True,timeout=15)
 print("S9_FIVE_POINT_YUNET_MODEL_VERIFIED "+
   json.dumps({"result":"installed","bytes":BYTES,"sha256":SHA,
     "landmark_inference_verified":False,"face_references_created":0,
     "recordings_modified":False,"manual_reviews_modified":False,
     "camera_apk_modified":False}),flush=True)
def main():
 p=argparse.ArgumentParser();p.add_argument("--install",action="store_true")
 a=p.parse_args()
 space();health()
 if not a.install:
  print("S9_FIVE_POINT_YUNET_PREFLIGHT "+
    json.dumps({"source":"opencv_zoo_mit_sha256_pinned","bytes":BYTES,
      "phone_model_sha256":digest(ROOT+"/"+NAME),
      "proposed_sha256":SHA,"model_executed":False,
      "camera_apk_modified":False}),flush=True)
 else:stage()
if __name__=="__main__":main()
