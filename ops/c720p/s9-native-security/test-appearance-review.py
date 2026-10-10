#!/usr/bin/env python3
"""Privacy, calibration, and no-auto-identity tests for recurring outfit review."""
import importlib.util
import pathlib
import unittest
from unittest import mock
HERE=pathlib.Path(__file__).resolve().parent
MOD=HERE/"s9_appearance_review.py"
s=importlib.util.spec_from_file_location("outfits",MOD)
a=importlib.util.module_from_spec(s);s.loader.exec_module(a)
class Tests(unittest.TestCase):
 def test_bounded_similarity(self):
  v=[0.125]*48
  self.assertEqual(a.compare(v,v),1)
  self.assertIsNone(a.compare(v,[0.2]*4))
  self.assertIsNone(a.compare(v,[float("nan")]*48))
  self.assertIsNone(a.compare(v,[1.5]*48))
 def test_only_review_suggestions_not_identity(self):
  v=[.125]*48
  def row(clip,stamp,vector=v,camera="new"):
   return {"clip_id":clip,"remote_name":f"NEW_{stamp}_person_001.mp4",
    "category":"single_person_event_candidate","camera":camera,
    "appearance_quality":"clear_clothing_color_candidate","appearance_vector":vector}
  r=row("a","20261010010000")
  possible=a.candidates(r,[r,row("b","20261010011500"),row("c","20261008010000"),
                         row("d","20261010011500",camera="s3"),
                         {"clip_id":"e","category":"multiple_people_candidate","camera":"new"}])
  self.assertEqual(len(possible),1)
  self.assertEqual(possible[0]["clip_id"],"b")
  self.assertFalse(possible[0]["verified_same_person"])
  self.assertTrue(possible[0]["human_review_required"])
  self.assertNotIn("visitor_id",possible[0])
 def test_quality_rejection_without_face_data(self):
  try:import numpy as np
  except ImportError:self.skipTest("numpy not in CI runner; installed in hub pinned venv")
  raw=bytes([0]*(320*240*3*8))
  evidence=[{"single_person_box":[.10,.15,.85,.45],"persons_050":1,"person_score":.95}]*8
  result=a.descriptor(raw,evidence)
  self.assertIsNone(result["vector"])
  self.assertEqual(result["quality"],"insufficient_clear_single_person_samples")
 def test_no_face_or_gait_matching(self):
  code=MOD.read_text()
  for disallowed in ("face_recognition","facenet","deepface","gait_signature","person_name"):
   self.assertNotIn(disallowed,code)
  catalog=(HERE/"drive-person-batch-catalog.py").read_text()
  self.assertIn('appearance_vector',catalog)
  self.assertIn('s9_appearance_review.descriptor',catalog)
  deploy=(HERE/"deploy-drive-person-catalog.py").read_text()
  self.assertIn('s9_appearance_review.py',deploy)
if __name__=="__main__":unittest.main(verbosity=2)
