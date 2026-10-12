#!/usr/bin/env python3
"""Explicit-owner, single-clip S9+ microSD deletion for authenticated Archive UI.

No automatic or bulk deletion. Never touches an in-progress file, and does not
modify the APK, cloud Drive archive, detection model, or unrelated SD content.
An auditable tombstone prevents an indexed entry reappearing between scans.
"""
import datetime as dt
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import threading
import time
import urllib.parse

STATE=Path("/home/jespern/c720p-home-hub/state/s9-user-deleted-clips-v1.json")
NATIVE=re.compile(r"(?:motion|native4k)_[0-9]{13}[.]mp4\Z")
OLD=re.compile(r"rec_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2}[.]mp4\Z")
LOCK=threading.Lock()
MAX=10000
PHONE="192.168.178.250:5555"

def deleted():
 try:
  data=json.loads(STATE.read_text())
  if data.get("version")!=1 or not isinstance(data.get("deleted"),dict):return {}
  return {name:entry for name,entry in data["deleted"].items()
          if isinstance(name,str) and (NATIVE.fullmatch(name) or OLD.fullmatch(name))}
 except (OSError,ValueError,TypeError):return {}

def filter_rows(source):
 def rows():
  removed=deleted()
  return {name:item for name,item in source().items() if name not in removed}
 return rows

def save_deleted(names):
 STATE.parent.mkdir(parents=True,exist_ok=True)
 fd,p=tempfile.mkstemp(prefix=".s9-delete-v1-",dir=STATE.parent)
 try:
  with os.fdopen(fd,"w") as f:
   json.dump({"version":1,"deleted":names},f,indent=2,sort_keys=True)
   f.write("\n");f.flush();os.fsync(f.fileno())
  os.chmod(p,0o600)
  os.replace(p,STATE)
 finally:
  if os.path.exists(p):os.unlink(p)

def adb(*args,timeout=24):
 return subprocess.run(["adb","-s",PHONE,*args],stdout=subprocess.PIPE,
   stderr=subprocess.PIPE,timeout=timeout,check=False)

def stat_size(full):
 result=adb("shell","stat","-c","%s",full)
 if result.returncode:return None
 try:return int(result.stdout.strip())
 except ValueError:return None

def respond(handler,code,doc):
 handler.js(code,doc)

def install(handler_class,current_rows,sd_root,native_root,legacy_root):
 old=handler_class.do_POST if hasattr(handler_class,"do_POST") else None
 def post(self):
  path=urllib.parse.urlsplit(self.path).path
  if path!="/new/api/sd/delete":
   if old:return old(self)
   return respond(self,404,{"ok":False,"error":"not_found"})
  # Port 8795 only serves loopback callers. Port 8794 authenticates user first.
  if self.client_address[0] not in ("127.0.0.1","::1"):
   return respond(self,403,{"ok":False,"error":"local_bridge_only"})
  try:
   length=int(self.headers.get("Content-Length","0"))
   if not 30<=length<=512 or "application/json" not in self.headers.get("Content-Type","").lower():
    raise ValueError("invalid_body")
   obj=json.loads(self.rfile.read(length))
   if not isinstance(obj,dict) or set(obj)!={"clip_no","expected_bytes","confirm"}:
    raise ValueError("invalid_keys")
   name=obj["clip_no"]
   expected=obj["expected_bytes"]
   if not isinstance(name,str) or not (NATIVE.fullmatch(name) or OLD.fullmatch(name)):
    raise ValueError("invalid_filename")
   if type(expected) is not int or not 10000<expected<=4*1024*1024*1024:
    raise ValueError("invalid_size")
   if obj["confirm"]!="DELETE "+name:
    raise ValueError("confirmation_required")
  except (OSError,ValueError,TypeError,KeyError,json.JSONDecodeError):
   return respond(self,400,{"ok":False,"error":"invalid_delete_confirmation"})
  # Never run deletion just because a filename looks valid: require the actual
  # authenticated archive's already-verified row and matching immutable size.
  with LOCK:
   known=deleted()
   if name in known:return respond(self,409,{"ok":False,"error":"already_deleted"})
   record=current_rows().get(name)
   if not isinstance(record,dict) or record.get("sd_verified") is not True:
    return respond(self,404,{"ok":False,"error":"clip_not_verified_on_phone"})
   if type(record.get("size")) is not int or record["size"]!=expected:
    return respond(self,409,{"ok":False,"error":"indexed_size_changed"})
   if name.startswith("motion_"):root=sd_root
   elif name.startswith("native4k_"):root=native_root
   else:root=legacy_root
   # New native camera recordings are immutable only after finalization.
   if name.startswith(("motion_","native4k_")):
    time_ms=int(name.rsplit("_",1)[1].split(".",1)[0])
    if time.time()*1000-time_ms<5*60*1000:
     return respond(self,409,{"ok":False,"error":"recent_clip_protected"})
   full=root+"/"+name
   before=stat_size(full)
   if before is None:return respond(self,503,{"ok":False,"error":"phone_or_media_unavailable"})
   if before!=expected:return respond(self,409,{"ok":False,"error":"phone_video_size_changed"})
   # One strictly allowlisted filename; no shell expansion or source paths.
   result=adb("shell","rm",full,timeout=48)
   if result.returncode:
    return respond(self,503,{"ok":False,"error":"phone_delete_failed"})
   if stat_size(full) is not None:
    return respond(self,503,{"ok":False,"error":"phone_file_still_present"})
   known[name]={"deleted_at":dt.datetime.now(dt.timezone.utc).isoformat(),
                "size_bytes":expected,"method":"explicit_archive_ui"}
   try:save_deleted(known)
   except OSError:
    return respond(self,500,{"ok":False,"error":"video_deleted_but_archive_index_update_failed"})
   return respond(self,200,{"ok":True,"deleted":True,"archive_mode":"S9-microSD-only",
                            "clip_no":name,"bytes_freed":expected,
                            "original_file_deleted":True})
 handler_class.do_POST=post
 return filter_rows(current_rows)
