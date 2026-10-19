#!/usr/bin/env python3
"""Guarded C720P-only upgrade of the saved S9 MP4 timing proof verifier.

All camera videos/phone archives untouched. Enforces post-APK install time,
backs up exact prior Python worker and incomplete proof, and atomically rolls
back on unknown source or failed proof freshness. Requires V126 catalog to
already expose real native timing fields. This does not assert 3 clips exist.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
MODULE=HOME/"bin/s9_7s_saved_timing_proof_v1.py"
PROOF=HOME/"state/s9-7s-native-saved-timing-proof-v1.json"
CATALOG=HOME/"state/s9-standalone-archive-catalog-v1.json"
BACKUPS=HOME/"backups/s9-saved-proof-freshness-v128"
SERVICE="c720p-s9-native-timing-proof-v1.service"
SCHEMA="s9_native_saved_prefix_quiet_hold_proof_v1"
def sha(raw):return hashlib.sha256(raw).hexdigest()
def source(path,sha256):
 if path.is_symlink() or not path.is_file() or path.stat().st_size>200000:
  raise RuntimeError("untrusted_pinned_source_file")
 raw=path.read_bytes()
 if sha(raw)!=sha256:raise RuntimeError("exact_source_digest_mismatch")
 return raw
def read(path,maximum=16000000):
 if path.is_symlink() or not path.is_file() or not 30<path.stat().st_size<=maximum:
  raise RuntimeError("unknown_existing_timing_file")
 return path.read_bytes()
def camera():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=11) as r:
  if r.status!=200:raise RuntimeError("camera_http_not_healthy")
  raw=r.read(65537)
 if len(raw)>65536:raise RuntimeError("camera_http_unbounded")
 d=json.loads(raw)
 if (d.get("ok") is not True or d.get("mode")!="watching"
   or d.get("continuous_4k_ready") is not True
   or d.get("native_4k_enabled") is not True
   or d.get("continuous_4k_dropped_output_frames")!=0
   or d.get("continuous_4k_error")
   or type(d.get("temperature_c")) not in (int,float)
   or not 0<d["temperature_c"]<=39.5
   or type(d.get("continuous_4k_buffered_ms")) is not int
   or d["continuous_4k_buffered_ms"]<6500):
  raise RuntimeError("native_4k_not_cool_idle")
 return d
def unit_state():
 r=subprocess.run(["systemctl","--user","show",SERVICE,
                    "-p","LoadState","-p","ActiveState"],
                   text=True,capture_output=True,timeout=10)
 if r.returncode:raise RuntimeError("timing_unit_query_failed")
 attrs=dict(x.split("=",1) for x in r.stdout.splitlines() if "=" in x)
 if attrs.get("LoadState")!="loaded":raise RuntimeError("unknown_timing_unit")
 return attrs.get("ActiveState")
def start():
 r=subprocess.run(["systemctl","--user","start",SERVICE],
                   text=True,capture_output=True,timeout=70)
 if r.returncode:raise RuntimeError("timing_proof_service_failed")
def atomic(path,content):
 if path.is_symlink():raise RuntimeError("unknown_existing_symlink")
 mode=stat.S_IMODE(path.stat().st_mode) if path.exists() else 0o600
 fd,temp=tempfile.mkstemp(prefix=".s9-proof-v128-",dir=path.parent)
 try:
  with os.fdopen(fd,"wb") as f:
   os.fchmod(f.fileno(),mode)
   f.write(content);f.flush();os.fsync(f.fileno())
  os.replace(temp,path)
 finally:
  if os.path.exists(temp):os.unlink(temp)
def checked_proof(raw):
 doc=json.loads(raw)
 if doc.get("schema_version")!=SCHEMA or type(doc.get("complete")) is not bool:
  raise RuntimeError("unknown_saved_proof_schema")
 return doc
def main(old_file,new_file,old_hash,new_hash,apply):
 old=source(old_file,old_hash);new=source(new_file,new_hash)
 if (b"def verified_rollout_epoch_ms(" in old or
     b"def verified_rollout_epoch_ms(" not in new or
     b"after_rollout_ms=cutoff" not in new):
  raise RuntimeError("unrecognized_source_transition")
 current=read(MODULE,200000);running_sha=sha(current)
 if running_sha not in (old_hash,new_hash):
  raise RuntimeError("newer_live_timing_proof_do_not_overwrite")
 catalog=json.loads(read(CATALOG))
 if (catalog.get("schema_version")!="s9_native_archive_catalog_v1" or
     not isinstance(catalog.get("records"),dict)
     or not catalog["records"]):
  raise RuntimeError("timing_catalog_unavailable")
 if not any(all(k in r.get("manifest",{}) for k in (
     "capture_segment_end_reason","capture_segment_start_elapsed_ms",
     "capture_segment_stop_elapsed_ms","capture_segment_last_accepted_motion_age_at_stop_ms",
     "capture_segment_configured_quiet_hold_ms")) for r in catalog["records"].values()):
  raise RuntimeError("no_real_capture_segment_evidence_yet")
 baseline=checked_proof(read(PROOF,400000))
 before=camera()
 if unit_state()!="inactive":
  print("S9_SAVED_PROOF_V128_DEFERRED "+json.dumps({
    "reason":"proof_worker_busy","modified":False}),flush=True)
  return
 if not apply:
  print("S9_SAVED_PROOF_V128_PREFLIGHT "+json.dumps({
    "old_known":running_sha==old_hash,
    "already_new":running_sha==new_hash,"camera_healthy":True,
    "original_videos_modified":False,"freshness_gate_required":True}),flush=True)
  return
 backup=BACKUPS/dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 backup.mkdir(parents=True,mode=0o700,exist_ok=False)
 for name,payload in (("worker.py",current),("previous-proof.json",read(PROOF,400000))):
  p=backup/name;p.write_bytes(payload);os.chmod(p,0o600)
 mutated=False
 try:
  if running_sha==old_hash:
   atomic(MODULE,new);mutated=True
  start()
  finished=checked_proof(read(PROOF,400000))
  if finished.get("freshness_guard_active") is not True:
   raise RuntimeError("new_proof_did_not_enforce_post_upgrade_guard")
  if type(finished.get("eligible_count")) is not int or finished["eligible_count"]<0:
   raise RuntimeError("proof_count_invalid")
  if finished.get("complete") is True and finished["eligible_count"]<3:
   raise RuntimeError("fewer_than_three_independent_clips_not_proof")
  if finished.get("private_clip_ids_disclosed") is not False:
   raise RuntimeError("private_metadata_leaked_to_proof")
  if not isinstance(finished.get("pre_upgrade_excluded"),int):
   raise RuntimeError("rollout_cutoff_not_applied")
  after=camera()
  print("S9_SAVED_PROOF_V128_VERIFIED "+json.dumps({
    "module_sha256":new_hash,"freshness_guard_active":True,
    "pre_upgrade_excluded":finished["pre_upgrade_excluded"],
    "eligible_post_upgrade_quiet_end":finished["eligible_count"],
    "proof_complete":finished["complete"],
    "temperature_after_c":after["temperature_c"],
    "originals_modified":False,"camera_apk_modified":False,
    "manual_reviews_modified":False,"backup_private":True},sort_keys=True),flush=True)
 except BaseException:
  if mutated and sha(read(MODULE,200000))==new_hash:atomic(MODULE,current)
  atomic(PROOF,read(backup/"previous-proof.json",400000))
  print("S9_SAVED_PROOF_V128_ROLLED_BACK "+json.dumps({
    "worker_restored":True,"originals_modified":False,
    "camera_apk_modified":False}),flush=True)
  raise
if __name__=="__main__":
 parser=argparse.ArgumentParser()
 parser.add_argument("--old",type=Path,required=True)
 parser.add_argument("--new",type=Path,required=True)
 parser.add_argument("--old-sha",required=True)
 parser.add_argument("--new-sha",required=True)
 parser.add_argument("--apply",action="store_true")
 args=parser.parse_args()
 for digest in (args.old_sha,args.new_sha):
  if not re.fullmatch(r"[a-f0-9]{64}",digest):
   raise ValueError("invalid_pinned_digest")
 main(args.old,args.new,args.old_sha,args.new_sha,args.apply)
