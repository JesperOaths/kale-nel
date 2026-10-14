#!/usr/bin/env python3
"""Phone-only 2-frame person gate, bounded face rescue and reversible retention."""
import re
import unittest
from pathlib import Path

ROOT=Path(__file__).resolve().parent
SOURCE=(ROOT/'src/nl/kalenel/s9security/CameraService.java').read_text()
CLASSIFIER=(ROOT/'src/nl/kalenel/s9security/ClipClassifier.java').read_text()
FACES=(ROOT/'src/nl/kalenel/s9security/S9FaceReview.java').read_text()
TRIAGE=(ROOT/'src/nl/kalenel/s9security/GardenArchiveTriage.java').read_text()

class Contract(unittest.TestCase):
 def test_two_separate_person_gate_checks(self):
  code=SOURCE.split('private void evaluateGardenPersonAsync(boolean sentinel){',1)[1].split('private boolean rateAllowed',1)[0]
  for required in ('now-gardenPersonGateLastAt<900',
                   'personEvidenceInGarden(jpg,top,margin,selectedZone)',
                   'personTrackGate.offer(now,jpegAt,score,personBox,localCells)',
                   'GardenPersonTrackGate.Decision.CONFIRMED',
                   'gardenPersonGateConfirmedStarts++',
                   'startRecording()','gardenPersonGateStale++'):
   self.assertIn(required,code)
  self.assertLess(code.index('GardenPersonTrackGate.Decision.CONFIRMED'),
                  code.rindex('startRecording()'))
  self.assertIn('d.put("motion_detector",GardenPersonTrackGate.VERSION)',SOURCE)
 def test_native_deep_review_is_bounded_and_does_not_reencode(self):
  deep=CLASSIFIER.split('boolean deepFaceReview(',1)[1].split('public synchronized JSONObject process(',1)[0]
  for required in ('deepFaceNeedsUpgrade(manifest)',
                   '1791687597000L','fingerprint.equalsIgnoreCase(digest(mp4))',
                   'i<36','MediaMetadataRetriever.OPTION_CLOSEST','new S9FaceReview(app,folder,name,36)',
                   'face_deep_review_version','face_deep_review_no_face_is_not_no_person'):
   self.assertIn(required,deep)
  self.assertIn('manifest.optInt("person_count",0)<=0',CLASSIFIER)
  self.assertIn('"s9_onphone_36_samples_v1".equals(prior)',CLASSIFIER)
  self.assertIn('return prior.isEmpty()',CLASSIFIER)
  self.assertNotIn('MediaRecorder',deep)
  self.assertNotIn('.delete(',deep)
  self.assertNotIn('mp4.renameTo',deep)
  self.assertIn('this.frameLimit=Math.max(1,Math.min(48,frameLimit))',FACES)
 def test_backfill_stays_on_phone_only_when_idle_and_cool(self):
  part=SOURCE.split('private void maybeFaceBackfill(){',1)[1].split('private void maybeGardenArchiveTriage(){',1)[0]
  for required in ('now-lastFaceBackfillScan<60000','gardenPersonGateBusy',
                   'now-lastMovementAt<45000L','temperature()>=350',
                   'folder.getUsableSpace()<20L*1024*1024*1024',
                   'classifier.deepFaceReview','faceBackfillQueued=false'):
   self.assertIn(required,part)
  self.assertNotIn('gardenGateExecutor.execute',part)
  self.assertNotIn('http',part)
 def test_no_irreversible_auto_cleanup(self):
  self.assertIn('garden_archive_triage_permanent_deletion_enabled",false',SOURCE)
  self.assertIn('quarantined_model_negative_not_deleted',TRIAGE)
  self.assertNotIn('Files.delete(',TRIAGE)
  self.assertNotIn('.delete(',TRIAGE)

if __name__=='__main__':unittest.main(verbosity=2)
