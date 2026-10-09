#!/usr/bin/env python3
"""Guarded C720P UI-only repair of 3 Security tabs and bottom LIVE button.

Does not restart the phone, modify 4K capture, erase recordings or expose
the private relay. Keeps backups and restores both HTML files on failure.
"""
import datetime
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
WWW=Path("/opt/homeassistant/config/www")
CLIPS=WWW/"frontyard-security-new/clips.html"
HOME_LIVE=WWW/"c720p-release/home-live-primary-v2.html"
WRAPPER=WWW/"c720p-extra-row-v85.html"
NEW_LIVE=WWW/"frontyard-security-new/home-live-native-s9-v4.html"
BOTTOM=WWW/"c720p-scenes-compact-v7b.html"
SECURITY=WWW/"c720p-surveillance.html"
SAVED=WWW/"c720p-drive-saved.html"
BACK=HOME/"backups/s9-tabs-live"

def get(url,first=500000):
 with urllib.request.urlopen(url,timeout=10) as reply:
  if reply.status!=200:raise RuntimeError("unexpected_http_status")
  return reply,reply.read(first)

def preflight():
 required=(CLIPS,HOME_LIVE,WRAPPER,BOTTOM,SECURITY,SAVED)
 if any(not p.is_file() for p in required):
  raise RuntimeError("required_current_security_files_missing")
 scene=BOTTOM.read_text()
 if 'data-action="live"' not in scene or "c720p-live-camera" not in scene:
  raise RuntimeError("bottom_live_button_missing_or_unrecognized")
 sec=SECURITY.read_text()
 for fragment in ('data-tab="camera"','data-tab="saved"','data-tab="live"','cameraSavedFrame','cameraFrame','/new/live.mjpg'):
  if fragment not in sec:raise RuntimeError("surveillance_tab_missing_"+fragment)
 saved=SAVED.read_text()
 if "/api/saved" not in saved or 'C720PSecureRelay' not in saved:
  raise RuntimeError("saved_clips_signed_relay_missing")
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=10) as z:camera=json.load(z)
 if not camera.get("ok") or camera.get("mode") not in ("watching","recording"):
  raise RuntimeError("native_camera_unhealthy")
 streaming,chunk=get("http://127.0.0.1:8794/new/live.mjpg",500)
 if b"--frame" not in chunk or b"\xff\xd8\xff" not in chunk:
  raise RuntimeError("native_live_MJPEG_bytes_invalid")
 if "multipart/x-mixed-replace" not in streaming.headers.get("Content-Type",""):
  raise RuntimeError("native_live_media_type_wrong")
 with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=10) as z:archive=json.load(z)
 if archive.get("archive_mode")!="S9-microSD-only" or len(archive.get("events",[]))<20:
  raise RuntimeError("saved_microSD_archive_missing")
 c=archive["events"][0]
 name=c.get("remote_name")
 if not re.fullmatch(r"(?:motion_[0-9]{13}|native4k_[0-9]{13}|rec_20[0-9-]+_[0-9-]+)[.]mp4",str(name)):
  raise RuntimeError("untrusted_SD_video_name")
 req=urllib.request.Request("http://127.0.0.1:8795/new/saved/clip/"+name,headers={"Range":"bytes=0-1023"})
 with urllib.request.urlopen(req,timeout=19) as z:
  if z.status!=206 or len(z.read())!=1024:
   raise RuntimeError("saved_MP4_range_failed")
 path=WWW/"frontyard-security-new/s9-phone-events.json"
 event=json.loads(path.read_text())
 if not isinstance(event.get("phone_recordings"),list):
  raise RuntimeError("native_SD_catalog_invalid")
 return {"camera_mode":camera["mode"],"saved_count":len(archive["events"]),
         "native_recordings":len(event["phone_recordings"]),
         "native_MJPEG":True,"saved_range":True}

