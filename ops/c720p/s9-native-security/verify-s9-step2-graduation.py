#!/usr/bin/env python3
"""Read-only S9 Step 2 graduation checklist; all private raw data stays local.

Never pauses camera, loads face JPEGs, emits embeddings, mutates video, or
equates reviewed appearance folders with verified biometric identity.
"""
import importlib.util
import json
from pathlib import Path
HERE=Path(__file__).resolve().parent

def module(filename,name):
 spec=importlib.util.spec_from_file_location(name,HERE/filename)
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 return mod

def summarize(release,face,pairs):
 total=int(face.get("source_original_4k_clips",0))
 current=int(face.get("v5_reviewed",0))
 remaining=int(face.get("remaining_current_v5_face_pass",total))
 counts_consistent=total>0 and 0<=current<=total and remaining==total-current
 signed=release.get("matches_current_pinned_signed_release") is True
 recording=release.get("camera_ok") is True and release.get("watching") is True and release.get("continuous_4k_ready") is True
 error_free=face.get("phone_face_deep_errors")==0
 actual_positive=int(pairs.get("positive_confirmed_pairs",0))
 actual_negative=int(pairs.get("negative_confirmed_pairs",0))
 calibrated=pairs.get("offline_thresholds_pass") is True
 approved=pairs.get("qualified_for_automated_grouping") is True
 # Keep approval fail-closed even for synthetic threshold passing fixtures.
 completed=bool(signed and recording and remaining==0 and counts_consistent and error_free and
                actual_positive>0 and actual_negative>0 and calibrated and approved)
 return {
  "status":"complete" if completed else "not_complete",
  "signed_release_installed":signed,
  "continuous_4k_healthy":recording,
  "current_v5_originals_reviewed":current,
  "source_original_4k_clips":total,
  "remaining_original_4k_reviews":remaining,
  "v5_review_fraction":round(current/total,4) if counts_consistent else 0,
  "archive_counters_consistent":counts_consistent,
  "older_face_crops_protected_but_need_v5":int(face.get("legacy_review_preserved_with_snapshots",0)),
  "face_snapshots_in_archive":int(face.get("cropped_faces_visible_in_hub",0)),
  "face_scan_error_free":error_free,
  "verified_positive_identity_pairs":actual_positive,
  "verified_negative_identity_pairs":actual_negative,
  "real_pair_thresholds_validated":calibrated,
  "automatic_identity_grouping_authorized":approved,
  "identity_validation_reason":pairs.get("reason","not_available"),
  "safe_camera_mode":release.get("watching"),
  "scanner_active":face.get("scanner_active"),
  "scanner_state":face.get("scanner_state"),
  "staged_release_present":release.get("current_pinned_signed_release_verified") is True,
  "installer_timer_active":release.get("deployment",{}).get("timer_enabled") is True,
  "installer_last_event":release.get("deployment",{}).get("last_worker_event"),
  "installer_state":release.get("deployment",{}).get("worker_state"),
  "installer_state_ref_matches_current":release.get("deployment",{}).get("worker_ref_matches_pin") is True,
  "installed_apk_sha256_prefix":str(release.get("installed_apk_sha256") or "")[:12],
  "staged_apk_sha256_prefix":str(release.get("deployment",{}).get("signed_stage") or "")[:12],
  "recordings_modified":False,
  "biometric_vectors_transferred":False,
 }
def main():
 proof=module("report-s9-release-proof.py","s9_release")
 scan=module("audit-face-pipeline-v30.py","s9_scan")
 ident=module("validate-s9-face-identity-pairs.py","s9_pairs")
 release=proof.summary(proof.apk_sha(),proof.status())
 face=scan.audit(scan.read(scan.PHONE,180000),scan.read(scan.ARCHIVE,4000000))
 # No biometric image, raw face-label corpus or similarity score is printed.
 if ident.PRIVATE.exists():
  if ident.PRIVATE.is_symlink() or ident.PRIVATE.stat().st_size>2000000:
   raise RuntimeError("unsafe_private_identity_labels")
  pair=ident.evaluate(json.loads(ident.PRIVATE.read_text(encoding="utf-8")))
 else:pair=ident.evaluate(None)
 print("S9_STEP2_LIVE_GRADUATION "+json.dumps(summarize(release,face,pair),sort_keys=True),flush=True)

if __name__=="__main__":main()
