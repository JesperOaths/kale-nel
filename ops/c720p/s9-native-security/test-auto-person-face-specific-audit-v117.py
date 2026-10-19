#!/usr/bin/env python3
"""Metadata-only audit: one group clip never labels faces for every group member."""
import importlib.util
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("s9_auto_ref_audit_v117",ROOT/"audit-auto-person-reference-readiness.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
def make(clip,sha,person=None):
 stem=clip[:-4]
 item={"clip_no":clip,"face_candidates":[{
  "snapshot_name":stem+"__r5full_pending__100_0.jpg","snapshot_on_s9":True,
  "snapshot_sha256":sha,"face_crop_requires_manual_review":False,
  "face_crop_padded_context_only":False,"match_status":"reference_similarity_unverified",
  "face_landmarks_aligned":True
 }]}
 if person:
  item["face_candidates"][0]["manual_face_person_confirmation"]={
   "source":"sd","clip":clip,"snapshot_sha256":sha,
   "person_id":person,"verified_by_human":True}
 return item
A="motion_1792200000000.mp4"
B="motion_1792200060000.mp4"
C="motion_1792200120000.mp4"
class FaceReferences(unittest.TestCase):
 def test_group_video_is_not_individual_face_approval(self):
  count, clips, known=m.classify([make(A,"a"*64),make(B,"b"*64)])
  self.assertEqual(count["explicitly_aligned"],2)
  self.assertEqual(count["human_face_to_person_confirmation_rows"],0)
  self.assertEqual(len(known),0)
 def test_two_distinct_independent_human_approved_faces(self):
  count, clips, known=m.classify([make(A,"a"*64,"G123"),make(B,"b"*64,"G123")])
  self.assertEqual(count["human_face_to_person_confirmation_rows"],2)
  self.assertEqual(len({p[0] for p in known["G123"]}),2)
 def test_duplicate_face_claims_for_two_people_are_disqualified(self):
  count, clips, known=m.classify([
    make(A,"a"*64,"G123"),make(B,"a"*64,"G789"),make(C,"b"*64,"G123")])
  self.assertEqual(count["conflicting_face_sha256_references"],1)
  self.assertEqual(len(known["G123"]),1)
  self.assertEqual(len(known["G789"]),0)
 def test_unverified_or_wrong_source_cannot_create_reference(self):
  event=make(A,"a"*64,"G123")
  event["face_candidates"][0]["manual_face_person_confirmation"]["source"]="gdrive"
  count,clips,known=m.classify([event])
  self.assertEqual(len(known),0)
 def test_read_only_source(self):
  source=(ROOT/"audit-auto-person-reference-readiness.py").read_text()
  for item in ("subprocess","method='POST'","camera.install(","face_image_bytes"):
   self.assertNotIn(item,source)
if __name__=="__main__":unittest.main(verbosity=2)
