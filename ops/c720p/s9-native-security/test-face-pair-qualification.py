#!/usr/bin/env python3
"""Synthetic test vectors exercise validation logic; NOT real face accuracy."""
import importlib.util
from pathlib import Path
import unittest

p=Path(__file__).with_name("validate-s9-face-identity-pairs.py")
spec=importlib.util.spec_from_file_location("s9_pair_gate",p)
gate=importlib.util.module_from_spec(spec);spec.loader.exec_module(gate)

def row(i,truth):
 start=1792200000000+i*86400000
 end=1792200060000+i*86400000
 return dict(left_clip=f"motion_{start}.mp4",right_clip=f"motion_{end}.mp4",
  truth=truth,category="anonymous",score=.98 if truth=="same_person" else .23,
  margin=.08,human_confirmed=True,original_4k_verified=True,
  phone_model_verified=True)
def doc(rows):
 return dict(version=1,origin="independent_human_confirmed_4k_pair_review",
  model_sha256="a"*64,pairs=rows)

class Gate(unittest.TestCase):
 def test_missing_labels_fail_closed(self):
  status=gate.evaluate(None)
  self.assertFalse(status["qualified_for_automated_grouping"])
  self.assertEqual(status["reason"],"verified_labels_unavailable")
 def test_passing_synthetic_thresholds_do_not_grant_identity_approval(self):
  corpus=doc([row(i,"same_person") for i in range(40)]+
      [row(i+40,"different_people") for i in range(500)])
  result=gate.evaluate(corpus)
  self.assertTrue(result["offline_thresholds_pass"])
  self.assertEqual(result["positive_confirmed_pairs"],40)
  self.assertEqual(result["negative_confirmed_pairs"],500)
  self.assertFalse(result["qualified_for_automated_grouping"])
  self.assertFalse(result["identity_claims_enabled"])
  self.assertLess(result["false_acceptance_95pct_upper"],0.01)
 def test_false_acceptances_reject_corpus(self):
  rows=[row(i,"same_person") for i in range(40)]+[row(i+40,"different_people") for i in range(500)]
  rows[40]["score"]=0.99
  self.assertFalse(gate.evaluate(doc(rows))["offline_thresholds_pass"])
 def test_reject_duplicates_self_pairs_and_missing_human_confirmation(self):
  base=row(1,"same_person")
  cases=[
   [base,dict(base)],
   [dict(base,right_clip=base["left_clip"])],
   [dict(base,human_confirmed=False)],
   [dict(base,phone_model_verified=False)],
   [dict(base,truth="unknown")],
   [dict(base,margin=float("nan"))]
  ]
  for rows in cases:
   with self.subTest(rows=rows),self.assertRaises(ValueError):gate.evaluate(doc(rows))
 def test_manual_case_folders_are_not_ground_truth(self):
  with self.assertRaisesRegex(ValueError,"provenance"):
   gate.evaluate(dict(version=1,origin="human_reviewed_recording_folder",
                      model_sha256="a"*64,pairs=[row(0,"same_person")]))
 def test_metadata_only_no_private_images_or_vectors(self):
  src=p.read_text()
  for forbidden in ("cv2","Bitmap","MediaMetadataRetriever","embedding_vector",
                    "image_data","adb pull","/new/saved/face/","write_text("):
   self.assertNotIn(forbidden,src)

if __name__=="__main__":unittest.main(verbosity=2)
