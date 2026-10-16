#!/usr/bin/env python3
"""Read-only anonymous V26 runtime and archive progress diagnosis."""
import collections,json,urllib.request
def get(url):
 with urllib.request.urlopen(url,timeout=20) as response:return json.load(response)
camera=get("http://127.0.0.1:18808/status")
data=get("http://127.0.0.1:8795/new/api/saved")
if data.get("archive_mode")!="S9-microSD-only":raise RuntimeError("archive_mode_invalid")
records=[r for r in data.get("events",[]) if str(r.get("clip_no","")).startswith("motion_")]
versions=collections.Counter(str(r.get("face_deep_review_version") or "not_reviewed") for r in records)
outcomes=collections.Counter(str(r.get("face_evidence_outcome") or "missing") for r in records)
sampled=collections.Counter(">=36" if int(r.get("face_review_sampled_frames") or 0)>=36 else
 "1..35" if int(r.get("face_review_sampled_frames") or 0)>0 else "0" for r in records)
# Only aggregate anonymous detector counts; never return names, clip IDs,
# image bytes, face crops, similarity scores or embedding vectors.
reviewed=[x for x in records if x.get("face_deep_review_version")=="s9_onphone_36_samples_person_or_tile_v3"]
counter_keys=("face_detector_raw_hits","face_rejected_confidence_or_size",
 "face_rejected_looking_away_or_roll","face_rejected_crop_geometry",
 "face_rejected_dark_or_blurry","face_deep_tiled_scene_samples",
 "face_deep_second_person_roi_samples","face_deep_person_roi_anchors")
def total(key):
 return sum(v for r in reviewed if type(v:=r.get(key)) is int and 0<=v<=1000)
def provided(key):
 return sum(type(r.get(key)) is int for r in reviewed)
v3_outcomes=collections.Counter(str(r.get("face_evidence_outcome") or "unknown") for r in reviewed)
v3_review_status=collections.Counter(str(r.get("face_review_status") or "unknown") for r in reviewed)
v3_stats={key:{"sum":total(key),"records_reporting":provided(key)} for key in counter_keys}
report={"archive_clips":len(records),"deep_versions":dict(versions),
 "outcomes":dict(outcomes),"sampling":dict(sampled),
 "v3_face_outcomes":dict(v3_outcomes),"v3_review_status":dict(v3_review_status),
 "v3_detector_rejection_counters":v3_stats,
 "clips_with_face_snapshots":sum(bool(r.get("face_snapshots_saved")) for r in records),
 "clips_with_person_candidate":sum(int(r.get("person_count") or 0)>0 for r in records),
 "phone":{"mode":camera.get("mode"),
 "face_deep_rescue_version":camera.get("face_deep_rescue_version"),
 "face_backfill_queued":camera.get("face_backfill_queued"),
 "face_backfill_completed":camera.get("face_backfill_completed"),
 "face_backfill_errors":camera.get("face_backfill_errors"),
 "face_deep_scanned":camera.get("face_deep_scanned"),
 "face_deep_errors":camera.get("face_deep_errors"),
 "face_backfill_retry_limited_clips":camera.get("face_backfill_retry_limited_clips"),
 "temperature_c":camera.get("temperature_c"),
 "sd_free_gib":round(float(camera.get("sd_free_bytes") or 0)/1024**3,2),
 "last_movement_age_ms":camera.get("person_last_accepted_motion_age_ms"),
 "garden_person_gate_busy":camera.get("garden_person_gate_busy"),
 "continuous_4k_ready":camera.get("continuous_4k_ready")},
 "face_images_read":False,"identity_vectors_read":False,"recordings_modified":False}
print("S9_FACE_V26_RUNTIME_AUDIT "+json.dumps(report,sort_keys=True),flush=True)
