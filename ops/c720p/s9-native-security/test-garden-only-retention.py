#!/usr/bin/env python3
"""Guard the S9+ garden-only continuous-video and recoverable archive policy."""
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parent
SRC=ROOT/'src/nl/kalenel/s9security'

class Tests(unittest.TestCase):
    def test_fixed_scene_excludes_street_and_bicycles(self):
        src=(SRC/'MotionGrid.java').read_text()
        self.assertIn('"near".equals(gardenZone)?0.64f',src)
        self.assertIn('"strict".equals(gardenZone)?0.72f',src)
        self.assertIn('"wide".equals(gardenZone)?0.50f',src)
        self.assertIn('insideGarden((gx+.5f)/W,(gy+.5f)/H)',src)
        self.assertIn('changedRatio=nChange/(double)validCells',src)

    def test_continuous_4k_without_cooldown_or_stills(self):
        s=(SRC/'CameraService.java').read_text()
        self.assertIn('MAX_MS=120000,COOLDOWN_MS=0',s)
        self.assertIn('lastFrameAt-lastMovementAt>QUIET_MS',s)
        self.assertIn('cooldownUntil=0',s)
        self.assertIn('fallback_stills_enabled",false',s)
        self.assertIn('max_person_clip_ms",MAX_MS',s)
        self.assertIn('person_recording_extend_by_garden_motion",true',s)
        fallback=s[s.index('private void saveFallbackEvidence(String why)'):
                   s.index('private static boolean validCompleted4K',s.index('private void saveFallbackEvidence'))]
        self.assertNotIn('FileOutputStream',fallback)
        self.assertNotIn('preview_motion_',fallback)
        self.assertNotIn('.jpg',fallback)
        self.assertIn('skippedRecordingsWithoutStill++',fallback)
        for guard in ('recorder.setVideoSize(3840,2160)',
                      'recorder.setVideoFrameRate(30)',
                      'recorder.setVideoEncodingBitRate(36000000)',
                      'temperature()>=415',
                      'folder.getUsableSpace()<15L*1024*1024*1024',
                      'RecordingRate.TOTAL_PER_HOUR',
                      'reviewer.submit('):
            self.assertIn(guard,s)

    def test_thumbnail_is_peak_garden_motion_not_road_frame(self):
        s=(SRC/'ClipClassifier.java').read_text()
        for token in ('sampleGardenLuma(bitmap,gardenTop)',
                      'gardenFrameDifference(previousGardenLuma,currentGardenLuma)',
                      'EventFrameRanker.rank(',
                      'bestMotionTimeMs=micros/1000',
                      'makeGardenThumbnail(bitmap,gardenPersonBox)',
                      'thumbnail_focus","foreground_garden_motion"',
                      'thumbnail_source_time_ms',
                      'rebuildGardenThumbnail('):
            self.assertIn(token,s)
        self.assertNotIn('double quality=confidence*2.0+0.05*(p+a+v)',s)

    def test_archive_thumbnail_warms_cold_classifier(self):
        source=(SRC/'ClipClassifier.java').read_text()
        method=source.split('public synchronized boolean rebuildGardenThumbnail(',1)[1].split(
            'public synchronized JSONObject gardenRetentionProbe(',1)[0]
        self.assertIn('init();',method)
        self.assertLess(method.index('init();'),method.index('detect(bitmap)'))
        # Initialization only on the S9+ background review thread, not the
        # real-time camera callback or the Home Assistant proxy.
        camera=(SRC/'CameraService.java').read_text()
        self.assertIn('reviewer.execute(new Runnable()',camera)
        self.assertIn('detector.rebuildGardenThumbnail(movie,live,meta)',(SRC/'GardenArchiveTriage.java').read_text())

    def test_archive_thumbnail_backfill_initializes_detector_independently(self):
        source=(SRC/'ClipClassifier.java').read_text()
        method=source.split('boolean rebuildGardenThumbnail(',1)[1].split(
            'public synchronized JSONObject gardenRetentionProbe(',1)[0]
        first_detect=method.index('for(Detection d:detect(bitmap))')
        first_init=method.index('init();')
        self.assertLess(first_init,first_detect)
        self.assertIn('MediaMetadataRetriever media=new MediaMetadataRetriever()',method)
        self.assertIn('writeJson(new File(folder,name+".verified.json"),manifest)',method)
        self.assertIn('thumb.previous-garden.jpg',method)

    def test_secondary_person_check_and_nonpermanent_quarantine(self):
        c=(SRC/'ClipClassifier.java').read_text()
        q=(SRC/'GardenArchiveTriage.java').read_text()
        self.assertIn('gardenRetentionProbe(File video',c)
        self.assertIn('for(int i=0;i<24;i++)',c)
        self.assertIn('frames<20?"uncertain_incomplete_samples"',c)
        self.assertIn('personFrames>0?"retain_possible_garden_person"',c)
        for phrase in ('MIN_AGE_MS=6L*3600000L',
                       'gardenRetentionProbe(movie,top,margin)',
                       'person_frames_at_050',
                       'Security4K_quarantine_garden_review',
                       'human_verified",false',
                       'permanently_deleted",false',
                       'quarantine_video_move_failed',
                       'quarantine_rollback_failed'):
            self.assertIn(phrase,q)
        self.assertNotIn('.delete(',q)
        self.assertNotIn('Files.delete(',q)
        s=(SRC/'CameraService.java').read_text()
        self.assertIn('maybeGardenArchiveTriage();',s)
        self.assertIn('garden_archive_triage_permanent_deletion_enabled",false',s)
        self.assertIn('garden_roi_archive_cutoff_ms',s)

if __name__=='__main__':
    unittest.main(verbosity=2)
