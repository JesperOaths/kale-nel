#!/usr/bin/env python3
"""Rollback-safe native S9+ Security Live MJPEG watchdog repair.

Updates only the writable Security iframe HTML. Never touches the protected
Home LIVE release, Android camera, microSD footage or retention settings.
"""
import argparse
import datetime
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import urllib.request

ROOT=Path("/opt/homeassistant/config/www")
PAGE=ROOT/"c720p-surveillance.html"
BACKUP_ROOT=Path("/home/jespern/c720p-home-hub/backups/s9-live-mjpeg")
def api(path,port):
 with urllib.request.urlopen("http://127.0.0.1:"+str(port)+path,timeout=12) as res:
  return res.status,res.headers,res.read(50000)

def check_health():
 status=json.loads(api("/status",18808)[2])
 if not status.get("ok") or status.get("mode") not in ("watching","recording"):
  raise RuntimeError("phone_camera_unhealthy")
 saved=json.loads(api("/new/api/saved",8795)[2])
 if saved.get("archive_mode")!="S9-microSD-only" or len(saved.get("events",[]))<20:
  raise RuntimeError("microSD_archive_unavailable")
 code,headers,head=api("/new/live.mjpg",8794)
 if code!=200 or b"--frame" not in head or b"\xff\xd8\xff" not in head:
  raise RuntimeError("native_MJPEG_frame_unavailable")
 return {"phone_mode":status["mode"],"saved":len(saved["events"]),"native_mjpeg":True}

def deploy(stage):
 tests=stage/"test-security-live-mjpeg-stable.py"
 patcher=stage/"patch-security-live-mjpeg-stable.py"
 if not patcher.is_file() or not tests.is_file():raise RuntimeError("staging_missing")
 subprocess.run(["python3",str(tests)],capture_output=True,text=True,check=True,timeout=30)
 info=check_health()
 if not os.access(PAGE,os.W_OK) or not os.access(PAGE.parent,os.W_OK):
  raise RuntimeError("protected_security_html_not_writable")
 spec=importlib.util.spec_from_file_location("s9_mjpeg_stable",patcher)
 p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
 before=PAGE.read_text()
 after=p.patch(before)
 if p.patch(after)!=after:raise RuntimeError("non_idempotent_patch")
 old_cards=before.count("data-tab=")
 if after.count("data-tab=")!=old_cards or after.count("cameraSavedFrame")!=before.count("cameraSavedFrame"):
  raise RuntimeError("modified_tab_content_unexpectedly")
 backup=BACKUP_ROOT/datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
 backup.mkdir(parents=True,exist_ok=False)
 original=backup/PAGE.name;shutil.copy2(PAGE,original)
 modified=False
 try:
  if before!=after:
   candidate=PAGE.with_suffix(".html.s9-mjpeg-stage")
   candidate.write_text(after);os.chmod(candidate,PAGE.stat().st_mode&0o777)
   os.replace(candidate,PAGE)
   modified=True
  now=PAGE.read_text()
  if p.MARKER not in now or p.patch(now)!=now:raise RuntimeError("source_verification_failed")
  # Server must serve current stable source; keep the other three tabs untouched.
  served=api("/local/c720p-surveillance.html?stableS9MJPEG=1",8123)[2]
  if p.MARKER.encode() not in served:raise RuntimeError("HTTP_served_stale_content")
  after_health=check_health()
  if after_health["saved"]<info["saved"]:raise RuntimeError("saved_clip_count_decreased")
  print("S9_SECURITY_LIVE_MJPEG_WATCHDOG_REPAIR_PASS",json.dumps({
    "before_saved":info["saved"],"after_saved":after_health["saved"],
    "native_MJPEG":True,"saved_tab_unchanged":True,"camera_tab_unchanged":True,
    "retry_only_after_12s_without_decoded_frame":True,"rollback":str(backup),
    "camera_APK_untouched":True}),flush=True)
 except Exception:
  if modified:
   candidate=PAGE.with_suffix(".html.s9-mjpeg-restore")
   shutil.copy2(original,candidate);os.replace(candidate,PAGE)
  print("S9_SECURITY_LIVE_MJPEG_AUTOMATIC_ROLLBACK",str(backup),flush=True)
  raise

if __name__=="__main__":
 parser=argparse.ArgumentParser();parser.add_argument("--stage",required=True,type=Path)
 deploy(parser.parse_args().stage)
