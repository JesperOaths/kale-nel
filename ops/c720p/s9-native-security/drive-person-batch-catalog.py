#!/usr/bin/env python3
"""Read-only, resumable S9/S3 verified Drive security clip categorization.

The output is a PRIVATE metadata catalog. Model-detected people are NOT verified
identities, and no automated biometric matching is performed across recordings.
Zero MP4/JPEG files, embeddings, biometric templates or Drive writes.
"""
import argparse
import collections
import contextlib
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import time

ROOT=Path("/home/jespern/c720p-home-hub")
DATA=ROOT/"state/s9-legacy-person-catalog.json"
LOCK=ROOT/"state/s9-legacy-person-catalog.lock"
SOURCE=ROOT/"state/drive-security-archive.json"
CONFIG=ROOT/"config/drive-security-archive.json"
MODEL_CODE=Path(__file__).with_name("legacy-drive-person-corpus.py")
NAME=re.compile(r"(?:NEW|S3|S9PHONE)_[A-Za-z0-9._-]{8,165}[.]mp4\Z")
CAMERAS={"new":("NEW_","S9PHONE_"),"s3":("S3_",)}
MAX_SIZE=650*1024*1024
VERSION=1

def reader():
 spec=importlib.util.spec_from_file_location("legacy_ssd_corpus",MODEL_CODE)
 if not spec or not spec.loader:raise RuntimeError("pinned_decoder_missing")
 module=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(module)
 return module

def clip_key(camera,name):
 return hashlib.sha256((camera+"\0"+name).encode("utf-8")).hexdigest()

def original_verified():
 d=json.loads(SOURCE.read_text())
 arr={}
 for item in d.get("items",[]):
  if not isinstance(item,dict) or item.get("state")!="verified":continue
  camera=item.get("camera")
  name=item.get("remote_name")
  if camera not in CAMERAS or not isinstance(name,str):continue
  if not NAME.fullmatch(name) or not name.startswith(CAMERAS[camera]):continue
  try:size=int(item.get("size") or item.get("source_size") or 0)
  except (TypeError,ValueError):continue
  if not 100000<size<=MAX_SIZE:continue
  try:score=float(item.get("person_confidence") or 0)
  except (TypeError,ValueError):score=0.0
  if not 0<=score<=1:score=0.0
  key=clip_key(camera,name)
  arr[key]={"clip_id":key,"camera":camera,"remote_name":name,
            "size":size,"legacy_person_score":round(score,5),
            "legacy_person_status":str(item.get("person_status") or "not_human_verified")[:50],
            "archive_state":"verified"}
 return arr

def read_catalog():
 try:d=json.loads(DATA.read_text())
 except (OSError,ValueError):d={}
 if d.get("version")!=VERSION or not isinstance(d.get("items"),dict):
  d={"version":VERSION,"model_sha256":None,"items":{}}
 return d

def write_catalog(d):
 DATA.parent.mkdir(parents=True,exist_ok=True)
 t=DATA.with_suffix(".json.tmp")
 with t.open("w") as f:
  json.dump(d,f,ensure_ascii=False,separators=(",",":"),sort_keys=True)
  f.write("\n");f.flush();os.fsync(f.fileno())
 os.chmod(t,0o600);os.replace(t,DATA)

def create_stats(catalog,verified):
 items=catalog["items"]
 stats=collections.Counter(x.get("category","pending") for key,x in items.items()
    if key in verified and x.get("status")=="classified")
 scanned=sum(key in verified and x.get("status")=="classified" for key,x in items.items())
 errors=sum(key in verified and x.get("status")=="error" for key,x in items.items())
 return {"eligible":len(verified),"processed":scanned,"errors":errors,
         "remaining":max(0,len(verified)-scanned-errors),"categories":dict(stats),
         "person_identity":"unverified_not_matched_across_clips",
         "persistent_visitor_ids":"human_confirmed_links_only"}

def categorize_evidence(legacy,events):
 d=legacy.categorize(events)
 category=d["event_category"]
 if category=="unresolved_motion_or_non_person":
  if d["vehicle_score_peak"]>=.50:category="vehicle_candidate"
  elif d["animal_score_peak"]>=.50:category="animal_candidate"
  else:category="unresolved_motion"
 d["event_category"]=category
 return d

def sorted_candidates(verified,stored):
 pending=[]
 for k,src in verified.items():
  old=stored.get(k,{})
  if old.get("status")=="classified" and old.get("model_sha256") is not None:
   if old.get("category") not in ("single_person_event_candidate","possible_person_needs_review") or "appearance_quality" in old:
    continue
  if old.get("status")=="error" and int(old.get("attempts",0))>=2:
   continue
  pending.append(src)
 # Include one S3 recording early, then highest scored S9 clips, then negatives.
 pending.sort(key=lambda x:(
   x["camera"]!="s3", -x["legacy_person_score"], x["remote_name"]))
 return pending

def bootstrap_net(m):
 import numpy as np
 from ai_edge_litert.interpreter import Interpreter
 assert m.MODEL.is_file() and hashlib.sha256(m.MODEL.read_bytes()).hexdigest()==m.MODEL_SHA
 net=Interpreter(model_path=str(m.MODEL),num_threads=1)
 net.allocate_tensors()
 inp=net.get_input_details()[0]
 shape=tuple(map(int,inp["shape"]))
 if shape!=(1,300,300,3) or inp["dtype"]!=np.uint8:
  raise RuntimeError("unknown_ssd_input_contract")
 output={x["name"]:x["index"] for x in net.get_output_details()}
 needed=("TFLite_Detection_PostProcess","TFLite_Detection_PostProcess:1",
         "TFLite_Detection_PostProcess:2","TFLite_Detection_PostProcess:3")
 if any(x not in output for x in needed):raise RuntimeError("unknown_ssd_output_contract")
 return net,inp["index"],output,shape

