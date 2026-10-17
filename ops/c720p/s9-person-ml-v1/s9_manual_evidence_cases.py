"""Private S9+ manual evidence cases: recorded events, not biometric identities.

The only persistent records are case IDs, verified original-4K clip references,
human review status and their audit history. Original media and face model are
never read or changed. The outer hub relay already requires authentication.
"""
import datetime as dt
import json
import os
from pathlib import Path
import re
import tempfile
import threading
from urllib.parse import urlsplit

HOME=Path("/home/jespern/c720p-home-hub")
CAT=Path("/opt/homeassistant/config/www/frontyard-security-new/s9-phone-events.json")
STORE=HOME/"state/s9-manual-evidence-cases-v1.json"
AUDIT=HOME/"state/s9-manual-evidence-cases-audit-v1.jsonl"
LOCK=threading.RLock()
CLIP=re.compile(r"motion_[0-9]{13}[.]mp4\Z")
CASE=re.compile(r"CASE-[0-9]{4,6}\Z")
ORIGINS={"https://kalenel.nl","https://www.kalenel.nl",
         "http://127.0.0.1","http://localhost"}
MAX_CASES=250
MAX_LINKS=1000
MAX_CASE_CLIPS=128
ROUTE="/new/api/s9-evidence-cases"

def disk_json(path,default):
 try:
  result=json.loads(path.read_text(encoding="utf-8"))
  return result if isinstance(result,dict) else default
 except (FileNotFoundError,ValueError,TypeError,OSError):return default

def eligible():
 doc=disk_json(CAT,{})
 result={}
 for r in doc.get("phone_recordings",[]):
  if not isinstance(r,dict):continue
  name=r.get("name")
  size=r.get("size")
  if (not isinstance(name,str) or not CLIP.fullmatch(name)
      or r.get("sd_verified") is not True or r.get("resolution")!="3840x2160"
      or type(size) is not int or not 100000<=size<800000000):
   continue
  result[name]={"size":size,"timestamp":str(r.get("timestamp") or "")[:32]}
 return result

def empty():
 return {"version":1,"revision":0,"next_id":1,"cases":{}}

def validated_store():
 if STORE.exists():
  try:
   doc=json.loads(STORE.read_text(encoding="utf-8"))
  except (OSError,ValueError,UnicodeError):
   raise RuntimeError("case_registry_corrupted_refuse_overwrite")
  if not isinstance(doc,dict):raise RuntimeError("case_registry_not_an_object")
 else:doc=empty()
 if (doc.get("version")!=1 or type(doc.get("revision")) is not int
      or not 0<=doc["revision"]<=10000000
      or type(doc.get("next_id")) is not int
      or not 1<=doc["next_id"]<=999999
      or not isinstance(doc.get("cases"),dict)
      or len(doc["cases"])>MAX_CASES):
  raise RuntimeError("case_registry_invalid")
 count=0
 for ident,c in doc["cases"].items():
  if not CASE.fullmatch(ident) or not isinstance(c,dict):raise RuntimeError("case_invalid")
  if c.get("state") not in ("open","closed") or not isinstance(c.get("clips"),dict):
   raise RuntimeError("case_invalid_state")
  if len(c["clips"])>MAX_CASE_CLIPS:raise RuntimeError("case_over_capacity")
  for name,link in c["clips"].items():
   if (not CLIP.fullmatch(name) or not isinstance(link,dict)
       or type(link.get("source_size")) is not int
       or not 100000<=link["source_size"]<800000000
       or link.get("method")!="manually_reviewed_original"):
    raise RuntimeError("case_link_invalid")
   count+=1
 if count>MAX_LINKS:raise RuntimeError("case_link_over_capacity")
 return doc

def atomic_store(doc):
 STORE.parent.mkdir(parents=True,exist_ok=True)
 fd,filename=tempfile.mkstemp(prefix=".s9-case-v1-",dir=STORE.parent)
 try:
  with os.fdopen(fd,"w",encoding="utf-8") as f:
   json.dump(doc,f,separators=(",",":"),sort_keys=True)
   f.write("\n");f.flush();os.fsync(f.fileno())
  os.chmod(filename,0o600)
  os.replace(filename,STORE)
 finally:
  if os.path.exists(filename):os.unlink(filename)

def audit_append(row):
 AUDIT.parent.mkdir(parents=True,exist_ok=True)
 # Append durable metadata changes, never faces/frames, browser user IDs, IPs.
 with AUDIT.open("a",encoding="utf-8") as f:
  f.write(json.dumps(row,sort_keys=True,separators=(",",":"))+"\n")
  f.flush();os.fsync(f.fileno())
 os.chmod(AUDIT,0o600)

def report():
 doc=validated_store()
 valid=eligible()
 cases=[]
 active=set()
 for ident,c in sorted(doc["cases"].items()):
  clips=[]
  for name,v in sorted(c["clips"].items(),reverse=True):
   src=valid.get(name)
   available=bool(src and src["size"]==v["source_size"])
   if available:active.add(name)
   clips.append({"clip":name,"available":available,
    "manually_reviewed_original":True,"added_at":v.get("added_at")})
  cases.append({"id":ident,"state":c["state"],"created_at":c.get("created_at"),
   "updated_at":c.get("updated_at"),"clips":clips,
   "manual_collection_only":True,"identity_verified":False})
 return {"ok":True,"version":1,"revision":doc["revision"],
  "scope":"s9_microSD_verified_original_4k_only",
  "auto_identity":False,"manual_collection_only":True,
  "cases":cases,"total_cases":len(cases),"linked_available_clips":len(active),
  "reviewed_clips_not_in_any_case":sum(n not in active for n in valid)}

