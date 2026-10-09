"""S9 native clip THUMBNAIL-only human labels, isolated from model predictions.

Only the secure C720P archive proxy serves this extension. Labels are private
host metadata, bound to exact cached JPEG SHA-256, and cannot alter phone files.
"""
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import threading

ROOT=Path("/opt/homeassistant/config/www/frontyard-security-new")
CAT=ROOT/"s9-phone-events.json"
THUMBS=ROOT/"s9-phone-thumbs"
STORE=Path("/home/jespern/c720p-home-hub/state/s9-human-thumbnail-labels.json")
AUDIT=Path("/home/jespern/c720p-home-hub/state/s9-human-thumbnail-labels-audit.jsonl")
BENCH=Path("/home/jespern/c720p-home-hub/build/s9-detector-benchmark/results/ssd-vs-lite0-hub-cpu.json")
RECORDING=re.compile(r"motion_[0-9]{13}[.]mp4")
CHOICES={"person_visible","no_person_visible","uncertain"}
WRITE_LOCK=threading.RLock()
MODEL_SHAS={"ssd":"e4b118e5e4531945de2e659742c7c590f7536f8d0ed26d135abcfe83b4779d13",
            "lite0":"2e04c53bfeac0ac2a30c057c7e2a777594ce39baaac35a92f74fb1e8c4fc4e0b"}

def load_json(path,fallback):
 try:
  x=json.loads(path.read_text())
  return x if isinstance(x,dict) else fallback
 except (FileNotFoundError,ValueError,TypeError,OSError):
  return fallback

def eligible():
 doc=load_json(CAT,{})
 rows={}
 for entry in doc.get("phone_recordings",[]):
  if not isinstance(entry,dict):continue
  name=str(entry.get("name",""))
  if not RECORDING.fullmatch(name) or entry.get("sd_verified") is not True:continue
  thumb=entry.get("thumbnail")
  if thumb!="s9-phone-thumbs/"+name+".thumb.jpg":continue
  path=THUMBS/(name+".thumb.jpg")
  if path.is_symlink() or not path.is_file():continue
  try:
   b=path.read_bytes()
   if not 4000<len(b)<2200000 or not b.startswith(b"\xff\xd8\xff") or not b.endswith(b"\xff\xd9"):
    continue
  except OSError:continue
  rows[name]={
   "name":name,"timestamp":str(entry.get("timestamp") or "")[:32],
   "thumbnail":thumb,"sha256":hashlib.sha256(b).hexdigest(),
   "model_scene":str(entry.get("scene_category") or "unreviewed"),
   "sd_verified":True}
 return rows

def read_store():
 obj=load_json(STORE,{"version":1,"labels":{}})
 if obj.get("version")!=1 or not isinstance(obj.get("labels"),dict):
  return {"version":1,"labels":{}}
 return obj

def benchmarks(frames):
 doc=load_json(BENCH,{})
 groups=doc.get("per_image",{})
 if not isinstance(groups,dict):return {}
 # If the benchmark predates per-image image hashes, refuse to use it as
 # a ground-truth comparator. No guesses from filenames alone.
 out={}
 for model in ("ssd","lite0"):
  record=groups.get(model,{})
  if not isinstance(record,dict) or record.get("model_sha256")!=MODEL_SHAS[model]:
   continue
  predictions=record.get("frames",{})
  for name,r in frames.items():
   p=predictions.get(name+".thumb.jpg")
   if not isinstance(p,dict) or p.get("input_sha256")!=r["sha256"]:continue
   score=p.get("person_score")
   if isinstance(score,(float,int)) and 0<=float(score)<=1:
    out.setdefault(name,{})[model]=round(float(score),5)
 return out

def truth_metrics(frames,records):
 scored=benchmarks(frames)
 stats={}
 for model in ("ssd","lite0"):
  matched=[]
  for name,row in frames.items():
   x=records.get(name,{})
   if (x.get("sha256")==row["sha256"] and
       x.get("label") in ("person_visible","no_person_visible") and
       model in scored.get(name,{})):
    matched.append((x["label"]=="person_visible", scored[name][model]>=.5))
  tp=sum(a and b for a,b in matched);tn=sum(not a and not b for a,b in matched)
  fp=sum(not a and b for a,b in matched);fn=sum(a and not b for a,b in matched)
  positive=tp+fn;negative=tn+fp
  # Avoid claiming robust accuracy from a handful of hand-selected frames.
  eligible_estimate=positive>=5 and negative>=5
  stats[model]={"annotated_compared":len(matched),"human_positive":positive,
                "human_negative":negative,"tp":tp,"tn":tn,"fp":fp,"fn":fn,
                "preliminary":True,
                "sufficient_to_display_rates":eligible_estimate,
                "precision":round(tp/(tp+fp),3) if eligible_estimate and tp+fp else None,
                "recall":round(tp/positive,3) if eligible_estimate else None,
                "false_positive_rate":round(fp/negative,3) if eligible_estimate else None}
 return stats

