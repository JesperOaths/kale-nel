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
FACE_VERSION="s9_onphone_36_samples_overlapping_tiles_v5"
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
 diagnostics=Counter()
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
  version=clip.get("face_deep_review_version")
  saved=int(clip.get("face_snapshots_saved") or 0)
  # The phone deliberately does not overwrite old validated snapshots on a
  # V5 upgrade. Report them as protected legacy reviews, not false V5 passes
  # or never-reviewed backlog items.
  if version==FACE_VERSION:
   pipeline["v5_reviewed"]+=1
  elif saved>0:
   pipeline["legacy_review_preserved_with_snapshots"]+=1
  else:
   pipeline["awaiting_4k_face_review"]+=1
  statuses[str(clip.get("face_model_state") or "unknown")]+=1
  if clip.get("face_model_state")=="available_on_phone":model_ready_clips+=1
  if clip.get("face_shadow_review_version")=="s9_shadow_model_probe_v2":
   diagnostics["v2_reviewed_clips"]+=1
   for key in ("face_shadow_model_trials","face_shadow_model_succeeded","face_shadow_model_failed"):
    value=clip.get(key)
    if type(value) is int and 0<=value<=1:diagnostics[key]+=value
  crops=clip.get("face_candidates")
  if not isinstance(crops,list) or len(crops)>16:
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
 camera_ready=phone.get("native_4k_enabled") is True and phone.get("continuous_4k_ready") is True
 known_thermal_fallback=(
   phone.get("native_4k_enabled") is True and
   phone.get("mode")=="watching" and
   phone.get("continuous_4k_ready") is False and
   phone.get("continuous_4k_last_result")=="fallback_thermal_guard" and
   phone.get("continuous_4k_production_persisted") is True and
   phone.get("preroll_ready") is True and
   isinstance(phone.get("preroll_buffered_ms"),int) and
   phone["preroll_buffered_ms"]>=4000)
 if not camera_ready and not known_thermal_fallback:
  raise RuntimeError("unknown_4k_fault_or_camera_unhealthy")
 never_reviewed=sum(not clip.get("face_deep_review_version") and
                    int(clip.get("face_snapshots_saved") or 0)==0 for clip in clips)
 prior_scanned_no_crops=sum(clip.get("face_deep_review_version") not in (None,"",FACE_VERSION)
                            and int(clip.get("face_snapshots_saved") or 0)==0 for clip in clips)
 current_version=str(phone.get("face_deep_rescue_version") or "not_reported")
 scanner_active=phone.get("face_backfill_queued") is True
 temperature=phone.get("temperature_c")
 thermal_ready=isinstance(temperature,(int,float)) and temperature<41.5
 scanner_state=("actively_reviewing" if scanner_active else
   "thermal_fallback" if known_thermal_fallback else
   "too_warm" if not thermal_ready else
   "waiting_for_idle_window" if camera_ready else "not_ready")
 return {
  "camera_ok":True,"camera_mode":phone.get("mode"),
  "camera_4k_ready":camera_ready,
  "known_thermal_fallback":known_thermal_fallback,
  "face_scan_safe_to_resume_now":bool(camera_ready and phone.get("mode")=="watching" and
   phone.get("face_backfill_queued") is not True and
   isinstance(phone.get("temperature_c"),(int,float)) and
   phone.get("temperature_c")<min(41.5,float(phone.get("face_review_4k_temperature_below_c",41.5)))),
  "installed_face_review_version":current_version,
  "scanner_state":scanner_state,
  "scanner_active":scanner_active,
  "v2_model_diagnostic_clips":diagnostics["v2_reviewed_clips"],
  "v2_model_diagnostic_trials":diagnostics["face_shadow_model_trials"],
  "v2_model_diagnostic_successes":diagnostics["face_shadow_model_succeeded"],
  "v2_model_diagnostic_failures":diagnostics["face_shadow_model_failed"],
  "never_deep_reviewed":never_reviewed,
  "older_scanned_no_face_crops":prior_scanned_no_crops,
  "current_face_review_version":FACE_VERSION,
  "source_original_4k_clips":len(clips),"v5_reviewed":pipeline["v5_reviewed"],
  "legacy_review_preserved_with_snapshots":pipeline["legacy_review_preserved_with_snapshots"],
  "reviewed_or_protected":pipeline["v5_reviewed"]+pipeline["legacy_review_preserved_with_snapshots"],
  # Legacy crops are protected, but still require the current V5 tile review.
  "awaiting_latest_4k_face_pass":pipeline["awaiting_4k_face_review"],
  "remaining_current_v5_face_pass":len(clips)-pipeline["v5_reviewed"],
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
