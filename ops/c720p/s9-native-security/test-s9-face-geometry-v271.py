#!/usr/bin/env python3
"""Source contracts for V27.1 image-geometry recovery. Android CI compiles Java."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parent
JAVA=ROOT/"src/nl/kalenel/s9security"
FACE=(JAVA/"S9FaceReview.java").read_text()
CLASSIFIER=(JAVA/"ClipClassifier.java").read_text()
SERVICE=(JAVA/"CameraService.java").read_text()
BUILD=(ROOT/"build-s9-face-recall-v27.py").read_text()
CATALOG=(ROOT.parent/"s9-person-ml-v1/local-sd-catalog.py").read_text()
class Tests(unittest.TestCase):
 def test_real_source_pixel_gate(self):
  self.assertIn('originalEyeSpan<10f',FACE)
  self.assertIn('Math.max(70,estimatedSize)',FACE)
  self.assertIn('originalEyeSpan>=22f&&estimatedSize>=96&&!contextPadded',FACE)
  self.assertIn('face_crop_requires_manual_review',FACE)
  self.assertIn('face_crop_padded_context_only',FACE)
 def test_clamp_crop_at_image_edges_without_fake_upscale(self):
  self.assertIn('b.getWidth()-side,x-side/2',FACE)
  self.assertIn('b.getHeight()-side,y-(int)(side*.43)',FACE)
  self.assertNotIn('b.getWidth()-1,x-size/2',FACE)
 def test_replay_only_clips_with_no_previous_saved_snapshot(self):
  self.assertIn('manifest.optInt("face_snapshots_saved",0)>0',CLASSIFIER)
  self.assertIn('S9FaceReview.GEOMETRY_VERSION.equals(manifest.optString("face_crop_geometry_version",""))',CLASSIFIER)
  self.assertIn('face_crop_geometry_version",GEOMETRY_VERSION',FACE)
 def test_build_and_status_marker(self):
  marker='face_crop_geometry_v2_padded_manual'
  self.assertIn(marker,FACE)
  self.assertIn(marker,BUILD)
  self.assertIn('face_crop_geometry_version",S9FaceReview.GEOMETRY_VERSION',SERVICE)
 def test_archive_exposes_only_allowlisted_geometry_marker(self):
  import importlib.util
  path=ROOT.parent/"s9-person-ml-v1/local-sd-catalog.py"
  spec=importlib.util.spec_from_file_location("s9_catalog_geom_test",path)
  mod=importlib.util.module_from_spec(spec)
  spec.loader.exec_module(mod)
  basis={"face_review_version":"s9_face_review_v1","face_review_status":"no_frontal_face_in_samples",
         "face_review_sampled_frames":36,"face_deep_review_version":"s9_onphone_36_samples_person_or_tile_v4",
         "face_candidates":[],"face_crop_padded_manual_count":2,"face_rejected_insufficient_native_eye_detail":3}
  good=mod.safe_face_review_metadata(dict(basis,face_crop_geometry_version="face_crop_geometry_v2_padded_manual"))
  self.assertEqual(good["face_crop_geometry_version"],"face_crop_geometry_v2_padded_manual")
  self.assertEqual(good["face_crop_padded_manual_count"],2)
  self.assertEqual(good["face_rejected_insufficient_native_eye_detail"],3)
  invalid=mod.safe_face_review_metadata(dict(basis,face_crop_geometry_version="arbitrary_or_untrusted"))
  self.assertIsNone(invalid["face_crop_geometry_version"])
  self.assertIsNone(mod.safe_face_review_metadata({})["face_crop_geometry_version"])
 def test_reviewer_must_not_make_weak_auto_identity_claim(self):
  self.assertIn('if(reliableForEmbedding)',FACE)
  self.assertIn('if(!reliableForEmbedding)',FACE)
  self.assertIn('"face_crop_padded_context_only":row.get("face_crop_padded_context_only") is True',CATALOG)
if __name__=="__main__":unittest.main(verbosity=2)
