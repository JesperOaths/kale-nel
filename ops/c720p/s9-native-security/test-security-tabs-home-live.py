#!/usr/bin/env python3
"""S9+ Security tab and main LIVE static UI regression contracts (synthetic)."""
from pathlib import Path
import importlib.util
import re
import unittest

HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location("native_today",HERE/"patch-today-native-and-home-live.py")
P=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(P)

class Tests(unittest.TestCase):
 def test_today_first_and_no_old_camera_origin_confusion(self):
  html='<html><body><video id="player"></video><script id="c720p-s9-phone-clips-ui-v1"></script></body></html>'
  p=P.patch_clips(html)
  self.assertEqual(p,P.patch_clips(p))
  self.assertIn("Today's S9+ camera clips",p)
  self.assertIn("Europe/Amsterdam",p)
  self.assertIn("sd_verified===true",p)
  self.assertIn("window.C720PSecureRelay?.url",p)
  self.assertIn("'/new/saved/clip/'",p)
  self.assertIn("Historical C720P recorder clips appear separately",p)
  self.assertIn("No verified native S9+ recordings yet today",p)
  self.assertIn("['save','delete']",p)
  with self.assertRaises(ValueError):P.patch_clips("<body></body>")
 def test_home_live_reliably_preserves_bottom_toggle(self):
  old='''<!doctype html><body><script>
const VERSION_KEY="version",LIVE_KEY="live",KEY="security",OLD_KEY="old";
if(localStorage.getItem(VERSION_KEY)!=="v61-primary-new-only-no-s3"){localStorage.setItem(LIVE_KEY,"off");localStorage.setItem(KEY,"off");localStorage.setItem(OLD_KEY,"off");localStorage.setItem(VERSION_KEY,"v61-primary-new-only-no-s3")}
function isOn(){return localStorage.getItem(LIVE_KEY)==="on"}
const stream="/new/live.mjpg";
</script></body>'''
  new=P.patch_home(old)
  self.assertEqual(new,P.patch_home(new))
  self.assertNotIn('localStorage.setItem(LIVE_KEY,"off")',new)
  self.assertNotIn('localStorage.setItem(KEY,"off")',new)
  self.assertIn("v62-native-live-toggle-preserved",new)
  self.assertIn("BroadcastChannel('c720p-live-camera')",new)
  self.assertIn("c720p-live-camera-toggle",new)
  self.assertIn("/new/live.mjpg",new)
  with self.assertRaises(ValueError):P.patch_home("<body></body>")
 def test_js_parse_targets_are_distinct(self):
  scripts=re.findall(r'<script[^>]*>(.*?)</script>',P.TODAY,re.S)
  self.assertEqual(len(scripts),1)
  self.assertIn("const dayOf",scripts[0])
  self.assertIn("C720PSecureRelay.url",scripts[0])

if __name__=="__main__":unittest.main(verbosity=2)
