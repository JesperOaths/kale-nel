#!/usr/bin/env python3
"""Conservative live C720P deployment of source-qualified S9 timing metadata.

Only hub Python catalog validator and regenerated read-only JSON indexes change.
No video/phone files, Camera2 APK, player, people approvals or video hashes.
Unknown live revisions, active workers, unhealthy camera and failed fresh
catalog checks refuse promotion and restore previous metadata atomically.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import tempfile
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
STATE=HOME/"state"
INSTALLED=HOME/"bin/phone_archive_catalog_v1.py"
OLD_SHA="345b51532b06918329eaba5e12d4e9fa8366628161a8912bcd4f7291646e28f2"
CATALOG=STATE/"s9-standalone-archive-catalog-v1.json"
SUMMARY=STATE/"s9-standalone-archive-summary-v1.json"
CLIENT=STATE/"s9-native-archive-client.json"
PROOF=STATE/"s9-7s-native-saved-timing-proof-v1.json"
SERVICE="c720p-s9-standalone-catalog.service"
TIMING="c720p-s9-native-timing-proof-v1.service"
FILES=(INSTALLED,CATALOG,SUMMARY,CLIENT,PROOF)
CAMERA="http://127.0.0.1:18808/status"
TIMING_FIELDS=("capture_segment_end_reason","capture_segment_configured_quiet_hold_ms",
 "capture_segment_start_elapsed_ms","capture_segment_stop_elapsed_ms",
 "capture_segment_last_accepted_motion_age_at_stop_ms")
def sha(raw):return hashlib.sha256(raw).hexdigest()
def checked_file(path,limit):
 if path.is_symlink() or not path.is_file() or not 0<path.stat().st_size<=limit:
  raise RuntimeError("unsafe_existing_metadata")
 return path.read_bytes()
def camera():
 with urllib.request.urlopen(CAMERA,timeout=12) as response:
  if response.status!=200:raise RuntimeError("camera_status_unavailable")
  raw=response.read(65537)
 if len(raw)>65536:raise RuntimeError("camera_status_unbounded")
 d=json.loads(raw)
 if (d.get("ok") is not True or d.get("mode")!="watching"
    or d.get("native_4k_enabled") is not True
    or d.get("continuous_4k_ready") is not True
    or d.get("continuous_4k_dropped_output_frames")!=0
    or type(d.get("temperature_c")) not in (int,float)
    or not 0<d["temperature_c"]<=39.5
    or d.get("continuous_4k_error")
    or type(d.get("continuous_4k_buffered_ms")) is not int
    or d["continuous_4k_buffered_ms"]<6500):
  raise RuntimeError("recording_capture_health_unsafe")
 return d
def unit_state(name):
 proc=subprocess.run(["systemctl","--user","show",name,"-p","LoadState","-p","ActiveState"],
     capture_output=True,text=True,timeout=10)
 if proc.returncode:raise RuntimeError("metadata_service_unavailable")
 pairs=dict(line.split("=",1) for line in proc.stdout.splitlines() if "=" in line)
 if pairs.get("LoadState")!="loaded":raise RuntimeError("unknown_metadata_service")
 return pairs.get("ActiveState")
def run_service(name,timeout=160):
 proc=subprocess.run(["systemctl","--user","start",name],
     capture_output=True,text=True,timeout=timeout)
 if proc.returncode:raise RuntimeError("metadata_service_refresh_failed")
def atomic(path,body):
 if path.is_symlink():raise RuntimeError("unsafe_metadata_target")
 path.parent.mkdir(parents=True,exist_ok=True)
 mode=stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o600
 fd,temp=tempfile.mkstemp(prefix=".s9-timing-v125-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as handle:
   os.fchmod(handle.fileno(),mode)
   handle.write(body);handle.flush();os.fsync(handle.fileno())
  os.replace(temp,path)
 finally:
  if os.path.exists(temp):os.unlink(temp)
def catalogue(path):
 d=json.loads(checked_file(path,16*1024*1024))
 if d.get("schema_version")!="s9_native_archive_catalog_v1" or not isinstance(d.get("records"),dict):
  raise RuntimeError("unknown_archive_catalog_schema")
 return d
def protected(c):
 protected={}
 for name,entry in c["records"].items():
  if (not re.fullmatch(r"motion_[0-9]{13}[.]mp4",name)
      or not isinstance(entry,dict)
      or not isinstance(entry.get("manifest"),dict)):
   raise RuntimeError("untrusted_catalog_row")
  m=entry["manifest"]
  protected[name]=(entry.get("bytes"),entry.get("version"),m.get("sha256"))
 return protected
def eligible(c):
 return sum(all(k in entry["manifest"] for k in TIMING_FIELDS)
            for entry in c["records"].values())
def inspect_source(path,expected):
 blob=checked_file(path,200000)
 if sha(blob)!=expected:raise RuntimeError("pinned_catalog_source_mismatch")
 if (b"CAPTURE_TIMING_FIELDS=(" not in blob or
     b"def safe_capture_segment(manifest):" not in blob or
     b"result.update(safe_capture_segment(manifest))" not in blob):
  raise RuntimeError("timing_source_contract_missing")
 return blob
def deploy(source,source_sha,apply):
 desired=inspect_source(source,source_sha)
 prior=checked_file(INSTALLED,200000)
 oldhash=sha(prior)
 if oldhash not in (OLD_SHA,source_sha):
  raise RuntimeError("newer_or_unknown_live_catalog_validator")
 before=camera()
 if unit_state(SERVICE)!="inactive" or unit_state(TIMING)!="inactive":
  raise RuntimeError("metadata_refresh_service_busy")
 old=catalogue(CATALOG);prior_ids=protected(old)
 before_eligible=eligible(old)
 if not prior_ids:raise RuntimeError("empty_archive_unsafe")
 if not apply:
  print("S9_TIMING_CATALOG_V125_PREFLIGHT "+json.dumps({
    "previous_validator_known":True,"recordings":len(prior_ids),
    "eligible_before":before_eligible,"apply":False,
    "camera_apk_modified":False,"originals_modified":False},sort_keys=True),flush=True)
  return
 # Backup private hub metadata only. Never alter or transfer an S9 MP4.
 backup=HOME/"backups/security-s9-timing-v125"/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 backup.mkdir(parents=True,mode=0o700,exist_ok=False)
 snapshots={}
 for target in FILES:
  if target.exists():
   blob=checked_file(target,16*1024*1024)
   snapshots[target]=blob
   save=backup/target.name
   save.write_bytes(blob);os.chmod(save,0o600)
  else:snapshots[target]=None
 applied=False
 try:
  if oldhash!=source_sha:
   atomic(INSTALLED,desired)
   applied=True
  run_service(SERVICE,160)
  fresh=catalogue(CATALOG);fresh_ids=protected(fresh)
  if (not set(prior_ids).issubset(fresh_ids) or
      any(fresh_ids[k]!=v for k,v in prior_ids.items())):
   raise RuntimeError("original_catalog_identity_or_digest_regressed")
  count=eligible(fresh)
  if count<1:raise RuntimeError("actual_phone_segment_timing_not_recovered")
  for rec in fresh["records"].values():
   m=rec["manifest"]
   if not any(k in m for k in TIMING_FIELDS):continue
   if not all(k in m for k in TIMING_FIELDS):
    raise RuntimeError("partial_segment_timing_surfaced")
  run_service(TIMING,65)
  after=camera()
  if after["continuous_4k_dropped_output_frames"]!=0:
   raise RuntimeError("capture_dropped_frames_after_refresh")
  proof=json.loads(checked_file(PROOF,200000))
  if proof.get("schema_version")!="s9_native_saved_prefix_quiet_hold_proof_v1":
   raise RuntimeError("timing_proof_schema_changed")
  if proof.get("eligible_count",0)<1:
   raise RuntimeError("saved_timing_proof_not_refreshed")
  print("S9_TIMING_CATALOG_V125_VERIFIED "+json.dumps({
    "catalog_recordings":len(fresh_ids),"source_timing_eligible":count,
    "proof_eligible":proof["eligible_count"],
    "proof_complete":proof.get("complete") is True,
    "camera_temperature_after_c":after["temperature_c"],
    "originals_modified":False,"camera_apk_modified":False,
    "human_reviews_modified":False,"previous_catalog_preserved":True,
    "rollback_backup_private":True},sort_keys=True),flush=True)
 except BaseException:
  # Only restore the exact known hub metadata targets, never saved MP4s.
  for path,data in snapshots.items():
   if data is not None:atomic(path,data)
   elif path.exists() and path in (CATALOG,SUMMARY,CLIENT,PROOF):
    path.unlink()
  print("S9_TIMING_CATALOG_V125_ROLLED_BACK "+json.dumps({
    "metadata_restored":True,"originals_modified":False,
    "camera_apk_modified":False,"human_reviews_modified":False}),flush=True)
  raise
def main():
 ap=argparse.ArgumentParser()
 ap.add_argument("--source",type=Path,required=True)
 ap.add_argument("--sha256",required=True)
 ap.add_argument("--apply",action="store_true")
 args=ap.parse_args()
 if not re.fullmatch(r"[a-f0-9]{64}",args.sha256):raise ValueError("invalid_sha_arg")
 deploy(args.source,args.sha256,args.apply)
if __name__=="__main__":main()
