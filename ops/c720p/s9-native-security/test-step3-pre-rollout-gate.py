#!/usr/bin/env python3
"""Synthetic, no-device tests of the Step 3 pre-rollout gate."""
import importlib.util
from pathlib import Path
import unittest
P=Path(__file__).with_name("validate-s9-step3-pre-rollout.py")
spec=importlib.util.spec_from_file_location("step3_preflight",P)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
C="motion_1792200000000.mp4"
def archive():
 return {"archive_mode":"S9-microSD-only","events":[{
   "clip_no":C,"face_deep_review_version":m.FACE_VERSION,
   "face_shadow_vectors_persisted":False,
   "anonymous_id_scope":"clip_only_never_across_recordings",
   "movement_evidence_scope":"camera_image_only_not_gait_identity",
   "person_tracks":[],"face_candidates":[{
     "snapshot_name":"motion_1792200000000__face_a__3500_0.jpg",
     "snapshot_on_s9":True,"snapshot_size":11000,
     "snapshot_sha256":"a"*64}]}]}
def release():
 return {"matches_current_pinned_signed_release":True,
   "camera_ok":True,"watching":True,"continuous_4k_ready":True,
   "deployment":{"worker_ref_matches_pin":True,"worker_state":"complete",
                 "timer_healthy_recurrence":True}}
def scan():
 return {"source_original_4k_clips":1,"remaining_current_v5_face_pass":0,
         "phone_face_deep_errors":0}
def pairs():
 return {"positive_confirmed_pairs":0,"negative_confirmed_pairs":0,
         "qualified_for_automated_grouping":False,"offline_thresholds_pass":False}
class Gate(unittest.TestCase):
 def test_healthy_scanned_archive_still_not_identity_validated(self):
  v=m.check(release(),scan(),pairs(),archive())
  self.assertTrue(v["manual_evidence_review_technically_ready"])
  self.assertFalse(v["automatic_identity_rollout_ready"])
  self.assertEqual(v["current_v5_reviewed"],1)
  self.assertEqual(v["face_images_with_valid_source_metadata"],1)
  self.assertEqual(v["face_images_2000_bytes_or_larger"],1)
  self.assertIn("independent_same_different_face_validation_missing",v["blockers"])
  self.assertTrue(v["read_only"])
 def test_tiny_face_crops_are_not_indexable(self):
  a=archive();a["events"][0]["face_candidates"][0]["snapshot_size"]=1710
  got=m.check(release(),scan(),pairs(),a)
  self.assertEqual(got["face_images_under_2000_bytes"],1)
  self.assertEqual(got["face_images_with_valid_source_metadata"],1)
  self.assertEqual(got["face_images_2000_bytes_or_larger"],0)
  self.assertIn("small_jpeg_images_need_resolution_quality_review",got["blockers"])
  self.assertTrue(got["jpeg_byte_size_is_not_a_integrity_failure"])
 def test_duplicate_or_mismatched_evidence_fails_privacy_gate(self):
  a=archive()
  a["events"][0]["anonymous_id_scope"]="across_recordings"
  self.assertFalse(m.check(release(),scan(),pairs(),a)["manual_evidence_review_technically_ready"])
  a=archive()
  a["events"][0]["face_candidates"][0]["embedding"]=[1,2]
  got=m.check(release(),scan(),pairs(),a)
  self.assertFalse(got["manual_evidence_review_technically_ready"])
  self.assertEqual(got["exposed_biometric_fields"],1)
 def test_signed_version_is_not_enough_without_current_worker_and_4k(self):
  r=release();r["deployment"]["worker_ref_matches_pin"]=False
  self.assertFalse(m.check(r,scan(),pairs(),archive())["manual_evidence_review_technically_ready"])
  r=release();r["continuous_4k_ready"]=False
  self.assertFalse(m.check(r,scan(),pairs(),archive())["manual_evidence_review_technically_ready"])
 def test_scan_errors_block_even_with_all_clips_reported_as_v5(self):
  v=scan();v["phone_face_deep_errors"]=1
  self.assertFalse(m.check(release(),v,pairs(),archive())["current_v5_archive_complete"])
 def test_genuine_offline_stats_can_pass_without_identity_approval(self):
  evaluated={"positive_confirmed_pairs":40,"negative_confirmed_pairs":500,
   "true_positive_95pct_lower":0.912,"false_acceptance_95pct_upper":0.0076,
   "offline_thresholds_pass":True,"qualified_for_automated_grouping":False}
  result=m.check(release(),scan(),evaluated,archive())
  self.assertTrue(result["face_comparison_calibrated"],
                  "Offline calibration cannot depend on identity rollout permission")
  self.assertFalse(result["pair_gate_authorized_automated_identity_grouping"])
  self.assertFalse(result["automatic_identity_rollout_ready"])
  self.assertTrue(result["offline_validation_does_not_authorize_deployment"])
  self.assertNotIn("independent_same_different_face_validation_missing",result["blockers"])
  self.assertIn("real_field_pilot_not_verified",result["blockers"])
 def test_high_raw_accuracy_with_insufficient_confidence_does_not_calibrate(self):
  evaluated={"positive_confirmed_pairs":40,"negative_confirmed_pairs":500,
   "true_positive_95pct_lower":0.82,"false_acceptance_95pct_upper":0.0076,
   "offline_thresholds_pass":True,"qualified_for_automated_grouping":False}
  self.assertFalse(m.check(release(),scan(),evaluated,archive())["face_comparison_calibrated"])
 def test_fake_human_scores_cannot_authorize_rollout(self):
  p={"positive_confirmed_pairs":100,"negative_confirmed_pairs":900,
     "qualified_for_automated_grouping":True,"offline_thresholds_pass":True}
  got=m.check(release(),scan(),p,archive())
  self.assertFalse(got["automatic_identity_rollout_ready"])
  self.assertIn("real_field_pilot_not_verified",got["blockers"])
  self.assertIn("independent_privacy_review_not_verified",got["blockers"])
 def test_unexpected_archive_not_accepted(self):
  a=archive();a["archive_mode"]="other"
  with self.assertRaisesRegex(RuntimeError,"unexpected_archive"):
   m.check(release(),scan(),pairs(),a)
 def test_strictly_read_only_no_identification_or_media_mutations(self):
  text=P.read_text()
  for prohibited in ("adb install","force-stop","write_bytes(", "write_text(",
                     "cv2.imread","MediaMetadataRetriever","/new/saved/face/"):
   self.assertNotIn(prohibited,text)

if __name__=="__main__":unittest.main(verbosity=2)
