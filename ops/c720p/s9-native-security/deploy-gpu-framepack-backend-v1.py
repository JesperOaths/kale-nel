#!/usr/bin/env python3
"""Guarded deployment of authenticated on-demand RGB565 Security player backend.

Installs one extra proxy route in s9_hub_playback.install. Leaves all existing
smooth/original range routes, archive metadata, and phone untouched. Always
backs up exact files and rolls back on health regression.
"""
import datetime
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.request

BASE=Path("/home/jespern/c720p-home-hub")
LIVE=BASE/"bin/s9_hub_playback.py"
EXT=BASE/"bin/s9_rgb_video_playback_v1.py"
STAGED=BASE/"build/security-v8/s9_rgb_video_playback_v1.py"
BACK=BASE/"backups/s9-gpu-framepack-backend-v1"
SERVICE="c720p-drive-security-archive.service"
ANCHOR="    handler_class.go = go"
MOUNT='    import s9_rgb_video_playback_v1\n    s9_rgb_video_playback_v1.install(handler_class,phone_rows,__import__("sys").modules[__name__])'
CLIP="motion_1791739041453.mp4"

def cmd(*x):
 p=subprocess.run(x,capture_output=True,text=True,timeout=35,check=True)
 return p.stdout.strip()

def get(url):
 with urllib.request.urlopen(url,timeout=14) as response:return json.load(response)

def healthy():
 data=get("http://127.0.0.1:8795/new/api/saved")
 if data.get("archive_mode")!="S9-microSD-only" or len(data.get("events",[]))<250:
  raise RuntimeError("archive_unhealthy")
 return data

def wait_health():
 for i in range(33):
  try:return healthy()
  except (OSError,ValueError,RuntimeError):time.sleep(.75)
 raise RuntimeError("archive_not_ready_after_deploy")

def main():
 if not LIVE.is_file() or not STAGED.is_file():raise RuntimeError("staging_or_backend_missing")
 before=healthy()
 existing=LIVE.read_text()
 if MOUNT in existing:
  print("S9_GPU_FRAMEPACK_BACKEND_ALREADY_INSTALLED")
  return
 if existing.count(ANCHOR)!=1 or not existing.endswith(ANCHOR+"\n"):
  raise RuntimeError("unexpected_existing_playback_backend")
 original_extension=EXT.read_bytes() if EXT.exists() else None
 if len(STAGED.read_bytes())<5000:raise RuntimeError("module_incomplete")
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
 folder=BACK/stamp;folder.mkdir(parents=True,mode=0o700)
 shutil.copy2(LIVE,folder/"s9_hub_playback.py")
 if EXT.exists():shutil.copy2(EXT,folder/"s9_rgb_video_playback_v1.py")
 installed=[]
 try:
  temp=EXT.with_name(EXT.name+".gpu-frames-stage")
  shutil.copy2(STAGED,temp)
  temp.chmod(0o700)
  cmd("python3","-m","py_compile",str(temp))
  os.replace(temp,EXT);installed.append(EXT)
  patched=existing.replace(ANCHOR,ANCHOR+"\n"+MOUNT)
  staged=LIVE.with_name(LIVE.name+".gpu-framepack-stage")
  staged.write_text(patched);staged.chmod(LIVE.stat().st_mode&0o777)
  cmd("python3","-m","py_compile",str(staged))
  os.replace(staged,LIVE);installed.append(LIVE)
  cmd("systemctl","--user","restart",SERVICE)
  after=wait_health()
  old={x.get("clip_no") for x in before["events"]}
  if not old.issubset({x.get("clip_no") for x in after["events"]}):
   raise RuntimeError("indexed_originals_disappeared")
  req="http://127.0.0.1:8795/new/saved/clip/"+CLIP+"?playback=rgb_prepare&chunk=0"
  result=get(req)
  if not result.get("ok") or result.get("state") not in (
      "preparing_source","preparing","queued","ready"):
   raise RuntimeError("new_framepack_endpoint_not_healthy")
  print("S9_GPU_FRAMEPACK_BACKEND_INSTALLED",json.dumps({
    "source_count":len(after["events"]),"framepack_state":result["state"],
    "profile":"rgb565_320x180_25fps_v1","backend_restart_ok":True,
    "camera_modified":False,"originals_untouched":True,
    "rollback":str(folder)},sort_keys=True),flush=True)
 except Exception:
  if LIVE in installed:shutil.copy2(folder/"s9_hub_playback.py",LIVE)
  if EXT in installed:
   if original_extension is None:EXT.unlink(missing_ok=True)
   else:EXT.write_bytes(original_extension)
  try:cmd("systemctl","--user","restart",SERVICE)
  except Exception:pass
  raise

if __name__=="__main__":main()
