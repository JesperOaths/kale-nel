#!/usr/bin/env python3
"""Read-only, identity-free S9 face backfill audit across V26/V27 versions."""
import collections
import json
import urllib.request

OLD_VERSION="s9_onphone_36_samples_person_or_tile_v3"
ACTIVE_VERSION="s9_onphone_36_samples_person_or_tile_v4"
COUNTERS=(
 "face_detector_raw_hits",
 "face_rejected_low_confidence",
 "face_rejected_small_face",
 "face_rejected_confidence_or_size",
 "face_rejected_crop_geometry",
 "face_rejected_dark_or_blurry",
 "face_rejected_looking_away_or_roll",
 "face_manual_review_rescue_candidates",
 "face_snapshots_saved",
 "face_deep_person_roi_anchors",
 "face_deep_second_person_roi_samples",
 "face_deep_tiled_scene_samples",
 "face_review_sampled_frames",
)
def valid_int(value):
 return value if type(value) is int and 0<=value<=10000 else 0

def report(records,phone):
 if not isinstance(records,list):raise ValueError("invalid_archive_events")
 included=[r for r in records if isinstance(r,dict) and
           str(r.get("clip_no","")).startswith("motion_")]
 versions=collections.Counter(str(r.get("face_deep_review_version") or "not_reviewed") for r in included)
 groups={}
 for version in (OLD_VERSION,ACTIVE_VERSION):
  rows=[r for r in included if r.get("face_deep_review_version")==version]
  sums={key:sum(valid_int(r.get(key)) for r in rows) for key in COUNTERS}
  groups[version]={
   "scanned_clips":len(rows),
   "with_detector_hit":sum(valid_int(r.get("face_detector_raw_hits"))>0 for r in rows),
   "with_saved_snapshot":sum(valid_int(r.get("face_snapshots_saved"))>0 for r in rows),
   "with_manual_review_rescue":sum(valid_int(r.get("face_manual_review_rescue_candidates"))>0 for r in rows),
   "outcomes":dict(collections.Counter(str(r.get("face_evidence_outcome") or "unspecified") for r in rows)),
   "counters":sums,
  }
 return {
  "archive_clips":len(included),
  "versions":dict(versions),
  "review_groups":groups,
  "remaining_v27":sum(r.get("face_deep_review_version")!=ACTIVE_VERSION for r in included),
  "native_face_backfill_errors":valid_int(phone.get("face_deep_errors")),
  "native_face_backfill_since_restart":valid_int(phone.get("face_deep_scanned")),
  "camera_mode":str(phone.get("mode") or "unknown")[:30],
  "temperature_c":phone.get("temperature_c"),
  "no_identity_data_collected":True,
  "videos_modified":False,
 }

def get(url):
 with urllib.request.urlopen(url,timeout=20) as response:return json.load(response)

def main():
 phone=get("http://127.0.0.1:18808/status")
 archive=get("http://127.0.0.1:8795/new/api/saved")
 if archive.get("archive_mode")!="S9-microSD-only":
  raise RuntimeError("archive_mode_invalid")
 print("S9_FACE_V27_RECALL_AUDIT "+json.dumps(report(archive.get("events",[]),phone),sort_keys=True),flush=True)

if __name__=="__main__":main()
