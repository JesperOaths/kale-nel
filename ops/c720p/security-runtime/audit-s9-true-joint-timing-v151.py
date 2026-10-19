#!/usr/bin/env python3
"""Read-only fresh assessment of 7s saved prefix + 10s quiet tail in SAME clips.

Never invokes the worker's main/atomic writer, never reads MP4 bytes,
does not operate Camera2, metadata catalog, human review, or identities.
"""
import argparse
import importlib.util
import json
from pathlib import Path
import urllib.request

ROOT=Path("/home/jespern/c720p-home-hub/state")
CATALOG=ROOT/"s9-standalone-archive-catalog-v1.json"
ROLLOUT=ROOT/"s9-native-seven-second-rollout-v1.json"
PROOF=ROOT/"s9-7s-native-saved-timing-proof-v1.json"
LIB=Path(__file__).resolve().with_name("s9_7s_saved_timing_proof_v1.py")
MARK="S9_TRUE_JOINT_7S_10S_V151_READONLY "

def read(path,max_size):
 if path.is_symlink() or not path.is_file():
  raise RuntimeError("missing_or_unsafe_private_timing_state")
 st=path.stat()
 if st.st_size<100 or st.st_size>max_size or st.st_mode&0o077:
  raise RuntimeError("untrusted_private_timing_state")
 raw=path.read_bytes()
 if len(raw)!=st.st_size or path.stat().st_mtime_ns!=st.st_mtime_ns:
  raise RuntimeError("timing_state_changed_during_read")
 return json.loads(raw)

def camera():
 with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=10) as r:
  if r.status!=200:raise RuntimeError("camera_unreachable")
  b=r.read(65537)
 if len(b)>65536:raise RuntimeError("camera_status_unbounded")
 d=json.loads(b)
 if (d.get("ok") is not True or d.get("mode")!="watching"
  or d.get("native_4k_enabled") is not True
  or d.get("continuous_4k_ready") is not True
  or d.get("continuous_4k_dropped_output_frames")!=0
  or d.get("continuous_4k_error")
  or type(d.get("temperature_c")) not in (int,float)
  or not 0<d["temperature_c"]<=39.5):
  raise RuntimeError("camera_not_healthy")
 return d

def assess():
 if LIB.is_symlink() or not LIB.is_file():
  raise RuntimeError("missing_pinned_timing_library")
 spec=importlib.util.spec_from_file_location("s9_joint_timing_v151",LIB)
 mod=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(mod)
 rollout=read(ROLLOUT,150000)
 if (rollout.get("schema_version")!="s9_native_7s_cool_rollout_v1"
  or rollout.get("state")!="done" or rollout.get("installed") is not True
  or rollout.get("candidate_sha256")!=
   "37091d542b8708db26f520a67af8a4edbb687c80d2b24c01d87bf1a2d8b5d059"):
  raise RuntimeError("camera_upgrade_provenance_not_verified")
 cutoff=mod.verified_rollout_epoch_ms(ROLLOUT)
 if cutoff is None:raise RuntimeError("camera_upgrade_epoch_unverified")
 catalog=read(CATALOG,5000000)
 fresh=mod.assess(catalog,after_rollout_ms=cutoff)
 if (fresh.get("ok") is not True or
  fresh.get("joint_same_recording_required") is not True
  or fresh.get("full_frame_decode_verified") is not False
  or fresh.get("private_clip_ids_disclosed") is not False):
  # No eligible files: keep incomplete while avoiding a false proof.
  if fresh.get("eligible_count")!=0:raise RuntimeError("timing_proof_contract_invalid")
  joint=0
 else:joint=fresh.get("joint_prefix_and_tail_count",0)
 if type(joint) is not int or not 0<=joint<=24:
  raise RuntimeError("timing_joint_count_invalid")
 persisted=None
 if PROOF.is_file() and not PROOF.is_symlink():
  persisted=read(PROOF,1000000)
 if persisted is not None and persisted.get("schema_version")!=mod.SCHEMA:
  raise RuntimeError("persisted_timing_schema_invalid")
 return {"new_camera_source_attested":True,
   "fresh_eligible":fresh.get("eligible_count",0),
   "joint_prefix_6700_and_tail_10000_to_15000":joint,
   "required_independent_natural_samples":mod.MIN_SAMPLES,
   "structural_proof_complete":fresh.get("complete") is True,
   "persistent_report_consistent_if_present":(
     persisted is None or not (
       persisted.get("complete") is True and fresh.get("complete") is False)),
   "same_recording_requirement_enforced":True,
   "metadata_only_not_visual_frame_proof":True,
   "no_video_bytes_read":True,"no_media_or_review_modifications":True}

if __name__=="__main__":
 parser=argparse.ArgumentParser()
 parser.add_argument("--run",action="store_true")
 args=parser.parse_args()
 if not args.run:
  print("S9_TRUE_JOINT_V151_PREFLIGHT "+
        json.dumps({"read_only":True,"no_mp4_read":True},sort_keys=True))
 else:
  try:
   before=camera()
   stats=assess()
   after=camera()
   stats.update(camera_ready_after=True,camera_drops_after=after["continuous_4k_dropped_output_frames"],
                temperature_after_c=after["temperature_c"])
   print(MARK+json.dumps(stats,sort_keys=True),flush=True)
  except Exception:
   print("S9_TRUE_JOINT_V151_NOT_VERIFIED "+
         json.dumps({"structural_proof_complete":False,
          "no_media_modifications":True},sort_keys=True),flush=True)
   raise SystemExit(1)
