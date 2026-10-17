#!/usr/bin/env python3
"""Synthetic status-contract tests; no attempt to infer a real identity."""
import importlib.util
from pathlib import Path
import unittest
from unittest import mock
P=Path(__file__).with_name("verify-s9-step2-graduation.py")
spec=importlib.util.spec_from_file_location("step2_status",P)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class Step2(unittest.TestCase):
 def setUp(self):
  self.release={"matches_current_pinned_signed_release":True,
   "current_pinned_signed_release_verified":True,
   "camera_ok":True,"watching":True,"continuous_4k_ready":True,
   "installed_apk_sha256":"a"*64,
   "deployment":{"signed_stage":"a"*64}}
  self.face={"source_original_4k_clips":141,"v5_reviewed":141,
   "remaining_current_v5_face_pass":0,"phone_face_deep_errors":0,
   "scanner_state":"waiting_for_idle_window","scanner_active":False}
  self.pairs={"positive_confirmed_pairs":40,"negative_confirmed_pairs":500,
   "offline_thresholds_pass":True,"qualified_for_automated_grouping":False,
   "reason":"passed_offline_calibration_requires_independent_approval"}
 def test_complete_archive_still_blocks_unapproved_identity(self):
  status=mod.summarize(self.release,self.face,self.pairs)
  self.assertEqual(status["status"],"not_complete")
  self.assertFalse(status["automatic_identity_grouping_authorized"])
  self.assertTrue(status["signed_release_installed"])
  self.assertEqual(status["v5_review_fraction"],1.0)
  self.assertEqual(status["face_snapshots_in_archive"],0)
  self.assertEqual(status["older_face_crops_protected_but_need_v5"],0)
  self.assertFalse(status["installer_timer_active"])
  self.release["deployment"].update(timer_enabled=True,
      last_worker_event="deferred_motion_or_background_work",
      worker_state="waiting",worker_ref_matches_pin=True)
  status=mod.summarize(self.release,self.face,self.pairs)
  self.assertTrue(status["installer_timer_active"])
  self.assertEqual(status["installer_last_event"],"deferred_motion_or_background_work")
  self.assertTrue(status["installer_state_ref_matches_current"])
 def test_missing_ground_truth_disables_identity_even_if_camera_healthy(self):
  self.pairs={"reason":"verified_labels_unavailable"}
  output=mod.summarize(self.release,self.face,self.pairs)
  self.assertEqual(output["verified_positive_identity_pairs"],0)
  self.assertFalse(output["real_pair_thresholds_validated"])
 def test_old_binary_or_incomplete_review_refuses_graduation(self):
  self.release["matches_current_pinned_signed_release"]=False
  self.face["remaining_current_v5_face_pass"]=50
  status=mod.summarize(self.release,self.face,self.pairs)
  self.assertFalse(status["signed_release_installed"])
  self.assertEqual(status["remaining_original_4k_reviews"],50)
  self.assertEqual(status["v5_review_fraction"],1.0)
  self.assertEqual(status["status"],"not_complete")
 def test_status_report_never_touches_clips_or_exports_vectors(self):
  content=P.read_text()
  for forbidden in ("adb install","force-stop","video.read_bytes","FaceSnapshots",
     "embedding_vector","write_text(","os.remove(","unlink(","print(face)"):
   self.assertNotIn(forbidden,content)

if __name__=="__main__":unittest.main(verbosity=2)
