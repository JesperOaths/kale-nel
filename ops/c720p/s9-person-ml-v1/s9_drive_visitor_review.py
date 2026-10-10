"""Private, human-confirmed visitor IDs for old verified Drive security clips.

No automatic cross-video person identification, facial recognition or embeddings.
Visitor IDs are stable only after a viewer checks the original Drive video.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import threading
from urllib.parse import urlsplit

BASE=Path("/home/jespern/c720p-home-hub")
CAT=BASE/"state/s9-legacy-person-catalog.json"
INDEX=BASE/"state/drive-security-archive.json"
CONFIG=BASE/"config/drive-security-archive.json"
STORE=BASE/"state/s9-manually-verified-visitors.json"
AUDIT=BASE/"state/s9-manually-verified-visitors-audit.jsonl"
LOCK=threading.RLock()
DIGEST=re.compile(r"[0-9a-f]{64}\Z")
VISITOR=re.compile(r"VIS-[0-9]{4,6}\Z")
ALLOWED={"single_person_event_candidate","possible_person_needs_review"}
ORIGINS={"https://kalenel.nl","https://www.kalenel.nl","http://localhost","http://127.0.0.1"}

def jsonfile(p,default):
 try:
  d=json.loads(p.read_text())
  return d if isinstance(d,dict) else default
 except (OSError,ValueError,TypeError):return default

def verified_keys():
 d=jsonfile(INDEX,{})
 keys=set()
 for item in d.get("items",[]):
  if not isinstance(item,dict) or item.get("state")!="verified":continue
  cam=item.get("camera");name=item.get("remote_name")
  if cam not in ("new","s3") or not isinstance(name,str):continue
  keys.add(hashlib.sha256((cam+"\0"+name).encode()).hexdigest())
 return keys

def source_rows():
 valid=verified_keys()
 doc=jsonfile(CAT,{})
 entries={}
 for key,src in doc.get("items",{}).items():
  if not isinstance(src,dict) or key not in valid or not DIGEST.fullmatch(key):continue
  if src.get("status")!="classified" or src.get("clip_id")!=key:continue
  entries[key]=src
 return entries,doc.get("summary",{})

def registry():
 data=jsonfile(STORE,{"version":1,"next_id":1,"links":{},"visitors":{}})
 if data.get("version")!=1 or not isinstance(data.get("links"),dict) or not isinstance(data.get("visitors"),dict):
  return {"version":1,"next_id":1,"links":{},"visitors":{}}
 return data

def atomic_save(doc):
 STORE.parent.mkdir(parents=True,exist_ok=True)
 tmp=STORE.with_suffix(".json.tmp")
 with tmp.open("w") as out:
  json.dump(doc,out,sort_keys=True,separators=(",",":"))
  out.write("\n");out.flush();os.fsync(out.fileno())
 os.chmod(tmp,0o600);os.replace(tmp,STORE)

def audit_line(entry):
 AUDIT.parent.mkdir(parents=True,exist_ok=True)
 with AUDIT.open("a") as f:
  f.write(json.dumps(entry,separators=(",",":"),sort_keys=True)+"\n")
  f.flush();os.fsync(f.fileno())
 os.chmod(AUDIT,0o600)

def sampled_person_presence_percent(row):
 """Share of sampled frames with a >=0.50 person detection, not continuous coverage."""
 frames=row.get("sampled_frames")
 observed=row.get("person_frame_count")
 if (isinstance(frames,bool) or not isinstance(frames,int) or frames<1 or frames>120 or
     isinstance(observed,bool) or not isinstance(observed,int) or not 0<=observed<=frames):
  return None
 return round(100*observed/frames,1)

def report():
 import s9_appearance_review
 rows,summary=source_rows()
 doc=registry()
 links=doc["links"]
 config=jsonfile(CONFIG,{})
 folders={}
 for cam in ("new","s3"):
  item=config.get("folders",{}).get(cam,{})
  folder=item.get("id")
  if isinstance(folder,str) and re.fullmatch(r"[A-Za-z0-9_-]{15,120}",folder):
   folders[cam]="https://drive.google.com/drive/folders/"+folder
 out=[]
 for key,r in sorted(rows.items(),key=lambda p:(p[1].get("person_score",0),p[1].get("remote_name","")),reverse=True):
  who=links.get(key)
  if who not in doc["visitors"]:who=None
  suggestions=s9_appearance_review.candidates(r,rows.values(),max_result=3)
  out.append({"clip_id":key,"camera":r.get("camera"),
    "remote_name":r.get("remote_name"),"category":r.get("category"),
    "person_score":r.get("person_score"),
    "sampled_frames":r.get("sampled_frames"),
    "person_detected_frames_050":r.get("person_frame_count"),
    "person_presence_percent":sampled_person_presence_percent(r),
    "max_simultaneous_person_boxes":r.get("max_simultaneous_person_boxes"),
    "visitor_id":who,"appearance_quality":r.get("appearance_quality","not_evaluated"),
    "possible_same_outfit_clips":suggestions,
    "eligible_for_one_person_link":r.get("category") in ALLOWED,
    "human_confirmed":bool(who),"model_prediction_not_ground_truth":True})
 return {"ok":True,"version":1,"scope":"verified_legacy_drive_clips_only",
  "model_identities_are_not_verified":True,
  "persistent_visitor_ids_require_manual_clip_confirmation":True,
  "automatic_identity":"not_available_outfit_similarity_review_only",
  "processed":len(rows),"summary":summary,
  "drive_folders":folders,
  "visitor_ids":sorted(doc["visitors"]),
  "reviewed_single_person_links":sum(bool(x["visitor_id"]) for x in out),
  "clips":out}

def save_link(clip_id,action,visitor_id,human_confirmed):
 if not isinstance(clip_id,str) or not DIGEST.fullmatch(clip_id):
  return 400,{"ok":False,"error":"invalid_clip_digest"}
 if action not in ("create","link","unlink") or (action!="unlink" and human_confirmed is not True):
  return 400,{"ok":False,"error":"manual_confirmation_required"}
 if action=="link" and (not isinstance(visitor_id,str) or not VISITOR.fullmatch(visitor_id)):
  return 400,{"ok":False,"error":"invalid_visitor_id"}
 if action in ("create","unlink") and visitor_id is not None:
  return 400,{"ok":False,"error":"unexpected_visitor_id"}
 with LOCK:
  src=source_rows()[0].get(clip_id)
  if not src:return 404,{"ok":False,"error":"verified_classified_clip_not_found"}
  if action!="unlink" and src.get("category") not in ALLOWED:
   return 409,{"ok":False,"error":"group_or_non_person_clip_requires_individual_frame_review"}
  before=registry()
  d=json.loads(json.dumps(before))
  old=d["links"].get(clip_id)
  now=datetime.datetime.now(datetime.timezone.utc).isoformat()
  if action=="create":
   n=int(d.get("next_id",1))
   if not 1<=n<=999999:return 503,{"ok":False,"error":"visitor_registry_exhausted"}
   visitor_id=f"VIS-{n:04d}"
   d["next_id"]=n+1
   d["visitors"][visitor_id]={"created_at":now,"method":"human_confirmed","no_biometric_profile":True}
   d["links"][clip_id]=visitor_id
  elif action=="link":
   if visitor_id not in d["visitors"]:
    return 404,{"ok":False,"error":"visitor_id_not_found"}
   d["links"][clip_id]=visitor_id
  else:
   d["links"].pop(clip_id,None)
  try:
   atomic_save(d)
   audit_line({"utc":now,"clip_id":clip_id,"action":action,"previous_id":old,
               "current_id":d["links"].get(clip_id),
               "manual_confirmation":human_confirmed is True})
  except OSError:
   atomic_save(before)
   return 503,{"ok":False,"error":"registry_write_failed"}
 return 200,{"ok":True,"clip_id":clip_id,"visitor_id":d["links"].get(clip_id),
             "manual_human_link_only":True}

def install(H):
 old_get=H.go
 old_post=H.do_POST
 route="/new/api/drive-person-review"
 def get(self):
  if urlsplit(self.path).path==route:
   self.js(200,report());return
  return old_get(self)
 def post(self):
  if urlsplit(self.path).path!=route:return old_post(self)
  if self.headers.get("X-S9-Visitor-Intent")!="manual-confirmed-visitor-v1":
   self.js(403,{"ok":False,"error":"explicit_intent_required"});return
  if "application/json" not in self.headers.get("Content-Type","").lower():
   self.js(415,{"ok":False,"error":"json_content_type_required"});return
  origin=self.headers.get("Origin","").strip()
  if origin and origin not in ORIGINS:
   self.js(403,{"ok":False,"error":"cross_origin_write_disallowed"});return
  try:
   n=int(self.headers.get("Content-Length","0"))
   if not 2<=n<=800:raise ValueError("size")
   body=json.loads(self.rfile.read(n))
   if not isinstance(body,dict) or set(body)!={"clip_id","action","visitor_id","human_confirmed"}:
    raise ValueError("shape")
  except (ValueError,TypeError,UnicodeError):
   self.js(400,{"ok":False,"error":"invalid_request_json"});return
  self.js(*save_link(body["clip_id"],body["action"],body["visitor_id"],body["human_confirmed"]))
 H.go=get;H.do_POST=post
