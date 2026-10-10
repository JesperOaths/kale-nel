#!/usr/bin/env python3
"""Guarded native S9+ Home Assistant Security UI/API integration.

No phone APK install, no video upload/delete, no Drive write. Edits only the
signed archive relay's Python metadata sources and the existing clips.html.
Rollback always restores all three originals and restarts the old proxy.
"""
import argparse
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
WWW=Path("/opt/homeassistant/config/www")
PAGE=WWW/"frontyard-security-new/clips.html"
BIN=HOME/"bin"
CAT=BIN/"c720p-s9-local-sd-catalog.py"
PROXY=BIN/"s9_sd_proxy_extension.py"
BACK=HOME/"backups/s9-unified-security"
SERVICE="c720p-drive-security-archive.service"
BASE="http://127.0.0.1:8795"

def get(url):
 with urllib.request.urlopen(url,timeout=12) as r:
  if r.status!=200:raise RuntimeError("API_HTTP_not_200")
  return json.load(r)

def command(*args,seconds=50):
 p=subprocess.run(args,check=True,capture_output=True,text=True,timeout=seconds)
 return p.stdout.strip()

def playback_probe(items):
 candidate=next((r.get("remote_name") for r in items
  if isinstance(r.get("remote_name"),str) and
  r["remote_name"].startswith("motion_") and r["remote_name"].endswith(".mp4")),None)
 if not candidate:raise RuntimeError("native_recording_missing")
 req=urllib.request.Request(BASE+"/new/saved/clip/"+candidate,
  headers={"Range":"bytes=0-1023"})
 with urllib.request.urlopen(req,timeout=25) as r:
  if r.status!=206 or len(r.read())!=1024:raise RuntimeError("native_range_playback_failed")

def preflight():
 camera=get("http://127.0.0.1:18808/status")
 if not camera.get("ok") or camera.get("mode") not in ("watching","recording"):
  raise RuntimeError("live_camera_not_healthy")
 catalog=get(BASE+"/new/api/saved")
 if catalog.get("archive_mode")!="S9-microSD-only" or len(catalog.get("events",[]))<20:
  raise RuntimeError("signed_native_SD_archive_unavailable")
 archive=get(BASE+"/new/api/drive-person-review")
 if archive.get("scope")!="verified_legacy_drive_clips_only":
  raise RuntimeError("verified_historical_review_missing")
 if not archive.get("persistent_visitor_ids_require_manual_clip_confirmation"):
  raise RuntimeError("manual_visitor_ID_safeguard_missing")
 playback_probe(catalog["events"])
 return camera,catalog,archive

def replace(src,dest):
 dest.parent.mkdir(parents=True,exist_ok=True)
 temp=dest.with_name(dest.name+".s9-unified-stage")
 shutil.copy2(src,temp)
 os.replace(temp,dest)

