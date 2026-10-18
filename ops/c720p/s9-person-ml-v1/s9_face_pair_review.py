"""Local, authenticated, human-only face-pair review. No biometric matching.

Capture subjective visual decisions about TWO original 4K recordings.  This
file deliberately does not write the Step 2 calibration corpus: a reviewed
pair is not a phone-scored, independently verified calibration example.
"""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import threading
from urllib.parse import urlsplit

HOME=Path("/home/jespern/c720p-home-hub")
CAT=Path("/opt/homeassistant/config/www/frontyard-security-new/s9-phone-events.json")
STORE=HOME/"state/s9-human-visual-face-pair-reviews-v1.json"
AUDIT=HOME/"state/s9-human-visual-face-pair-review-audit-v1.jsonl"
ROUTE="/new/api/s9-face-pair-review"
CLIP=re.compile(r"motion_[0-9]{13}[.]mp4\Z")
IMAGE=re.compile(r"motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg\Z")
SHA=re.compile(r"[0-9a-f]{64}\Z")
LOCK=threading.RLock()
CHOICES={"same_person","different_people","uncertain"}
ORIGINS={"https://kalenel.nl","https://www.kalenel.nl","http://127.0.0.1","http://localhost"}

def eligible():
 try:
  data=json.loads(CAT.read_text(encoding="utf-8"))
 except (OSError,ValueError,UnicodeError):
  raise RuntimeError("verified_catalog_unavailable")
 items={}
 for rec in data.get("phone_recordings",[]):
  if not isinstance(rec,dict):continue
  clip=rec.get("name")
  if (not isinstance(clip,str) or not CLIP.fullmatch(clip)
      or rec.get("sd_verified") is not True or rec.get("resolution")!="3840x2160"
      or type(rec.get("size")) is not int or rec["size"]<100000):
   continue
  for face in rec.get("face_candidates",[])[:48]:
   if not isinstance(face,dict):continue
   name=face.get("snapshot_name")
   if (not isinstance(name,str) or not IMAGE.fullmatch(name)
       or not name.startswith(clip[:-4]+"__")
       or face.get("snapshot_on_s9") is not True
       or type(face.get("snapshot_size")) is not int
       or not 2000<=face["snapshot_size"]<=2200000
       or not SHA.fullmatch(str(face.get("snapshot_sha256","")))):
    continue
   items[name]={"clip":clip,"snapshot_sha256":face["snapshot_sha256"],
                "clip_size":rec["size"]}
 return items

def pair_key(left,right):
 return hashlib.sha256(("\x00".join(sorted((left,right)))).encode()).hexdigest()

def empty():
 return {"version":1,"revision":0,"pairs":{}}

def read_store():
 if not STORE.exists():return empty()
 if STORE.is_symlink() or STORE.stat().st_size>1500000:raise RuntimeError("review_store_untrusted")
 try:doc=json.loads(STORE.read_text(encoding="utf-8"))
 except (OSError,ValueError,UnicodeError):raise RuntimeError("review_store_unreadable")
 if (not isinstance(doc,dict) or doc.get("version")!=1
     or type(doc.get("revision")) is not int or doc["revision"]<0
     or not isinstance(doc.get("pairs"),dict) or len(doc["pairs"])>5000):
  raise RuntimeError("review_store_invalid")
 for key,p in doc["pairs"].items():
  if (not SHA.fullmatch(str(key)) or not isinstance(p,dict)
      or p.get("decision") not in CHOICES or
      not isinstance(p.get("images"),list) or len(p["images"])!=2 or
      any(not isinstance(n,str) or not IMAGE.fullmatch(n) for n in p["images"]) or
      p["images"][0]>=p["images"][1] or
      pair_key(*p["images"])!=key or
      not isinstance(p.get("snapshots"),list) or len(p["snapshots"])!=2 or
      any(not SHA.fullmatch(str(h)) for h in p["snapshots"])):
   raise RuntimeError("review_pair_invalid")
 return doc

def write_atomic(doc):
 STORE.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
 if STORE.is_symlink():raise RuntimeError("review_store_symlink")
 fd,name=tempfile.mkstemp(prefix=".s9-face-pairs-",dir=STORE.parent)
 try:
  with os.fdopen(fd,"w",encoding="utf-8") as out:
   json.dump(doc,out,sort_keys=True,separators=(",",":"))
   out.write("\n");out.flush();os.fsync(out.fileno())
  os.chmod(name,0o600);os.replace(name,STORE)
 finally:
  if os.path.exists(name):os.unlink(name)

def report():
 with LOCK:
  doc=read_store()
  valid=eligible()
  results=[]
  for key,p in sorted(doc["pairs"].items(),key=lambda x:x[1].get("reviewed_at",""),reverse=True):
   images=p["images"]
   available=all(n in valid and valid[n]["snapshot_sha256"]==h
                 for n,h in zip(images,p["snapshots"]))
   results.append({"pair_id":key[:16],"left_image":images[0],
       "right_image":images[1],"decision":p["decision"],"available":available,
       "reviewed_at":p.get("reviewed_at"),"manual_visual_review_only":True})
  counts={choice:sum(p["decision"]==choice for p in doc["pairs"].values())
          for choice in sorted(CHOICES)}
  return {"ok":True,"revision":doc["revision"],"pairs":results[:5000],
          "counts":counts,"no_automatic_identity_matching":True,
          "not_qualified_model_calibration":True,"biometric_vectors_exported":False}

