#!/usr/bin/env python3
"""No-phone tests for fail-closed YuNet synthetic runtime staging."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
source=HERE/"run-s9-yunet-synthetic-smoke-v121.py"
spec=importlib.util.spec_from_file_location("yunet_smoke_v121",source)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def test_existing_ort_version_pinned(self):
  self.assertIn("1.22.0",m.AAR_URI)
  self.assertEqual(m.AAR_SHA,"04a4617a9c797cf49225595e45b5546081cb34c86ac817581141577d3b7dbfe2")
 def test_phone_offline_is_not_missing_model(self):
  with patch.object(m.subprocess,"run",return_value=SimpleNamespace(
        returncode=1,stderr="ADB offline",stdout="")):
   with self.assertRaisesRegex(RuntimeError,"unavailable_phone_model_or_dex"):
    m.phone_sha("/storage/9C33-6BBD/S9OfflineModels/test.onnx")
 def test_missing_model_requires_clean_absence(self):
  with patch.object(m.subprocess,"run",return_value=SimpleNamespace(
        returncode=1,stderr="",stdout="")):
   self.assertIsNone(m.phone_sha("/data/local/tmp/s9_worker/none"))
 def test_unknown_zero_byte_partial_cannot_be_overwritten(self):
  def fake(argv,**kwargs):
   if "test -L" in argv[-1]:return SimpleNamespace(returncode=1,stderr="",stdout="")
   if "test -e" in argv[-1]:return SimpleNamespace(returncode=0,stderr="",stdout="")
   raise AssertionError("unexpected command")
  with patch.object(m.subprocess,"run",side_effect=fake):
   self.assertTrue(m.phone_path_exists_safely("/data/local/tmp/s9_worker/temp.pending"))
 def test_unknown_phone_symlink_is_refused(self):
  with patch.object(m.subprocess,"run",return_value=SimpleNamespace(
       returncode=0,stderr="",stdout="")):
   with self.assertRaisesRegex(RuntimeError,"unsafe_phone_worker_symlink"):
    m.phone_path_exists_safely("/data/local/tmp/s9_worker/test.pending")
 def test_static_device_safety(self):
  text=source.read_text()
  for needed in ("continuous_4k_dropped_output_frames","temperature_c",
                 "s9-v3-archive-backfill.lock","S9_YUNET_REAL_PHONE_SYNTHETIC_DEFERRED",
                 "S9_YUNET_REAL_PHONE_SYNTHETIC_VERIFIED","app_process","model_sha_verified"):
   self.assertIn(needed,text)
  for banned in ("am force-stop","adb install","pm install","Security4K",
                 "review_decide","delete_original","auto_assign_person","face_images.write"):
   self.assertNotIn(banned,text)
 def test_synthetic_only_java(self):
  java=(HERE/"S9YuNetOnnxSyntheticSmoke.java").read_text()
  self.assertIn("new float[3*640*640]",java)
  self.assertIn("--synthetic-smoke",java)
  self.assertNotIn("BitmapFactory",java)
  self.assertNotIn("ImageReader",java)
if __name__=="__main__":unittest.main(verbosity=2)
