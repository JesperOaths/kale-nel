#!/usr/bin/env python3
"""Synthetic-only uniform S9 V2 read-only route validation."""
from pathlib import Path
import hashlib
import importlib.util
import json
import tempfile
from types import SimpleNamespace
import unittest
root=Path(__file__).resolve().parent
path=root.parent.parent/"s9-person-ml-v1"/"s9_multivector_appearance_api_v2.py"
spec=importlib.util.spec_from_file_location("api_v2",path)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class TestV2(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory()
  self.addCleanup(self.temp.cleanup)
  self.oldstate=m.STATE
  m.STATE=Path(self.temp.name)/"map.json"
  self.addCleanup(setattr,m,"STATE",self.oldstate)
  self.rows=[]
  for i in range(57):
   key=hashlib.sha256(("sample"+str(i)).encode()).hexdigest()
   self.rows.append({"key":key,
       "clip":"motion_"+str(1792200000000+1000*i)+".mp4",
       "source":"s9_sd","cohort":"v40" if i<51 else "approved_new"})
  self.mapdoc={"schema":"s9_multivector_source_map_v2",
    "visual_model_sha256":m.VISUAL_SHA,
    "color_histogram_schema":"s9_uniform_upper_torso_hsv32_v2",
    "people_assigned_automatically":0,"rows":self.rows}
  m.STATE.write_text(json.dumps(self.mapdoc))
  self.oldr=m.phone_rankings
  self.addCleanup(setattr,m,"phone_rankings",self.oldr)
  self.match={"candidate_key":self.rows[1]["key"],
     "appearance_similarity_percent":86.25,
     "method":"visual_75_color_25","human_review_required":True,
     "verified_same_person":False}
  def ranking():
   return [{"reference_key":row["key"],
     "similar_appearance_only":[self.match] if i==0 else []}
     for i,row in enumerate(self.rows)]
  m.phone_rankings=ranking

 def test_source_qualified_and_unverified_identity(self):
  status,payload=m.report(self.rows[0]["clip"])
  self.assertEqual(status,200)
  self.assertEqual(payload["ranking_schema"],"s9_appearance_rankings_v2")
  self.assertEqual(payload["color_histogram_schema"],"s9_uniform_upper_torso_hsv32_v2")
  self.assertIs(payload["identity_probability"],False)
  self.assertEqual(payload["coverage"]["real_person_crops"],57)
  self.assertEqual(payload["automatic_person_assignments"],0)
  self.assertEqual(payload["results"][0]["similarity_percent"],86.25)
  self.assertNotIn("embedding",json.dumps(payload))
  self.assertEqual(m.report("motion_1792500000000.mp4")[0],404)

 def test_reject_bad_model_schema_and_false_identity_claim(self):
  self.mapdoc["color_histogram_schema"]="unknown"
  m.STATE.write_text(json.dumps(self.mapdoc))
  with self.assertRaises(ValueError):m.report(self.rows[0]["clip"])
  self.mapdoc["color_histogram_schema"]="s9_uniform_upper_torso_hsv32_v2"
  m.STATE.write_text(json.dumps(self.mapdoc))
  self.match["verified_same_person"]=True
  with self.assertRaises(ValueError):m.report(self.rows[0]["clip"])

 def test_unqualified_drive_source_rejected(self):
  self.mapdoc["rows"][2]["source"]="gdrive_archive"
  m.STATE.write_text(json.dumps(self.mapdoc))
  with self.assertRaises(ValueError):m.mapping()

if __name__=="__main__":unittest.main(verbosity=2)
