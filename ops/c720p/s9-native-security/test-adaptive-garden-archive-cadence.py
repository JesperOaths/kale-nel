#!/usr/bin/env python3
"""Guard phone-first accelerated archive cleanup against live camera load."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parent
SOURCE=(ROOT/'src/nl/kalenel/s9security/CameraService.java').read_text()
TRIAGE=(ROOT/'src/nl/kalenel/s9security/GardenArchiveTriage.java').read_text()

class Tests(unittest.TestCase):
 def test_background_work_never_preempts_live_garden(self):
  body=SOURCE.split('private void maybeGardenArchiveTriage(){',1)[1].split('private void watchdog(){',1)[0]
  for required in ('batteryTenths<310?18000L','batteryTenths<335?40000L:60000L',
                   'gardenPersonGateBusy','now-lastMovementAt<30000L',
                   '"watching".equals(mode)','faceBackfillQueued','historicalQueued',
                   'batteryTenths>=370','folder.getUsableSpace()<20L*1024*1024*1024',
                   'reviewer.execute(new Runnable()','GardenArchiveTriage(media,classifier'):
   self.assertIn(required,body)
  self.assertNotIn('gardenGateExecutor.execute',body)
  self.assertNotIn('saveFallbackEvidence(',body)
  self.assertIn('gardenTriageQueued=false;',body)

 def test_recording_safety_and_quarantine_preserved(self):
  for text in ('recorder.setVideoSize(3840,2160)',
               'recorder.setVideoFrameRate(30)',
               'recorder.setVideoEncodingBitRate(36000000)',
               'MAX_MS=120000,COOLDOWN_MS=0',
               'fallback_stills_enabled",false',
               'garden_archive_triage_permanent_deletion_enabled",false',
               'garden_archive_target_interval_ms',
               'garden_archive_requires_quiet_ms",30000'):
   self.assertIn(text,SOURCE)
  self.assertIn('gardenRetentionProbe(movie,top,margin)',TRIAGE)
  self.assertIn('MIN_AGE_MS=6L*3600000L',TRIAGE)
  self.assertIn('quarantine_video_move_failed',TRIAGE)
  self.assertNotIn('.delete(',TRIAGE)
  self.assertNotIn('Files.delete(',TRIAGE)

if __name__=='__main__':
 unittest.main(verbosity=2)