def main(stage):
 source={
  CAT:stage/"s9-person-ml-v1/local-sd-catalog.py",
  PROXY:stage/"s9-person-ml-v1/s9_sd_proxy_extension.py",
 }
 patches=[stage/"s9-native-security/patch-s9-integrated-security-ui.py",
          stage/"s9-native-security/patch-anonymous-tracks-ui.py"]
 tests=[stage/"s9-native-security/test-s9-integrated-security-ui.py",
        stage/"s9-native-security/test-anonymous-index-ui.py"]
 if not all(p.is_file() for p in list(source.values())+patches+tests):
  raise RuntimeError("incomplete_staged_HA_integration_sources")
 for test in tests:
  command(sys.executable,str(test),seconds=35)
 for f in list(source.values())+patches:
  command(sys.executable,"-m","py_compile",str(f),seconds=12)
 sp=importlib.util.spec_from_file_location("s9_hub_integrated_staged",patches[0])
 mod=importlib.util.module_from_spec(sp);sp.loader.exec_module(mod)
 before_html=PAGE.read_text()
 after_html=mod.patch(before_html,anon_source=patches[1])
 if mod.patch(after_html,anon_source=patches[1])!=after_html:
  raise RuntimeError("Security_page_patch_not_idempotent")
 for anchor in ('id="s9-native-unified-security-script-v1"',
                'id="s9-anonymous-clips-script-v1"',
                'id="s9-drive-person-review-script-v1"',
                'id="s9-human-thumbnail-review-script-v1"'):
  if anchor not in after_html:raise RuntimeError("existing_review_panel_missing_"+anchor)
 if "const validName=name=>/^motion_[0-9]{13}[.]mp4$/" not in after_html:
  raise RuntimeError("native_gallery_filename_bug_not_fixed")
 current,catalog,history=preflight()
 # Never swap code while the SD index is executing against the same module.
 for n in range(14):
  p=subprocess.run(["systemctl","--user","is-active","c720p-s9-local-sd-catalog.service"],
    capture_output=True,text=True,timeout=9)
  if p.stdout.strip()!="active":break
  time.sleep(3)
 else:raise RuntimeError("native_catalog_is_currently_reading_SD")
 stamp=datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
 backup=BACK/stamp
 backup.mkdir(parents=True,exist_ok=False)
 originals={}
 for i,dst in enumerate([*source,PAGE]):
  old=backup/(str(i)+"-"+dst.name)
  shutil.copy2(dst,old)
  originals[dst]=old
 print("S9_UNIFIED_SECURITY_ROLLBACK_READY",str(backup),flush=True)
 changed=[]
 try:
  for dst,src in source.items():
   replace(src,dst);changed.append(dst)
  if after_html!=before_html:
   dest=PAGE.with_name(PAGE.name+".s9-unified-stage")
   dest.write_text(after_html)
   os.chmod(dest,PAGE.stat().st_mode&0o777)
   os.replace(dest,PAGE);changed.append(PAGE)
  command("systemctl","--user","restart",SERVICE,seconds=60)
  for i in range(8):
   try:
    after_cam,after_cat,after_drive=preflight()
    break
   except Exception:
    if i==7:raise
    time.sleep(2)
  old_names={r.get("remote_name") for r in catalog["events"]}
  new_names={r.get("remote_name") for r in after_cat["events"]}
  if not old_names.issubset(new_names):raise RuntimeError("saved_microSD_recordings_disappeared")
  if len(after_cat.get("fallback_previews",[]))<len(catalog.get("fallback_previews",[])):
   raise RuntimeError("fallback_evidence_regressed")
  if after_drive.get("processed",0)<history.get("processed",0):
   raise RuntimeError("verified_historical_classification_regressed")
  if mod.MARKER not in PAGE.read_text() or mod.patch(PAGE.read_text(),anon_source=patches[1])!=PAGE.read_text():
   raise RuntimeError("live_HTML_integrity_failed")
  print("S9_UNIFIED_NATIVE_SECURITY_DEPLOY_PASS",json.dumps({
   "saved_recordings":len(after_cat["events"]),
   "Drive_classified":after_drive.get("processed"),
   "native_MJPEG_unchanged":True,
   "authenticated_MP4_Range":"206",
   "metadata_api":"signed_8795",
   "GPU_camera_mode":after_cam.get("mode"),
   "new_camera_APK_modified":False,"microSD_files_modified":False,
   "Drive_files_modified":False,
   "rollback":str(backup)
  }),flush=True)
 except Exception as error:
  print("S9_UNIFIED_SECURITY_AUTO_ROLLBACK",type(error).__name__,str(error)[:200],flush=True)
  for dst in reversed(changed):
   try:replace(originals[dst],dst)
   except Exception as failure:print("RESTORE_FAILED",str(dst),type(failure).__name__,flush=True)
  try:command("systemctl","--user","restart",SERVICE,seconds=60)
  except Exception as failure:print("SERVICE_RECOVERY_FAILED",type(failure).__name__,flush=True)
  raise

if __name__=="__main__":
 p=argparse.ArgumentParser()
 p.add_argument("--stage",type=Path,required=True)
 args=p.parse_args()
 main(args.stage.resolve())
