#!/usr/bin/env python3
"""Read-only Step 1 gate for S9 original-4K face-review coverage.

Reports coverage honestly without implying that detector misses are proven
person-free, that weak crops prove identity, or that live camera is interrupted.
"""
import importlib.util
import json
from pathlib import Path
import sys

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("s9_step1_audit",HERE/"audit-face-pipeline-v30.py")
audit=importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)

def evaluate(summary):
 total=summary["source_original_4k_clips"]
 v5=summary["v5_reviewed"]
 preserved=summary["legacy_review_preserved_with_snapshots"]
 pending=summary["awaiting_latest_4k_face_pass"]
 if total<=0 or min(v5,preserved,pending)<0 or total!=v5+preserved+pending:
  raise RuntimeError("face_archive_partition_inconsistent")
 expected=summary["current_face_review_version"]
 running=summary["installed_face_review_version"]
 errors=summary.get("phone_face_deep_errors")
 coverage=(pending==0 and running==expected and errors==0)
 current_all=(v5==total and running==expected and errors==0)
 return {
  "original_4k_recordings":total,
  "current_version_scanned":v5,
  "older_face_crops_preserved_not_current_scanned":preserved,
  # Every older preserved crop also awaits V5; pending alone omits these clips.
  "pending_latest_scan":pending+preserved,
  "pending_without_preserved_crops":pending,
  "installed_version_matches_target":running==expected,
  "current_camera_4k_ready":summary["camera_4k_ready"],
  "phone_face_deep_errors":errors,
  "coverage_complete_current_or_preserved":coverage,
  "every_original_current_v5_complete":current_all,
  # No unlabeled person or face corpus means even a full scan cannot certify
  # recall/precision or enable dependable biometric identification.
  "face_detector_accuracy_validated":False,
  "identity_matching_qualified":False,
  "step_2_release_approved":False,
  "original_clips_mutated":False,
 }

def main():
 report=audit.audit(audit.read(audit.PHONE,180000),audit.read(audit.ARCHIVE,4000000))
 result=evaluate(report)
 print("S9_ORIGINAL_4K_STEP1_GATE "+json.dumps(result,sort_keys=True),flush=True)
 if "--require-full-current-scan" in sys.argv and not result["every_original_current_v5_complete"]:
  sys.exit(2)

if __name__=="__main__":main()
