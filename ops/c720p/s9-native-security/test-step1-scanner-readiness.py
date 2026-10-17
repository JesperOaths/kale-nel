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
 def test_safety_and_privacy_still_enforced(self):
  for part in ("known_thermal_fallback", "BIOMETRIC_FIELDS", "duplicate_clip_in_verified_archive",
               "archive_mode", "face_backfill_queued", "source_original_4k_clips"):
   self.assertIn(part,SOURCE)
if __name__=="__main__":unittest.main(verbosity=2)
