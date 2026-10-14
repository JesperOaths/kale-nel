#!/usr/bin/env python3
"""Offline regression: face metadata allowlist and 4K historical retry safety.

No network, ADB, phone, images or models are needed. These checks deliberately
cannot establish real-world facial recognition accuracy or Android build health.
"""
import importlib.util
import pathlib
import unittest

HERE=pathlib.Path(__file__).resolve().parent
CATALOG=HERE.parent/"s9-person-ml-v1/local-sd-catalog.py"
def load_catalog():
 spec=importlib.util.spec_from_file_location("s9_safe_local_sd_catalog",CATALOG)
 mod=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(mod)
 return mod

class FaceBackfillV2Regression(unittest.TestCase):
 @classmethod
 def setUpClass(cls):
  cls.catalog=load_catalog()
  src=HERE/"src/nl/kalenel/s9security"
  cls.classifier=(src/"ClipClassifier.java").read_text()
  cls.worker=(src/"CameraService.java").read_text()
  cls.face=(src/"S9FaceReview.java").read_text()

 def manifest(self, **extras):
  data={"name":"motion_1791600000000.mp4",
        "face_review_version":"s9_face_review_v1",
        "face_deep_review_version":"s9_onphone_36_samples_person_roi_v2",
        "face_review_sampled_frames":36,
        "face_review_status":"no_frontal_face_in_samples",
        "face_evidence_outcome":"face_candidates_rejected_in_sampling",
        "face_model_state":"not_tested_no_usable_face",
        "face_detector_raw_hits":7,
        "face_rejected_confidence_or_size":3,
        "face_rejected_looking_away_or_roll":2,
        "face_rejected_crop_geometry":1,
        "face_rejected_dark_or_blurry":1,
        "face_deep_detector_anchor_frames":12,
        "face_deep_person_roi_anchors":8,
        "face_deep_multiple_person_anchors":1,
        "face_deep_multiscale_refinement_passes":4,
        "face_candidates":[]}
  data.update(extras)
  return data

 def test_v2_diagnostics_allowlisted(self):
  result=self.catalog.safe_face_review_metadata(self.manifest())
  self.assertEqual(result["face_deep_review_version"],
     "s9_onphone_36_samples_person_roi_v2")
  self.assertEqual(result["face_evidence_outcome"],
     "face_candidates_rejected_in_sampling")
  self.assertEqual(result["face_deep_person_roi_anchors"],8)
  self.assertEqual(result["face_rejected_dark_or_blurry"],1)

 def test_all_embeddings_and_arbitrary_fields_never_exported(self):
  result=self.catalog.safe_face_review_metadata(self.manifest(
    embedding=[0.01]*128,face_candidates=[{"embedding":[1]*128}]))
  self.assertNotIn("embedding",result)
  self.assertFalse(any(isinstance(v,list) and len(v)==128 for v in result.values()))
  self.assertNotIn("private_name",result)
  self.assertEqual(result["face_candidates"],[])

 def test_invalid_counts_and_status_fail_closed(self):
  result=self.catalog.safe_face_review_metadata(self.manifest(
    face_detector_raw_hits=True,face_deep_person_roi_anchors=9999,
    face_evidence_outcome="verified_person_identity",
    face_embedding_model_state="unknown_magic_model"))
  self.assertIsNone(result["face_detector_raw_hits"])
  self.assertIsNone(result["face_deep_person_roi_anchors"])
  self.assertEqual(result["face_evidence_outcome"],
       "legacy_review_no_diagnostics")
  self.assertEqual(result["face_model_state"],
       "not_tested_no_usable_face")

 def test_legacy_and_missing_metadata_have_distinct_states(self):
  v1=self.catalog.safe_face_review_metadata(self.manifest(
    face_deep_review_version="s9_onphone_36_samples_v1",
    face_evidence_outcome=None))
  self.assertEqual(v1["face_deep_review_version"],"s9_onphone_36_samples_v1")
  self.assertEqual(v1["face_evidence_outcome"],"legacy_review_no_diagnostics")
  missing=self.catalog.safe_face_review_metadata({})
  self.assertEqual(missing["face_evidence_outcome"],"not_reviewed")

 def test_android_backfill_respects_original_and_one_time_version(self):
  text=self.classifier
  self.assertIn('DEEP_FACE_ROI_VERSION="s9_onphone_36_samples_person_roi_v2"',text)
  self.assertIn('"s9_onphone_36_samples_v1".equals(prior)',text)
  self.assertIn("return prior.isEmpty()",text)
  self.assertIn('manifest.optInt("width",0)!=3840',text)
  self.assertIn('manifest.optInt("height",0)!=2160',text)
  self.assertIn('fingerprint.equalsIgnoreCase(digest(mp4))',text)
  self.assertIn("if(i%3==0)",text)
  self.assertIn("faces.sample(frame,at/1000,isolated)",text)
  self.assertIn('if(decoded==0)throw new IOException',text)
  self.assertIn('writeJson(new File(folder,name+".verified.json"),manifest)',text)
  self.assertIn("ClipClassifier.deepFaceNeedsUpgrade(meta)",self.worker)
  self.assertIn("faceBackfillRetries.merge(mp4name,1,Integer::sum)",self.worker)

 def test_no_false_identification_or_fake_gait_in_face_backfill(self):
  self.assertIn('"face_review_identity_claim","similarity_suggestion_not_verified_identity"',self.face)
  self.assertIn('"face_embedding_on_s9_only",true',self.face)
  self.assertIn('"face_deep_review_human_verified",false',self.classifier)
  self.assertIn('"face_deep_review_no_face_is_not_no_person",true',self.classifier)

if __name__=="__main__":unittest.main()
