#!/usr/bin/env python3
"""Guarded replacement of outdated grouped face modal with per-clip evidence.

Installs only the existing Home Assistant face-gallery HTML from an immutable
SHA-256 verified GitHub source. Camera, S9+ APK, clip files and indexes are not
changed. Keep installed page copy for rollback if any contract fails.
"""
import argparse
from datetime import datetime,timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import urllib.request

WWW=Path("/opt/homeassistant/config/www")
DEST=WWW/"frontyard-security-new/face-appearances.html"
SECURITY=WWW/"c720p-surveillance.html"
BACKUP=Path("/home/jespern/c720p-home-hub/backups/security-faces-v17")
PATH="ops/c720p/s9-native-security/face-appearances.html.txt"
MARKER="s9-faces-appearances-gallery-v1"

def sha(payload):return hashlib.sha256(payload).hexdigest()
def http(url,limit=2800000,timeout=18):
 with urllib.request.urlopen(url,timeout=timeout) as r:
  data=r.read(limit+1)
  if r.status!=200 or len(data)>limit:raise RuntimeError("page_unavailable_or_oversize")
  return data
def atomic(path,data,st):
 fd,tmp=tempfile.mkstemp(prefix=".security-faces-v17-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as h:h.write(data);h.flush();os.fsync(h.fileno())
  os.chmod(tmp,stat.S_IMODE(st.st_mode))
  try:os.chown(tmp,st.st_uid,st.st_gid)
  except PermissionError:pass
  os.replace(tmp,path)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)
def main():
 p=argparse.ArgumentParser()
 p.add_argument("--ref",required=True)
 p.add_argument("--sha256",required=True)
 args=p.parse_args()
 if not re.fullmatch(r"[0-9a-f]{40}",args.ref) or not re.fullmatch(r"[0-9a-f]{64}",args.sha256):
  raise RuntimeError("invalid_immutable_ref")
 if DEST.is_symlink() or not DEST.is_file() or SECURITY.is_symlink() or not SECURITY.is_file():
  raise RuntimeError("known_faces_or_root_html_unavailable")
 source=http("https://raw.githubusercontent.com/JesperOaths/kale-nel/"+args.ref+"/"+PATH,limit=140000)
 if sha(source)!=args.sha256:raise RuntimeError("face_template_digest_mismatch")
 html=source.decode("utf-8")
 for required in (MARKER,"/new/api/saved","/new/saved/clip/","/new/saved/snap/",
                  "C720PSecureRelay","Face snapshots","Clothing &amp; tracks",
                  "Needs review", "more[hidden]", "security-video-playback.js",
                  "v817 - Made by Bruis"):
  if required not in html:raise RuntimeError("face_template_contract_"+required)
 root=SECURITY.read_text(errors="replace")
 if 'id="panel-faces"' not in root or "s9FacesGalleryFrame" not in root:
  raise RuntimeError("security_face_navigation_not_installed")
 index=json.loads(http("http://127.0.0.1:8794/new/api/saved"))
 if index.get("archive_mode")!="S9-microSD-only" or not isinstance(index.get("events"),list):
  raise RuntimeError("saved_camera_index_unhealthy")
 n=len(index["events"])
 before=DEST.read_bytes();st=DEST.stat()
 if before==source:
  print("SECURITY_FACES_V17_VERIFIED "+json.dumps({"already_installed":True,"archive_clips":n,"page_sha256":sha(source)}),flush=True)
  return
 BACKUP.mkdir(parents=True,exist_ok=True);os.chmod(BACKUP,0o700)
 old=BACKUP/("before-"+datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")+".html")
 old.write_bytes(before);os.chmod(old,0o600)
 if old.read_bytes()!=before or DEST.read_bytes()!=before:
  raise RuntimeError("original_backup_or_concurrent_edit_failed")
 changed=False
 try:
  atomic(DEST,source,st);changed=True
  served=http("http://127.0.0.1:8123/local/frontyard-security-new/face-appearances.html?v=faces-v17")
  if sha(served)!=sha(source):raise RuntimeError("ha_http_readback_changed")
  current=json.loads(http("http://127.0.0.1:8794/new/api/saved"))
  if len(current.get("events",[]))<n or current.get("archive_mode")!="S9-microSD-only":
   raise RuntimeError("media_catalog_regressed")
  print("SECURITY_FACES_V17_VERIFIED "+json.dumps({
   "already_installed":False,"source_sha256":sha(source),"backup":str(old),
   "archive_clips":len(current["events"]),"http_readback":True,
   "per_clip_evidence":True,"large_no_face_modal_removed":True,
   "original_4k_unchanged":True,"camera_unchanged":True}),flush=True)
 except BaseException:
  if changed:
   try:atomic(DEST,before,st);print("SECURITY_FACES_V17_ROLLED_BACK",flush=True)
   except Exception:print("SECURITY_FACES_V17_RESTORE_REQUIRED",flush=True)
  raise
if __name__=="__main__":main()
