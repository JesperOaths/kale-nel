#!/usr/bin/env python3
"""Keep real-time S9+ garden person detection independent of slow 4K reviews.

The Samsung Galaxy S9+ remains responsible for both live inference and archive
decoding. No CPU/image work is added to the Home Assistant C720P relay.
"""
from pathlib import Path
import unittest

HERE=Path(__file__).resolve().parent
CAMERA=(HERE/'src/nl/kalenel/s9security/CameraService.java')
MODEL=(HERE/'src/nl/kalenel/s9security/ClipClassifier.java')

class GardenRealtimePriorityTests(unittest.TestCase):
    def test_live_motion_never_queues_behind_historical_archive_or_faces(self):
        s=CAMERA.read_text()
        gate=s.split('private void evaluateGardenPersonAsync(){',1)[1].split(
            'private boolean rateAllowed(',1)[0]
        self.assertIn('gardenGateExecutor.execute(new Runnable()',gate)
        self.assertIn('gardenGateClassifier.personScoreInGarden',gate)
        self.assertNotIn('reviewer.execute',gate)
        self.assertNotIn('reviewer.submit',gate)
        self.assertNotIn('classifier.process(',gate)
        self.assertIn('SystemClock.elapsedRealtime()-now>3500',gate)
        self.assertIn('!gardenGateReady',s)
        self.assertIn('realtime_person_detector_warming_or_unavailable',s)
        self.assertIn('realtime_person_detector_failed',gate)
        self.assertIn('stale_person_result_skipped',gate)
        self.assertIn('gardenPersonGateBusy',gate)

    def test_separate_pre_warmed_gpu_model_still_on_phone(self):
        s=CAMERA.read_text()
        model=MODEL.read_text()
        for required in (
            'gardenGateExecutor=Executors.newSingleThreadExecutor(',
            'gardenGateClassifier=new ClipClassifier(this)',
            'liveGate.warmPersonGate()',
            'new Thread(job,"s9-realtime-garden-person")',
            'new Thread(job,"s9-background-4k-review")',
            'gardenGateExecutor.shutdown()',
            'gateClose.close()',
            'gardenGateClassifier.inferenceBackend()',
            'garden_person_gate_stale_dropped',
            'garden_person_gate_last_queue_wait_ms',
            'garden_person_gate_prepare_errors',
        ):
            self.assertIn(required,s)
        self.assertIn('synchronized void warmPersonGate()',model)
        self.assertIn('String inferenceBackend()',model)
        self.assertIn('volatile String backend=',model)
        self.assertNotIn('http://',model)
        self.assertNotIn('Socket(',model)

    def test_4k_and_thermal_guards_remain_intact(self):
        s=CAMERA.read_text()
        for required in (
            'recorder.setVideoSize(3840,2160)',
            'recorder.setVideoFrameRate(30)',
            'recorder.setVideoEncodingBitRate(36000000)',
            'temperature()<415',
            'folder.getUsableSpace()>15L*1024*1024*1024',
            'COOLDOWN_MS=12000',
            'recording_rate_max_per_hour',
            'PhoneMediaRange.handle',
            'PreviewJpeg.encode(copied,58)',
            'sensor_exposure_ms',
            'garden_roi_gpu_person_gate_v1',
            'Math.max(0,gateStarted-now)',
        ):
            self.assertIn(required,s)
        self.assertIn('if(now-lastFallbackAt<45000L',s)

if __name__=='__main__':
    unittest.main(verbosity=2)
