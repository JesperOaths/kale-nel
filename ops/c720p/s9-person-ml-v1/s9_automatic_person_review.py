#!/usr/bin/env python3
"""Private face-match proposal review; never auto-assign a recording."""
import datetime as dt
import fcntl
import hashlib
import json
import os
import re
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

STATE=Path("/home/jespern/c720p-home-hub/state")
SOURCE=STATE/"s9-auto-person-face-proposals-v1.json"
REJECTED=STATE/"s9-auto-person-rejections-v1.json"
LOCK=STATE/"s9-auto-person-rejections-v1.lock"
AUDIT=STATE/"s9-auto-person-rejections-v1.audit.jsonl"
ROUTE="/new/api/automatic-person"
INTENT="human-automatic-person-denial-v1"
CLIP=re.compile(r"motion_[0-9]{13}[.]mp4\Z")
HASH=re.compile(r"[0-9a-f]{64}\Z")
FOLDER=re.compile(r"[A-Za-z0-9_-]{1,100}\Z")
ORIGINS={"https://kalenel.nl","https://www.kalenel.nl","http://localhost","http://127.0.0.1"}

def state():
 if REJECTED.is_symlink():raise ValueError("unsafe_path")
 if not REJECTED.exists():return {"version":1,"revision":0,"denied":[]}
 if REJECTED.stat().st_size>200000:raise ValueError("oversized_reviews")
 d=json.loads(REJECTED.read_text())
 if d.get("version")!=1 or type(d.get("revision"))!=int or not isinstance(d.get("denied"),list):
  raise ValueError("invalid_review_state")
 if len(d["denied"])>5000 or any(not isinstance(x,str) or not HASH.fullmatch(x) for x in d["denied"]):
  raise ValueError("invalid_denials")
 return d

def proposals():
 if SOURCE.is_symlink():raise ValueError("unsafe_proposals_path")
 if not SOURCE.is_file():return [],"face_embedding_index_not_ready"
 if SOURCE.stat().st_size>1400000:raise ValueError("too_many_proposals")
 doc=json.loads(SOURCE.read_text())
 if doc.get("version")!=1 or doc.get("origin")!="s9_offline_aligned_face_embeddings" or not HASH.fullmatch(str(doc.get("model_sha256",""))):
  raise ValueError("unverified_face_model")
 rows=doc.get("suggestions")
 if not isinstance(rows,list) or len(rows)>2500:raise ValueError("invalid_proposals")
 verified=[];seen=set()
 for x in rows:
  if not isinstance(x,dict):continue
  if x.get("source")!="sd" or not CLIP.fullmatch(str(x.get("name",""))):continue
  if not FOLDER.fullmatch(str(x.get("folder",""))):continue
  if x.get("model_sha256")!=doc["model_sha256"] or not HASH.fullmatch(str(x.get("snapshot_sha256",""))):continue
  if x.get("aligned_face") is not True or x.get("human_confirmed_reference") is not True:continue
  if x.get("pair_score_origin")!="s9_local_exact_face_pair_score_v1":continue
  if type(x.get("reference_count"))!=int or x["reference_count"]<2:continue
  if type(x.get("score")) not in (int,float) or type(x.get("margin")) not in (int,float):continue
  if not 0.84<=x["score"]<=1 or not 0.08<=x["margin"]<=1:continue
  digest=hashlib.sha256(("sd|"+x["name"]+"|"+x["folder"]+"|"+
    x["snapshot_sha256"]+"|"+doc["model_sha256"]).encode()).hexdigest()
  if digest in seen:continue
  seen.add(digest)
  verified.append({"id":digest,"source":"sd","name":x["name"],"folder":x["folder"],
   "score":x["score"],"margin":x["margin"],"reference_count":x["reference_count"],
   "model_origin":"S9+ aligned face embeddings","human_approved":False})
 return verified,"ready"

def report(sd_names,manual_links):
 rows,status=proposals();rejected=state();denied=set(rejected["denied"]);visible=[]
 used=set()
 for x in sorted(rows,key=lambda x:(-x["score"],-x["margin"])):
  if x["name"] not in sd_names or x["id"] in denied or x["name"] in used:continue
  if (manual_links.get("sd:"+x["name"]) or {}).get("folder"):continue
  used.add(x["name"]);visible.append(x)
 return {"ok":True,"status":status,"items":visible[:500],
  "revision":rejected["revision"],"human_approval_required":True,
  "automatic_assignments":False,"face_vectors_exported":False}

