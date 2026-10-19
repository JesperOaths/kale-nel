#!/usr/bin/env python3
"""Offline guard for native seven-second Camera2 stage-only builder."""
from pathlib import Path
import ast
import unittest
ROOT=Path(__file__).resolve().parents[0]
BUILDER=ROOT/"build-s9-native-seven-second-tail-v1.py"
SRC=BUILDER.read_text()
class Safety(unittest.TestCase):
 def test_source_compiles_and_checks_mature_ring(self):
  ast.parse(SRC)
  self.assertIn('HISTORY_US=9000000L',SRC)
  self.assertIn('TARGET_US=7000000L',SRC)
  self.assertIn('mature_native_preroll_target_ms":7000',SRC)
  self.assertIn("capture_segment_last_accepted_motion_age_at_stop_ms",SRC)
 def test_only_stage_no_install(self):
  for needle in ('"signed":True,"installed":False','/dev/shm/s9-face-recall-v27',
       'sha256sum','apksigner','baseline_apk_sha256','source_ref_immutable',
       's9-native-seven-second-tail-v1.apk'):
   # Live checksum measured using adb shell sha256sum, never installed.
   self.assertIn(needle,SRC)
  for unexpected in ("adb install", "am force-stop", "pm uninstall", "adb reboot",
                     '"install","-r"', 'shutil.rmtree('):
   self.assertNotIn(unexpected,SRC)
 def test_preserve_assets_signer_and_installed_baseline(self):
  for term in ('APK_SIGNER_CHANGED','installed-before-v27.apk',
      'saved_current_camera_apk_not_identical_to_installed',
      'changed_model_manifest_or_native_lib',
      'unexpected_existing_signed_release'):
   self.assertIn(term,SRC)
if __name__=="__main__":unittest.main(verbosity=2)
