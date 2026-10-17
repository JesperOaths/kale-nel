#!/usr/bin/env python3
"""Source and scheduling regressions for non-destructive original-4K face backlog."""
from pathlib import Path
import unittest

HERE=Path(__file__).resolve().parent
JAVA=HERE/"src/nl/kalenel/s9security"
SERVICE=(JAVA/"CameraService.java").read_text()
FACE=(JAVA/"S9FaceReview.java").read_text()
CLASSIFIER=(JAVA/"ClipClassifier.java").read_text()

class FaceBackfillCoverageV35(unittest.TestCase):
 def test_oldest_verified_clip_first_no_new_clip_starvation(self):
  worker=SERVICE.split("private void maybeFaceBackfill(){",1)[1].split(
   "Offloaded archived-video retention review",1)[0]
  self.assertIn("Arrays.sort(manifests,(a,b)->a.getName().compareTo(b.getName()));",worker)
  self.assertNotIn("b.getName().compareTo(a.getName())",worker)
  self.assertIn("return;",worker) # bounded one original video per pass
  self.assertIn("now-lastFaceBackfillScan<60000",worker)
  self.assertIn('name.matches("motion_[0-9]{13}[.]mp4")',CLASSIFIER)
  self.assertIn('fingerprint.equalsIgnoreCase(digest(mp4))',CLASSIFIER)
 def test_keep_4k_thermal_motion_and_storage_safety(self):
  scope=SERVICE.split("private void maybeFaceBackfill(){",1)[1].split(
   "Offloaded archived-video retention review",1)[0]
  for gate in ("faceBackfillThermallyAllowed()","gardenPersonGateBusy",
   "lastMovementAt<45000L","folder.getUsableSpace()<20L*1024*1024*1024"):
   self.assertIn(gate,scope)
  self.assertIn("FACE_BACKFILL_WITH_4K_MAX_TENTHS_C=360",SERVICE)
  self.assertIn("FACE_BACKFILL_MAX_TEMP_TENTHS_C=390",SERVICE)
  self.assertIn("!continuous4K.readyForEvent()",SERVICE)
 def test_reported_review_version_is_compiled_classifier_version(self):
  self.assertIn('d.put("face_deep_rescue_version",ClipClassifier.DEEP_FACE_ROI_VERSION);',SERVICE)
  self.assertIn('DEEP_FACE_ROI_VERSION="s9_onphone_36_samples_overlapping_tiles_v5"',CLASSIFIER)
  self.assertNotIn('d.put("face_deep_rescue_version","s9_onphone_36_samples_person_or_tile_v4")',SERVICE)
 def test_eight_slots_reserved_across_all_deep_review_samples(self):
  self.assertIn("if(!FILE.matcher(clip).matches()||frames>=frameLimit)return;",FACE)
  self.assertNotIn("frames>=frameLimit||captures.length()>=MAX_CAPTURES",FACE)
  self.assertIn("(frames*MAX_CAPTURES+expectedSamples-1)/expectedSamples",FACE)
  self.assertIn("captures.length()<captureAllowance",FACE)
  self.assertIn("expectedSamples=Math.min(frameLimit,36)",FACE)
  slots=[min(8,max(1,(f*8+36-1)//36)) for f in range(1,49)]
  self.assertEqual((slots[0],slots[11],slots[23],slots[35],slots[47]),
                   (1,3,6,8,8))
  self.assertTrue(all(a<=b for a,b in zip(slots,slots[1:])))
  # Snapshots are a strict bounded sample, never guaranteed 36 good frames.
  self.assertIn("MAX_CAPTURES=8",FACE)
 def test_crop_identity_gates_not_weakened(self):
  self.assertIn("originalEyeSpan>=22f&&estimatedSize>=96&&!contextPadded",FACE)
  self.assertIn("if(!reliableForEmbedding)",FACE)
  self.assertIn('match.put("face_crop_requires_manual_review",true)',FACE)
  self.assertIn('match.put("face_crop_padded_context_only",true)',FACE)
  self.assertIn("shadow=null",FACE)
  self.assertIn('manifest.put("face_shadow_matches_created",0)',FACE)
  self.assertNotIn("mp4.delete(",CLASSIFIER)

if __name__=="__main__":unittest.main(verbosity=2)