def main(stage):
 patcher=stage/"patch-today-native-and-home-live.py"
 tests=stage/"test-security-tabs-home-live.py"
 if not patcher.is_file() or not tests.is_file():raise RuntimeError("staged_code_missing")
 subprocess.run(["python3",str(tests)],check=True,capture_output=True,text=True,timeout=30)
 spec=importlib.util.spec_from_file_location("s9_tabs_patch",patcher)
 p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
 baseline=preflight()
 original_live=HOME_LIVE.read_text()
 original_sha=__import__("hashlib").sha256(original_live.encode()).hexdigest()
 before={CLIPS:CLIPS.read_text(),WRAPPER:WRAPPER.read_text()}
 old_route="/local/c720p-release/home-live-primary-v2.html"
 new_route="/local/frontyard-security-new/home-live-native-s9-v4.html"
 if before[WRAPPER].count(old_route)!=1:
  if before[WRAPPER].count(new_route)!=1:raise RuntimeError("unexpected_active_home_wrapper")
  new_wrapper=before[WRAPPER]
 else:
  new_wrapper=before[WRAPPER].replace(old_route,new_route,1)
 if 'PHOTO_AUTO_' not in new_wrapper or 'c720p-photo-live-big' not in new_wrapper:
  raise RuntimeError("live_photo_wrapper_changed")
 patched_live=p.patch_home(original_live)
 after={CLIPS:p.patch_clips(before[CLIPS]),WRAPPER:new_wrapper,NEW_LIVE:patched_live}
 if "s9-native-today-clips-script-v1" not in after[CLIPS]:
  raise RuntimeError("today_4K_section_missing")
 if "C720P_S9_HOME_LIVE_RETAIN_TOGGLE_V1" not in after[NEW_LIVE]:
  raise RuntimeError("LIVE_toggle_patch_missing")
 stamp=datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
 backup=BACK/stamp
 backup.mkdir(parents=True,exist_ok=False)
 for dest in before:shutil.copy2(dest,backup/dest.name)
 if NEW_LIVE.is_file():shutil.copy2(NEW_LIVE,backup/NEW_LIVE.name)
 existed=NEW_LIVE.is_file()
 changed=[]
 try:
  for dest,data in after.items():
   if dest!=NEW_LIVE and data==before[dest]:continue
   if dest==NEW_LIVE and dest.is_file() and dest.read_text()==data:continue
   staged=dest.with_name(dest.name+".s9native-tabs-stage")
   staged.write_text(data)
   os.chmod(staged,0o644 if dest==NEW_LIVE else dest.stat().st_mode&0o777)
   os.replace(staged,dest)
   changed.append(dest)
  again=preflight()
  assert again["saved_count"]>=baseline["saved_count"]
  assert again["native_recordings"]>=baseline["native_recordings"]
  assert p.patch_clips(CLIPS.read_text())==CLIPS.read_text()
  assert p.patch_home(NEW_LIVE.read_text())==NEW_LIVE.read_text()
  assert new_route in WRAPPER.read_text()
  assert __import__("hashlib").sha256(HOME_LIVE.read_text().encode()).hexdigest()==original_sha
  print("S9_SECURITY_3VIEWS_AND_BOTTOM_LIVE_UI_PASS",json.dumps({
   "native_MJPEG":"200 stream actual JPEG bytes",
   "camera_clips":"today_native_S9_SD_pinned_first",
   "saved_clips":again["saved_count"],
   "clip_catalog":again["native_recordings"],
   "home_LIVE_toggle":"retained_and_native_S9_stream",
   "legacy_readonly_live_release":"unchanged",
   "home_live_new_asset":str(NEW_LIVE),
   "backup":str(backup),"phone_APK_changed":False
  }),flush=True)
 except Exception:
  for dest in reversed(changed):
   old=backup/dest.name
   if dest==NEW_LIVE and not existed:
    dest.unlink(missing_ok=True)
    continue
   staged=dest.with_name(dest.name+".s9native-restore")
   shutil.copy2(old,staged)
   os.replace(staged,dest)
  print("S9_TABS_UI_AUTO_ROLLBACK",str(backup),flush=True)
  raise

if __name__=="__main__":
 import argparse
 parser=argparse.ArgumentParser()
 parser.add_argument("--stage",type=Path,required=True)
 main(parser.parse_args().stage.resolve())
