#!/usr/bin/env python3
"""No C720P connected: old-version guard, backups and SHA-pinned metadata."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("timing_v126",ROOT/"deploy-s9-timing-metadata-v126.py")
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
class Tests(unittest.TestCase):
 def test_previous_live_sha_is_real_readonly_diagnostic(self):
  self.assertEqual(mod.OLD_SHA,"345b51532b06918329eaba5e12d4e9fa8366628161a8912bcd4f7291646e28f2")
 def test_new_source_has_all_five_fields(self):
  src=(ROOT/"phone_archive_catalog_v1.py").read_bytes()
  mod.safe_source(src)
  for field in mod.FIELDS:self.assertIn(field,src.decode())
 def test_wrong_source_is_not_accepted(self):
  with self.assertRaisesRegex(RuntimeError,"invalid_target_module_size"):
   mod.safe_source(b"not original catalog")
 def test_no_originals_or_camera_mutations_in_installer(self):
  src=(ROOT/"deploy-s9-timing-metadata-v126.py").read_text()
  for forbidden in ("am force-stop","adb install","pm install","Security4K",
                    "review_decide","delete_original","open_video","restart Camera2"):
   self.assertNotIn(forbidden,src)
  self.assertIn("newer_live_module_no_overwrite",src)
  self.assertIn('atomic(MODULE,before,oldmode)',src)
  self.assertIn("fcntl.LOCK_EX|fcntl.LOCK_NB",src)
if __name__=="__main__":unittest.main(verbosity=2)
