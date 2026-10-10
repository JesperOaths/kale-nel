#!/usr/bin/env python3
"""Rollback-protected UI-only S9+ Home Assistant Security release.

Use when the C720P is too loaded to restart its signed archive service.
Only modifies an existing nested Saved Clips HTML file; leaves active
Camera2 recorder, authenticated relay, MP4 and Drive files untouched.
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import urllib.request

PAGE=Path("/opt/homeassistant/config/www/frontyard-security-new/clips.html")
BACK=Path("/home/jespern/c720p-home-hub/backups/s9-unified-security-ui-only")
BASE="http://127.0.0.1:8795"

def get(path):
 with urllib.request.urlopen(BASE+path,timeout=15) as response:
  if response.status!=200:raise RuntimeError("signed_archive_API_unavailable")
  return json.load(response)

def verify():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=12) as r:camera=json.load(r)
 if not camera.get("ok") or camera.get("mode") not in ("watching","recording"):
  raise RuntimeError("Camera2_not_healthy")
 saved=get("/new/api/saved")
 archive=get("/new/api/drive-person-review")
 if saved.get("archive_mode")!="S9-microSD-only" or len(saved.get("events",[]))<20:
  raise RuntimeError("microSD_archive_unhealthy")
 if archive.get("scope")!="verified_legacy_drive_clips_only":
  raise RuntimeError("historical_Drive_archive_unhealthy")
 if not archive.get("persistent_visitor_ids_require_manual_clip_confirmation"):
  raise RuntimeError("manual_identity_linking_safeguard_missing")
 return camera,saved,archive

def patcher(path,name):
 spec=importlib.util.spec_from_file_location(name,path)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 return module

def main(stage):
 sources=[stage/"s9-native-security/patch-anonymous-tracks-ui.py",
          stage/"s9-native-security/patch-s9-integrated-security-ui.py",
          stage/"s9-native-security/test-s9-integrated-security-ui.py"]
 if any(not f.is_file() for f in sources):raise RuntimeError("missing_pinned_staged_UI_code")
 # Independent stage + CI has already run complete unit tests. Recheck source
 # syntax and deterministic patch against the *actual* current HTML.
 for file in sources:
  p=subprocess.run([sys.executable,"-m","py_compile",str(file)],capture_output=True,text=True,timeout=40)
  if p.returncode:raise RuntimeError("staged_source_syntax_invalid_"+file.name)
 patch=patcher(sources[1],"s9_ui_read_only_release")
 before=PAGE.read_text()
 after=patch.patch(before,anon_source=sources[0])
 if patch.patch(after,anon_source=sources[0])!=after:raise RuntimeError("UI_idempotence_failed")
 must_keep=['id="s9-anonymous-clips-script-v1"',
            'id="s9-drive-person-review-script-v1"',
            'id="s9-human-thumbnail-review-script-v1"',
            '/local/c720p-secure-relay-client.js']
 for item in must_keep:
  if item not in before or item not in after:raise RuntimeError("existing_UI_contract_lost")
 if "const validName=name=>/^motion_[0-9]{13}[.]mp4$/" not in after:
  raise RuntimeError("anonymous_native_MP4_regex_still_broken")
 if "parent.C720PSecureRelay?.fetch" not in after:raise RuntimeError("nested_signed_relay_missing")
 if not ("S9+ native security · live, recordings & analytics" in after and "/new/live.mjpg" in after):
  raise RuntimeError("unified_native_live_content_missing")
 _,saved,archive=verify()
 n=len(saved["events"]);processed=int(archive.get("processed",0))
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 backup=BACK/stamp;backup.mkdir(parents=True,exist_ok=False)
 original=backup/"clips.html";shutil.copy2(PAGE,original)
 old_hash=hashlib.sha256(before.encode()).hexdigest()
 print("S9_SECURITY_UI_ORIGINAL_BACKUP",str(original),flush=True)
 changed=False
 try:
  if after!=before:
   tmp=PAGE.with_name(PAGE.name+".s9-ui-only-stage")
   tmp.write_text(after)
   os.chmod(tmp,PAGE.stat().st_mode&0o777)
   os.replace(tmp,PAGE);changed=True
  now=PAGE.read_text()
  if now!=after or patch.patch(now,anon_source=sources[0])!=now:
   raise RuntimeError("UI_write_or_integrity_check_failed")
  # HTTP-served page must contain the newly staged components.
  with urllib.request.urlopen("http://127.0.0.1:8123/local/frontyard-security-new/clips.html?nativeS9="+stamp,timeout=16) as response:
   served=response.read()
  if b"s9-native-unified-security-script-v1" not in served:
   raise RuntimeError("Home_Assistant_stale_or_missing_unified_HTML")
  cam,now_saved,now_drive=verify()
  if len(now_saved["events"])<n or int(now_drive.get("processed",0))<processed:
   raise RuntimeError("recording_or_Drive_catalog_count_regressed")
  print("S9_UNIFIED_SECURITY_UI_ONLY_DEPLOY_PASS",json.dumps({
   "saved_native_clips":len(now_saved["events"]),
   "historical_Drive_classified":now_drive.get("processed"),
   "camera_mode":cam.get("mode"),
   "live_view":"signed_MJPEG_on_demand",
   "native_playback":"existing_authenticated_microSD_byte_ranges",
   "gallery_MP4_filename_bug":"fixed",
   "nested_signed_relay":"same_origin_parent_only",
   "backend_restarted":False,
   "camera_or_recordings_modified":False,
   "new_metadata_metrics_pending_proxy_release":True,
   "rollback":str(original),
   "prior_page_sha256":old_hash
  }),flush=True)
 except Exception as error:
  if changed:
   temp=PAGE.with_name(PAGE.name+".s9-ui-only-restore")
   shutil.copy2(original,temp);os.replace(temp,PAGE)
  print("S9_UNIFIED_SECURITY_UI_ONLY_ROLLBACK",type(error).__name__,flush=True)
  raise

if __name__=="__main__":
 parser=argparse.ArgumentParser()
 parser.add_argument("--stage",type=Path,required=True)
 main(parser.parse_args().stage.resolve())
