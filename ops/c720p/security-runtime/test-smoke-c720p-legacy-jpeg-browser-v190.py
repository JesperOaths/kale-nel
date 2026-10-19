#!/usr/bin/env python3
"""No-hub regression for private authenticated legacy JPEG browser smoke."""
import ast
import importlib.util
from pathlib import Path
import unittest

SOURCE=Path(__file__).with_name("smoke-c720p-legacy-jpeg-browser-v190.py")
spec=importlib.util.spec_from_file_location("legacy_jpeg_browser_v190",SOURCE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def fixture():
 return {"ok":True,"real_served_legacy_pages":2,
  "same_origin_authenticated_relay":True,
  "served_dynamic_script_verified":True,"signed_s9_jpeg_images_loaded":6,
  "late_camera_clips_image_loaded":True,
  "local_fallback_event_simulation":True,
  "original_save_delete_controls_preserved":True,
  "no_person_media_or_settings_changes":True,
  "private_filenames_not_returned":True,
  "signed_urls_not_returned":True}
class Tests(unittest.TestCase):
 def test_proof_requires_exactly_six_signed_images_and_dynamic_load(self):
  report=m.validate(fixture())
  self.assertEqual(report["authenticated_s9_thumbnails_loaded"],6)
  for k,v in (("signed_s9_jpeg_images_loaded",5),
    ("late_camera_clips_image_loaded",False),
    ("local_fallback_event_simulation",False),
    ("no_person_media_or_settings_changes",False),
    ("signed_urls_not_returned",False)):
   with self.subTest(k=k),self.assertRaisesRegex(RuntimeError,"legacy_jpeg_v190_metrics"):
    m.validate({**fixture(),k:v})
 def test_auth_and_untrusted_filename_proofs_refused(self):
  with self.assertRaisesRegex(RuntimeError,"legacy_jpeg_v190_auth_relay_missing"):
   m.validate({"ok":False,"reason":"auth_relay_missing"})
  with self.assertRaisesRegex(RuntimeError,"legacy_jpeg_v190_unknown"):
   m.validate({"ok":False,"reason":"https://secret.example"})
 def test_test_does_not_click_save_or_play_media(self):
  js=m.browser_script()
  self.assertIn("MutationObserver",js)
  self.assertIn("C720PSecureRelay",js)
  self.assertIn("real_served_legacy_pages:2",js)
  self.assertIn("images[0].dispatchEvent(new Event('error'))",js)
  self.assertIn("finally{script.remove();container.remove();}",js)
  for banned in ("saveClip(","deleteClip(","/save?","/delete?","video.play(",
      "getUserMedia(","fetch('/new/people/"):
   self.assertNotIn(banned,js)
  tree=ast.parse(SOURCE.read_text())
  calls=[n.func.attr for n in ast.walk(tree) if isinstance(n,ast.Call)
         and isinstance(n.func,ast.Attribute)]
  for banned in ("write_text","write_bytes","unlink","remove","rmtree",
                 "replace","Popen","restart","system","chmod"):
   self.assertNotIn(banned,calls)

if __name__=="__main__":unittest.main(verbosity=2)
