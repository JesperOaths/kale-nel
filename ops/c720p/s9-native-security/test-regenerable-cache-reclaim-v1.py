#!/usr/bin/env python3
"""Regression tests for the C720P bounded, cache-only disk cleanup."""
import contextlib
from io import StringIO
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE=Path(__file__).with_name("reclaim-regenerable-chromium-cache.py")
spec=importlib.util.spec_from_file_location("safe_cache_reclaim",SOURCE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class SafeReclaimTests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory()
  self.addCleanup(self.temp.cleanup)
  self.root=Path(self.temp.name)/"chromium-headless"
  self.root.mkdir()
  self.cache=self.root/"Default"/"GPUCache"
  self.cache.mkdir(parents=True)
  (self.cache/"temporary.bin").write_bytes(b"a"*6000)
  self.protected=self.root/"Default"/"Cookies"
  self.protected.write_bytes(b"never-delete-me")
  self.model=Path(self.temp.name)/"model"
  self.model.write_bytes(b"model-is-not-a-cache")

 def call(self,apply=False,occupied=False):
  output=StringIO()
  with patch.object(m,"BASE",self.root),patch.object(m,"BUILD",self.model),\
       patch.object(m,"occupied",return_value=occupied),\
       contextlib.redirect_stdout(output):
   m.run(apply=apply)
  report=json.loads(output.getvalue().split("SECURITY_REGENERABLE_CACHE_CLEANUP_V1 ",1)[1])
  return report

 def test_default_mode_never_deletes_even_when_cache_is_eligible(self):
  report=self.call()
  self.assertEqual(report["status"],"dry_run_only")
  self.assertFalse(report["apply_requested"])
  self.assertTrue(self.cache.is_dir())
  self.assertEqual(self.protected.read_bytes(),b"never-delete-me")

 def test_apply_only_removes_approved_cache(self):
  report=self.call(apply=True)
  self.assertEqual(report["status"],"finished")
  self.assertTrue(report["apply_requested"])
  self.assertFalse(self.cache.exists())
  self.assertEqual(self.protected.read_bytes(),b"never-delete-me")
  self.assertEqual(self.model.read_bytes(),b"model-is-not-a-cache")
  self.assertFalse(report["video_deleted"])
  self.assertFalse(report["backup_deleted"])

 def test_busy_chromium_causes_skip_without_cleanup(self):
  report=self.call(apply=True,occupied=True)
  self.assertEqual(report["status"],"skipped_profile_in_use")
  self.assertTrue(self.cache.is_dir())

 def test_symlinked_cache_never_follows_destination(self):
  outside=Path(self.temp.name)/"outside"
  outside.mkdir()
  (outside/"retain").write_bytes(b"outside-private-data")
  (self.root/"Default"/"Code Cache").symlink_to(outside,target_is_directory=True)
  self.call(apply=True)
  self.assertEqual((outside/"retain").read_bytes(),b"outside-private-data")

if __name__=="__main__":
 unittest.main(verbosity=2)
