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
import time

ROOT=Path("/home/jespern/c720p-home-hub")
BIN=ROOT/"bin"
MODEL=BIN/"s9-drive-person-catalog.py"
PHONE="192.168.178.250:5555"
INBOX="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/HistoricalDriveInbox"
SAFE_ID=re.compile(r"[a-f0-9]{64}\Z")
MAX_BYTES=650*1024*1024
RECHECK_VERSION="v28_s9_gpu_historical_person_review_v1"
APP_STATUS="http://127.0.0.1:18808/status"

def wait_for_catalog_lock(lock,seconds=200):
 """Share the CPU classifier's lock; another healthy batch is not a failure."""
 deadline=time.monotonic()+seconds
 while True:
  try:
   fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
   return
  except BlockingIOError:
   if time.monotonic()>=deadline:
    raise RuntimeError("historical_catalog_busy_retry_next_timer")
   time.sleep(1.0)

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

def normalize_gpu_input(original,target):
 """Decode damaged legacy H264 on hub; phone only runs TFLite on a tiny clean MP4."""
 details=json.loads(execute([
  "ffprobe","-v","error","-show_entries","format=duration","-of","json",str(original)],22))
 duration=float(details["format"]["duration"])
 if not 1<=duration<=120:raise RuntimeError("unsupported_historical_duration")
 rate=12.0/duration
 cmd=["ffmpeg","-y","-nostdin","-v","error","-threads","1",
      "-err_detect","ignore_err","-i",str(original),"-an","-sn",
      "-vf",f"fps={rate:.6f},scale=960:540","-frames:v","12",
      "-c:v","libx264","-preset","ultrafast","-crf","17",
      "-profile:v","baseline","-pix_fmt","yuv420p","-g","1","-bf","0",
      "-movflags","+faststart",str(target)]
 execute(cmd,150)
 n=target.stat().st_size
 if not 100000<n<10000000:raise RuntimeError("invalid_normalized_import_size")
 probe=json.loads(execute(["ffprobe","-v","error","-count_frames",
           "-show_entries","stream=codec_name,width,height,nb_read_frames",
           "-of","json",str(target)],25))
 streams=probe.get("streams",[])
 if len(streams)!=1 or streams[0].get("codec_name")!="h264" or \
    (streams[0].get("width"),streams[0].get("height"))!=(960,540) or \
    not 2<=int(streams[0].get("nb_read_frames") or 0)<=12:
  raise RuntimeError("normalization_decode_validation_failed")
 return hashlib.sha256(target.read_bytes()).hexdigest()

def v28_candidates(verified,stored):
 """Reanalyse only independently verified Drive originals; never old deleted items."""
 selected=[]
 for key,source in verified.items():
  previous=stored.get(key,{})
  rereview=previous.get("v28_person_recheck",{})
  if rereview.get("status")=="classified" or int(rereview.get("attempts",0))>=3:
   continue
  selected.append(source)
 # Stable order with a mix of S3 and outdoor clips; source still validates by hash.
 selected.sort(key=lambda x:(x["camera"]!="s3",-x["legacy_person_score"],x["remote_name"]))
 return selected

def merge_v28_recheck(catalog,entry):
 """Keep old 180 CPU classifications byte-for-byte except an additive v28 field."""
 key=entry["clip_id"]
 prior=catalog["items"].get(key)
 if not isinstance(prior,dict) or prior.get("status")!="classified":
  raise ValueError("v28_cannot_replace_missing_baseline")
 row=dict(prior)
 if row.get("camera")!=entry["camera"] or row.get("remote_name")!=entry["remote_name"]:
  raise ValueError("v28_baseline_source_mismatch")
 review={k:entry[k] for k in ("status","category","person_score","person_frame_count",
    "sampled_frames","possible_person_frame_count","max_simultaneous_person_boxes",
    "vehicle_score","animal_score","review_backend","model_sha256",
    "original_source_sha256","analysis_input_preprocessing","processed_at_utc")}
 review.update(version=RECHECK_VERSION,human_review="pending",
    identity_status="not_verified",source_media="verified_read_only_google_drive",
    note="person_detection_not_face_identification")
 row["v28_person_recheck"]=review
 catalog["items"][key]=row
 return review

