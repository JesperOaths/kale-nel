#!/usr/bin/env python3
"""Rebuild metadata-only verified S9 catalog after V126 sanitizer deployment.

One authorized existing systemd scanner run, followed by existing saved timing
proof service. No capture, video decoding, Android package or manual review
writes. Fail closed on unknown sanitizer and any known original identity drift.
"""
import argparse
import hashlib
import json
from pathlib import Path
import re
import subprocess
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
STATE=HOME/"state"
VALIDATOR=HOME/"bin/phone_archive_catalog_v1.py"
VALIDATOR_SHA="ce29949ea8e95b3e781c76c50f937e0d7d4e7d2673bf7023d3e5692266078593"
CATALOG=STATE/"s9-standalone-archive-catalog-v1.json"
SUMMARY=STATE/"s9-standalone-archive-summary-v1.json"
PROOF=STATE/"s9-7s-native-saved-timing-proof-v1.json"
CATALOG_UNIT="c720p-s9-standalone-catalog.service"
PROOF_UNIT="c720p-s9-native-timing-proof-v1.service"
FIELDS=("capture_segment_end_reason","capture_segment_configured_quiet_hold_ms",
 "capture_segment_start_elapsed_ms","capture_segment_stop_elapsed_ms",
 "capture_segment_last_accepted_motion_age_at_stop_ms")
def sha(raw):return hashlib.sha256(raw).hexdigest()
def safe_read(path,maximum):
 if path.is_symlink() or not path.is_file() or not 30<path.stat().st_size<=maximum:
  raise RuntimeError("unsafe_metadata_file")
 return path.read_bytes()
def catalog():
 doc=json.loads(safe_read(CATALOG,16*1024*1024))
 if (doc.get("schema_version")!="s9_native_archive_catalog_v1" or
    not isinstance(doc.get("records"),dict) or not 1<=len(doc["records"])<=2000):
  raise RuntimeError("untrusted_catalog_contract")
 return doc
def integrity_snapshot(doc):
 values={}
 for name,item in doc["records"].items():
  if (not re.fullmatch(r"motion_[0-9]{13}[.]mp4",name) or
      not isinstance(item,dict) or not isinstance(item.get("manifest"),dict)):
   raise RuntimeError("untrusted_catalog_entry")
  manifest=item["manifest"]
  digest=manifest.get("sha256")
  if not isinstance(digest,str) or not re.fullmatch("[0-9a-f]{64}",digest):
   raise RuntimeError("catalog_source_digest_invalid")
  values[name]=(item.get("bytes"),item.get("version"),digest)
 return values
def timing_counts(doc):
 complete=[]
 for item in doc["records"].values():
  m=item["manifest"]
  present=[k in m for k in FIELDS]
  if any(present) and not all(present):
   raise RuntimeError("partial_timing_evidence_group")
  if all(present):complete.append(m)
 return len(complete)
def verify_capture():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=10) as response:
  if response.status!=200:raise RuntimeError("s9_capture_status_unavailable")
  raw=response.read(65537)
 if len(raw)>65536:raise RuntimeError("s9_capture_status_oversize")
 s=json.loads(raw)
 if (s.get("ok") is not True or s.get("mode")!="watching"
     or s.get("continuous_4k_ready") is not True or
     s.get("native_4k_enabled") is not True or
     s.get("continuous_4k_dropped_output_frames")!=0 or
     s.get("continuous_4k_error") or
     type(s.get("continuous_4k_buffered_ms")) is not int or
     s["continuous_4k_buffered_ms"]<6500 or
     type(s.get("temperature_c")) not in (int,float) or
     not 0<s["temperature_c"]<=39.5):
  raise RuntimeError("s9_capture_not_healthy_idle")
 return s
def show(name):
 p=subprocess.run(["systemctl","--user","show",name,"-p","ActiveState",
      "-p","LoadState"],capture_output=True,text=True,timeout=10)
 if p.returncode:raise RuntimeError("metadata_unit_status_unavailable")
 result=dict(line.split("=",1) for line in p.stdout.splitlines() if "=" in line)
 if result.get("LoadState")!="loaded":raise RuntimeError("metadata_unit_not_loaded")
 return result.get("ActiveState")
def start(name,timeout):
 p=subprocess.run(["systemctl","--user","start",name],
    capture_output=True,text=True,timeout=timeout)
 if p.returncode:raise RuntimeError("metadata_unit_refresh_failed")
def refresh(apply=False):
 if sha(safe_read(VALIDATOR,200000))!=VALIDATOR_SHA:
  raise RuntimeError("unknown_live_sanitizer_do_not_overwrite")
 before=verify_capture()
 prior=catalog();protected=integrity_snapshot(prior)
 if show(CATALOG_UNIT)!="inactive" or show(PROOF_UNIT)!="inactive":
  print("S9_SAVED_TIMING_V127_DEFERRED "+json.dumps({
   "reason":"metadata_worker_busy","originals_modified":False,
   "camera_apk_modified":False,"proof_complete_not_claimed":True}),flush=True)
  return "deferred"
 if not apply:
  print("S9_SAVED_TIMING_V127_PREFLIGHT "+json.dumps({
   "old_records":len(protected),"source_timing_rows":timing_counts(prior),
   "validator_sha_verified":True,"originals_modified":False,
   "apply":False}),flush=True)
  return "preflight"
 # Existing independent scanner already validates phone SHA, original byte
 # lengths, index parity and 4K camera before atomically writing new metadata.
 start(CATALOG_UNIT,155)
 updated=catalog();new=integrity_snapshot(updated)
 if (not set(protected).issubset(new) or
     any(new[k]!=v for k,v in protected.items())):
  raise RuntimeError("recording_identity_hash_regressed_no_proof")
 n=timing_counts(updated)
 if n<1:raise RuntimeError("new_phone_timing_metadata_not_visible")
 after=verify_capture()
 start(PROOF_UNIT,60)
 proof=json.loads(safe_read(PROOF,300000))
 if proof.get("schema_version")!="s9_native_saved_prefix_quiet_hold_proof_v1":
  raise RuntimeError("saved_timing_proof_unrecognized")
 eligible=proof.get("eligible_count")
 if type(eligible) is not int or eligible<0:raise RuntimeError("proof_eligible_count_invalid")
 if proof.get("complete") is True and eligible<3:
  raise RuntimeError("proof_completed_without_three_independent_clips")
 print("S9_SAVED_TIMING_V127_VERIFIED "+json.dumps({
  "originals_still_indexed":len(new),
  "verified_native_timing_metadata_rows":n,
  "proof_eligible_quiet_end_records":eligible,
  "proof_complete":proof.get("complete") is True,
  "s9_camera_temperature_c":after["temperature_c"],
  "no_video_bytes_read_by_timing_proof":True,
  "originals_modified":False,"camera_apk_modified":False,
  "reviews_modified":False,"historical_original_hashes_unchanged":True,
  "unknown_identity_assignments_created":0
 },sort_keys=True),flush=True)
 return "verified"
if __name__=="__main__":
 p=argparse.ArgumentParser();p.add_argument("--apply",action="store_true")
 a=p.parse_args()
 refresh(a.apply)
