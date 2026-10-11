#!/usr/bin/env python3
"""Guarded C720P security status compatibility repair. S9 APK unaffected."""
import datetime
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
LIVE=HOME/"bin/s9_phone_garden_status.py"
CANDIDATE=HOME/"build/s9-v7-adapter/s9_phone_garden_status.py"
ARCHIVE="http://127.0.0.1:8795/new/api/saved"
GATE="http://127.0.0.1:8795/new/api/live-person-watch"
PHONE="http://127.0.0.1:18808/status"
BACK=HOME/"backups/s9-live-detector-version-fix"

def get(url):
 with urllib.request.urlopen(url,timeout=15) as r:return json.load(r)
def service(cmd):
 return subprocess.run(["systemctl","--user",cmd,"c720p-drive-security-archive.service"],
                       check=True,capture_output=True,text=True,timeout=40).stdout.strip()
def validate_module(path,version):
 spec=importlib.util.spec_from_file_location("candidate_s9_garden_status",str(path))
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 sample={"ok":True,"mode":"watching","motion_detector":version,
         "last_frame_age_ms":80,"garden_person_gate_checked":2,
         "garden_person_gate_matches":1,"garden_person_gate_rejected":1,
         "garden_person_gate_errors":0}
 return mod.from_phone(sample,now_ms=90000)["detector_version"]==version
def main():
 if not CANDIDATE.is_file() or not LIVE.is_file():raise RuntimeError("expected_status_adapter_missing")
 subprocess.run([sys.executable,"-m","py_compile",str(CANDIDATE)],check=True,timeout=12)
 for version in ("garden_roi_gpu_person_gate_v1","garden_roi_gpu_two_frame_person_gate_v2",
                 "person_spatial_motion_corroborated_v7"):
  if not validate_module(CANDIDATE,version):raise RuntimeError("candidate_version_test_failed")
 before=get(ARCHIVE);phone=get(PHONE)
 if not phone.get("ok") or len(before.get("events",[]))<250:raise RuntimeError("predeploy_system_unhealthy")
 old_names={x.get("clip_no") for x in before["events"]}
 BACK.mkdir(parents=True,exist_ok=True)
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 backup=BACK/("s9_phone_garden_status_before_"+stamp+".py")
 shutil.copy2(LIVE,backup)
 staged=LIVE.with_name(LIVE.name+".v7-stage")
 try:
  shutil.copy2(CANDIDATE,staged);staged.chmod(0o700)
  os.replace(staged,LIVE)
  service("restart")
  time.sleep(2)
  after=get(GATE)
  if not after.get("ok") or after.get("detector_version")!=phone.get("motion_detector"):
   raise RuntimeError("status_adapter_not_exposing_live_detector")
  saved=get(ARCHIVE)
  if not old_names.issubset({x.get("clip_no") for x in saved.get("events",[])}):
   raise RuntimeError("prior_clips_lost_from_archive")
  print("S9_DETECTOR_ADAPTER_FIXED",json.dumps({"phone_version":phone.get("motion_detector"),
   "after_ok":after.get("ok"),"backend":after.get("person_inference_backend"),
   "previous_clips":len(old_names),"current_clips":len(saved.get("events",[])),
   "backup":str(backup),"camera_apk_modified":False},sort_keys=True),flush=True)
 except Exception:
  staged.unlink(missing_ok=True)
  shutil.copy2(backup,LIVE)
  service("restart")
  raise

if __name__=="__main__":main()