def stage_one(rescan_v28=False):
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
  wait_for_catalog_lock(lock)
  verified=m.original_verified()
  rows=m.read_catalog()["items"]
  options=v28_candidates(verified,rows) if rescan_v28 else m.sorted_candidates(verified,rows)
  # V28 visits verified, previously classified originals; ordinary mode unchanged.
  source=options[0] if rescan_v28 and options else options[-1] if options else None
 if source is None:
  print("S9_HISTORY_V28_COMPLETE" if rescan_v28 else "S9_HISTORY_NO_REMAINING_RECORDINGS")
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
  original_sha=local_stream(cfg,source,src)
  gpu_mp4=folder/"gpu_input.mp4"
  gpu_sha=normalize_gpu_input(src,gpu_mp4)
  gpu_input_bytes=gpu_mp4.stat().st_size
  destination=INBOX+"/history_"+key
  execute(["adb","-s",PHONE,"push",str(gpu_mp4),destination+".mp4.partial"],180)
  phone("mv",destination+".mp4.partial",destination+".mp4",timeout=18)
  meta={
   "clip_id":key,"camera":source["camera"],
   "source_remote_name":source["remote_name"],"bytes":gpu_mp4.stat().st_size,
   "source_sha256":gpu_sha,"original_source_sha256":original_sha,
   "original_source_size":src.stat().st_size,
   "derivative_transcode":"ffmpeg_h264_960x540_all_intra_12samples",
   "source":"verified_historical_google_drive",
   "requires_gpu_or_cpu_on_phone":True,
   "identity_claim":"none","original_drive_read_only":True}
  if rescan_v28:meta["review_request_version"]=RECHECK_VERSION
  ready=folder/"ready.json"
  ready.write_text(json.dumps(meta,separators=(",",":"),sort_keys=True))
  execute(["adb","-s",PHONE,"push",str(ready),destination+".ready.json.partial"],25)
  phone("mv",destination+".ready.json.partial",destination+".ready.json",timeout=12)
 print("S9_HISTORY_STAGED",json.dumps({"clip_id_prefix":key[:12],
        "size":source["size"],"gpu_input_bytes":gpu_input_bytes,
        "source_camera":source["camera"],
        "native_archive_touched":False,"cloud_writes":False,
        "review":RECHECK_VERSION if rescan_v28 else "ordinary"}))

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

def validate_result(result,verified,descriptor=None):
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
 if descriptor is not None:
  if (descriptor.get("clip_id")!=key or
      descriptor.get("source_remote_name")!=src["remote_name"] or
      descriptor.get("camera")!=src["camera"] or
      descriptor.get("source_sha256")!=media_hash or
      descriptor.get("original_source_size")!=src["size"] or
      descriptor.get("derivative_transcode")!="ffmpeg_h264_960x540_all_intra_12samples" or
      not isinstance(descriptor.get("original_source_sha256"),str) or
      not SAFE_ID.fullmatch(descriptor["original_source_sha256"])):
   raise ValueError("original_drive_and_gpu_input_provenance_mismatch")
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
  "source_sha256":media_hash,"analysis_input_sha256":media_hash,
  "original_source_sha256":descriptor.get("original_source_sha256") if descriptor else None,
  "analysis_input_preprocessing":descriptor.get("derivative_transcode") if descriptor else "legacy_direct_clip",
  "source_clip_sampling":"up_to_12_s9_keyframes",
  "human_review":"pending","identity_status":"not_verified",
  "appearance_quality":"not_evaluated",
  "processed_at_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
  "drive_read_only":True,"source_preserved_in_drive":True,"attempts":1,
 }

