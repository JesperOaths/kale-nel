#!/usr/bin/env python3
"""Synthetic guard/page integration and safety tests, no live services."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

DIR=Path(__file__).resolve().parent
TARGET=DIR/"deploy-c720p-s9-jpeg-pages-v187.py"
GUARD_SOURCE=DIR/"c720p_legacy_s9_index_bridge_guard_v1.py"
spec=importlib.util.spec_from_file_location("jpeg_page_rollout",TARGET)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Tests(unittest.TestCase):
 def test_new_watchdog_reattaches_both_scripts_without_touching_controls(self):
  old=GUARD_SOURCE.read_bytes()
  revised=m.patched_guard(old)
  compile(revised.decode(),"test_guard_v187.py","exec")
  self.assertIn(b"SNAPSHOT_BRIDGE",revised)
  self.assertIn(b"EXPECTED_SNAPSHOT_GIT_BLOB",revised)
  with tempfile.TemporaryDirectory() as d:
   temp=Path(d)/"guard.py";temp.write_bytes(revised)
   spec=importlib.util.spec_from_file_location("installed_v187_guard",temp)
   new=importlib.util.module_from_spec(spec);spec.loader.exec_module(new)
   base=("<html><head>"+m.TITLE+"</head><body>"
        "<div>saveClip(1)</div><video src='clips/safe.mp4'></video>"
        +("<p>thumbnail-test-row</p>"*35)
        +"</body></html>").encode()
   both=new.new_html(base)
   self.assertEqual(both.count(m.VIDEO_TAG.encode()),1)
   self.assertEqual(both.count(m.JPEG_TAG.encode()),1)
   self.assertIn(b"saveClip(1)",both)
   self.assertIsNone(new.new_html(both))
   original_video=base.replace(m.TITLE.encode(),
                               (m.TITLE+m.VIDEO_TAG).encode())
   new_only=new.new_html(original_video)
   self.assertEqual(new_only.count(m.VIDEO_TAG.encode()),1)
   self.assertEqual(new_only.count(m.JPEG_TAG.encode()),1)
   with self.assertRaisesRegex(ValueError,"untrusted_existing_snapshot_bridge"):
    new.new_html(new_only.replace(m.JPEG_TAG.encode(),b"c720p-migrated-snapshot-display-v182.js"))

 def test_html_patches_preserve_old_contents(self):
  source=("<html><head>"+m.TITLE+m.VIDEO_TAG+"</head>"
          "<body><button>saveClip(0)</button>clips/a.mp4</body></html>").encode()
  augmented=m.add_tag(source,m.VIDEO_TAG,m.JPEG_TAG,"saveClip(")
  self.assertEqual(augmented.count(m.VIDEO_TAG.encode()),1)
  self.assertEqual(augmented.count(m.JPEG_TAG.encode()),1)
  self.assertIn(b"saveClip(0)",augmented)
  with self.assertRaisesRegex(m.Refused,"already_contains_snapshot_bridge"):
   m.add_tag(augmented,m.VIDEO_TAG,m.JPEG_TAG,"saveClip(")
  page=b"<html><head></head><body>C720PSecureRelay</body></html>"
  second=m.add_tag(page,"</head>",m.CLIPS_TAG,"C720PSecureRelay")
  self.assertIn(m.CLIPS_TAG.encode(),second)
  self.assertIn(b"C720PSecureRelay",second)

 def test_exact_source_pins_and_safety_properties(self):
  code=TARGET.read_text()
  for literal in ("camera2_restarted","legacy_recorder_restarted",
                  "originals_deleted","save_delete_modified","reviews_modified",
                  "os.replace(tmp,path)","page_changed_during_staging",
                  "SOURCE" if False else "SNAPSHOT_BRIDGE"):
   self.assertIn(literal,code if literal!="SNAPSHOT_BRIDGE" else m.patched_guard(
                  GUARD_SOURCE.read_bytes()).decode())
  for harmful in ("rm -rf","shutil.rmtree","DELETE FROM","pm install",
                  "auto_assign_person","open(EVENTS,'w')","os.unlink(VIDEO)"):
   self.assertNotIn(harmful,code)

 def test_bad_existing_bridge_is_not_mutated(self):
  with self.assertRaisesRegex(m.Refused,"original_page_contract_changed"):
   m.add_tag(b"<html></html>",m.VIDEO_TAG,m.JPEG_TAG,"saveClip(")
  with self.assertRaisesRegex(m.Refused,"guard_source_contract_changed"):
   m.patched_guard(b"def new_html(old):pass")

if __name__=="__main__":
 unittest.main(verbosity=2)
