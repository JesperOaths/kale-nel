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
import importlib.util
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

def binding_protocol():
 # Import only when a separately verified original-byte attestor is installed.
 # Historical/manual legacy entry points cannot silently demand a new service.
 path=Path(__file__).with_name("s9_manual_media_digest_binding_v1.py")
 if path.is_symlink() or not path.is_file():
  raise RuntimeError("trusted_original_binding_module_missing")
 spec=importlib.util.spec_from_file_location("manual_original_binding_v1",path)
 module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
 return module

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

def report(attestor=None):
 # Public authenticated review readers need status, group folders and latest
 # manual authority, NOT original SHA, immutable media ID, revision or any
 # private byte-attestor details. Historical unbound stays authoritative.
 data=current()
 categories=("bound","historically_unbound","source_unavailable",
             "revision_mismatch")
 counts={name:0 for name in categories}
 items={}
 protocol=None
 for key,stored in data["items"].items():
  if not isinstance(stored,dict):raise RuntimeError("manual_entry_invalid")
  binding=stored.get("media_binding")
  if not isinstance(binding,dict) or binding.get("status")!="bound_at_decision":
   status="historically_unbound"
  elif attestor is None:
   status="source_unavailable"
  else:
   if protocol is None:protocol=binding_protocol()
   status=protocol.display_status(stored,attestor)
  if status not in counts:raise RuntimeError("untrusted_binding_state")
  counts[status]+=1
  # Keep all existing manual fields except private original-byte evidence.
  public={field:value for field,value in stored.items() if field!="media_binding"}
  public["media_binding_status"]=status
  items[key]=public
 return {"ok":True,"revision":data["revision"],"items":items,
   "manual_links_only":True,"automatic_identity_matching":False,
   "manual_digest_status":{"schema_version":"manual_digest_status_v1",
     "counts":counts,"historical_authority_preserved":True,
     "digest_backfill_performed":False,"reviews_reopened":False}}

def mutate(body,sd_names,attestor=None,require_binding=False):
 if not isinstance(body,dict):
  return 400,{"ok":False,"error":"wrong_fields"}
 multi=body.get("action")=="assign_many"
 expected={"action","source","name","folder","revision","human_confirmed"}
 if multi:expected.add("folders")
 if set(body)!=expected:
  return 400,{"ok":False,"error":"wrong_fields"}
 action,source,name=body["action"],body["source"],body["name"]
 if action not in ("assign","assign_many","return_to_queue","skip","reject"):
  return 400,{"ok":False,"error":"wrong_action"}
 if not isinstance(name,str) or not source_known(source,name,sd_names):
  return 404,{"ok":False,"error":"source_not_in_verified_archive"}
 if body["human_confirmed"] is not True:
  return 400,{"ok":False,"error":"human_review_required"}
 folder=body["folder"]
 if action=="assign" and (not isinstance(folder,str) or not FOLDER.fullmatch(folder)):
  return 400,{"ok":False,"error":"unknown_folder_format"}
 if action=="assign_many":
  selected=body["folders"]
  if (not isinstance(selected,list) or not 1<=len(selected)<=8 or
      any(not isinstance(x,str) or not FOLDER.fullmatch(x) for x in selected) or
      len(set(selected))!=len(selected) or folder!=selected[0]):
   return 400,{"ok":False,"error":"invalid_multi_person_selection"}
 elif action=="assign":selected=[folder]
 else:
  if folder is not None:return 400,{"ok":False,"error":"return_requires_null_folder"}
  selected=[]
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
  # A verified current/previous binding can NEVER be silently discarded
  # by the legacy writer. New original-byte proof is opt-in until the
  # separately trusted SD+Drive byte-hash attestor has physically passed.
  if attestor is None and (require_binding or
      isinstance(old,dict) and "media_binding" in old):
   return 503,{"ok":False,"error":"independent_media_digest_required"}
  binding=None
  if attestor is not None:
   try:
    binding_module_=binding_protocol()
    binding=binding_module_.bind_new_decision(source,name,attestor)
    binding_module_.require_unchanged(binding,attestor)
   except (OSError,ValueError,RuntimeError) as error:
    return 503,{"ok":False,"error":"original_digest_unavailable"}
   except Exception as error:
    # Includes stale/replaced original revision, with no state mutation.
    return 409,{"ok":False,"error":"original_digest_or_revision_unverified"}
  entry={"folder":selected[0] if selected else None,
         "folders":selected,
         "source":source,"name":name,
         "review_status":{"assign":"assigned","assign_many":"assigned",
                          "return_to_queue":"inbox","skip":"skipped","reject":"rejected"}[action]}
  if binding is not None:entry["media_binding"]=binding
  updated={"version":1,"revision":before["revision"]+1,
           "items":{**before["items"],key:entry}}
  log={"at":dt.datetime.now(dt.timezone.utc).isoformat(),"source":source,
       "name":name,"from":old.get("folder") if isinstance(old,dict) else None,
       "to":entry["folder"],"to_folders":selected,"revision":updated["revision"],
       "manual":True,"action":action,"from_review_status":
       old.get("review_status") if isinstance(old,dict) else None,
       "to_review_status":entry["review_status"]}
  if binding is not None:log["media_binding"]=binding
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
    "folder":entry["folder"],"folders":list(selected),
    "review_status":entry["review_status"],
    "persisted":True,"manual_links_only":True,
    "media_binding_status":"bound" if binding is not None else "historically_unbound"}

def install(H,sd_names,attestor=None,require_binding=False):
 previous_get=H.go
 previous_post=H.do_POST
 def get(self):
  route=urlsplit(self.path)
  if route.path!=ROUTE or route.query:
   return previous_get(self)
  if self.command=="HEAD":return self.js(200,{"ok":True})
  try:self.js(200,report(attestor=attestor))
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
   code,result=mutate(body,sd_names(),attestor=attestor,require_binding=require_binding)
   self.js(code,result)
  except (ValueError,TypeError,RuntimeError,OSError):
   self.js(400,{"ok":False,"error":"invalid_manual_assignment"})
 H.go=get
 H.do_POST=post
