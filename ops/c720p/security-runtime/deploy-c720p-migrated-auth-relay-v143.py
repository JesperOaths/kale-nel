#!/usr/bin/env python3
"""Add only the missing authenticated C720P->S9 migrated media paths to 8794.

The existing 8794 authenticated relay already carries Range to 8795. This
patch changes no auth logic, camera, S9 app, review, or video. Atomic source
backup, exact old SHA pin, user-service restart, bounded 1 KiB sample and
safe rollback if this deployment's known source remains current.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import py_compile
import re
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

TARGET=Path("/home/jespern/c720p-home-hub/bin/c720p-lan-camera-relay.py")
BACK=Path("/home/jespern/c720p-home-hub/backups/c720p-migrated-auth-relay-v143")
SERVICE="c720p-lan-camera-relay.service"
PREVIOUS_SHA="8c935eae99010fe8ab0968fced0ff9953c924b9343a274cf2b1ada2c81d1956c"
MARK="C720P_MIGRATED_S9_AUTHENTICATED_RANGE_V143"
ANCHOR="  # SECURITY_NATIVE_CAMERA2_RELAY_V18: authenticated GET, read-only metadata\n"
ADDITION="""  # C720P_MIGRATED_S9_AUTHENTICATED_RANGE_V143: existing auth already passed.
  if path=='/new/api/c720p-migrated-clips':
   if head:return self.empty(405)
   return self.archive('new','/api/c720p-migrated-clips',False)
  m=re.fullmatch(r'/(new)/saved/c720p-migrated/clip/([A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]mp4)',path)
  if m:
   if '..' in m.group(2):return self.empty(400)
   return self.archive(m.group(1),'/saved/c720p-migrated/clip/'+urllib.parse.quote(m.group(2)),head)