def report():
 frames=eligible()
 store=read_store()
 labels=store["labels"]
 preds=benchmarks(frames)
 rows=[]
 counts={"person_visible":0,"no_person_visible":0,"uncertain":0,"unreviewed":0}
 for name,src in sorted(frames.items(),key=lambda t:t[0],reverse=True)[:120]:
  found=labels.get(name,{})
  if not isinstance(found,dict):found={}
  chosen=found.get("label") if found.get("sha256")==src["sha256"] else None
  if chosen not in CHOICES:chosen=None
  counts[chosen or "unreviewed"]+=1
  row=dict(src)
  row["human_label"]=chosen
  row["person_scores"]=preds.get(name,{})
  rows.append(row)
 return {"ok":True,"version":1,"archive_mode":"S9-microSD-only",
         "scope":"visible_content_of_single_thumbnail_not_entire_video",
         "review_method":"independent_manual_annotation_only",
         "total":len(rows),"counts":counts,"images":rows,
         "metrics":truth_metrics(frames,labels)}

def atomic_store(doc):
 STORE.parent.mkdir(parents=True,exist_ok=True)
 tmp=STORE.with_suffix(STORE.suffix+".tmp")
 with tmp.open("w") as f:
  json.dump(doc,f,separators=(",",":"),sort_keys=True);f.write("\n")
  f.flush();os.fsync(f.fileno())
 os.chmod(tmp,0o600)
 os.replace(tmp,STORE)

def save_label(name,digest,label):
 if not isinstance(name,str) or not RECORDING.fullmatch(name):
  return 400,{"ok":False,"error":"invalid_clip_name"}
 if not isinstance(digest,str) or not re.fullmatch("[a-f0-9]{64}",digest):
  return 400,{"ok":False,"error":"invalid_thumbnail_digest"}
 if not isinstance(label,str) or (label not in CHOICES and label!="clear"):
  return 400,{"ok":False,"error":"invalid_label"}
 with WRITE_LOCK:
  frames=eligible()
  src=frames.get(name)
  if not src:return 404,{"ok":False,"error":"not_verified_native_thumbnail"}
  if src["sha256"]!=digest:
   return 409,{"ok":False,"error":"thumbnail_changed_refresh_before_label"}
  original=read_store()
  previous=original["labels"].get(name)
  if label=="clear":
   original["labels"].pop(name,None)
  else:
   original["labels"][name]={"label":label,"sha256":digest,
      "updated_at":datetime.datetime.now(datetime.timezone.utc).isoformat()}
  # Commit current state first, audit append second; on audit error restore
  # via a new atomic state write and return explicit error.
  before=json.loads(json.dumps(read_store()))
  try:
   atomic_store(original)
   AUDIT.parent.mkdir(parents=True,exist_ok=True)
   with AUDIT.open("a") as out:
    event={"version":1,"clip":name,"sha256":digest,
      "before":previous.get("label") if isinstance(previous,dict) else None,
      "after":None if label=="clear" else label,
      "utc":datetime.datetime.now(datetime.timezone.utc).isoformat()}
    out.write(json.dumps(event,sort_keys=True,separators=(",",":"))+"\n")
    out.flush();os.fsync(out.fileno())
   os.chmod(AUDIT,0o600)
  except OSError:
   atomic_store(before)
   return 503,{"ok":False,"error":"label_storage_error"}
 return 200,{"ok":True,"name":name,"human_label":None if label=="clear" else label}

def install(H):
 old_get=H.go
 old_post=H.do_POST
 def get(self):
  if self.path.split("?",1)[0]=="/new/api/thumbnail-review":
   if self.command=="HEAD":self.js(200,{"ok":True});return
   self.js(200,report());return
  return old_get(self)
 def post(self):
  if self.path.split("?",1)[0]!="/new/api/thumbnail-review":
   return old_post(self)
  if self.headers.get("X-S9-Review-Intent")!="human-thumbnail-v1":
   self.js(403,{"ok":False,"error":"review_intent_header_required"});return
  if "application/json" not in self.headers.get("Content-Type","").lower():
   self.js(415,{"ok":False,"error":"json_only"});return
  origin=self.headers.get("Origin","").strip()
  if origin and origin not in ("https://kalenel.nl","https://www.kalenel.nl",
                                "http://localhost","http://127.0.0.1"):
   self.js(403,{"ok":False,"error":"origin_not_allowed"});return
  try:
   length=int(self.headers.get("Content-Length","0"))
   if length<2 or length>1024:raise ValueError("bad_length")
   obj=json.loads(self.rfile.read(length))
   if not isinstance(obj,dict) or set(obj)!={"name","sha256","label"}:
    raise ValueError("invalid_fields")
  except (TypeError,ValueError,UnicodeError):
   self.js(400,{"ok":False,"error":"invalid_json_payload"});return
  self.js(*save_label(obj["name"],obj["sha256"],obj["label"]))
 H.go=get
 H.do_POST=post
