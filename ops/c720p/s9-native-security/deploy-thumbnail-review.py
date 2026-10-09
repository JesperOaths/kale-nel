#!/usr/bin/env python3
"""C720P-only rollback-safe S9 thumbnail review deploy; zero camera app changes."""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request
import urllib.error
import datetime

LIVE=Path("/home/jespern/c720p-home-hub/bin")
PAGE=Path("/opt/homeassistant/config/www/frontyard-security-new/clips.html")
PROXY=LIVE/"s9_sd_proxy_extension.py"
REVIEW=LIVE/"s9_human_thumbnail_review.py"
BACKUP_ROOT=Path("/home/jespern/c720p-home-hub/backups/s9-thumbnail-review")
MARKER='id="s9-human-thumbnail-review-script-v1"'
HOST="http://127.0.0.1:8795"

def run(command,timeout=140):
 return subprocess.run(command,check=True,text=True,capture_output=True,timeout=timeout)

def api(path):
 with urllib.request.urlopen(HOST+path,timeout=15) as reply:
  if reply.status!=200:raise RuntimeError("unexpected_http_status")
  return json.load(reply)

def baseline():
 old=api("/new/api/saved")
 if old.get("archive_mode")!="S9-microSD-only" or not isinstance(old.get("events"),list):
  raise RuntimeError("archive_SD_only_not_active")
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=8) as response:
  cam=json.load(response)
 if not cam.get("ok") or cam.get("mode")!="watching":
  raise RuntimeError("camera_not_idle")
 with urllib.request.urlopen("http://127.0.0.1:8793/health.json",timeout=8) as response:
  ha=json.load(response)
 if not ha.get("camera_ok"):raise RuntimeError("HA_camera_unhealthy")
 return old

def copy_atomic(source,destination):
 temp=destination.with_name(destination.name+".s9review-stage")
 shutil.copy2(source,temp);os.replace(temp,destination)

def deploy(staging):
 for relative in (
  "s9-person-ml-v1/s9_human_thumbnail_review.py",
  "s9-person-ml-v1/s9_sd_proxy_extension.py",
  "s9-person-ml-v1/local-sd-catalog.py",
  "s9-native-security/patch-fallback-preview-ui.py",
  "s9-native-security/patch-thumbnail-review-ui.py",
  "s9-native-security/test-thumbnail-review.py",
  "s9-native-security/test-fallback-evidence.py",
 ):
  if not (staging/relative).is_file():raise RuntimeError("staged_source_missing_"+relative)
 for relative in (
  "s9-person-ml-v1/s9_human_thumbnail_review.py",
  "s9-person-ml-v1/s9_sd_proxy_extension.py",
  "s9-native-security/patch-thumbnail-review-ui.py",
 ):
  run([sys.executable,"-m","py_compile",str(staging/relative)],timeout=15)
 for relative in ("s9-native-security/test-thumbnail-review.py",
                  "s9-native-security/test-fallback-evidence.py"):
  run([sys.executable,str(staging/relative)],timeout=35)
 print("S9_REVIEW_STAGED_TESTS_PASSED",flush=True)
 pre=baseline()
 old_count=len(pre["events"])
 spec=importlib.util.spec_from_file_location("review_patcher",staging/"s9-native-security/patch-thumbnail-review-ui.py")
 patcher=importlib.util.module_from_spec(spec);spec.loader.exec_module(patcher)
 old_html=PAGE.read_text();updated=patcher.patch_text(old_html)
 assert MARKER in updated and "X-S9-Review-Intent" in updated
 back=BACKUP_ROOT/datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
 back.mkdir(parents=True,exist_ok=False)
 original={}
 for i,dest in enumerate((REVIEW,PROXY,PAGE)):
  if dest.is_file():
   saved=back/(str(i)+"-"+dest.name)
   shutil.copy2(dest,saved);original[dest]=saved
  else:original[dest]=None
 print("ROLLBACK_BACKUP",str(back),flush=True)
 changed=[]
 try:
  copy_atomic(staging/"s9-person-ml-v1/s9_human_thumbnail_review.py",REVIEW);changed.append(REVIEW)
  copy_atomic(staging/"s9-person-ml-v1/s9_sd_proxy_extension.py",PROXY);changed.append(PROXY)
  if updated!=old_html:
   temp=PAGE.with_suffix(".html.s9review-stage")
   temp.write_text(updated);os.chmod(temp,PAGE.stat().st_mode&0o777)
   os.replace(temp,PAGE);changed.append(PAGE)
  run(["systemctl","--user","restart","c720p-drive-security-archive.service"],timeout=45)
  for attempt in range(6):
   try:
    saved=api("/new/api/saved")
    review=api("/new/api/thumbnail-review")
    break
   except Exception:
    if attempt==5:raise
    time.sleep(2)
  if len(saved.get("events",[]))<old_count:raise RuntimeError("previous_MP4_events_lost")
  if review.get("scope")!="visible_content_of_single_thumbnail_not_entire_video":
   raise RuntimeError("review_scope_incorrect")
  if review.get("total",0)<4:raise RuntimeError("expected_native_thumbnails_not_listed")
  for r in review.get("images",[]):
   if not r.get("sd_verified") or r.get("human_label") not in (None,"person_visible","no_person_visible","uncertain"):
    raise RuntimeError("human_truth_provenance_error")
  request=urllib.request.Request(HOST+"/new/api/thumbnail-review",
   headers={"Content-Type":"application/json"},
   data=b"{}",method="POST")
  try:
   urllib.request.urlopen(request,timeout=9)
   raise RuntimeError("unauthenticated_review_write_accepted")
  except urllib.error.HTTPError as e:
   if e.code!=403:raise RuntimeError("unexpected_POST_gate_status_"+str(e.code))
  video=next((r.get("remote_name") for r in saved["events"]
              if str(r.get("remote_name") or "").endswith(".mp4")),None)
  if not video:raise RuntimeError("no_verified_video")
  req=urllib.request.Request(HOST+"/new/saved/clip/"+video,headers={"Range":"bytes=0-1023"})
  with urllib.request.urlopen(req,timeout=18) as response:
   body=response.read()
   if response.status!=206 or len(body)!=1024:raise RuntimeError("video_range_regression")
  after=baseline()
  print("S9_HUMAN_FRAME_REVIEW_LIVE_PASS",json.dumps({
   "native_thumbnails":review["total"],
   "labels":review["counts"],
   "videos":len(saved["events"]),
   "video_range":"HTTP_206_1024_bytes",
   "blocked_unauthorized_label_POST":True,
   "native_camera":"unchanged",
   "cloud_upload":False,
   "rollback":str(back)
  }),flush=True)
 except Exception as error:
  print("S9_REVIEW_DEPLOY_FAILED_ROLLBACK",repr(error),flush=True)
  for dest in reversed(changed):
   try:
    if original[dest] is None:dest.unlink(missing_ok=True)
    else:copy_atomic(original[dest],dest)
   except Exception as e:print("RESTORE_FAILED",str(dest),repr(e),flush=True)
  try:run(["systemctl","--user","restart","c720p-drive-security-archive.service"],timeout=45)
  except Exception as e:print("RESTART_FAILED",repr(e),flush=True)
  raise

if __name__=="__main__":
 ap=argparse.ArgumentParser()
 ap.add_argument("--staging",type=Path,required=True)
 args=ap.parse_args()
 deploy(args.staging.resolve())
