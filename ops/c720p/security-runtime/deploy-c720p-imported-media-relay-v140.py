#!/usr/bin/env python3
"""Patch TWO strict read-only routes in existing authorized C720P LAN relay.

Reuses existing authenticated H.archive, never introduces an unauthenticated
listener, never changes media, reviews, UI or Camera2. Live source SHA pinned.
Only the user-level LAN relay is restarted, with private backup/rollback.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
RELAY=HOME/"bin/c720p-lan-camera-relay.py"
BACKUPS=HOME/"backups/c720p-signed-import-routes-v140"
UNIT="c720p-lan-camera-relay.service"
EXPECTED_SHA="8c935eae99010fe8ab0968fced0ff9953c924b9343a274cf2b1ada2c81d1956c"
MARK="C720P_AUTHORIZED_IMPORTED_MEDIA_V140"
ANCHOR="   m=re.fullmatch(r'/(new)/api/saved',path)"
INSERT="""   # C720P_AUTHORIZED_IMPORTED_MEDIA_V140 - read-only, after authorized().
   # Explicit exact metadata path: no broad public /new/* delegation.
   m=re.fullmatch(r'/(new)/api/c720p-migrated-clips',path)
   if m:return self.archive(m.group(1),'/api/c720p-migrated-clips',head)
   # Only manifest-qualified verified C720P originals. The 8795 upstream
   # does its own 0600 SHA/size validation; signed relay keeps Range/HEAD.
   m=re.fullmatch(r'/(new)/saved/c720p-migrated/clip/([A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]mp4)',path)
   if m and '..' not in m.group(2):
    return self.archive(m.group(1),'/saved/c720p-migrated/clip/'+urllib.parse.quote(m.group(2)),head)