def process_one(m,net,index,output,shape,cfg,src):
 key=src["clip_id"];cam=src["camera"];name=src["remote_name"]
 # Configure the rclone *read-only* source folder according to the camera.
 cc=dict(cfg)
 cc["folders"]=dict(cfg["folders"])
 cc["folders"]["new"]=cfg["folders"][cam]
 raw=m.decode_frames(cc,name,110)
 evidence=m.detect(raw,net,index,output,shape)
 import s9_appearance_review
 appearance=s9_appearance_review.descriptor(raw,evidence)
 del raw
 if len(evidence)<2:raise RuntimeError("too_few_frames_to_categorize")
 labels=categorize_evidence(m,evidence)
 return {"clip_id":key,"status":"classified","camera":cam,
  "remote_name":name,"model_sha256":m.MODEL_SHA,
  "model_kind":"local_SSD_MobileNet_COCOv1",
  "category":labels["event_category"],
  "person_score":labels["person_peak_score"],
  "person_frame_count":labels["person_observed_frames_050"],
  "possible_person_frame_count":labels["person_possible_frames_030"],
  "sampled_frames":labels["sampled_frames"],
  "max_simultaneous_person_boxes":labels["max_simultaneous_detections"],
  "frames_with_distinct_multi_person_boxes":labels["frames_with_multiple_person_boxes"],
  "vehicle_score":labels["vehicle_score_peak"],
  "animal_score":labels["animal_score_peak"],
  "motion_observation":labels["person_activity"],
  "appearance_quality":appearance["quality"],
  "appearance_samples":appearance["sample_frames"],
  "appearance_vector":appearance["vector"],
  "appearance_claim":"similar_outfit_only_not_identified_person",
  "identity_status":"not_verified",
  "visitor_id":None,
  "human_review":"pending",
  "camera_claim":"model_detection_not_independent_truth",
  "drive_read_only":True,
  "processed_at_utc":datetime.datetime.now(datetime.timezone.utc).isoformat()}

def report_camera_mode_safe(model):
 """A busy/hot camera is a valid reason to pause, not a catalog failure.

 Do not turn a correctly checkpointed batch into a systemd failure because the
 live recorder entered 4K capture between the guard and summary reporting.
 This is reporting only; the actual preflight and per-clip guards remain strict.
 """
 try:return model.active_camera()["mode"]
 except (RuntimeError,OSError,ValueError,KeyError,TypeError):
  return "paused_camera_busy_hot_or_unavailable"

def run(max_clips,dry_run):
 LOCK.parent.mkdir(parents=True,exist_ok=True)
 with LOCK.open("a") as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  verified=original_verified()
  cat=read_catalog()
  items=cat["items"]
  selected=sorted_candidates(verified,items)
  before=create_stats(cat,verified)
  if dry_run:
   print("S9_LEGACY_CATALOG_PREFLIGHT",json.dumps({
    "before":before,"selected_camera":[x["camera"] for x in selected[:max_clips]],
    "selected_count":min(max_clips,len(selected))}))
   return
  if not selected:
   print("S9_LEGACY_CATALOG_FINISHED",json.dumps(before))
   return
  m=reader()
  m.active_camera()
  cfg=json.loads(CONFIG.read_text())
  for camera in CAMERAS:
   if camera not in cfg.get("folders",{}):raise RuntimeError("missing_drive_folder_"+camera)
  net,index,output,shape=bootstrap_net(m)
  done=0
  for src in selected[:max_clips]:
   # Never compete with active 4K recording or a hot S9+.
   try:m.active_camera()
   except RuntimeError as e:
    print("S9_CATALOG_PAUSED_CAMERA_NOT_IDLE",str(e),flush=True)
    break
   key=src["clip_id"]
   previous=items.get(key,{})
   attempts=int(previous.get("attempts",0))+1
   started=time.monotonic()
   try:
    entry=process_one(m,net,index,output,shape,cfg,src)
    entry["attempts"]=attempts
    items[key]=entry
    done+=1
    print("S9_DRIVE_CLIP_CLASSIFIED",json.dumps({
     "index":done,"camera":src["camera"],"clip_id_prefix":key[:12],
     "category":entry["category"],"frames":entry["sampled_frames"],
     "processing_seconds":round(time.monotonic()-started,1)}),flush=True)
   except Exception as error:
    items[key]={"clip_id":key,"camera":src["camera"],"remote_name":src["remote_name"],
      "status":"error","attempts":attempts,"error_type":type(error).__name__,
      "last_attempt_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
      "human_review":"pending"}
    print("S9_DRIVE_CLIP_RETRY_LATER",json.dumps({"clip":key[:12],"error":type(error).__name__}),flush=True)
   cat["model_sha256"]=m.MODEL_SHA
   cat["updated_at_utc"]=datetime.datetime.now(datetime.timezone.utc).isoformat()
   cat["summary"]=create_stats(cat,verified)
   cat["private_metadata_only"]=True
   cat["media_saved_on_hub"]=False
   cat["biometric_identification"]=False
   write_catalog(cat)
  final=create_stats(cat,verified)
  print("S9_DRIVE_PERSON_CATALOG_BATCH_COMPLETE",json.dumps({
   "this_batch":done,**final,"camera_mode":report_camera_mode_safe(m),
   "metadata_path":str(DATA),"cloud_writes":False}),flush=True)

if __name__=="__main__":
 p=argparse.ArgumentParser()
 p.add_argument("--max-clips",type=int,default=3)
 p.add_argument("--dry-run",action="store_true")
 args=p.parse_args()
 if not 1<=args.max_clips<=8:raise SystemExit("max_clips_must_be_1_to_8")
 run(args.max_clips,args.dry_run)
