#!/usr/bin/env python3
"""Pure synthetic tests; never creates a real biometric test subject."""
import importlib.util
from pathlib import Path
import unittest

P=Path(__file__).with_name("validate-s9-opt-in-captures-v1.py")
spec=importlib.util.spec_from_file_location("optin",P)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
PURPOSE=m.PURPOSE
def sample(i,who):
 ms=1792200000000+i*60000
 clip=f"motion_{ms}.mp4"
 face=f"motion_{ms}__pending_1__3500_0.jpg"
 return {"subject_code":who,"clip_no":clip,"snapshot_name":face,
         "snapshot_sha256":str(i%10)*64,"human_original_and_face_reviewed":True}
def subject(code):
 return {"subject_code":code,"consent_document_sha256":"a"*64,
         "adult_verified":True,"consent_scope":PURPOSE,
         "withdrawn":False,"consent_human_verified":True}
def fixture():
 a="V-ABCDEFGHIJKL";b="V-MNOPQRSTUVWX"
 captures=[sample(i,a) for i in range(3)]+[sample(i+3,b) for i in range(3)]
 doc={"version":1,"purpose":PURPOSE,
      "participants":[subject(a),subject(b)],"captures":captures}
 archive={"archive_mode":"S9-microSD-only","events":[{
  "clip_no":r["clip_no"],
  "face_candidates":[{"snapshot_name":r["snapshot_name"],
                      "snapshot_sha256":r["snapshot_sha256"]}]}
  for r in captures]}
 return doc,archive
class ConsentGate(unittest.TestCase):
 def test_no_manifest_is_not_implicit_consent(self):
  result=m.summarize(None,None)
  self.assertEqual(result["status"],"missing_opt_in_participant_manifest")
  self.assertEqual(result["opted_in_participants"],0)
  self.assertTrue(result["these_are_not_ground_truth_labels"])
 def test_only_verified_opt_in_source_pairs_count_as_potential_tasks(self):
  doc,archive=fixture()
  got=m.summarize(doc,archive)
  self.assertEqual(got["opted_in_participants"],2)
  self.assertEqual(got["verified_original_clip_samples"],6)
  self.assertEqual(got["possible_same_subject_pair_tasks"],6)
  self.assertEqual(got["possible_different_subject_pair_tasks"],9)
  self.assertFalse(got["enough_potential_tasks_for_manual_review"])
  self.assertFalse(got["automatic_recognition_enabled"])
 def test_withdrawn_consent_invalidates_all_subject_captures(self):
  doc,archive=fixture()
  doc["participants"][0]["withdrawn"]=True
  with self.assertRaisesRegex(ValueError,"no_active_consent"):
   m.summarize(doc,archive)
 def test_unverified_or_ambiguous_clip_cannot_become_ground_truth(self):
  doc,archive=fixture()
  doc["captures"][0]["human_original_and_face_reviewed"]=False
  with self.assertRaisesRegex(ValueError,"unverified_exact"):
   m.summarize(doc,archive)
  doc,archive=fixture()
  doc["captures"][0]["snapshot_sha256"]="c"*64
  with self.assertRaisesRegex(ValueError,"not_in_original"):
   m.summarize(doc,archive)
  doc,archive=fixture()
  doc["captures"].append(dict(doc["captures"][0]))
  with self.assertRaisesRegex(ValueError,"ambiguous_or_reused"):
   m.summarize(doc,archive)
 def test_no_unconsented_subject_can_be_assumed(self):
  doc,archive=fixture()
  doc["participants"][0]["consent_human_verified"]=False
  with self.assertRaisesRegex(ValueError,"valid_specific_opt_in_consent"):
   m.summarize(doc,archive)
 def test_no_images_or_identity_vectors_leave_process(self):
  text=P.read_text()
  for forbidden in ("cv2.imread","embedding","face_recognition","write_text(",
                    "write_bytes(","/new/saved/face/","adb shell"):
   self.assertNotIn(forbidden,text)

if __name__=="__main__":unittest.main(verbosity=2)
