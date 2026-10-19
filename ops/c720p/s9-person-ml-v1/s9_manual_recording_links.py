#!/usr/bin/env python3
"""Audited manual folder links for S9+ originals and verified historic Drive MP4s.

Independent, non-biometric *review assignments*, deliberately separate from
the v40 person detector's immutable audit history. Supports explicit return
to queue even for a prior v40 approval; original approval remains in history
but the new overlay is authoritative for the People & Faces UI. No media writes.
"""
from pathlib import Path
import datetime as dt
import fcntl
import json
import os
import re
import tempfile
from urllib.parse import urlsplit

BASE=Path("/home/jespern/c720p-home-hub")
STORE=BASE/"state/s9-manual-recording-links-v1.json"
AUDIT=BASE/"state/s9-manual-recording-links-v1.audit.jsonl"
LOCK=BASE/"state/s9-manual-recording-links-v1.lock"
DRIVE=BASE/"state/drive-security-archive.json"
ROUTE="/new/api/s9-manual-recording-links"
WRITE="/new/api/s9-manual-recording-links"
WORKFLOW="manual_recording_links_v1"
FILING_REVIEW_VERSION=66
INTENT="manual-original-review-links-v1"
CLIP=re.compile(r"motion_[0-9]{13}[.]mp4\Z")
REMOTE=re.compile(r"[A-Za-z0-9._-]{1,180}[.]mp4\Z")
FOLDER=re.compile(r"[A-Za-z0-9_-]{1,100}\Z")
ORIGINS={"https://kalenel.nl","https://www.kalenel.nl",
         "http://localhost","http://127.0.0.1",
         "http://localhost:8123","http://127.0.0.1:8123"}

def initial():return {"version":1,"revision":0,"items":{}}

def current():
 if STORE.is_symlink():raise RuntimeError("store_symlink")
 if not STORE.exists():return initial()
 if STORE.stat().st_size>500_000:raise RuntimeError("store_too_large")
 doc=json.loads(STORE.read_text(encoding="utf-8"))
 if (not isinstance(doc,dict) or doc.get("version")!=1
     or type(doc.get("revision")) is not int or doc["revision"]<0
     or not isinstance(doc.get("items"),dict)
     or len(doc["items"])>10000):raise RuntimeError("store_corrupt")
 return doc

def atomic(doc):
 STORE.parent.mkdir(parents=True,exist_ok=True)
 data=json.dumps(doc,sort_keys=True,separators=(",",":")).encode()
 if len(data)>500_000:raise RuntimeError("store_limit")
 fd,tmp=tempfile.mkstemp(prefix=".s9-links-",dir=STORE.parent)
 try:
  os.fchmod(fd,0o600)
  with os.fdopen(fd,"wb") as f:
   f.write(data);f.flush();os.fsync(f.fileno())
  os.replace(tmp,STORE)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)

def drive_verified(name):
 if DRIVE.is_symlink() or not DRIVE.is_file() or DRIVE.stat().st_size>6_000_000:
  return False
 doc=json.loads(DRIVE.read_text(encoding="utf-8"))
 for row in doc.get("items",[]):
  if (isinstance(row,dict) and row.get("remote_name")==name and
      row.get("state")=="verified" and
      type(row.get("size")) is int and row["size"]>=10000):
   return True
 return False

def source_known(source,name,sd_names):
 if source=="sd":
  return bool(CLIP.fullmatch(name) and name in sd_names)
 if source=="drive":
  return bool(REMOTE.fullmatch(name) and ".." not in name and drive_verified(name))
 return False

def report():
 data=current()
 return {"ok":True,"revision":data["revision"],"items":data["items"],
   "manual_links_only":True,"automatic_identity_matching":False}

