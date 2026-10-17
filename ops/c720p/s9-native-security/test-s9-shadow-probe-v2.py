#!/usr/bin/env python3
"""No-device contracts: test shadow inference availability, never face identity.

V2's diagnostic inference is only allowed for saved, real-source, nonpadded
crops that passed the preexisting minimum face/image gates. Results may be
discarded but must never feed assignment, enrollment, or a match group.
"""
from pathlib import Path
import importlib.util
import unittest

HERE=Path(__file__).resolve().parent
JAVA=(HERE/"src/nl/kalenel/s9security/S9FaceReview.java").read_text()
CATALOG=HERE.parent/"s9-person-ml-v1/local-sd-catalog.py"
BUILD=(HERE/"build-s9-face-recall-v27.py").read_text()

class ShadowProbeV2(unittest.TestCase):
 def test_accepts_real_review_crops_without_lowering_identification_gate(self):
  self.assertIn("f.confidence()>=.49f&&f.eyesDistance()>=7f",JAVA)
  self.assertIn("originalEyeSpan>=10f&&estimatedSize>=70",JAVA)
  self.assertIn("shadowEmbeddingTrials==0&&!contextPadded",JAVA)
  self.assertIn("if(!usable(face)){rejectedImageQuality++;continue;}",JAVA)
  self.assertIn("if(originalEyeSpan<10f)",JAVA)
  self.assertIn("originalEyeSpan>=22f&&estimatedSize>=96&&!contextPadded",JAVA)
  self.assertIn("if(reliableForEmbedding){",JAVA)
  self.assertIn("}else if(shadowEmbeddingTrials==0&&!contextPadded",JAVA)
  self.assertIn("shadow=null;",JAVA)
  self.assertIn("JSONObject match=assign(emb);",JAVA)
  self.assertNotIn("assign(shadow)",JAVA)
  self.assertIn('manifest.put("face_shadow_matches_created",0)',JAVA)
  self.assertIn('manifest.put("face_shadow_vectors_persisted",false)',JAVA)
  self.assertIn('manifest.put("face_shadow_review_version","s9_shadow_model_probe_v2")',JAVA)
 def test_saved_review_crops_not_mislabeled_no_face(self):
  self.assertIn('if("no_frontal_face_in_samples".equals(status)',JAVA)
  self.assertIn('status="review_complete_unverified_matches";',JAVA)
  self.assertIn('status.equals("face_index_read_error")',JAVA)
 def test_hub_does_not_receive_embeddings_and_versions_are_allowlisted(self):
  spec=importlib.util.spec_from_file_location("s9_shadow_safe_catalog",CATALOG)
  m=importlib.util.module_from_spec(spec)
  spec.loader.exec_module(m)
  base={"face_review_version":"s9_face_review_v1",
   "face_shadow_model_trials":1,"face_shadow_model_succeeded":1,
   "face_shadow_model_failed":0,"face_shadow_matches_created":0,
   "face_shadow_vectors_persisted":False,
   "face_candidates":[{"match_status":"not_comparable_manual_review",
       "face_crop_requires_manual_review":True}],
   "private_face_embedding":[.1]*128}
  for version in ("s9_shadow_model_probe_v1","s9_shadow_model_probe_v2"):
   out=m.safe_face_review_metadata({**base,"face_shadow_review_version":version})
   self.assertEqual(out["face_shadow_review_version"],version)
   self.assertEqual(out["face_shadow_model_trials"],1)
   self.assertEqual(out["face_shadow_model_succeeded"],1)
   self.assertEqual(out["face_shadow_matches_created"],0)
   self.assertFalse(out["face_shadow_vectors_persisted"])
   self.assertEqual(out["face_candidates"][0]["match_status"],"not_comparable_manual_review")
   self.assertNotIn("private_face_embedding",out)
  unknown=m.safe_face_review_metadata({**base,"face_shadow_review_version":"untrusted"})
  self.assertIsNone(unknown["face_shadow_review_version"])
  self.assertEqual(unknown["face_shadow_model_trials"],0)
 def test_signed_release_must_embed_v2_marker(self):
  self.assertIn('b"s9_shadow_model_probe_v2"',BUILD)
  self.assertIn("shadow_face_model_probe_not_compiled_into_signed_APK",BUILD)
  self.assertIn('"face_deep_rescue_version"', (HERE/"src/nl/kalenel/s9security/CameraService.java").read_text())
if __name__=="__main__":unittest.main(verbosity=2)