def save(doc):
 STATE.mkdir(parents=True,exist_ok=True)
 payload=json.dumps(doc,sort_keys=True).encode()
 if len(payload)>200000:raise ValueError("review_store_limit")
 fd,tmp=tempfile.mkstemp(prefix=".auto-person-",dir=STATE)
 try:
  os.fchmod(fd,0o600)
  with os.fdopen(fd,"wb") as f:f.write(payload);f.flush();os.fsync(f.fileno())
  os.replace(tmp,REJECTED)
 finally:
  if os.path.exists(tmp):os.unlink(tmp)

def deny(body,sd_names,links):
 if not isinstance(body,dict) or set(body)!={"action","id","revision","human_confirmed"} or body.get("action")!="deny" or body.get("human_confirmed") is not True:
  return 400,{"ok":False,"error":"manual_denial_required"}
 if not isinstance(body.get("id"),str) or not HASH.fullmatch(body["id"]) or type(body.get("revision"))!=int:
  return 400,{"ok":False,"error":"invalid_revision_or_id"}
 if LOCK.is_symlink() or AUDIT.is_symlink():return 503,{"ok":False,"error":"unsafe_storage"}
 STATE.mkdir(parents=True,exist_ok=True)
 with LOCK.open("a+") as handle:
  os.chmod(LOCK,0o600);fcntl.flock(handle,fcntl.LOCK_EX)
  old=state()
  if old["revision"]!=body["revision"]:return 409,{"ok":False,"error":"review_changed_refresh"}
  candidate=next((x for x in report(sd_names,links)["items"] if x["id"]==body["id"]),None)
  if not candidate:return 404,{"ok":False,"error":"proposal_not_available"}
  updated={"version":1,"revision":old["revision"]+1,"denied":old["denied"]+[body["id"]]}
  try:
   save(updated)
   fd=os.open(AUDIT,os.O_CREAT|os.O_APPEND|os.O_WRONLY|os.O_NOFOLLOW,0o600)
   with os.fdopen(fd,"a") as f:
    f.write(json.dumps({"at":dt.datetime.now(dt.timezone.utc).isoformat(),
      "proposal_id":body["id"],"human_denied":True})+"\n")
    f.flush();os.fsync(f.fileno())
  except OSError:
   save(old);return 503,{"ok":False,"error":"denial_not_saved"}
  return 200,{"ok":True,"revision":updated["revision"],"decision":"denied"}

def install(H,sd_names):
 import s9_manual_recording_links as manual
 original_get,original_post=H.go,H.do_POST
 def get(self):
  route=urlsplit(self.path)
  if route.path!=ROUTE or route.query:return original_get(self)
  try:self.js(200,report(sd_names(),manual.current()["items"]))
  except (OSError,ValueError,TypeError):self.js(503,{"ok":False,"error":"suggestions_unavailable"})
 def post(self):
  route=urlsplit(self.path)
  if route.path!=ROUTE or route.query or self.headers.get("X-S9-Automatic-Person-Intent")!=INTENT:
   return original_post(self)
  if "application/json" not in self.headers.get("Content-Type","").lower():
   return self.js(415,{"ok":False,"error":"json_only"})
  origin=self.headers.get("Origin","").strip()
  if origin and origin not in ORIGINS:return self.js(403,{"ok":False,"error":"cross_origin_denied"})
  if self.headers.get("Sec-Fetch-Site","") not in ("","same-origin","none"):
   return self.js(403,{"ok":False,"error":"cross_site_denied"})
  try:
   n=int(self.headers.get("Content-Length","0"))
   if not 45<=n<=700:raise ValueError("size")
   code,value=deny(json.loads(self.rfile.read(n)),sd_names(),manual.current()["items"])
   self.js(code,value)
  except (ValueError,TypeError,OSError):self.js(400,{"ok":False,"error":"invalid_denial"})
 H.go,H.do_POST=get,post