"""
NAME=re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]mp4\Z")
SCHEMA="c720p_s9_verified_import_v2"
JSON_MAX=300000
def sha(blob):return hashlib.sha256(blob).hexdigest()
def checked(path,maxbytes):
 if path.is_symlink() or not path.is_file() or not 0<path.stat().st_size<=maxbytes:
  raise RuntimeError("source_untrusted_or_missing")
 return path.read_bytes()
def patch_source(original,expected=PREVIOUS_SHA):
 if sha(original)!=expected:raise RuntimeError("unknown_or_newer_live_relay")
 text=original.decode("utf8")
 if MARK in text or text.count(ANCHOR)!=1:raise RuntimeError("source_marker_or_anchor_drift")
 pos=text.index(ANCHOR)
 authline="  if not self.authorized(): return self.empty(401)"
 if authline not in text[:pos] or "def do_GET(self): self.go(False)" not in text:
  raise RuntimeError("authorization_anchor_missing")
 result=text.replace(ANCHOR,ADDITION+ANCHOR,1).encode()
 if result.count(MARK.encode())!=1:raise RuntimeError("patch_marker_count")
 return result
def unit(action):
 r=subprocess.run(["systemctl","--user",action,SERVICE],
                  capture_output=True,text=True,timeout=25)
 if r.returncode:raise RuntimeError("relay_unit_"+action+"_failed")
 return r.stdout.strip()
def camera():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=10) as r:
  if r.status!=200:raise RuntimeError("camera_status_not_ok")
  b=r.read(65537)
 if len(b)>65536:raise RuntimeError("camera_status_unbounded")
 d=json.loads(b)
 if (d.get("ok") is not True or d.get("mode")!="watching"
     or d.get("native_4k_enabled") is not True
     or d.get("continuous_4k_ready") is not True
     or d.get("continuous_4k_dropped_output_frames")!=0
     or d.get("continuous_4k_error")
     or type(d.get("continuous_4k_buffered_ms")) is not int
     or d["continuous_4k_buffered_ms"]<6500
     or type(d.get("temperature_c")) not in (int,float)
     or not 0<d["temperature_c"]<=39.5):
  raise RuntimeError("camera_not_healthy")
 return d
def fetch(port,path,headers=None,limit=JSON_MAX):
 req=urllib.request.Request("http://127.0.0.1:"+str(port)+path,
                            headers=headers or {})
 try:r=urllib.request.urlopen(req,timeout=18)
 except urllib.error.HTTPError as error:r=error
 with r:
  status=r.status;headers=r.headers
  if status==206 and not 1<=int(headers.get("Content-Length","0"))<=4096:
   raise RuntimeError("upstream_range_unbounded")
  data=r.read(limit+1)
 if len(data)>limit:raise RuntimeError("oversize_response")
 return status,data,headers
def manifest(port):
 code,b,headers=fetch(port,"/new/api/c720p-migrated-clips")
 if code!=200 or headers.get_content_type()!="application/json":
  raise RuntimeError("import_manifest_api_unavailable")
 doc=json.loads(b)
 if (doc.get("ok") is not True or doc.get("schema_version")!=SCHEMA
     or doc.get("not_s9_original_recordings") is not True
     or doc.get("not_person_assignments") is not True
     or type(doc.get("total_imported")) is not int
     or not 1<=doc["total_imported"]<=5000
     or not isinstance(doc.get("files"),list)
     or len(doc["files"])!=doc["total_imported"]):
  raise RuntimeError("import_manifest_contract_untrusted")
 names=[]
 for item in doc["files"]:
  if (not isinstance(item,dict) or not isinstance(item.get("name"),str)
      or not NAME.fullmatch(item["name"]) or ".." in item["name"]
      or type(item.get("bytes")) is not int or not 10000<=item["bytes"]<=900*1024**2
      or type(item.get("indexed")) is not bool):
   raise RuntimeError("imported_clip_entry_untrusted")
  names.append(item["name"])
 return len(names),sorted(names)[0]
def checked_range(port,name):
 route="/new/saved/c720p-migrated/clip/"+urllib.parse.quote(name,safe="")
 status,body,head=fetch(port,route,{"Range":"bytes=0-1023"},4096)
 if status!=206 or not 1<=len(body)<=1024 or head.get_content_type()!="video/mp4":
  raise RuntimeError("imported_media_range_not_verified")
 cr=head.get("Content-Range","")
 if not re.fullmatch(r"bytes 0-[0-9]{1,4}/[0-9]+",cr):
  raise RuntimeError("untrusted_content_range")
 if int(cr.split("-")[1].split("/")[0])+1!=len(body):
  raise RuntimeError("incorrect_bounded_range_length")
 return sha(body)
def verify(count,name):
 front,sample=manifest(8794)
 if front!=count or sample!=name:raise RuntimeError("migrated_manifest_front_drift")
 direct=checked_range(8795,name)
 proxied=checked_range(8794,name)
 if direct!=proxied:raise RuntimeError("migrated_range_bytes_differ")
 if unit("is-active")!="active":raise RuntimeError("relay_not_active")
 return {"authenticated_front_manifest":True,"verified_imported_clips":count,
         "bounded_range_206":True,"range_hash_equal_to_s9_proxy":True}
def atomic(target,body,meta):
 fd,temp=tempfile.mkstemp(prefix=".c720p-migrated-auth-v143-",dir=target.parent)
 try:
  with os.fdopen(fd,"wb") as f:
   os.fchmod(f.fileno(),stat.S_IMODE(meta.st_mode))
   f.write(body);f.flush();os.fsync(f.fileno())
  os.replace(temp,target)
 finally:
  if os.path.exists(temp):os.unlink(temp)
def apply(do_apply):
 prior=checked(TARGET,150000);meta=TARGET.stat()
 updated=patch_source(prior)
 if unit("is-active")!="active":raise RuntimeError("relay_not_active_before")
 count,name=manifest(8795)
 # Confirm downstream real S9 range works BEFORE touching current front relay.
 upstream=checked_range(8795,name)
 healthy=camera()
 with tempfile.TemporaryDirectory(prefix="migrated-relay-v143-") as folder:
  copy=Path(folder)/"relay.py";copy.write_bytes(updated)
  py_compile.compile(str(copy),doraise=True)
 if not do_apply:
  print("C720P_MIGRATED_AUTH_V143_PREFLIGHT "+json.dumps({
    "exact_live_source_sha_verified":True,"verified_import_count":count,
    "upstream_206_available":True,"relay_restart_not_requested":True,
    "camera_temperature_c":healthy["temperature_c"],
    "originals_modified":False,"camera_apk_modified":False},sort_keys=True),flush=True)
  return
 BACK.mkdir(parents=True,mode=0o700,exist_ok=True)
 backup=BACK/("source-"+dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")+".py")
 backup.write_bytes(prior);os.chmod(backup,0o600)
 if checked(backup,150000)!=prior or checked(TARGET,150000)!=prior:
  raise RuntimeError("backup_or_source_concurrent_change")
 applied=False
 try:
  atomic(TARGET,updated,meta);applied=True
  unit("restart")
  last=None
  for attempt in range(5):
   try:
    verified=verify(count,name)
    camera_after=camera()
    print("C720P_MIGRATED_AUTH_V143_VERIFIED "+json.dumps({
      **verified,"temperature_after_c":camera_after["temperature_c"],
      "camera_apk_modified":False,"videos_modified":False,
      "manual_reviews_modified":False,"source_backup_verified":True,
      "legacy_web_pages_unchanged":True,"local_mp4_retention_required":True
    },sort_keys=True),flush=True)
    return
   except Exception as error:
    last=error;time.sleep(2)
  raise RuntimeError("authenticated_media_relay_postcheck_failed_"+type(last).__name__)
 except BaseException:
  if applied and TARGET.is_file() and sha(checked(TARGET,150000))==sha(updated):
   atomic(TARGET,prior,meta)
   unit("restart")
   print("C720P_MIGRATED_AUTH_V143_ROLLED_BACK "+json.dumps({
       "relay_restored":True,"originals_modified":False,
       "camera_apk_modified":False}),flush=True)
  raise
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--apply",action="store_true")
 args=p.parse_args();apply(args.apply)
