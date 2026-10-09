#!/usr/bin/env python3
"""Reversible C720P-only S9 live-person sensor activation.

Must point --stage to a coherent immutable Git revision fetched on the hub.
No Android APK, camera settings, Drive archive or saved clip mutation.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import datetime

HOME=Path("/home/jespern/c720p-home-hub")
BIN=HOME/"bin"
HTML=Path("/opt/homeassistant/config/www/frontyard-security-new/clips.html")
UNIT=Path("/home/jespern/.config/systemd/user/c720p-s9-live-person-watch.service")
PROXY=BIN/"s9_sd_proxy_extension.py"
WATCH=BIN/"s9-live-person-watch.py"
BACKUPS=HOME/"backups/s9-live-person-watch"
VENV=HOME/"build/s9-detector-benchmark/venv/bin/python"
MODEL=HOME/"build/s9-detector-benchmark/assets/baseline.tflite"
STATE=HOME/"state/s9-live-person-watch.json"
SERVICE=UNIT.name

def sh(*args,timeout=40):
 return subprocess.run(args,check=True,capture_output=True,text=True,timeout=timeout).stdout.strip()

def jget(url):
 with urllib.request.urlopen(url,timeout=8) as response:
  if response.status!=200:raise RuntimeError("unexpected_http_response")
  return json.load(response)

def camera():
 c=jget("http://127.0.0.1:18808/status")
 h=jget("http://127.0.0.1:8793/health.json")
 if not c.get("ok") or c.get("mode")!="watching" or c.get("temperature_c",100)>=38:
  raise RuntimeError("live_camera_not_healthy_idle")
 if not h.get("camera_ok"):raise RuntimeError("HA_camera_unhealthy")
 return c

def replace_file(source,dest):
 dest.parent.mkdir(parents=True,exist_ok=True)
 stage=dest.with_name(dest.name+".s9live-stage")
 shutil.copy2(source,stage);os.replace(stage,dest)

def main(stage):
 mapping={
  WATCH:stage/"s9-native-security/live-person-watch.py",
  PROXY:stage/"s9-person-ml-v1/s9_sd_proxy_extension.py",
  UNIT:stage/"s9-native-security/c720p-s9-live-person-watch.service"
 }
 patch=stage/"s9-native-security/patch-live-person-watch-ui.py"
 tests=stage/"s9-native-security/test-live-person-watch.py"
 if not all(p.is_file() for p in [*mapping.values(),patch,tests]):
  raise RuntimeError("staged_sources_incomplete")
 if not VENV.is_file() or not MODEL.is_file():
  raise RuntimeError("pinned_litert_venv_or_model_missing")
 for p in [*mapping.values(),patch,tests]:
  if p.suffix==".py":sh("/usr/bin/python3","-m","py_compile",str(p))
 # Run unit contracts from matching stage before touching live installation.
 sh("/usr/bin/python3",str(tests),timeout=40)
 old_archive=jget("http://127.0.0.1:8795/new/api/saved")
 if old_archive.get("archive_mode")!="S9-microSD-only":raise RuntimeError("SD_only_archive_missing")
 n=len(old_archive.get("events",[]))
 assert n>=16
 cam=camera()
 spec=importlib.util.spec_from_file_location("s9liveui",patch)
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 new_html=mod.patch_text(HTML.read_text())
 if 'id="s9-live-person-watch-script-v1"' not in new_html:
  raise RuntimeError("live_person_widget_failed")
 stamp=datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
 backup=BACKUPS/stamp;backup.mkdir(parents=True,exist_ok=False)
 original={}
 for p in [*mapping,HTML]:
  if p.is_file():
   dest=backup/(str(len(original))+"-"+p.name)
   shutil.copy2(p,dest);original[p]=dest
  else:original[p]=None
 existing=UNIT.is_file()
 print("S9_PERSON_LIVE_ROLLBACK_BACKUP",str(backup),flush=True)
 changes=[]
 try:
  for target,source in mapping.items():
   replace_file(source,target);changes.append(target)
  if HTML.read_text()!=new_html:
   temp=HTML.with_suffix(".html.s9live-person-temp")
   temp.write_text(new_html);os.chmod(temp,HTML.stat().st_mode&0o777)
   os.replace(temp,HTML);changes.append(HTML)
  sh("systemctl","--user","daemon-reload")
  sh("systemctl","--user","restart","c720p-drive-security-archive.service",timeout=60)
  sh("systemctl","--user","enable","--now",SERVICE,timeout=50)
  good=None
  for attempt in range(12):
   time.sleep(3)
   status=jget("http://127.0.0.1:8795/new/api/live-person-watch")
   if status.get("ok") and int(status.get("samples") or 0)>=2:
    good=status;break
  if good is None:raise RuntimeError("no_two_genuine_live_detection_samples")
  assert good.get("read_only") is True and good.get("label_is_ground_truth") is False
  assert good["status"]["identity"]=="not_evaluated"
  if (STATE.stat().st_mode&0o777)!=0o600:raise RuntimeError("sensitive_watch_state_not_private")
  after_archive=jget("http://127.0.0.1:8795/new/api/saved")
  if len(after_archive.get("events",[]))<n:raise RuntimeError("old_archived_clips_lost")
  first=next((v.get("remote_name") for v in after_archive["events"] if str(v.get("remote_name","")).endswith(".mp4")),None)
  if not first:raise RuntimeError("no_playable_archive_video")
  request=urllib.request.Request("http://127.0.0.1:8795/new/saved/clip/"+first,headers={"Range":"bytes=0-1023"})
  with urllib.request.urlopen(request,timeout=22) as response:
   if response.status!=206 or len(response.read())!=1024:raise RuntimeError("video_seek_regression")
  cam2=camera()
  print("S9_LIVE_PERSON_WATCH_PRODUCTION_PASS",json.dumps({
   "live_samples":good["samples"],"person_category":good["status"]["kind"],
   "phone_camera_mode":cam2["mode"],"camera_temp_c":cam2.get("temperature_c"),
   "existing_recordings":n,"video_seek":"HTTP_206","user_service":SERVICE,
   "service_active":sh("systemctl","--user","is-active",SERVICE),
   "media_uploaded":False,"phone_apk_changed":False,"backup":str(backup)
  }),flush=True)
 except Exception as e:
  print("S9_LIVE_PERSON_DEPLOY_ROLLING_BACK",type(e).__name__,str(e),flush=True)
  try:sh("systemctl","--user","stop",SERVICE,timeout=30)
  except Exception:pass
  if not existing:
   try:sh("systemctl","--user","disable",SERVICE,timeout=15)
   except Exception:pass
  for target in reversed(changes):
   try:
    old=original[target]
    if old is None:target.unlink(missing_ok=True)
    else:replace_file(old,target)
   except Exception as err:print("S9_RESTORE_FILE_FAILED",str(target),type(err).__name__)
  try:
   sh("systemctl","--user","daemon-reload")
   sh("systemctl","--user","restart","c720p-drive-security-archive.service",timeout=60)
   if existing:sh("systemctl","--user","start",SERVICE,timeout=25)
  except Exception as err:print("S9_RESTORE_SERVICE_FAILED",type(err).__name__)
  raise

if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--stage",type=Path,required=True)
 main(p.parse_args().stage.resolve())
