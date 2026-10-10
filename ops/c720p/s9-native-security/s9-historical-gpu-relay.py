#!/usr/bin/env python3
"""C720P -> S9+ historical GPU review transfer, fully separate from Security4K.

One verified Drive clip at a time, read-only Drive, immutable copied MP4,
app-specific microSD inbox. Results merge into the existing catalog under
the same lock used by its CPU classifier, retaining algorithm provenance.
"""
import argparse
import contextlib
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile

ROOT=Path("/home/jespern/c720p-home-hub")
BIN=ROOT/"bin"
MODEL=BIN/"s9-drive-person-catalog.py"
PHONE="192.168.178.250:5555"
INBOX="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/HistoricalDriveInbox"
SAFE_ID=re.compile(r"[a-f0-9]{64}\Z")
MAX_BYTES=650*1024*1024
APP_STATUS="http://127.0.0.1:18808/status"

def cpu_catalog():
 spec=importlib.util.spec_from_file_location("hist_cpu_catalog",MODEL)
 module=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(module)
 return module

def execute(argv,timeout=45):
 p=subprocess.run(argv,capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError("command_failed_"+argv[0]+":"+p.stderr[-150:])
 return p.stdout.strip()

def phone(*args,timeout=30):
 return execute(["adb","-s",PHONE,"shell",*args],timeout)

def local_stream(cfg,source,target):
 """Bounded rclone read-only stream; no full video stored in RAM."""
 remote=cfg["remote"]+":"+source["remote_name"]
 args=[cfg["rclone"],"--config",cfg["rclone_config"],"cat",remote,
       "--drive-root-folder-id",str(cfg["folders"][source["camera"]]["id"])]
 expected=int(source["size"])
 if not 100000<expected<=MAX_BYTES:raise ValueError("source_size_out_of_bounds")
 if shutil.disk_usage(target.parent).free<expected+1024*1024*1024:
  raise RuntimeError("hub_disk_space_guard")
 h=hashlib.sha256();total=0
 proc=subprocess.Popen(args,stdout=subprocess.PIPE,stderr=subprocess.DEVNULL)
 try:
  with target.open("xb") as out:
   while True:
    chunk=proc.stdout.read(262144)
    if not chunk:break
    total+=len(chunk)
    if total>MAX_BYTES or total>expected:
     proc.kill();raise RuntimeError("source_exceeded_verified_size")
    h.update(chunk);out.write(chunk)
   out.flush();os.fsync(out.fileno())
  if proc.wait(timeout=12)!=0:raise RuntimeError("drive_stream_failed")
 finally:
  if proc.poll() is None:proc.kill()
  proc.stdout.close()
  proc.wait()
 if total!=expected:raise RuntimeError("drive_stream_size_mismatch")
 return h.hexdigest()

def stage_one():
 import urllib.request
 with urllib.request.urlopen(APP_STATUS,timeout=9) as res:
  status=json.load(res)
 if status.get("historical_gpu_import_version")!="isolated_drive_import_v1":
  raise RuntimeError("phone_historical_worker_not_installed")
 if not status.get("ok") or status.get("mode")!="watching" or \
    float(status.get("temperature_c",100))>=37:
  raise RuntimeError("phone_camera_not_idle_or_cool")
 m=cpu_catalog()
 with m.LOCK.open("a") as lock:
  fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
  verified=m.original_verified()
  options=m.sorted_candidates(verified,m.read_catalog()["items"])
  # CPU runner takes the beginning. Pilot the opposite end to avoid contention.
  source=options[-1] if options else None
 if source is None:
  print("S9_HISTORY_NO_REMAINING_RECORDINGS")
  return
 key=source["clip_id"]
 if not SAFE_ID.fullmatch(key):raise RuntimeError("invalid_source_clip_id")
 execute(["adb","-s",PHONE,"shell","mkdir","-p",INBOX],20)
 names=phone("ls","-1",INBOX,timeout=15).splitlines()
 inflight=[n for n in names if re.fullmatch(r"history_[a-f0-9]{64}[.]ready[.]json",n)
           and n.replace(".ready.json",".result.json") not in names]
 if inflight:
  print("S9_HISTORY_PHONE_STILL_PROCESSING",len(inflight))
  return
 with tempfile.TemporaryDirectory(prefix="s9-history-") as tmp:
  folder=Path(tmp);src=folder/("history_"+key+".mp4")
  cfg=json.loads(m.CONFIG.read_text())
  sha=local_stream(cfg,source,src)
  destination=INBOX+"/history_"+key
  execute(["adb","-s",PHONE,"push",str(src),destination+".mp4.partial"],180)
  phone("mv",destination+".mp4.partial",destination+".mp4",timeout=18)
  meta={
   "clip_id":key,"camera":source["camera"],
   "source_remote_name":source["remote_name"],"bytes":src.stat().st_size,
   "source_sha256":sha,"source":"verified_historical_google_drive",
   "requires_gpu_or_cpu_on_phone":True,
   "identity_claim":"none","original_drive_read_only":True}
  ready=folder/"ready.json"
  ready.write_text(json.dumps(meta,separators=(",",":"),sort_keys=True))
  execute(["adb","-s",PHONE,"push",str(ready),destination+".ready.json.partial"],25)
  phone("mv",destination+".ready.json.partial",destination+".ready.json",timeout=12)
 print("S9_HISTORY_STAGED",json.dumps({"clip_id_prefix":key[:12],
        "size":source["size"],"source_camera":source["camera"],
        "native_archive_touched":False,"cloud_writes":False}))

def category_from_phone(result):
 event=result.get("person_event_category")
 mapping={
  "single_person_repeated_candidate":"single_person_event_candidate",
  "single_frame_person_candidate":"possible_person_needs_review",
  "multiple_people_candidate":"multiple_people_candidate",
  "possible_group_needs_frame_review":"possible_group_needs_frame_review",
  "possible_person_below_standard_threshold":"possible_person_needs_review",
 }
 if event in mapping:return mapping[event]
 if event!="no_person_model_detection":
  raise ValueError("unsupported_native_person_event")
 if float(result.get("vehicle_confidence") or 0)>=.50:return "vehicle_candidate"
 if float(result.get("animal_confidence") or 0)>=.50:return "animal_candidate"
 return "unresolved_motion"

def validate_result(result,verified):
 key=result.get("source_clip_id")
 if not isinstance(key,str) or not SAFE_ID.fullmatch(key) or key not in verified:
  raise ValueError("unknown_verified_clip")
 src=verified[key]
 if result.get("source_remote_name")!=src["remote_name"] or \
    result.get("source_camera")!=src["camera"] or \
    result.get("source")!="verified_historical_google_drive" or \
    result.get("archive")!="historical_drive_import_isolated" or \
    result.get("import_status")!="classified_pending_hub_ack":
  raise ValueError("historical_source_mismatch")
 model=result.get("model_sha256")
 media_hash=result.get("source_sha256")
 if not isinstance(model,str) or not SAFE_ID.fullmatch(model) or \
    not isinstance(media_hash,str) or not SAFE_ID.fullmatch(media_hash) or \
    media_hash!=result.get("sha256"):
  raise ValueError("invalid_model_or_original_digest")
 count=result.get("sampled_frame_count")
 positive=result.get("person_frames_at_050")
 score=result.get("person_confidence")
 if (isinstance(count,bool) or not isinstance(count,int) or not 2<=count<=12 or
     isinstance(positive,bool) or not isinstance(positive,int) or not 0<=positive<=count or
     isinstance(score,bool) or not isinstance(score,(float,int)) or not 0<=score<=1):
  raise ValueError("invalid_sampled_detection_metrics")
 backend=result.get("backend")
 if backend not in ("gpu","cpu"):raise ValueError("unrecognized_phone_backend")
 return {
  "clip_id":key,"camera":src["camera"],"remote_name":src["remote_name"],
  "status":"classified","category":category_from_phone(result),
  "person_score":round(score,4),
  "person_frame_count":positive,"sampled_frames":count,
  "possible_person_frame_count":int(result.get("possible_person_frames_at_030") or 0),
  "max_simultaneous_person_boxes":int(result.get("person_count") or 0),
  "vehicle_score":round(float(result.get("vehicle_confidence") or 0),4),
  "animal_score":round(float(result.get("animal_confidence") or 0),4),
  "model_kind":"S9_Android_TFLite_SSD_MobileNet_COCO_v1",
  "model_sha256":model,"review_backend":backend,
  "analysis_device":"S9_plus_GPU_or_CPU_fallback",
  "source_sha256":media_hash,"source_clip_sampling":"up_to_12_s9_keyframes",
  "human_review":"pending","identity_status":"not_verified",
  "appearance_quality":"not_evaluated",
  "processed_at_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "drive_read_only":True,"source_preserved_in_drive":True,"attempts":1,
 }

def clean_import_copy(key):
 """Only remove the disposable staging copy after trusted catalog reconciliation."""
 if not SAFE_ID.fullmatch(key):raise ValueError("invalid_cleanup_key")
 base=INBOX+"/history_"+key
 # Retain result JSON as an audit record. Never touch Security4K or Google Drive.
 for name in (base+".mp4",base+".mp4.verified.json",
              base+".mp4.thumb.jpg",base+".ready.json"):
  phone("rm","-f",name,timeout=12)
 phone("mv",base+".result.json",base+".ack.json",timeout=12)

def collect():
 m=cpu_catalog()
 listing=phone("ls","-1",INBOX,timeout=20)
 names=[n for n in listing.splitlines() if re.fullmatch(r"history_[a-f0-9]{64}[.]result[.]json",n)]
 accepted=0
 for name in names[:2]:
  raw=execute(["adb","-s",PHONE,"exec-out","cat",INBOX+"/"+name],30)
  if len(raw)>180000:raise ValueError("result_too_large")
  result=json.loads(raw)
  with m.LOCK.open("a") as lock:
   fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   verified=m.original_verified()
   entry=validate_result(result,verified)
   cat=m.read_catalog()
   prev=cat["items"].get(entry["clip_id"],{})
   if prev.get("status")=="classified":
    print("S9_HISTORY_ALREADY_CLASSIFIED",entry["clip_id"][:12])
   else:
    cat["items"][entry["clip_id"]]=entry
    # Preserve the CPU catalog's global model fingerprint. Each phone row has its own.
    cat["updated_at_utc"]=datetime.datetime.now(datetime.timezone.utc).isoformat()
    cat["summary"]=m.create_stats(cat,verified)
    cat["private_metadata_only"]=True
    cat["media_saved_on_hub"]=False
    cat["biometric_identification"]=False
    m.write_catalog(cat)
    accepted+=1
    print("S9_HISTORY_MERGED",json.dumps({"clip_id_prefix":entry["clip_id"][:12],
       "classification":entry["category"],"backend":entry["review_backend"],
       "progress":cat["summary"]["processed"],"source_preserved":True}))
  # Clean imported TEMPORARY phone copy only after the catalog lock was released.
  clean_import_copy(entry["clip_id"])
 print("S9_HISTORY_COLLECT_COMPLETE",accepted)

def cycle():
 import urllib.request
 try:
  with urllib.request.urlopen(APP_STATUS,timeout=9) as res:status=json.load(res)
 except Exception as error:
  print("S9_HISTORY_DEFERRED_CAMERA_UNAVAILABLE",type(error).__name__)
  return
 if status.get("historical_gpu_import_version")!="isolated_drive_import_v1":
  print("S9_HISTORY_DEFERRED_PHONE_APK_NOT_UPGRADED")
  return
 execute(["adb","-s",PHONE,"shell","mkdir","-p",INBOX],20)
 collect()
 try:stage_one()
 except RuntimeError as error:
  if str(error) in ("phone_camera_not_idle_or_cool","phone_historical_worker_not_installed",
                     "hub_disk_space_guard"):
   print("S9_HISTORY_DEFERRED",str(error))
  else:raise

if __name__=="__main__":
 parser=argparse.ArgumentParser(description=__doc__)
 group=parser.add_mutually_exclusive_group(required=True)
 group.add_argument("--stage-one",action="store_true")
 group.add_argument("--collect",action="store_true")
 group.add_argument("--cycle",action="store_true")
 options=parser.parse_args()
 if options.stage_one:stage_one()
 elif options.collect:collect()
 else:cycle()
