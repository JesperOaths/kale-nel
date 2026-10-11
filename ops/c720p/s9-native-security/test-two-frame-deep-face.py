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
 def test_temporally_consistent_person_first_engine(self):
  code=SOURCE.split('private void evaluateGardenPersonAsync(){',1)[1].split('private void noteRecordingStarted',1)[0]
  for required in ('PersonEventTracker.Decision event=personEvents.observe',
                   'jpegStamp<=lastPersonGateJpegStamp',
                   'motion.motion?650L:1650L',
                   'event.confirmedNow',
                   'pendingPersonSegment&&event.active',
                   'gardenPersonGateConfirmedStarts++',
                   'startRecording()','gardenPersonGateStale++'):
   self.assertIn(required,code)
  self.assertIn('person_first_periodic_temporal_track_v4',SOURCE)
  self.assertIn('person_gate_periodic_without_motion",true',SOURCE)
  self.assertIn('pendingPersonSegment=personEvents.isActive(',SOURCE)
  self.assertIn('person_gate_spatial_confirmation_frames",3',SOURCE)
 def test_native_deep_review_is_bounded_and_does_not_reencode(self):
  deep=CLASSIFIER.split('boolean deepFaceReview(',1)[1].split('public synchronized JSONObject process(',1)[0]
  for required in ('manifest.optInt("person_count",0)<=0','manifest.has("face_deep_review_version")',
                   '1791687597000L','fingerprint.equalsIgnoreCase(digest(mp4))',
                   'i<36','MediaMetadataRetriever.OPTION_CLOSEST','new S9FaceReview(app,folder,name,36)',
                   'face_deep_review_version','face_deep_review_no_face_is_not_no_person'):
   self.assertIn(required,deep)
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
