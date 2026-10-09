#!/usr/bin/env python3
"""Offline behavioral and source invariants for updated native detection."""
import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parent
SRC=ROOT/"src/nl/kalenel/s9security"
def load():
 p=ROOT/"legacy-drive-person-corpus.py"
 spec=importlib.util.spec_from_file_location("legacy_corpus",p)
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 return mod

class Tests(unittest.TestCase):
 def test_person_categorization_avoids_identity_overclaim(self):
  mod=load()
  frames=[
   {"t_sec":0,"persons_050":1,"person_score":.81,"centers":[[.15,.15]],"vehicle_max":0,"animal_max":0},
   {"t_sec":2,"persons_050":1,"person_score":.91,"centers":[[.22,.45]],"vehicle_max":0,"animal_max":0},
   {"t_sec":4,"persons_050":1,"person_score":.89,"centers":[[.28,.70]],"vehicle_max":0,"animal_max":0},
  ]
  result=mod.categorize(frames)
  self.assertEqual(result["event_category"],"single_person_event_candidate")
  self.assertEqual(result["person_activity"],"bounding_box_position_changed_across_samples_not_identity")
  self.assertEqual(result["identity"],"not_evaluated")
  frames[1]["persons_050"]=2
  self.assertEqual(mod.categorize(frames)["event_category"],"possible_group_needs_frame_review")
  frames[2]["persons_050"]=2
  self.assertEqual(mod.categorize(frames)["event_category"],"multiple_people_candidate")
  # Duplicated/overlapping detector boxes are never counted as two people.
  self.assertTrue(mod.overlaps_same_object([.1,.1,.6,.6],[.12,.12,.58,.58]))
  self.assertFalse(mod.overlaps_same_object([.1,.1,.3,.3],[.6,.6,.9,.9]))
  weak=[dict(frames[0],persons_050=0,person_score=.38,centers=[])]
  self.assertEqual(mod.categorize(weak)["event_category"],"unresolved_motion_or_non_person")
  self.assertEqual(mod.categorize(weak+weak)["event_category"],"possible_person_needs_review")
  self.assertEqual(mod.categorize([])["event_category"],"unresolved_motion_or_non_person")
 def test_source_preserves_recording_and_limits(self):
  cls=(SRC/"ClipClassifier.java").read_text()
  motion=(SRC/"MotionGrid.java").read_text()
  cam=(SRC/"CameraService.java").read_text()
  self.assertIn("int frames=(int)Math.min(12,Math.max(6,(duration+1799L)/1800L))",cls)
  self.assertIn('result.put("person_sample_timeline",frameEvidence)',cls)
  self.assertIn('result.put("human_reviewed",false)',cls)
  self.assertIn('result.put("person_identity","not_evaluated")',cls)
  self.assertIn("if(t-lastSample<190)return false",motion)
  self.assertIn('RecordingRate.TOTAL_PER_HOUR',cam)
  self.assertIn('cloud_upload",false',cam)
  self.assertIn("recorder.setVideoSize(3840,2160)",cam)
  corpus=(ROOT/"legacy-drive-person-corpus.py").read_text()
  self.assertIn('"state")!="verified"',corpus)
  self.assertIn("source\":\"verified historical Google Drive",corpus)
  self.assertIn('"video_or_images_saved":False',corpus)
  self.assertIn("name_sha256",corpus)
  self.assertNotIn("Drive upload",cls)
if __name__=="__main__":unittest.main(verbosity=2)
