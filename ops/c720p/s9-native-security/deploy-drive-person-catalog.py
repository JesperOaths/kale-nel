#!/usr/bin/env python3
"""Deploy bounded verified-Drive metadata catalog + manual visitor review on hub.

Never installs Android APKs or mutates Google Drive. Roll back page and proxy
if authenticated archive playback or the native live camera fails.
"""
import argparse
import datetime
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.error
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
BIN=HOME/"bin"
PAGE=Path("/opt/homeassistant/config/www/frontyard-security-new/clips.html")
UNITDIR=Path("/home/jespern/.config/systemd/user")
BACKUPS=HOME/"backups/s9-drive-person-catalog"
TIMER="c720p-s9-drive-person-catalog.timer"
SERVICE="c720p-s9-drive-person-catalog.service"
ROOT="http://127.0.0.1:8795"

def shell(*args,timeout=45):
 x=subprocess.run(args,check=True,text=True,capture_output=True,timeout=timeout)
 return x.stdout.strip()

def get(url):
 with urllib.request.urlopen(url,timeout=14) as x:
  if x.status!=200:raise RuntimeError("archive_http_not_200")
  return json.load(x)

def camera():
 s=get("http://127.0.0.1:18808/status")
 h=get("http://127.0.0.1:8793/health.json")
 if not s.get("ok") or s.get("mode")!="watching" or not h.get("camera_ok"):
  raise RuntimeError("native_camera_or_HA_unhealthy")
 return s

def atomic_replace(src,dst):
 dst.parent.mkdir(parents=True,exist_ok=True)
 tmp=dst.with_name(dst.name+".driveperson-staged")
 shutil.copy2(src,tmp)
 os.replace(tmp,dst)

