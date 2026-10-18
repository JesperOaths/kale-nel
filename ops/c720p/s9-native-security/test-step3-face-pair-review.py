#!/usr/bin/env python3
"""Synthetic tests for audited manual face-pair review, no media or device access."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

P=Path(__file__).resolve().parent.parent/"s9-person-ml-v1/s9_face_pair_review.py"
spec=importlib.util.spec_from_file_location("s9_pair_review",P)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
A="motion_1792200000000.mp4"
B="motion_1792200300000.mp4"
SA="motion_1792200000000__pending_1__6365_0.jpg"
SB="motion_1792200300000__pending_1__3200_0.jpg"

class FacePairs(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory()
  self.addCleanup(self.tmp.cleanup)
  self.patchers=[
   patch.object(m,"CAT",Path(self.tmp.name)/"catalog.json"),
   patch.object(m,"STORE",Path(self.tmp.name)/"private.json"),
   patch.object(m,"AUDIT",Path(self.tmp.name)/"audit.jsonl")]
  for p in self.patchers:p.start();self.addCleanup(p.stop)
  def entry(clip,face,sha):
   return {"name":clip,"sd_verified":True,"resolution":"3840x2160",
    "size":20000000,"face_candidates":[{"snapshot_name":face,
      "snapshot_on_s9":True,"snapshot_size":30456,
      "snapshot_sha256":sha}]}
  self.rows=[entry(A,SA,"a"*64),entry(B,SB,"b"*64)]
  self._write_catalog()
 def _write_catalog(self):
  m.CAT.write_text(json.dumps({"phone_recordings":self.rows}))
 def request(self,revision=0,choice="uncertain",**changes):
  body={"left_image":SA,"right_image":SB,"revision":revision,
        "decision":choice,"left_original_viewed":True,
        "right_original_viewed":True,"human_confirmed":True}
  body.update(changes)
  return m.mutate(body)
 def test_submit_requires_two_distinct_originals_and_explicit_review(self):
  for changes in ({"right_image":SA},{"left_original_viewed":False},
                  {"right_original_viewed":False},{"human_confirmed":False},
                  {"decision":"automatic_identity"},{"left_image":"../../private.jpg"}):
   code,_=self.request(**changes)
   self.assertEqual(code,400)
  self.assertFalse(m.STORE.exists())
 def test_review_persists_metadata_without_identity_grouping(self):
  code,answer=self.request(choice="same_person")
  self.assertEqual(code,200)
  self.assertTrue(answer["no_identity_grouping_enabled"])
  self.assertEqual(m.STORE.stat().st_mode&0o777,0o600)
  review=m.report()
  self.assertEqual(review["counts"]["same_person"],1)
  self.assertTrue(review["pairs"][0]["available"])
  self.assertTrue(review["not_qualified_model_calibration"])
  self.assertFalse("embedding" in m.STORE.read_text().lower())
  self.assertFalse("image_bytes" in m.STORE.read_text().lower())
  self.assertEqual(len(m.AUDIT.read_text().splitlines()),1)
  code,_=self.request(revision=0)
  self.assertEqual(code,409)
  code,_=self.request(revision=1,choice="different_people")
  self.assertEqual(code,200)
  self.assertEqual(m.report()["counts"]["different_people"],1)
  self.assertEqual(len(m.AUDIT.read_text().splitlines()),2)
 def test_tampered_source_does_not_appear_available(self):
  self.assertEqual(self.request()[0],200)
  self.rows[0]["face_candidates"][0]["snapshot_sha256"]="c"*64
  self._write_catalog()
  self.assertFalse(m.report()["pairs"][0]["available"])
 def test_unverified_recordings_are_rejected(self):
  self.rows[1]["sd_verified"]=False
  self._write_catalog()
  self.assertEqual(self.request()[0],404)
 def test_corrupt_store_blocks_updates(self):
  m.STORE.write_text("not JSON")
  with self.assertRaises(RuntimeError):m.mutate(self.request(0)[1])
 def test_no_synthetic_review_can_become_score_corpus(self):
  # This backend does not create scores, identity groups or write the
  # separate Step 2 independent phone-model qualification dataset.
  src=P.read_text()
  self.assertNotIn("s9-human-confirmed-face-pairs-v1.json",src)
  self.assertNotIn("calibration_false_acceptances",src)
  self.assertNotIn("adb shell",src)
  self.assertNotIn("face_embedding",src)

if __name__=="__main__":unittest.main(verbosity=2)
