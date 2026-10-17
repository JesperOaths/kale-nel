#!/usr/bin/env python3
"""Regression check: Step 1 read-only scanner audit uses active S9+ thermal policy."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parent
SOURCE=(ROOT/"audit-face-pipeline-v30.py").read_text()

class ScannerReadiness(unittest.TestCase):
 def test_legacy_36_degree_guard_removed(self):
  self.assertNotIn('phone.get("temperature_c")<36',SOURCE)
  self.assertIn('face_review_4k_temperature_below_c',SOURCE)
  self.assertIn('41.5',SOURCE)
  self.assertIn('"remaining_current_v5_face_pass"',SOURCE)
 def test_ui_includes_legacy_crop_clips_in_remaining_v5_total(self):
  ui=(ROOT/"security-face-folders-v22.html").read_text()
  self.assertIn("' · Still need V5: '+(summary.total-summary.reviewed)",ui)

 def test_safety_and_privacy_still_enforced(self):
  for part in ("known_thermal_fallback", "BIOMETRIC_FIELDS", "duplicate_clip_in_verified_archive",
               "archive_mode", "face_backfill_queued", "source_original_4k_clips"):
   self.assertIn(part,SOURCE)

 def test_completion_gate_never_equates_preserved_crops_with_v5(self):
  import importlib.util
  p=ROOT/"verify-s9-step1-coverage.py"
  spec=importlib.util.spec_from_file_location("read_only_step1_gate",p)
  gate=importlib.util.module_from_spec(spec)
  spec.loader.exec_module(gate)
  report={"source_original_4k_clips":139,"v5_reviewed":0,
   "legacy_review_preserved_with_snapshots":52,"awaiting_latest_4k_face_pass":87,
   "current_face_review_version":"v5","installed_face_review_version":"v5",
   "phone_face_deep_errors":0,"camera_4k_ready":True}
  result=gate.evaluate(report)
  self.assertFalse(result["coverage_complete_current_or_preserved"])
  self.assertFalse(result["every_original_current_v5_complete"])
  self.assertEqual(result["pending_latest_scan"],139)
  self.assertEqual(result["pending_without_preserved_crops"],87)
  report.update(v5_reviewed=87,awaiting_latest_4k_face_pass=0)
  result=gate.evaluate(report)
  self.assertTrue(result["coverage_complete_current_or_preserved"])
  self.assertFalse(result["every_original_current_v5_complete"])
  self.assertEqual(result["pending_latest_scan"],52)
  self.assertEqual(result["pending_without_preserved_crops"],0)
  self.assertFalse(result["step_2_release_approved"])
  report.update(v5_reviewed=139,legacy_review_preserved_with_snapshots=0)
  result=gate.evaluate(report)
  self.assertTrue(result["every_original_current_v5_complete"])
  self.assertEqual(result["pending_latest_scan"],0)
  self.assertFalse(result["face_detector_accuracy_validated"])
  with self.assertRaisesRegex(RuntimeError,"partition"):
   gate.evaluate({**report,"awaiting_latest_4k_face_pass":2})
if __name__=="__main__":unittest.main(verbosity=2)
