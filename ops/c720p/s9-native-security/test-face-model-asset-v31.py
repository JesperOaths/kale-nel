#!/usr/bin/env python3
"""Offline tests of installed APK model-asset inspection contract."""
import importlib.util
from pathlib import Path
import tempfile,unittest,zipfile
DIR=Path(__file__).resolve().parent
PATH=DIR/"audit-face-model-asset-v31.py"
spec=importlib.util.spec_from_file_location("faceassetv31",PATH)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class ApkFaceAsset(unittest.TestCase):
 def test_detect_absent_model(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/"apk.zip"
   with zipfile.ZipFile(p,"w") as z:z.writestr("AndroidManifest.xml",b"manifest")
   result=m.summarize_model(p)
   self.assertFalse(result["installed_model_asset"])
 def test_detect_model_without_claiming_compatibility(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/"apk.zip"
   with zipfile.ZipFile(p,"w") as z:z.writestr(m.NAME,b"x"*160000)
   result=m.summarize_model(p)
   self.assertTrue(result["installed_model_asset"])
   self.assertEqual(result["model_asset_size"],160000)
   self.assertEqual(result["model_compatibility"],"tensor_contract_requires_on_device_inference_test")
 def test_path_rejects_ambiguous_device_apk(self):
  good="package:/data/app/nl.kalenel.s9security-abc==/base.apk"
  self.assertEqual(m.apk_path(good),good.split(":",1)[1])
  for invalid in ("",good+"\n"+good,"package:/sdcard/evil.apk"):
   with self.assertRaises(RuntimeError):m.apk_path(invalid)
 def test_source_never_reads_private_face_or_video_data(self):
  text=PATH.read_text()
  for banned in ("KnownFaces/","FaceSnapshots/","Security4K/",
    "/shot.jpg","MediaCodec","adb install","shell am","unlink(",
    "rmtree(","DELETE ","POST "):
   self.assertNotIn(banned,text)
if __name__=="__main__":unittest.main(verbosity=2)