def mutate(body,sd_names):
 if not isinstance(body,dict) or set(body)!={"action","source","name","folder","revision","human_confirmed"}:
  return 400,{"ok":False,"error":"wrong_fields"}
 action,source,name=body["action"],body["source"],body["name"]
 if action not in ("assign","return_to_queue","skip","reject"):
  return 400,{"ok":False,"error":"wrong_action"}
 if not isinstance(name,str) or not source_known(source,name,sd_names):
  return 404,{"ok":False,"error":"source_not_in_verified_archive"}
 if body["human_confirmed"] is not True:
  return 400,{"ok":False,"error":"human_review_required"}
 folder=body["folder"]
 if action=="assign" and (not isinstance(folder,str) or not FOLDER.fullmatch(folder)):
  return 400,{"ok":False,"error":"unknown_folder_format"}
 if action!="assign" and folder is not None:
  return 400,{"ok":False,"error":"return_requires_null_folder"}
 if type(body["revision"]) is not int:
  return 400,{"ok":False,"error":"revision_required"}
 LOCK.parent.mkdir(parents=True,exist_ok=True)
 if LOCK.is_symlink() or AUDIT.is_symlink():return 503,{"ok":False,"error":"unsafe_metadata_path"}
 with LOCK.open("a+") as lock:
  os.chmod(LOCK,0o600);fcntl.flock(lock,fcntl.LOCK_EX)
  before=current()
  if before["revision"]!=body["revision"]:
   return 409,{"ok":False,"error":"review_revision_changed"}
  key=source+":"+name
  old=before["items"].get(key)
  entry={"folder":folder if action=="assign" else None,
         "source":source,"name":name,
         "review_status":{"assign":"assigned","return_to_queue":"inbox",
                          "skip":"skipped","reject":"rejected"}[action]}
  updated={"version":1,"revision":before["revision"]+1,
           "items":{**before["items"],key:entry}}
  log={"at":dt.datetime.now(dt.timezone.utc).isoformat(),"source":source,
       "name":name,"from":old.get("folder") if isinstance(old,dict) else None,
       "to":entry["folder"],"revision":updated["revision"],
       "manual":True,"action":action,"from_review_status":
       old.get("review_status") if isinstance(old,dict) else None,
       "to_review_status":entry["review_status"]}
  try:
   atomic(updated)
   fd=os.open(AUDIT,os.O_CREAT|os.O_APPEND|os.O_WRONLY|os.O_NOFOLLOW,0o600)
   try:
    with os.fdopen(fd,"a",encoding="utf-8") as f:
     f.write(json.dumps(log,sort_keys=True)+"\n");f.flush();os.fsync(f.fileno())
   except BaseException:
    atomic(before);raise
  except OSError:return 503,{"ok":False,"error":"metadata_persistence_failed"}
  # Confirm the persisted source-qualified entry before acknowledging the save.
  saved=current()
  if saved["revision"]!=updated["revision"] or saved["items"].get(key)!=entry:
   return 503,{"ok":False,"error":"persisted_assignment_not_verified"}
  return 200,{"ok":True,"revision":updated["revision"],"source":source,"name":name,
    "folder":entry["folder"],"review_status":entry["review_status"],
    "persisted":True,"manual_links_only":True}

def install(H,sd_names):
 previous_get=H.go
 previous_post=H.do_POST
 def get(self):
  route=urlsplit(self.path)
  if route.path!=ROUTE or route.query:
   return previous_get(self)
  if self.command=="HEAD":return self.js(200,{"ok":True})
  try:self.js(200,report())
  except (OSError,ValueError,RuntimeError,TypeError):
   self.js(503,{"ok":False,"error":"manual_link_registry_unavailable"})
 def post(self):
  route=urlsplit(self.path)
  if route.path!=WRITE or self.headers.get("X-S9-Manual-Link-Intent")!=INTENT:
   return previous_post(self)
  if "application/json" not in self.headers.get("Content-Type","").lower():
   return self.js(415,{"ok":False,"error":"json_only"})
  origin=self.headers.get("Origin","").strip()
  if origin and origin not in ORIGINS:
   return self.js(403,{"ok":False,"error":"cross_origin_blocked"})
  if self.headers.get("Sec-Fetch-Site","") not in ("","same-origin","none"):
   return self.js(403,{"ok":False,"error":"cross_site_blocked"})
  try:
   size=int(self.headers.get("Content-Length","0"))
   if not 35<=size<=1400:raise ValueError("body_size")
   body=json.loads(self.rfile.read(size))
   code,result=mutate(body,sd_names())
   self.js(code,result)
  except (ValueError,TypeError,RuntimeError,OSError):
   self.js(400,{"ok":False,"error":"invalid_manual_assignment"})
 H.go=get
 H.do_POST=post
