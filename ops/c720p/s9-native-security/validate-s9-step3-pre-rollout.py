#!/usr/bin/env python3
"""Read-only Step 3 pre-rollout gate. Do not inspect faces or identify people.

This is an evidence/quality gate, not a workflow that enables recognition.
Do not treat a completed V5 scan or model self-test as accuracy validation.
"""
from pathlib import Path
import importlib.util
import json
import re

ROOT=Path(__file__).resolve().parent
CLIP=re.compile(r"motion_[0-9]{13}[.]mp4\Z")
FACE=re.compile(r"motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg\Z")
SHA=re.compile(r"[0-9a-f]{64}\Z")
BIOMETRIC={"embedding","face_embedding","descriptor","biometric_template","embedding_vector"}
FACE_VERSION="s9_onphone_36_samples_overlapping_tiles_v5"

def module(name,alias):
 spec=importlib.util.spec_from_file_location(alias,ROOT/name)
 out=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(out)
 return out

def check(release,scan,calibration,archive):
 """Fail closed, aggregate only: no face files, MP4s, IDs or model scores."""
 if not isinstance(archive,dict) or archive.get("archive_mode")!="S9-microSD-only":
  raise RuntimeError("unexpected_archive")
 events=archive.get("events")
 if not isinstance(events,list) or not events:
  raise RuntimeError("missing_original_archive")
 clips=[x for x in events if isinstance(x,dict) and CLIP.fullmatch(str(x.get("clip_no","")))]
 if len(clips)!=len(events):
  raise RuntimeError("unexpected_nonoriginal_records")
 if len({x["clip_no"] for x in clips})!=len(clips):
  raise RuntimeError("duplicate_source_recordings")
 reviewed=sum(x.get("face_deep_review_version")==FACE_VERSION for x in clips)
 metadata_images=0
 small=0
 invalid=0
 duplicate=0
 forbidden=0
 mis_scoped=0
 snapshot_names=set()
 track_sources=0
 move_unverified=0
 for clip in clips:
  if BIOMETRIC.intersection(clip):forbidden+=1
  if clip.get("face_shadow_vectors_persisted") is not False:forbidden+=1
  if clip.get("anonymous_id_scope")!="clip_only_never_across_recordings":
   mis_scoped+=1
  if clip.get("movement_evidence_scope")!="camera_image_only_not_gait_identity":
   mis_scoped+=1
  tracks=clip.get("person_tracks") or []
  if not isinstance(tracks,list) or len(tracks)>64:raise RuntimeError("invalid_person_tracks")
  if tracks and clip.get("person_track_evidence_version")!="corroborated_person_tracklets_v25":
   mis_scoped+=1
  if tracks:track_sources+=1
  if clip.get("movement_evidence_scope")=="camera_image_only_not_gait_identity":
   move_unverified+=1
  candidates=clip.get("face_candidates") or []
  if not isinstance(candidates,list) or len(candidates)>16:
   raise RuntimeError("invalid_face_evidence_shape")
  for face in candidates:
   if not isinstance(face,dict) or BIOMETRIC.intersection(face):
    forbidden+=1;continue
   name=face.get("snapshot_name")
   if not name:continue
   if not isinstance(name,str) or not FACE.fullmatch(name) or not name.startswith(clip["clip_no"][:-4]+"__"):
    invalid+=1;continue
   if name in snapshot_names:
    duplicate+=1;continue
   snapshot_names.add(name)
   size=face.get("snapshot_size")
   digest=face.get("snapshot_sha256")
   if face.get("snapshot_on_s9") is not True or type(size) is not int or not SHA.fullmatch(str(digest)):
    invalid+=1;continue
   if size<2000:
    small+=1
   elif size<=2200000:
    metadata_images+=1
   else:invalid+=1
 signed=(
   release.get("matches_current_pinned_signed_release") is True and
   release.get("camera_ok") is True and release.get("watching") is True and
   release.get("continuous_4k_ready") is True and
   release.get("deployment",{}).get("worker_ref_matches_pin") is True and
   release.get("deployment",{}).get("worker_state")=="complete" and
   release.get("deployment",{}).get("timer_healthy_recurrence") is True)
 complete=(len(clips)>0 and reviewed==len(clips) and
   scan.get("source_original_4k_clips")==len(clips) and
   scan.get("remaining_current_v5_face_pass")==0 and
   scan.get("phone_face_deep_errors")==0)
 privacy=forbidden==0 and mis_scoped==0 and duplicate==0 and invalid==0
 # A self-consistency model probe is not a cross-person discrimination test.
 positives=calibration.get("positive_confirmed_pairs",0)
 negatives=calibration.get("negative_confirmed_pairs",0)
 calibrated=(positives>=40 and negatives>=500 and
    calibration.get("offline_thresholds_pass") is True and
    calibration.get("qualified_for_automated_grouping") is True)
 blockers=[]
 if not signed:blockers.append("signed_4k_install_or_scheduler_not_verified")
 if not complete:blockers.append("incomplete_original_4k_review_or_processing_errors")
 if not privacy:blockers.append("untrusted_or_leaking_clip_evidence")
 if small:blockers.append("undersized_face_crops_require_quality_triage")
 if metadata_images==0:blockers.append("no_valid_face_image_metadata")
 if not calibrated:blockers.append("independent_same_different_face_validation_missing")
 # Explicit acceptance gates cannot be inferred from empty metadata or
 # synthetic unit tests. Require separate recorded field, privacy and
 # camera-performance pilot results in a future authorization process.
 blockers.extend(["real_field_pilot_not_verified",
                  "independent_privacy_review_not_verified",
                  "human_authorization_for_identity_grouping_not_recorded"])
 manual_review_ready=bool(signed and complete and privacy and metadata_images>0)
 return {
  "status":"blocked" if blockers else "ready",
  "manual_evidence_review_technically_ready":manual_review_ready,
  "automatic_identity_rollout_ready":False,
  "face_comparison_calibrated":bool(calibrated),
  "camera_and_signed_upgrade_verified":bool(signed),
  "current_v5_archive_complete":bool(complete),
  "original_4k_clips":len(clips),
  "current_v5_reviewed":reviewed,
  "face_images_indexable_by_metadata":metadata_images,
  "face_images_under_2000_bytes":small,
  "invalid_face_references":invalid,
  "duplicate_face_references":duplicate,
  "exposed_biometric_fields":forbidden,
  "invalid_track_scope":mis_scoped,
  "clips_with_corroborated_person_tracks":track_sources,
  "gait_identity_verified":False,
  "independent_positive_pairs":int(positives),
  "independent_negative_pairs":int(negatives),
  "blockers":blockers,
  "read_only":True,
  "original_recordings_modified":False,
  "face_embeddings_exported":False}

def main():
 proof=module("report-s9-release-proof.py","s9_release_preflight")
 review=module("audit-face-pipeline-v30.py","s9_face_preflight")
 pairs=module("validate-s9-face-identity-pairs.py","s9_pairs_preflight")
 phone=proof.status()
 archive=review.read(review.ARCHIVE,4000000)
 report=review.audit(phone,archive)
 release=proof.summary(proof.apk_sha(),phone)
 if pairs.PRIVATE.exists():
  if pairs.PRIVATE.is_symlink() or pairs.PRIVATE.stat().st_size>2000000:
   raise RuntimeError("private_calibration_untrusted")
  dataset=json.loads(pairs.PRIVATE.read_text(encoding="utf-8"))
 else:dataset=None
 calibration=pairs.evaluate(dataset)
 print("S9_STEP3_PRE_ROLLOUT_GATE "+json.dumps(
   check(release,report,calibration,archive),sort_keys=True),flush=True)

if __name__=="__main__":main()