def clean_import_copy(key,rescan_v28=False):
 """Only remove the disposable staging copy after trusted catalog reconciliation."""
 if not SAFE_ID.fullmatch(key):raise ValueError("invalid_cleanup_key")
 base=INBOX+"/history_"+key
 # Retain result JSON as an audit record. Never touch Security4K or Google Drive.
 for name in (base+".mp4",base+".mp4.verified.json",
              base+".mp4.thumb.jpg",base+".ready.json"):
  phone("rm","-f",name,timeout=12)
 # Preserve the previous GPU audit acknowledgment when reviewing the same clip again.
  # A fresh v28 result gets its own independent acknowledgment file.
 destination=base+(".v28.ack.json" if rescan_v28 else ".ack.json")
 if rescan_v28:
  existing=phone("ls","-1",INBOX,timeout=12).splitlines()
  if "history_"+key+".v28.ack.json" in existing:
   raise RuntimeError("v28_ack_already_exists_refuse_overwrite")
 phone("mv",base+".result.json",destination,timeout=12)

def collect():
 m=cpu_catalog()
 listing=phone("ls","-1",INBOX,timeout=20)
 names=[n for n in listing.splitlines() if re.fullmatch(r"history_[a-f0-9]{64}[.]result[.]json",n)]
 accepted=0
 for name in names[:2]:
  raw=execute(["adb","-s",PHONE,"exec-out","cat",INBOX+"/"+name],30)
  if len(raw)>180000:raise ValueError("result_too_large")
  result=json.loads(raw)
  ready_name=name.replace(".result.json",".ready.json")
  ready_text=execute(["adb","-s",PHONE,"exec-out","cat",INBOX+"/"+ready_name],30)
  if len(ready_text)>4096:raise ValueError("ready_descriptor_too_large")
  ready=json.loads(ready_text)
  with m.LOCK.open("a") as lock:
   wait_for_catalog_lock(lock)
   verified=m.original_verified()
   entry=validate_result(result,verified,ready)
   cat=m.read_catalog()
   if ready.get("review_request_version")==RECHECK_VERSION:
    old=cat["items"].get(entry["clip_id"],{})
    if old.get("v28_person_recheck",{}).get("status")=="classified":
     print("S9_HISTORY_V28_ALREADY_CLASSIFIED",entry["clip_id"][:12])
    else:
     review=merge_v28_recheck(cat,entry)
     cat["updated_at_utc"]=datetime.datetime.now(datetime.timezone.utc).isoformat()
     cat["summary"]=m.create_stats(cat,verified)
     m.write_catalog(cat)
     accepted+=1
     print("S9_HISTORY_V28_PERSON_RECHECK_MERGED",json.dumps({
        "clip_id_prefix":entry["clip_id"][:12],
        "person_category":review["category"],"backend":review["review_backend"],
        "old_category":old.get("category"),"baseline_preserved":True,
        "cloud_writes":False}))
   else:
    prev=cat["items"].get(entry["clip_id"],{})
    if prev.get("status")=="classified":
     print("S9_HISTORY_ALREADY_CLASSIFIED",entry["clip_id"][:12])
    else:
     cat["items"][entry["clip_id"]]=entry
     # Preserve original global model fingerprint; each phone row has its own.
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
  clean_import_copy(entry["clip_id"],rescan_v28=ready.get("review_request_version")==RECHECK_VERSION)
 print("S9_HISTORY_COLLECT_COMPLETE",accepted)

def cycle(rescan_v28=False):
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
 try:stage_one(rescan_v28=rescan_v28)
 except RuntimeError as error:
  if str(error) in ("phone_camera_not_idle_or_cool","phone_historical_worker_not_installed",
                     "hub_disk_space_guard","historical_catalog_busy_retry_next_timer"):
   print("S9_HISTORY_DEFERRED",str(error))
  else:raise

if __name__=="__main__":
 parser=argparse.ArgumentParser(description=__doc__)
 group=parser.add_mutually_exclusive_group(required=True)
 group.add_argument("--stage-one",action="store_true")
 group.add_argument("--collect",action="store_true")
 group.add_argument("--cycle",action="store_true")
 group.add_argument("--cycle-v28",action="store_true")
 group.add_argument("--stage-one-v28",action="store_true")
 options=parser.parse_args()
 if options.stage_one:stage_one()
 elif options.collect:collect()
 elif options.stage_one_v28:stage_one(rescan_v28=True)
 elif options.cycle_v28:cycle(rescan_v28=True)
 else:cycle()