"""
SCHEMA="c720p_s9_verified_import_v2"
def sha(raw):return hashlib.sha256(raw).hexdigest()
def snapshot(path,maxlen):
 if path.is_symlink() or not path.is_file() or not 0<path.stat().st_size<=maxlen:
  raise RuntimeError("unexpected_or_unreadable_relay")
 return path.read_bytes()
def patch(text):
 if MARK in text:raise RuntimeError("already_patched_unknown_live_state")
 if text.count(ANCHOR)!=1:
  raise RuntimeError("signed_relay_source_anchor_not_unique")
 auth="   if not self.authorized(): return self.empty(401)"
 if text.count(auth)!=1 or text.index(auth)>=text.index(ANCHOR):
  raise RuntimeError("existing_authorization_guard_missing")
 if "def archive(self," not in text or "   if m:return self.archive(m.group(1),'/api/saved',head)" not in text:
  raise RuntimeError("existing_archive_range_forwarding_changed")
 updated=text.replace(ANCHOR,INSERT+ANCHOR,1)
 if updated.count(MARK)!=1 or updated.count("if not self.authorized()")!=text.count("if not self.authorized()"):
  raise RuntimeError("new_relay_auth_boundary_modified")
 compile(updated,str(RELAY),"exec")
 return updated
def camera():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=10) as r:
  if r.status!=200:raise RuntimeError("4k_status_unavailable")
  raw=r.read(65537)
 if len(raw)>65536:raise RuntimeError("4k_status_unbounded")
 doc=json.loads(raw)
 if (doc.get("ok") is not True or doc.get("mode")!="watching"
     or doc.get("native_4k_enabled") is not True
     or doc.get("continuous_4k_ready") is not True
     or doc.get("continuous_4k_dropped_output_frames")!=0
     or doc.get("continuous_4k_error")
     or type(doc.get("temperature_c")) not in (float,int)
     or not 0<doc["temperature_c"]<=39.5
     or type(doc.get("continuous_4k_buffered_ms")) is not int
     or doc["continuous_4k_buffered_ms"]<6500):
  raise RuntimeError("4k_capture_busy_or_unhealthy")
 return doc
def get(port,route):
 u="http://127.0.0.1:%d%s"%(port,route)
 with urllib.request.urlopen(u,timeout=12) as r:
  if r.status!=200:raise RuntimeError("unexpected_http_status")
  b=r.read(600000)
 if len(b)>=600000:raise RuntimeError("unbounded_metadata_response")
 return json.loads(b)
def import_state(port):
 result=get(port,"/new/api/c720p-migrated-clips")
 if (result.get("ok") is not True or result.get("schema_version")!=SCHEMA
     or result.get("not_s9_original_recordings") is not True
     or result.get("not_person_assignments") is not True
     or type(result.get("total_imported")) is not int
     or not 1<=result["total_imported"]<=5000
     or not isinstance(result.get("files"),list)
     or len(result["files"])!=result["total_imported"]):
  raise RuntimeError("existing_private_migrated_manifest_incompatible")
 return result["total_imported"]
def current_saved_count():
 d=get(8794,"/new/api/saved")
 if not isinstance(d.get("events"),list):raise RuntimeError("known_security_archive_route_unhealthy")
 return len(d["events"])
def restart():
 r=subprocess.run(["systemctl","--user","restart",UNIT],
    capture_output=True,text=True,timeout=45)
 if r.returncode:raise RuntimeError("metadata_relay_restart_failed")
def atomically_write(path,b):
 if path.is_symlink():raise RuntimeError("concurrent_relay_symlink")
 st=path.stat()
 fd,temp=tempfile.mkstemp(prefix=".c720p-verified-import-relay-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as f:
   os.fchmod(f.fileno(),stat.S_IMODE(st.st_mode))
   f.write(b);f.flush();os.fsync(f.fileno())
  os.replace(temp,path)
 finally:
  if os.path.exists(temp):os.unlink(temp)
def verified_live(oldcount,expected_imports):
 last=None
 for i in range(20):
  try:
   current=import_state(8794)
   after=current_saved_count()
   if current<expected_imports or after<oldcount:
    raise RuntimeError("original_archive_or_import_index_regressed")
   return current,after
  except Exception as error:
   last=error;time.sleep(.30)
 raise RuntimeError("relay_readback_failed_"+type(last).__name__)
def main(apply):
 b=snapshot(RELAY,80000)
 if sha(b)!=EXPECTED_SHA:
  raise RuntimeError("newer_or_unknown_live_relay_not_overwritten")
 if os.statvfs(str(HOME)).f_bavail*os.statvfs(str(HOME)).f_frsize<750*1024**2:
  raise RuntimeError("hub_storage_reserve_unsafe")
 phone=camera()
 before=current_saved_count()
 imports=import_state(8795)
 updated=patch(b.decode("utf8")).encode("utf8")
 if not apply:
  print("C720P_SIGNED_IMPORT_RELAY_V140_PREFLIGHT "+json.dumps({
   "authorized_guard_preserved":True,"existing_saved_count":before,
   "verified_migrated_count":imports,"exact_two_routes_added":True,
   "camera_healthy":True,"applied":False,
   "original_videos_modified":False,"camera_apk_modified":False
  },sort_keys=True),flush=True)
  return
 path=BACKUPS/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 path.mkdir(parents=True,mode=0o700,exist_ok=False)
 backup=path/"original-relay.py"
 backup.write_bytes(b);os.chmod(backup,0o600)
 if snapshot(backup,80000)!=b:raise RuntimeError("backup_readback_mismatch")
 patched_sha=sha(updated)
 changed=False
 try:
  if snapshot(RELAY,80000)!=b:
   raise RuntimeError("concurrent_relay_update_before_write")
  atomically_write(RELAY,updated);changed=True
  if sha(snapshot(RELAY,80000))!=patched_sha:
   raise RuntimeError("relay_atomic_patch_readback_mismatch")
  restart()
  current,after=verified_live(before,imports)
  alive=camera()
  if sha(snapshot(RELAY,80000))!=patched_sha:
   raise RuntimeError("relay_file_replaced_during_acceptance")
  print("C720P_SIGNED_IMPORT_RELAY_V140_VERIFIED "+json.dumps({
   "authorized_readonly_metadata_route":True,
   "authorized_strict_mp4_range_route":True,
   "verified_migrated_count":current,"original_archive_count":after,
   "original_archive_count_preserved":after>=before,
   "temperature_after_c":alive["temperature_c"],
   "original_videos_modified":False,"camera_apk_modified":False,
   "manual_reviews_modified":False,
   "only_lan_relay_restarted":True,
   "metadata_proxy_not_restarted":True,
   "backup_verified":True,"signed_url_logged":False
  },sort_keys=True),flush=True)
 except BaseException:
  if changed and sha(snapshot(RELAY,80000))==patched_sha:
   atomically_write(RELAY,b)
   try:restart()
   except Exception:pass
  print("C720P_SIGNED_IMPORT_RELAY_V140_ROLLBACK "+
   json.dumps({"old_relay_restored_if_unchanged":True,
               "originals_modified":False,"camera_apk_modified":False}),flush=True)
  raise
if __name__=="__main__":
 parser=argparse.ArgumentParser();parser.add_argument("--apply",action="store_true")
 args=parser.parse_args();main(args.apply)
