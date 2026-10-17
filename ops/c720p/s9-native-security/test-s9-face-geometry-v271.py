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
 def test_reviewer_must_not_make_weak_auto_identity_claim(self):
  self.assertIn('if(reliableForEmbedding)',FACE)
  self.assertIn('if(!reliableForEmbedding)',FACE)
  self.assertIn('"face_crop_padded_context_only":row.get("face_crop_padded_context_only") is True',CATALOG)
if __name__=="__main__":unittest.main(verbosity=2)