def mutate(body):
 if (not isinstance(body,dict) or set(body)!={"left_image","right_image",
       "decision","revision","left_original_viewed","right_original_viewed",
       "human_confirmed"}):
  return 400,{"ok":False,"error":"invalid_review_request"}
 a,b=body["left_image"],body["right_image"]
 if (not isinstance(a,str) or not isinstance(b,str) or
     not IMAGE.fullmatch(a) or not IMAGE.fullmatch(b) or a==b):
  return 400,{"ok":False,"error":"invalid_pair"}
 if (body["decision"] not in CHOICES or
     body["left_original_viewed"] is not True or
     body["right_original_viewed"] is not True or
     body["human_confirmed"] is not True):
  return 400,{"ok":False,"error":"explicit_originals_and_decision_required"}
 if type(body["revision"]) is not int:return 400,{"ok":False,"error":"invalid_revision"}
 left,right=sorted((a,b))
 if left.split("__",1)[0]==right.split("__",1)[0]:
  return 400,{"ok":False,"error":"independent_recordings_required"}
 with LOCK:
  doc=read_store()
  if body["revision"]!=doc["revision"]:
   return 409,{"ok":False,"error":"review_changed_refresh","revision":doc["revision"]}
  known=eligible()
  if left not in known or right not in known:
   return 404,{"ok":False,"error":"original_4k_face_evidence_unavailable"}
  key=pair_key(left,right)
  if key not in doc["pairs"] and len(doc["pairs"])>=5000:
   return 409,{"ok":False,"error":"private_review_limit_reached"}
  now=dt.datetime.now(dt.timezone.utc).isoformat(timespec="seconds")
  result={"images":[left,right],
          "snapshots":[known[left]["snapshot_sha256"],known[right]["snapshot_sha256"]],
          "decision":body["decision"],"reviewed_at":now}
  updated={"version":1,"revision":doc["revision"]+1,
           "pairs":dict(doc["pairs"])}
  updated["pairs"][key]=result
  if AUDIT.is_symlink():
   return 503,{"ok":False,"error":"audit_path_untrusted"}
  try:
   AUDIT.parent.mkdir(mode=0o700,parents=True,exist_ok=True)
   write_atomic(updated)
   with AUDIT.open("a",encoding="utf-8") as f:
    f.write(json.dumps({"utc":now,"pair_id":key[:16],
       "revision":updated["revision"],"decision":body["decision"],
       "human_original_review":True},sort_keys=True)+"\n")
    f.flush();os.fsync(f.fileno())
   os.chmod(AUDIT,0o600)
  except OSError:
   # If the append failed, restore the previous registry before reporting
   # failure. An unlogged decision must not silently become an approval.
   try:write_atomic(doc)
   except OSError:raise RuntimeError("review_audit_recovery_required")
   return 503,{"ok":False,"error":"local_review_persistence_failed"}
  return 200,{"ok":True,"revision":updated["revision"],
              "pair_id":key[:16],"manual_visual_review_only":True,
              "no_identity_grouping_enabled":True}

def install(H):
 old_get=H.go;old_post=H.do_POST
 def get(self):
  if urlsplit(self.path).path!=ROUTE:return old_get(self)
  if self.command=="HEAD":self.js(200,{"ok":True});return
  if self.command!="GET":
   self.js(405,{"ok":False,"error":"read_only_get"});return
  try:self.js(200,report())
  except (OSError,RuntimeError,ValueError,TypeError):
   self.js(503,{"ok":False,"error":"private_review_unavailable"})
 def post(self):
  if urlsplit(self.path).path!=ROUTE:return old_post(self)
  if self.headers.get("X-S9-Face-Pair-Intent")!="manual-originals-pair-v1":
   self.js(403,{"ok":False,"error":"explicit_review_intent_required"});return
  if "application/json" not in self.headers.get("Content-Type","").lower():
   self.js(415,{"ok":False,"error":"json_body_required"});return
  origin=self.headers.get("Origin","").strip()
  if origin and origin not in ORIGINS:
   self.js(403,{"ok":False,"error":"cross_origin_denied"});return
  if self.headers.get("Sec-Fetch-Site","").strip() not in ("","same-origin","none"):
   self.js(403,{"ok":False,"error":"cross_site_denied"});return
  try:
   size=int(self.headers.get("Content-Length","0"))
   if not 90<=size<=800:raise ValueError("invalid_body_size")
   payload=json.loads(self.rfile.read(size))
  except (OSError,ValueError,TypeError,UnicodeError):
   self.js(400,{"ok":False,"error":"invalid_json_request"});return
  try:self.js(*mutate(payload))
  except (OSError,RuntimeError,ValueError,TypeError):
   self.js(503,{"ok":False,"error":"private_review_unavailable"})
 H.go=get;H.do_POST=post
