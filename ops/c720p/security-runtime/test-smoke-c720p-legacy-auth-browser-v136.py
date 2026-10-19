#!/usr/bin/env python3
"""No browser/device tests for bounded authenticated legacy S9 range smoke."""
import importlib.util
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parent
p=ROOT/"smoke-c720p-legacy-auth-browser-v136.py"
spec=importlib.util.spec_from_file_location("legacy_smoke_v136",p)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
def good():
 return {"relay_ready":True,"static_pages_served":3,"api_http":200,
  "verified_migrated_count":6,"signed_playback_url_constructed":True,
  "range_http":206,"range_bytes":1024,"no_video_decoded":True,
  "media_originals_modified":False}
class Tests(unittest.TestCase):
 def test_true_bounded_signed_media_range(self):
  d=mod.validate_result(good())
  self.assertEqual(d["migrated_manifest_count"],6)
  self.assertEqual(d["range_bytes"],1024)
  self.assertTrue(d["signed_url_not_disclosed"])
 def test_cannot_accept_nonrange_full_original_download(self):
  for patch in ({"range_http":200},{"range_bytes":5000},
    {"signed_playback_url_constructed":False},{"verified_migrated_count":0},
    {"no_video_decoded":False},{"media_originals_modified":True},
    {"static_pages_served":2},{"relay_ready":False}):
   sample=good();sample.update(patch)
   with self.subTest(patch=patch),self.assertRaises(RuntimeError):
    mod.validate_result(sample)
 def test_range_bytes_must_be_explicitly_bounded_before_read(self):
  js=mod.script()
  self.assertIn("declared>=1&&declared<=4096",js)
  self.assertIn("response.status===206",js)
  self.assertIn("response.body?.cancel()",js)
  self.assertIn("let b=await response.arrayBuffer();",js)
  self.assertLess(js.index("declared<=4096"),js.index("let b=await response.arrayBuffer();"))
 def test_no_filename_or_url_escapes_phone_browser(self):
  js=mod.script()
  self.assertIn("signed_playback_url_constructed:true",js)
  self.assertNotIn("return {ticket:",js)
  self.assertNotIn("return {rec:",js)
  self.assertNotIn("return {url:",js)
  self.assertIn("verified_migrated_count:files.length",js)
 def test_no_video_or_security_mutation_in_source(self):
  s=p.read_text()
  for unsafe in ("pm install","am force-stop","adb push","--delete",
    "window.localStorage", "eval(", "subprocess.run(", "reconfigureRecorder(",
    "camera.turn_off(", "os.unlink(", "shutil.rmtree(", "video.play()"):
   self.assertNotIn(unsafe,s)
  self.assertIn("Target.closeTarget",s)
  self.assertIn("Target.activateTarget",s)
  self.assertIn("originals_modified",s.lower().replace("media_originals_modified","originals_modified"))
if __name__=="__main__":unittest.main(verbosity=2)
