#!/usr/bin/env python3
"""No-device end-to-end sanitized facial evidence regression."""
from pathlib import Path
import importlib.util
import unittest
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("face_v30",HERE/"audit-face-pipeline-v30.py")
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

CAMERA={"ok":True,"mode":"watching","native_4k_enabled":True,
        "continuous_4k_ready":True,"face_backfill_queued":False,
        "face_deep_errors":0}
def clip(i,**kwargs):
 result={"clip_no":"motion_"+str(1792000000000+i)+".mp4",
   "face_deep_review_version":"s9_onphone_36_samples_person_or_tile_v4",
   "face_model_state":"available_on_phone","face_candidates":[]}
 result.update(kwargs)
 return result
class FaceAuditV30Tests(unittest.TestCase):
 def test_reports_real_model_state_and_unverified_comparison(self):
  rows=[clip(0,face_candidates=[{
    "match_status":"anonymous_similarity_unverified",
    "person_id":"unknown_00001","face_crop_requires_manual_review":False}]),
    clip(1,face_model_state="not_tested_no_usable_face",
      face_deep_review_version="old"),
    clip(2,face_candidates=[{
      "match_status":"not_comparable_model_unavailable",
      "face_crop_padded_context_only":True}])]
  result=module.audit(CAMERA,{"archive_mode":"S9-microSD-only","events":rows})
  self.assertEqual(result["v4_reviewed"],2)
  self.assertEqual(result["awaiting_latest_4k_face_pass"],1)
  self.assertEqual(result["clips_confirming_model_available"],2)
  self.assertEqual(result["comparisons_eligible_for_review_grouping"],1)
  self.assertEqual(result["inspection_only_face_crops"],1)
  self.assertEqual(result["cropped_faces_visible_in_hub"],2)
  self.assertFalse(result["named_identity_automatically_verified"])
 def test_never_accepts_embeddings_on_hub(self):
  for name in ("embedding","face_embedding","descriptor","biometric_template","embedding_vector"):
   with self.subTest(name=name):
    with self.assertRaises(RuntimeError):
     module.audit(CAMERA,{"archive_mode":"S9-microSD-only",
      "events":[clip(0,face_candidates=[{"match_status":"new_anonymous_candidate",name:[0]*128}])]})
 def test_unhealthy_camera_or_dup_ids_not_accepted(self):
  rows=[clip(0),clip(0)]
  with self.assertRaises(RuntimeError):
   module.audit(CAMERA,{"archive_mode":"S9-microSD-only","events":rows})
  with self.assertRaises(RuntimeError):
   module.audit({**CAMERA,"continuous_4k_ready":False},
     {"archive_mode":"S9-microSD-only","events":[clip(0)]})
 def test_no_camera_commands_or_images(self):
  src=(HERE/"audit-face-pipeline-v30.py").read_text()
  for forbidden in ("adb install","adb shell","/shot.jpg","JPEG","urllib.request.Request(",
     "POST","MediaCodec","rmtree(","unlink(","open('w')"):
   self.assertNotIn(forbidden,src)
if __name__=="__main__":unittest.main(verbosity=2)
