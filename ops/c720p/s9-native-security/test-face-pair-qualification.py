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
  left_snapshot_name=f"motion_{start}__review_a__3500_0.jpg",
  right_snapshot_name=f"motion_{end}__review_b__3600_0.jpg",
  left_snapshot_sha256="b"*64,right_snapshot_sha256="c"*64,
  truth=truth,category="anonymous",score=.98 if truth=="same_person" else .23,
  margin=.08,human_confirmed=True,original_4k_verified=True,
  phone_model_verified=True,independent_reviewer_verified=True,
  pair_score_origin="s9_local_exact_face_pair_score_v1")
def doc(rows):
 return dict(version=2,origin="independent_human_confirmed_4k_face_pair_review",
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
  self.assertGreater(result["true_positive_95pct_lower"],0.90)
 def test_observed_ninety_percent_recall_is_not_ninety_percent_confident(self):
  rows=[row(i,"same_person") for i in range(40)]+[
       row(i+40,"different_people") for i in range(500)]
  # 36/40 positives pass (observed 90 percent); confidence interval
  # cannot support a claimed >=90% true positive rate.
  for i in range(4):rows[i]["score"]=0.15
  result=gate.evaluate(doc(rows))
  self.assertEqual(result["true_positive_rate"],0.9)
  self.assertLess(result["true_positive_95pct_lower"],0.9)
  self.assertFalse(result["offline_thresholds_pass"])
 def test_zero_positive_samples_lower_bound_is_zero(self):
  self.assertEqual(gate.wilson_lower(0,0),0.0)
  self.assertAlmostEqual(gate.wilson_lower(40,40),0.912,delta=.002)
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
   [dict(base,margin=float("nan"))],
   [dict(base,independent_reviewer_verified=False)],
   [dict(base,pair_score_origin="unverified_similarity")],
   [dict(base,left_snapshot_name=base["right_snapshot_name"])],
   [dict(base,left_snapshot_sha256="not-verified")],
   [dict(base,right_snapshot_name=base["left_snapshot_name"])]
  ]
  for rows in cases:
   with self.subTest(rows=rows),self.assertRaises(ValueError):gate.evaluate(doc(rows))
 def test_legacy_clip_only_pairs_cannot_qualify_face_matching(self):
  legacy=doc([row(0,"same_person")])
  legacy["version"]=1
  legacy["origin"]="independent_human_confirmed_4k_pair_review"
  for item in legacy["pairs"]:
   for k in ("left_snapshot_name","right_snapshot_name",
             "left_snapshot_sha256","right_snapshot_sha256",
             "independent_reviewer_verified","pair_score_origin"):
    item.pop(k,None)
  with self.assertRaisesRegex(ValueError,"provenance"):
   gate.evaluate(legacy)
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
