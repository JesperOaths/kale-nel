#!/usr/bin/env python3
"""Publish S9 face-evidence review safeguards to the existing authenticated hub UI.

Only changes the face-folder HTML. Keeps raw recordings, S9 camera APK,
face embeddings, metadata index, video player and all relay security intact.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import urllib.request

UI=Path("/opt/homeassistant/config/www/frontyard-security-new/security-face-folders-v22.html")
BACKUPS=Path("/home/jespern/c720p-home-hub/backups/s9-face-review-evidence-v29")
SOURCE="ops/c720p/s9-native-security/security-face-folders-v22.html"

def digest(raw):return hashlib.sha256(raw).hexdigest()

def get(url,limit=3000000):
 with urllib.request.urlopen(url,timeout=25) as response:
  if response.status!=200:raise RuntimeError("server_unavailable")
  data=response.read(limit+1)
 if len(data)>limit:raise RuntimeError("bounded_metadata_or_source_too_large")
 return data

def catalog():
 r=json.loads(get("http://127.0.0.1:8795/new/api/saved",4000000))
 if not isinstance(r.get("events"),list) or r.get("archive_mode")!="S9-microSD-only":
  raise RuntimeError("s9_original_microSD_archive_not_healthy")
 return r

def status():
 r=json.loads(get("http://127.0.0.1:18808/status",200000))
 if not r.get("ok") or not r.get("native_4k_enabled") or not r.get("continuous_4k_ready"):
  raise RuntimeError("s9_native_4k_not_ready")
 return r

def atomic(path,body,meta):
 fd,name=tempfile.mkstemp(prefix=".s9-face-v29-",dir=str(path.parent))
 try:
  with os.fdopen(fd,"wb") as out:
   out.write(body);out.flush();os.fsync(out.fileno())
  os.chmod(name,stat.S_IMODE(meta.st_mode))
  try:os.chown(name,meta.st_uid,meta.st_gid)
  except PermissionError:pass
  os.replace(name,path)
 finally:
  if os.path.exists(name):os.unlink(name)

def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--ref",required=True)
 ap.add_argument("--ui-sha",required=True)
 args=ap.parse_args()
 if not re.fullmatch(r"[a-f0-9]{40}",args.ref) or not re.fullmatch(r"[a-f0-9]{64}",args.ui_sha):
  raise RuntimeError("immutable_release_identifiers_required")
 if not UI.is_file() or UI.is_symlink():raise RuntimeError("unexpected_existing_face_page")
 before=catalog()
 old_ids={e.get("clip_no") for e in before["events"]}
 if len(old_ids)<1 or None in old_ids:raise RuntimeError("archive_clip_identity_invalid")
 camera=status()
 if camera.get("mode")!="watching":raise RuntimeError("camera_not_watching_no_UI_write")
 source=get("https://raw.githubusercontent.com/JesperOaths/kale-nel/"+args.ref+"/"+SOURCE,200000)
 if digest(source)!=args.ui_sha or not all(needle in source for needle in (
     b'security-face-folders-v22',b'facePipelineStatus',b'comparisonCandidate(face)',
     b'face_deep_review_version',b'face_crop_requires_manual_review',
     b'/new/api/saved',b'/new/saved/face/')):
  raise RuntimeError("face_review_source_integrity_or_scope_mismatch")
 old=UI.read_bytes()
 if len(old)>200000 or b'security-face-folders-v22' not in old:
  raise RuntimeError("existing_ui_contract_mismatch")
 if old==source:
  print("S9_FACE_REVIEW_V29_VERIFIED "+json.dumps({
   "already_installed":True,"original_recordings":len(old_ids),
   "ui_sha256":digest(source),"phone_original_4k_healthy":True,
   "biometric_templates_transferred":False},sort_keys=True),flush=True)
  return
 BACKUPS.mkdir(parents=True,exist_ok=True);os.chmod(BACKUPS,0o700)
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 backup=BACKUPS/(stamp+"-security-face-folders-v22.html")
 if backup.exists():raise RuntimeError("face_ui_backup_collision")
 backup.write_bytes(old);os.chmod(backup,0o600)
 if backup.read_bytes()!=old:raise RuntimeError("face_ui_backup_corruption")
 original_meta=UI.stat()
 if UI.read_bytes()!=old:raise RuntimeError("concurrent_face_ui_edit")
 installed=False
 try:
  atomic(UI,source,original_meta);installed=True
  if digest(UI.read_bytes())!=args.ui_sha:raise RuntimeError("installed_ui_sha_mismatch")
  delivered=get("http://127.0.0.1:8123/local/frontyard-security-new/security-face-folders-v22.html?v=s9-face-review-v29-"+args.ref[:12],200000)
  if digest(delivered)!=args.ui_sha:raise RuntimeError("served_face_ui_not_current")
  after=catalog()
  new_ids={e.get("clip_no") for e in after["events"]}
  if not old_ids.issubset(new_ids):raise RuntimeError("face_review_deployment_lost_archive_records")
  if not status().get("continuous_4k_ready"):raise RuntimeError("s9_4k_healthy_state_changed")
  print("S9_FACE_REVIEW_V29_VERIFIED "+json.dumps({
   "already_installed":False,"clips_before":len(old_ids),"clips_after":len(new_ids),
   "changed_file":UI.name,"ui_sha256":digest(source),
   "s9_4k_healthy":True,"camera_apk_changed":False,
   "archive_clips_modified":False,"biometric_templates_transferred":False,
   "backup":str(backup),"http_readback_verified":True},sort_keys=True),flush=True)
 except BaseException:
  if installed:
   try:atomic(UI,old,original_meta)
   except Exception:print("S9_FACE_REVIEW_V29_MANUAL_RESTORE_NEEDED",flush=True)
  print("S9_FACE_REVIEW_V29_ROLLBACK_ATTEMPTED",flush=True)
  raise

if __name__=="__main__":
 main()
