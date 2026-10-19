#!/usr/bin/env python3
"""Inspect the already deployed 3-hour C720P->S9 mirror without invoking it.

Does not list private filenames, touch any MP4 bytes, verify/copy media, run
adb, update manifests, mutate systemd, or enable local deletion.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import urllib.request

WORKER=Path("/home/jespern/c720p-home-hub/bin/c720p_to_s9_verified_media_stage_v2.py")
UNITS=Path("/home/jespern/.config/systemd/user")
SERVICE="c720p-s9-verified-local-mirror-v2.service"
TIMER="c720p-s9-verified-local-mirror-v2.timer"
MANIFEST=Path("/home/jespern/c720p-home-hub/state/c720p-s9-imported-v2.json")
CURRENT_BLOB="1783cd5419504258deadc246b887a0eb5099939a"
RESUMABLE_BLOBS=("4625db1d3883a349a7cdc27028e9f6138e16c3fb",)
OLD_BLOCKING_BLOBS=("3f678dc946824eaaa9e2a1058f0e0c5d5de540bd",)
MARK="C720P_S9_MIRROR_V150_READONLY_VERIFIED "

def run_systemctl(action,unit):
 result=subprocess.run(["systemctl","--user",action,unit],
       capture_output=True,text=True,timeout=11,check=False)
 return result.returncode,result.stdout.strip()

def guarded_file(path,max_size):
 if path.is_symlink() or not path.is_file():
  raise RuntimeError("unknown_or_missing_mirror_source")
 st=path.stat()
 if not 10<st.st_size<max_size or st.st_nlink!=1:
  raise RuntimeError("unsafe_mirror_source_stat")
 blob=path.read_bytes()
 if len(blob)!=st.st_size or path.stat().st_mtime_ns!=st.st_mtime_ns:
  raise RuntimeError("mirror_source_changed_during_audit")
 return blob

def git_blob(blob):
 return hashlib.sha1(b"blob "+str(len(blob)).encode()+b"\0"+blob).hexdigest()

def camera_status():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=9) as r:
  if r.status!=200:raise RuntimeError("camera_status_error")
  b=r.read(65537)
 if len(b)>65536:raise RuntimeError("camera_unbounded")
 d=json.loads(b)
 if (d.get("ok") is not True or d.get("mode")!="watching"
  or d.get("native_4k_enabled") is not True
  or d.get("continuous_4k_ready") is not True
  or d.get("continuous_4k_dropped_output_frames")!=0
  or d.get("continuous_4k_error")
  or type(d.get("temperature_c")) not in (float,int)
  or not 0<d["temperature_c"]<=39.5):
  raise RuntimeError("s9_capture_unhealthy")
 return d["temperature_c"]

def inspect_worker(content):
 text=content.decode("utf8")
 blob=git_blob(content)
 if blob==CURRENT_BLOB:kind="current"
 elif blob in RESUMABLE_BLOBS:kind="resumable_previous"
 elif blob in OLD_BLOCKING_BLOBS:kind="old_blocks_partials"
 else:kind="unknown"
 must=("MAX_TEMP_C=37.0","RESERVE=15*1024**3",
       "all_local_recordings_preserved","phone_file_matches",
       "camera_ready()","sha256_file","atomic_write(old)")
 safeguards=all(x in text for x in must)
 resumable=("verified_partial_promoted" in text and
            "preexisting_partial_not_matching_preserved" in text and
            "camera_became_unhealthy_before_promotion" in text)
 if any(x in text for x in ("shutil.rmtree(","path.unlink(","os.remove(","--delete")):
  raise RuntimeError("unsafe_mirror_media_delete_logic")
 return {"worker_version":kind,
   "worker_sha_matches_known_approved_blob":kind!="unknown",
   "worker_latest_source":kind=="current",
   "partial_resume_logic_present":resumable,
   "thermal_hash_storage_guards_present":safeguards,
   "contains_media_deletion":False}

def manifest_summary():
 raw=guarded_file(MANIFEST,2000000)
 if MANIFEST.stat().st_mode&0o077:
  raise RuntimeError("private_manifest_not_private")
 doc=json.loads(raw)
 if doc.get("schema_version")!="c720p_s9_verified_import_v2":
  raise RuntimeError("private_manifest_schema_changed")
 records=doc.get("records")
 if not isinstance(records,dict) or len(records)>5000:
  raise RuntimeError("private_manifest_invalid")
 n=0;total=0
 for name,item in records.items():
  if (not isinstance(name,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]mp4",name)
      or ".." in name or not isinstance(item,dict)
      or not re.fullmatch(r"[0-9a-f]{64}",str(item.get("sha256","")))
      or type(item.get("bytes")) is not int or not 10000<=item["bytes"]<=900*1024**2
      or type(item.get("indexed")) is not bool):
   raise RuntimeError("private_manifest_entry_invalid")
  n+=1;total+=item["bytes"]
 return {"verified_import_manifest_entries":n,"manifest_bytes":total}

def audit():
 before=camera_status()
 service=guarded_file(UNITS/SERVICE,50000).decode()
 timer=guarded_file(UNITS/TIMER,50000).decode()
 if (not re.search(r"ExecStart=/usr/bin/python3 /home/jespern/c720p-home-hub/bin/c720p_to_s9_verified_media_stage_v2[.]py --copy",service)
     or "NoNewPrivileges=yes" not in service
     or "IOSchedulingClass=idle" not in service
     or "OnUnitInactiveSec=3h" not in timer
     or "Persistent=false" not in timer):
  raise RuntimeError("mirror_service_timer_contract_drift")
 active=run_systemctl("is-active",TIMER)==(0,"active")
 enabled=run_systemctl("is-enabled",TIMER)==(0,"enabled")
 if not active or not enabled:
  raise RuntimeError("mirror_timer_not_enabled_and_active")
 worker=inspect_worker(guarded_file(WORKER,100000))
 report={**worker,**manifest_summary(),
  "mirror_timer_active":True,"mirror_timer_enabled":True,
  "mirror_3h_no_catchup":True,"local_clips_deleted":False,
  "originals_still_required":True,
  "no_worker_copy_or_verify_run":True,
  "no_recordings_or_reviews_changed":True}
 after=camera_status()
 report["camera_ready_before_after"]=True
 report["camera_dropped_frames_after"]=0
 report["camera_temperature_after_c"]=after
 print(MARK+json.dumps(report,sort_keys=True),flush=True)
 return report

if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--run",action="store_true")
 args=p.parse_args()
 if args.run:
  try:audit()
  except Exception:
   print("C720P_S9_MIRROR_V150_NOT_VERIFIED "+
    json.dumps({"failed":True,"local_deletion_allowed":False},sort_keys=True),flush=True)
   raise SystemExit(1)
 else:
  print("C720P_S9_MIRROR_V150_PREVIEW "+
        json.dumps({"read_only":True,"copy_or_delete":False},sort_keys=True),flush=True)
