#!/usr/bin/env python3
"""Offline regression checks for S9/S3 verified Drive catalog; synthetic metadata."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest import mock

SCRIPT=Path(__file__).with_name("drive-person-batch-catalog.py")
spec=importlib.util.spec_from_file_location("s9_catalog_test",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class CatalogTests(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory()
  self.addCleanup(self.tmp.cleanup)
  d=Path(self.tmp.name)
  m.SOURCE=d/"source.json";m.DATA=d/"private.json";m.LOCK=d/"catalog.lock"
  self.good="NEW_20261001010203_person-0.99_20261001-010203-0123.mp4"
  self.s3="S3_20260903180600_person-0.99_20260903-180600-0001.mp4"
  self.deleted="NEW_20260916165945_person-1.00_20260916-165945-0189.mp4"
  self.edge="S9PHONE_rec_2026-10-08_20-30.mp4"
  m.SOURCE.write_text(json.dumps({"items":[
   {"camera":"new","state":"verified","remote_name":self.good,"size":2000000,"person_confidence":.94},
   {"camera":"s3","state":"verified","remote_name":self.s3,"size":2500000,"person_confidence":.1},
   {"camera":"new","state":"verified","remote_name":self.edge,"size":2000000,"person_confidence":.12},
   {"camera":"new","state":"deleted","remote_name":self.deleted,"size":3000000,"person_confidence":1},
   {"camera":"new","state":"verified","remote_name":"../escape.mp4","size":2000000}
  ]}))
 def test_source_filters_deletions_and_paths(self):
  src=m.original_verified()
  self.assertEqual(len(src),3)
  self.assertNotIn(m.clip_key("new",self.deleted),src)
  self.assertIn(m.clip_key("new",self.good),src)
  self.assertIn(m.clip_key("s3",self.s3),src)
  self.assertIn(m.clip_key("new",self.edge),src)
  self.assertNotEqual(m.clip_key("new",self.good),m.clip_key("s3",self.good))
 def test_resumable_and_private_atomic(self):
  verified=m.original_verified()
  cat=m.read_catalog()
  self.assertEqual(m.create_stats(cat,verified)["remaining"],3)
  targets=m.sorted_candidates(verified,cat["items"])
  self.assertEqual([x["camera"] for x in targets],["s3","new","new"])
  key=m.clip_key("s3",self.s3)
  cat["items"][key]={"status":"classified","category":"unresolved_motion","model_sha256":"test"}
  m.write_catalog(cat)
  self.assertEqual(m.DATA.stat().st_mode&0o777,0o600)
  self.assertEqual(m.create_stats(m.read_catalog(),verified)["processed"],1)
  self.assertEqual(len(m.sorted_candidates(verified,m.read_catalog()["items"])),2)
  self.assertEqual(len(list(m.DATA.parent.glob("*.tmp"))),0)
 def test_event_categories_do_not_imply_identity(self):
  class Fake:
   @staticmethod
   def categorize(events):
    return {"event_category":"unresolved_motion_or_non_person","vehicle_score_peak":.72,
            "animal_score_peak":.3}
  event=m.categorize_evidence(Fake,[{}])
  self.assertEqual(event["event_category"],"vehicle_candidate")
  self.assertNotIn("identity",event)
 def test_dry_run_has_no_classification_or_media(self):
  with mock.patch.object(m,"reader",side_effect=AssertionError("model_should_not_load")):
   m.run(2,True)
  self.assertFalse(m.DATA.exists())

if __name__=="__main__":unittest.main(verbosity=2)
