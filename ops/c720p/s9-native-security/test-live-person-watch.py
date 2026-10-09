#!/usr/bin/env python3
"""No hardware required: live native person-watch and Security view contracts."""
import importlib.util
import pathlib
import tempfile
import unittest
import json

ROOT=pathlib.Path(__file__).resolve().parent
def load(name):
 p=ROOT/name
 s=importlib.util.spec_from_file_location("s9_"+p.stem.replace("-","_"),p)
 m=importlib.util.module_from_spec(s);s.loader.exec_module(m);return m
class Tests(unittest.TestCase):
 def test_live_temporal_evidence_is_not_identity(self):
  m=load("live-person-watch.py")
  p={"priority_motion":False,"motion_events":8}
  self.assertEqual(m.categorize([],p)["kind"],"no_object_detected")
  weak=[{"person_max":.37,"people_050":0,"vehicle_max":0,"animal_max":0}]
  self.assertEqual(m.categorize(weak,p)["kind"],"possible_person_needs_review")
  moderate={"person_max":.62,"people_050":1,"vehicle_max":0,"animal_max":0}
  self.assertEqual(m.categorize([moderate],p)["kind"],"possible_person_needs_review")
  self.assertEqual(m.categorize([moderate,moderate],p)["kind"],"person_likely_candidate")
  strong={"person_max":.83,"people_050":2,"vehicle_max":0,"animal_max":0}
  self.assertEqual(m.categorize([strong],p)["kind"],"multiple_people_candidate")
  self.assertEqual(m.categorize([{"person_max":0,"people_050":0,"vehicle_max":.81,"animal_max":0}],p)["kind"],"vehicle_candidate")
  self.assertEqual(m.categorize([{"person_max":0,"people_050":0,"vehicle_max":0,"animal_max":.68}],p)["kind"],"animal_candidate")
  self.assertEqual(m.categorize([],dict(p,priority_motion=True))["kind"],"other_motion_detected")
  self.assertEqual(m.categorize([moderate,moderate],p)["identity"],"not_evaluated")
 def test_private_state_and_image_retention(self):
  m=load("live-person-watch.py")
  with tempfile.TemporaryDirectory() as dirname:
   m.STATE=pathlib.Path(dirname)/"status.json"
   data={"version":"s9-live-ssd-watch-v1","status":{"kind":"person_likely_candidate"}}
   m.atomic_update(data)
   self.assertEqual(m.STATE.stat().st_mode&0o777,0o600)
   self.assertEqual(json.loads(m.STATE.read_text()),data)
   self.assertEqual(len(list(pathlib.Path(dirname).iterdir())),1)
   text=(ROOT/"live-person-watch.py").read_text()
   self.assertIn('INTERVAL=4.0',text)
   self.assertIn('MODEL_SHA=',text)
   self.assertNotIn("rclone",text)
   self.assertNotIn("cloud_upload",text)
 def test_security_patch_idempotence_and_signed_relay(self):
  m=load("patch-live-person-watch-ui.py")
  html='<html><script id="c720p-s9-phone-clips-ui-v1"></script></body></html>'
  newer=m.patch_text(html)
  self.assertEqual(newer,m.patch_text(newer))
  self.assertIn("S9+ live person & motion sensing",newer)
  self.assertIn("C720PSecureRelay.fetch",newer)
  self.assertIn("identity",newer)
  with self.assertRaises(ValueError):m.patch_text("<html></body></html>")
 def test_native_motion_has_fresh_samples_only(self):
  frame=(ROOT/"src/nl/kalenel/s9security/MotionGrid.java").read_text()
  self.assertIn("if(t-lastSample<190)return false",frame)
  clip=(ROOT/"src/nl/kalenel/s9security/ClipClassifier.java").read_text()
  self.assertIn("person_event_category",clip)
  self.assertIn("person_sample_timeline",clip)
  self.assertIn("human_reviewed",clip)
if __name__=="__main__":unittest.main(verbosity=2)
