#!/usr/bin/env python3
"""Guarded UI-only Step 2 appearance pilot deployment on C720P.

The existing S9+ and authenticated API already own the HSV index. Update only
one local Home Assistant HTML file. Never restart camera/archive/ADB or touch
biometric model, recordings, snapshots, user data or metadata database.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import urllib.request

SITE=Path("/opt/homeassistant/config/www/frontyard-security-new")
FACE=SITE/"security-face-folders-v22.html"
BACKUP=Path("/home/jespern/c720p-home-hub/backups/s9-step2-appearance-pilot")
BASE="https://raw.githubusercontent.com/JesperOaths/kale-nel/"
SOURCE="ops/c720p/s9-native-security/security-face-folders-v22.html"

def digest(data):return hashlib.sha256(data).hexdigest()

def fetch(uri,limit):
 with urllib.request.urlopen(uri,timeout=30) as response:
  if response.status!=200:raise RuntimeError("unexpected_http_status")
  data=response.read(limit+1)
 if not 1000<len(data)<=limit:raise RuntimeError("bounded_source_size_invalid")
 return data

def write_atomic(path,blob,original_stat):
 path.parent.mkdir(parents=True,exist_ok=True)
 with tempfile.NamedTemporaryFile(dir=path.parent,prefix=".s9-visual-pilot-",delete=False) as file:
  file.write(blob);file.flush();os.fsync(file.fileno());tmp=Path(file.name)
 try:
  os.chmod(tmp,stat.S_IMODE(original_stat.st_mode))
  try:os.chown(tmp,original_stat.st_uid,original_stat.st_gid)
  except PermissionError:pass
  os.replace(tmp,path)
 finally:
  if tmp.exists():tmp.unlink()

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--ref",required=True)
 parser.add_argument("--sha256",required=True)
 args=parser.parse_args()
 if not re.fullmatch(r"[0-9a-f]{40}",args.ref) or not re.fullmatch(r"[0-9a-f]{64}",args.sha256):
  raise RuntimeError("source_commit_and_sha_required")
 if not FACE.is_file() or FACE.is_symlink():raise RuntimeError("unsafe_live_face_ui_target")
 blob=fetch(BASE+args.ref+"/"+SOURCE,120000)
 if digest(blob)!=args.sha256:raise RuntimeError("immutable_source_checksum_invalid")
 for part in (b'id="appearanceTab"',b'id="appearanceResults"',
              b'/new/api/appearance-search?',b"verified_same_person===false",
              b'Similar clothing',b'C720PSecureRelay'):
  if part not in blob:raise RuntimeError("appearance_pilot_contract_missing")
 if b'innerHTML=' in blob:raise RuntimeError("unsafe_html_construction")
 before=fetch("http://127.0.0.1:8795/new/api/saved",4200000)
 doc=json.loads(before)
 if doc.get("archive_mode")!="S9-microSD-only":raise RuntimeError("native_recordings_unavailable")
 originals={e.get("clip_no") for e in doc.get("events",[]) if isinstance(e,dict)}
 if len(originals)<1:raise RuntimeError("no_verified_local_archive")
 old=FACE.read_bytes();owner=FACE.stat()
 if digest(old)==args.sha256:
  print("S9_STEP2_APPEARANCE_PILOT_UI_VERIFIED "+json.dumps({
   "already":True,"source_ref":args.ref,"clip_count":len(originals),
   "camera_modified":False,"identity_matching_enabled":False,
   "recordings_modified":False,"archive_service_restarted":False
  },sort_keys=True),flush=True)
  return
 BACKUP.mkdir(parents=True,exist_ok=True);os.chmod(BACKUP,0o700)
 save=BACKUP/(dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")+".html")
 with save.open("xb") as out:out.write(old);out.flush();os.fsync(out.fileno())
 os.chmod(save,0o600)
 if save.read_bytes()!=old:raise RuntimeError("original_ui_backup_failed")
 if FACE.read_bytes()!=old:raise RuntimeError("ui_changed_concurrently")
 try:
  write_atomic(FACE,blob,owner)
  if digest(FACE.read_bytes())!=args.sha256:raise RuntimeError("ui_readback_digest_invalid")
  served=fetch("http://127.0.0.1:8123/local/frontyard-security-new/security-face-folders-v22.html?stage2="+args.ref[:12],120000)
  if digest(served)!=args.sha256:raise RuntimeError("homeassistant_served_different_ui")
  after=json.loads(fetch("http://127.0.0.1:8795/new/api/saved",4200000))
  if after.get("archive_mode")!="S9-microSD-only" or not originals.issubset({
   e.get("clip_no") for e in after.get("events",[]) if isinstance(e,dict)
  }):raise RuntimeError("native_originals_no_longer_visible")
  print("S9_STEP2_APPEARANCE_PILOT_UI_VERIFIED "+json.dumps({
   "already":False,"source_ref":args.ref,"source_sha256":args.sha256,
   "clip_count":len(originals),"backup":str(save),
   "homeassistant_readback_verified":True,"camera_modified":False,
   "identity_matching_enabled":False,"recordings_modified":False,
   "archive_service_restarted":False
  },sort_keys=True),flush=True)
 except BaseException:
  try:write_atomic(FACE,old,owner)
  except Exception:print("S9_STEP2_APPEARANCE_UI_MANUAL_RESTORE_REQUIRED",flush=True)
  print("S9_STEP2_APPEARANCE_PILOT_UI_ROLLED_BACK",flush=True)
  raise

if __name__=="__main__":main()
