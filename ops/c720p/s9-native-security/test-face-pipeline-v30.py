#!/usr/bin/env python3
"""No-device end-to-end sanitized facial evidence regression."""
from pathlib import Path
import importlib.util
import unittest
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("face_v30",HERE/"audit-face-pipeline-v30.py")
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

CAMERA={"ok":True,"mode":"watching","native_4k_enabled":True,
        "continuous_4k_ready":True,"face_backfill_queued":False,
        "face_deep_errors":0}
def clip(i,**kwargs):
 result={"clip_no":"motion_"+str(1792000000000+i)+".mp4",
   "face_deep_review_version":"s9_onphone_36_samples_overlapping_tiles_v5",
   "face_model_state":"available_on_phone","face_candidates":[]}
 result.update(kwargs)
 return result
class FaceAuditV30Tests(unittest.TestCase):
 def test_reports_real_model_state_and_unverified_comparison(self):
  rows=[clip(0,face_candidates=[{
    "match_status":"anonymous_similarity_unverified",
    "person_id":"unknown_00001","face_crop_requires_manual_review":False}]),
    clip(1,face_model_state="not_tested_no_usable_face",
      face_deep_review_version="old"),
    clip(2,face_candidates=[{
      "match_status":"not_comparable_model_unavailable",
      "face_crop_padded_context_only":True}])]
  result=module.audit(CAMERA,{"archive_mode":"S9-microSD-only","events":rows})
  self.assertEqual(result["v5_reviewed"],2)
  self.assertEqual(result["legacy_review_preserved_with_snapshots"],0)
  self.assertEqual(result["reviewed_or_protected"],2)
  self.assertEqual(result["awaiting_latest_4k_face_pass"],1)
  self.assertEqual(result["clips_confirming_model_available"],2)
  self.assertEqual(result["comparisons_eligible_for_review_grouping"],1)
  self.assertEqual(result["inspection_only_face_crops"],1)
  self.assertEqual(result["cropped_faces_visible_in_hub"],2)
  self.assertFalse(result["named_identity_automatically_verified"])
 def test_legacy_snapshots_are_protected_not_permanently_pending(self):
  rows=[
    clip(0,face_deep_review_version=None,face_snapshots_saved=1,
      face_candidates=[{"match_status":"not_comparable_manual_review",
                        "face_crop_requires_manual_review":True}]),
    clip(1,face_deep_review_version="s9_onphone_36_samples_person_or_tile_v4",
      face_snapshots_saved=1,
      face_candidates=[{"match_status":"not_tested_no_usable_face"}]),
    clip(2,face_deep_review_version="s9_onphone_36_samples_person_or_tile_v4"),
    clip(3,face_deep_review_version=None)]
  result=module.audit(CAMERA,{"archive_mode":"S9-microSD-only","events":rows})
  self.assertEqual(result["source_original_4k_clips"],4)
  self.assertEqual(result["v5_reviewed"],0)
  self.assertEqual(result["legacy_review_preserved_with_snapshots"],2)
  self.assertEqual(result["reviewed_or_protected"],2)
  self.assertEqual(result["awaiting_latest_4k_face_pass"],2)
  self.assertEqual(result["inspection_only_face_crops"],1)
 def test_known_thermal_fallback_reports_without_erasing_archived_progress(self):
  rows=[
    clip(0,face_deep_review_version=None,face_model_state="not_tested_no_usable_face"),
    clip(1,face_deep_review_version="s9_onphone_36_samples_person_or_tile_v4",
      face_snapshots_saved=0,face_candidates=[]),
    clip(2,face_deep_review_version="s9_onphone_36_samples_person_or_tile_v4",
      face_snapshots_saved=2,face_candidates=[
        {"match_status":"not_comparable_model_unavailable","face_crop_requires_manual_review":True},
        {"match_status":"not_tested_no_usable_face","face_crop_padded_context_only":True}])]
  fallback={**CAMERA,"continuous_4k_ready":False,"continuous_4k_last_result":"fallback_thermal_guard",
      "continuous_4k_production_persisted":True,"mode":"watching",
      "preroll_ready":True,"preroll_buffered_ms":6500,
      "temperature_c":36.7,"face_deep_rescue_version":"s9_onphone_36_samples_person_or_tile_v4"}
  outcome=module.audit(fallback,{"archive_mode":"S9-microSD-only","events":rows})
  self.assertFalse(outcome["camera_4k_ready"])
  self.assertTrue(outcome["known_thermal_fallback"])
  self.assertFalse(outcome["face_scan_safe_to_resume_now"])
  self.assertEqual(outcome["source_original_4k_clips"],3)
  self.assertEqual(outcome["never_deep_reviewed"],1)
  self.assertEqual(outcome["older_scanned_no_face_crops"],1)
  self.assertEqual(outcome["legacy_review_preserved_with_snapshots"],1)
  self.assertEqual(outcome["awaiting_latest_4k_face_pass"],2)
  self.assertEqual(outcome["installed_face_review_version"],"s9_onphone_36_samples_person_or_tile_v4")
 def test_thermal_fallback_gating_rejects_unsafe_camera(self):
  baseline={**CAMERA,"continuous_4k_ready":False,"continuous_4k_last_result":"fallback_thermal_guard",
   "continuous_4k_production_persisted":True,"preroll_ready":True,
   "preroll_buffered_ms":6500,"mode":"watching"}
  for unsafe in (
      {"continuous_4k_last_result":"fallback_codec_health_guard"},
      {"continuous_4k_production_persisted":False},
      {"preroll_ready":False},
      {"preroll_buffered_ms":300},
      {"mode":"recording"},
      {"native_4k_enabled":False}):
   with self.subTest(unsafe=unsafe),self.assertRaises(RuntimeError):
    module.audit({**baseline,**unsafe},
      {"archive_mode":"S9-microSD-only","events":[clip(0)]})
 def test_runtime_model_diagnostics_are_separate_from_identity(self):
  row=clip(0,face_shadow_review_version="s9_shadow_model_probe_v2",
      face_shadow_model_trials=1,face_shadow_model_succeeded=1,
      face_shadow_model_failed=0)
  camera={**CAMERA,"face_backfill_queued":True,"temperature_c":38.5}
  result=module.audit(camera,{"archive_mode":"S9-microSD-only","events":[row]})
  self.assertEqual(result["scanner_state"],"actively_reviewing")
  self.assertTrue(result["scanner_active"])
  self.assertEqual(result["v2_model_diagnostic_trials"],1)
  self.assertEqual(result["v2_model_diagnostic_successes"],1)
  self.assertEqual(result["v2_model_diagnostic_failures"],0)
  self.assertFalse(result["named_identity_automatically_verified"])
 def test_idle_and_fallback_statuses(self):
  base={**CAMERA,"temperature_c":37.5}
  waiting=module.audit(base,{"archive_mode":"S9-microSD-only","events":[clip(0)]})
  self.assertEqual(waiting["scanner_state"],"waiting_for_idle_window")
  fallback={**base,"continuous_4k_ready":False,
   "continuous_4k_last_result":"fallback_thermal_guard",
   "continuous_4k_production_persisted":True,
   "preroll_ready":True,"preroll_buffered_ms":6500}
  paused=module.audit(fallback,{"archive_mode":"S9-microSD-only","events":[clip(0)]})
  self.assertEqual(paused["scanner_state"],"thermal_fallback")
 def test_never_accepts_embeddings_on_hub(self):
  for name in ("embedding","face_embedding","descriptor","biometric_template","embedding_vector"):
   with self.subTest(name=name):
    with self.assertRaises(RuntimeError):
     module.audit(CAMERA,{"archive_mode":"S9-microSD-only",
      "events":[clip(0,face_candidates=[{"match_status":"new_anonymous_candidate",name:[0]*128}])]})
 def test_unhealthy_camera_or_dup_ids_not_accepted(self):
  rows=[clip(0),clip(0)]
  with self.assertRaises(RuntimeError):
   module.audit(CAMERA,{"archive_mode":"S9-microSD-only","events":rows})
  with self.assertRaises(RuntimeError):
   module.audit({**CAMERA,"continuous_4k_ready":False},
     {"archive_mode":"S9-microSD-only","events":[clip(0)]})
 def test_no_camera_commands_or_images(self):
  src=(HERE/"audit-face-pipeline-v30.py").read_text()
  for forbidden in ("adb install","adb shell","/shot.jpg","JPEG","urllib.request.Request(",
     "POST","MediaCodec","rmtree(","unlink(","open('w')"):
   self.assertNotIn(forbidden,src)
if __name__=="__main__":unittest.main(verbosity=2)