def mutate(data):
 if not isinstance(data,dict) or set(data)!={"action","case_id","clip","revision","confirmed"}:
  return 400,{"ok":False,"error":"invalid_request_shape"}
 action=data["action"]
 if action not in ("create","add","remove","close","reopen"):
  return 400,{"ok":False,"error":"invalid_action"}
 if data["confirmed"] is not True:
  return 400,{"ok":False,"error":"explicit_recording_review_required"}
 if type(data["revision"]) is not int or data["revision"]<0:
  return 400,{"ok":False,"error":"invalid_revision"}
 name=data["clip"]
 ident=data["case_id"]
 if action=="create" and ident is not None:return 400,{"ok":False,"error":"new_case_must_not_have_id"}
 if action!="create" and (not isinstance(ident,str) or not CASE.fullmatch(ident)):
  return 400,{"ok":False,"error":"invalid_case_id"}
 if action in ("create","add","remove"):
  if not isinstance(name,str) or not CLIP.fullmatch(name):
   return 400,{"ok":False,"error":"invalid_clip"}
 elif name is not None:return 400,{"ok":False,"error":"unexpected_clip"}
 with LOCK:
  old=validated_store()
  if data["revision"]!=old["revision"]:
   return 409,{"ok":False,"error":"case_review_changed_refresh","revision":old["revision"]}
  source=eligible()
  if action in ("create","add"):
   src=source.get(name)
   if not src:return 404,{"ok":False,"error":"original_4k_clip_not_verified"}
  work=json.loads(json.dumps(old))
  now=dt.datetime.now(dt.timezone.utc).isoformat()
  if action=="create":
   if len(work["cases"])>=MAX_CASES or work["next_id"]>999999:
    return 409,{"ok":False,"error":"case_limit_reached"}
   ident=f"CASE-{work['next_id']:04d}"
   work["next_id"]+=1
   work["cases"][ident]={"state":"open","created_at":now,"updated_at":now,"clips":{}}
  case=work["cases"].get(ident)
  if case is None:return 404,{"ok":False,"error":"case_not_found"}
  if action in ("create","add"):
   if case["state"]!="open":return 409,{"ok":False,"error":"case_closed"}
   if sum(len(c["clips"]) for c in work["cases"].values())>=MAX_LINKS and name not in case["clips"]:
    return 409,{"ok":False,"error":"registry_link_limit_reached"}
   if len(case["clips"])>=MAX_CASE_CLIPS and name not in case["clips"]:
    return 409,{"ok":False,"error":"case_full"}
   if any(name in c["clips"] for k,c in work["cases"].items() if k!=ident):
    return 409,{"ok":False,"error":"clip_already_in_other_case"}
   if (name in case["clips"] and
       case["clips"][name]["source_size"]==src["size"]):
    return 409,{"ok":False,"error":"duplicate_case_link"}
   case["clips"][name]={"source_size":src["size"],"added_at":now,
                         "method":"manually_reviewed_original"}
  elif action=="remove":
   if name not in case["clips"]:return 404,{"ok":False,"error":"clip_not_in_case"}
   case["clips"].pop(name)
  elif action=="close":
   if case["state"]=="closed":return 409,{"ok":False,"error":"already_closed"}
   case["state"]="closed"
  elif action=="reopen":
   if case["state"]=="open":return 409,{"ok":False,"error":"already_open"}
   case["state"]="open"
  case["updated_at"]=now
  work["revision"]+=1
  try:
   atomic_store(work)
   audit_append({"version":1,"utc":now,"revision":work["revision"],
    "action":action,"case_id":ident,"clip":name,"manual_confirmation":True})
  except OSError:
   atomic_store(old)
   return 503,{"ok":False,"error":"case_metadata_write_failed"}
  return 200,{"ok":True,"case_id":ident,"action":action,
   "revision":work["revision"],"no_identity_inferred":True}

def install(H):
 old_get=H.go
 old_post=H.do_POST
 def get(self):
  if urlsplit(self.path).path!=ROUTE:return old_get(self)
  if self.command=="HEAD":self.js(200,{"ok":True});return
  try:self.js(200,report())
  except (OSError,ValueError,TypeError,RuntimeError):
   self.js(503,{"ok":False,"error":"case_registry_unavailable"})
 def post(self):
  if urlsplit(self.path).path!=ROUTE:return old_post(self)
  if self.headers.get("X-S9-Case-Intent")!="manually-reviewed-evidence-v1":
   self.js(403,{"ok":False,"error":"intent_header_required"});return
  if "application/json" not in self.headers.get("Content-Type","").lower():
   self.js(415,{"ok":False,"error":"json_content_type_required"});return
  origin=self.headers.get("Origin","").strip()
  if origin and origin not in ORIGINS:
   self.js(403,{"ok":False,"error":"cross_origin_write_disallowed"});return
  if self.headers.get("Sec-Fetch-Site","").strip() not in ("","same-origin","none"):
   self.js(403,{"ok":False,"error":"cross_site_write_disallowed"});return
  try:
   length=int(self.headers.get("Content-Length","0"))
   if not 30<=length<=500:raise ValueError("invalid_content_length")
   request=json.loads(self.rfile.read(length))
  except (ValueError,TypeError,UnicodeError):
   self.js(400,{"ok":False,"error":"invalid_request_json"});return
  try:self.js(*mutate(request))
  except (OSError,TypeError,ValueError,RuntimeError):
   self.js(503,{"ok":False,"error":"case_registry_unavailable"})
 H.go=get
 H.do_POST=post
