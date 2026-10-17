#!/usr/bin/env python3
"""Read-only end-to-end S9 face pipeline readiness audit.

Reads only original-4K camera status and sanitized C720P relay metadata,
never photographs, names, biometric embeddings or MP4 content. No state change.
"""
from collections import Counter
import json
import re
import urllib.request

PHONE="http://127.0.0.1:18808/status"
ARCHIVE="http://127.0.0.1:8795/new/api/saved"
FACE_VERSION="s9_onphone_36_samples_person_or_tile_v4"
CLIP=re.compile(r"motion_[0-9]{13}[.]mp4")
SAFE_MATCHES={
 "not_comparable_model_unavailable","not_comparable_manual_review","not_tested_no_usable_face",
 "reference_similarity_unverified",
 "anonymous_similarity_unverified","new_anonymous_candidate",
 "face_model_changed_requires_reenrollment","face_index_read_error",
 "face_database_unavailable","face_index_capacity_reached"}
BIOMETRIC_FIELDS={"embedding","face_embedding","descriptor","biometric_template","embedding_vector"}

def read(url,limit):
 with urllib.request.urlopen(url,timeout=22) as response:
  if response.status!=200:raise RuntimeError("metadata_unavailable")
  b=response.read(limit+1)
 if len(b)>limit:raise RuntimeError("bounded_metadata_size_exceeded")
 return json.loads(b)

def audit(phone,archive):
 if not isinstance(phone,dict) or not phone.get("ok"):
  raise RuntimeError("phone_not_healthy")
 if archive.get("archive_mode")!="S9-microSD-only" or not isinstance(archive.get("events"),list):
  raise RuntimeError("microSD_catalog_unavailable")
 clips=[r for r in archive["events"] if isinstance(r,dict) and CLIP.fullmatch(str(r.get("clip_no","")))]
 if len(clips)<1:raise RuntimeError("no_original_4k_clips")
 statuses=Counter()
 matches=Counter()
 pipeline=Counter()
 seen=set()
 snapshots=0
 weak=0
 recognized=0
 manual=0
 strict_pairs=0
 model_ready_clips=0
 for clip in clips:
  name=clip["clip_no"]
  if name in seen:raise RuntimeError("duplicate_clip_in_verified_archive")
  seen.add(name)
  pipeline["v4_reviewed" if clip.get("face_deep_review_version")==FACE_VERSION else "not_yet_v4"]+=1
  statuses[str(clip.get("face_model_state") or "unknown")]+=1
  if clip.get("face_model_state")=="available_on_phone":model_ready_clips+=1
  crops=clip.get("face_candidates")
  if not isinstance(crops,list) or len(crops)>8:
   raise RuntimeError("sanitized_face_candidate_shape_changed")
  snapshots+=len(crops)
  if len(crops)>0:pipeline["clips_with_crops"]+=1
  if len(crops)==0 and clip.get("face_evidence_outcome")=="face_candidates_rejected_in_sampling":
   pipeline["detected_but_unusable_face"]+=1
  for face in crops:
   if not isinstance(face,dict) or BIOMETRIC_FIELDS.intersection(face):
    raise RuntimeError("biometric_data_exposed_through_hub")
   state=str(face.get("match_status","missing"))
   if state not in SAFE_MATCHES:raise RuntimeError("unknown_face_match_status")
   matches[state]+=1
   if face.get("face_crop_requires_manual_review") or face.get("face_crop_padded_context_only"):
    manual+=1
   if state in ("anonymous_similarity_unverified","reference_similarity_unverified"):
    recognized+=1
    if not face.get("face_crop_requires_manual_review") and not face.get("face_crop_padded_context_only"):
     strict_pairs+=1
   elif state=="new_anonymous_candidate":weak+=1
 if not phone.get("native_4k_enabled") or not phone.get("continuous_4k_ready"):
  raise RuntimeError("native_4k_unhealthy")
 return {
  "camera_ok":True,"camera_mode":phone.get("mode"),
  "current_face_review_version":FACE_VERSION,
  "source_original_4k_clips":len(clips),"v4_reviewed":pipeline["v4_reviewed"],
  "awaiting_latest_4k_face_pass":pipeline["not_yet_v4"],
  "clips_with_face_crops":pipeline["clips_with_crops"],
  "cropped_faces_visible_in_hub":snapshots,
  "clipped_face_detections_rejected":pipeline["detected_but_unusable_face"],
  "phone_embedding_model_state_by_clip":dict(statuses),
  "candidate_match_state_counts":dict(matches),
  "clips_confirming_model_available":model_ready_clips,
  "repeat_similarity_suggestions":recognized,
  "comparisons_eligible_for_review_grouping":strict_pairs,
  "new_anonymous_first_sightings":weak,
  "inspection_only_face_crops":manual,
  "phone_face_backfill_active":phone.get("face_backfill_queued"),
  "phone_face_deep_errors":phone.get("face_deep_errors"),
  "camera_temperature_c":phone.get("temperature_c"),
  "all_biometric_templates_stay_on_phone":True,
  "named_identity_automatically_verified":False,
  "archive_mutated":False
 }

def main():
 result=audit(read(PHONE,180000),read(ARCHIVE,4000000))
 print("S9_FACE_PIPELINE_V30_AUDIT "+json.dumps(result,sort_keys=True),flush=True)

if __name__=="__main__":
 main()