def start(stage):
 files={
  BIN/"s9-drive-person-catalog.py":stage/"s9-native-security/drive-person-batch-catalog.py",
  BIN/"legacy-drive-person-corpus.py":stage/"s9-native-security/legacy-drive-person-corpus.py",
  BIN/"s9_drive_visitor_review.py":stage/"s9-person-ml-v1/s9_drive_visitor_review.py",
  BIN/"s9_sd_proxy_extension.py":stage/"s9-person-ml-v1/s9_sd_proxy_extension.py",
  UNITDIR/SERVICE:stage/"s9-native-security/c720p-s9-drive-person-catalog.service",
  UNITDIR/TIMER:stage/"s9-native-security/c720p-s9-drive-person-catalog.timer"}
 patch=stage/"s9-native-security/patch-drive-visitor-review-ui.py"
 tests=(stage/"s9-native-security/test-drive-person-batch-catalog.py",
        stage/"s9-native-security/test-drive-visitor-review.py")
 if not all(x.is_file() for x in (*files.values(),patch,*tests)):
  raise RuntimeError("staging_incomplete")
 for test in tests:shell("python3",str(test),timeout=35)
 shell("python3","-m","py_compile",str(patch),str(files[BIN/"s9_drive_visitor_review.py"]),
       str(files[BIN/"s9-drive-person-catalog.py"]),str(files[BIN/"s9_sd_proxy_extension.py"]))
 before=get(ROOT+"/new/api/saved")
 videos=len(before.get("events",[]))
 if before.get("archive_mode")!="S9-microSD-only" or videos<20:
  raise RuntimeError("existing_microSD_archive_not_verified")
 camera()
 spec=importlib.util.spec_from_file_location("drivevisitor",patch)
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 old_html=PAGE.read_text()
 new_html=mod.patch(old_html)
 if 'id="s9-drive-person-review-script-v1"' not in new_html:
  raise RuntimeError("missing_review_ui")
 backup=BACKUPS/datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
 backup.mkdir(parents=True,exist_ok=False)
 old={}
 for path in [*files,PAGE]:
  if path.is_file():
   dest=backup/(str(len(old))+"-"+path.name)
   shutil.copy2(path,dest);old[path]=dest
  else:old[path]=None
 was_enabled=subprocess.run(["systemctl","--user","is-enabled",TIMER],capture_output=True,text=True)
 print("S9_DRIVE_VISITOR_REVIEW_ROLLBACK",str(backup),flush=True)
 changed=[]
 try:
  for dest,src in files.items():
   atomic_replace(src,dest);changed.append(dest)
  if new_html!=old_html:
   staged=PAGE.with_suffix(".html.driveperson-stage")
   staged.write_text(new_html)
   os.chmod(staged,PAGE.stat().st_mode&0o777)
   os.replace(staged,PAGE);changed.append(PAGE)
  shell("systemctl","--user","daemon-reload")
  shell("systemctl","--user","restart","c720p-drive-security-archive.service",timeout=55)
  for attempt in range(6):
   try:
    review=get(ROOT+"/new/api/drive-person-review")
    recent=get(ROOT+"/new/api/saved")
    break
   except Exception:
    if attempt==5:raise
    time.sleep(2)
  if review.get("scope")!="verified_legacy_drive_clips_only":
   raise RuntimeError("wrong_scope_for_private_visitor_links")
  if not review.get("persistent_visitor_ids_require_manual_clip_confirmation"):
   raise RuntimeError("auto_identity_guard_missing")
  if len(recent.get("events",[]))<videos:
   raise RuntimeError("lost_SD_archive_video_rows")
  # Verify unauthorized write rejection and original playback before timer on.
  payload=b"{}"
  request=urllib.request.Request(ROOT+"/new/api/drive-person-review",
   data=payload,headers={"Content-Type":"application/json"},method="POST")
  try:
   urllib.request.urlopen(request,timeout=9)
   raise RuntimeError("visitor_post_without_intent_accepted")
  except urllib.error.HTTPError as err:
   if err.code!=403:raise RuntimeError("visitor_post_rejected_with_wrong_status")
  mp4=next((x.get("remote_name") for x in recent["events"]
            if str(x.get("remote_name","")).endswith(".mp4")),None)
  if not mp4:raise RuntimeError("no_verified_MP4")
  range_request=urllib.request.Request(ROOT+"/new/saved/clip/"+mp4,
    headers={"Range":"bytes=0-1023"})
  with urllib.request.urlopen(range_request,timeout=20) as reply:
   if reply.status!=206 or len(reply.read())!=1024:
    raise RuntimeError("archive_video_seek_regression")
  shell("systemctl","--user","enable","--now",TIMER,timeout=32)
  shell("systemctl","--user","is-active",TIMER)
  cam=camera()
  print("S9_LEGACY_DRIVE_CATALOG_AUTH_AND_TIMER_PASS",json.dumps({
   "archive_videos_preserved":videos,"manual_confirm_only":True,
   "classified_available":review.get("processed"),
   "visitor_links":review.get("reviewed_single_person_links"),
   "timer_enabled":True,"phone_mode":cam.get("mode"),
   "native_apk_changed":False,"Drive_files_mutated":False,
   "video_seek":"HTTP_206","rollback":str(backup)}),flush=True)
 except Exception as failure:
  print("S9_LEGACY_DRIVE_DEPLOY_ROLLBACK",type(failure).__name__,str(failure)[:240],flush=True)
  try:
   shell("systemctl","--user","stop",TIMER,timeout=25)
   if was_enabled.returncode:
    shell("systemctl","--user","disable",TIMER,timeout=25)
  except Exception as e:print("TIMER_ROLLBACK_WARNING",type(e).__name__,flush=True)
  for dest in reversed(changed):
   try:
    original=old[dest]
    if original is None:dest.unlink(missing_ok=True)
    else:atomic_replace(original,dest)
   except Exception as e:print("RESTORE_WARNING",str(dest),type(e).__name__,flush=True)
  try:
   shell("systemctl","--user","daemon-reload")
   shell("systemctl","--user","restart","c720p-drive-security-archive.service",timeout=55)
   if was_enabled.returncode==0:shell("systemctl","--user","enable","--now",TIMER,timeout=25)
  except Exception as e:print("RECOVERY_SERVICE_WARNING",type(e).__name__,flush=True)
  raise

if __name__=="__main__":
 arg=argparse.ArgumentParser()
 arg.add_argument("--stage",required=True,type=Path)
 start(arg.parse_args().stage.resolve())
