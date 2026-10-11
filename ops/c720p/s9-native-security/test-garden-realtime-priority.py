#!/usr/bin/env python3
"""Keep real-time S9+ garden person detection independent of slow 4K reviews.

The Samsung Galaxy S9+ remains responsible for both live inference and archive
decoding. No CPU/image work is added to the Home Assistant C720P relay.
"""
from pathlib import Path
import unittest
import importlib.util

HERE=Path(__file__).resolve().parent
CAMERA=(HERE/'src/nl/kalenel/s9security/CameraService.java')
MODEL=(HERE/'src/nl/kalenel/s9security/ClipClassifier.java')

class GardenRealtimePriorityTests(unittest.TestCase):
    def test_live_motion_never_queues_behind_historical_archive_or_faces(self):
        s=CAMERA.read_text()
        gate=s.split('private void evaluateGardenPersonAsync(){',1)[1].split(
            'private void noteRecordingStarted(',1)[0]
        self.assertIn('gardenGateExecutor.execute(new Runnable()',gate)
        self.assertIn('gardenGateClassifier.personObservationInGarden',gate)
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
            'gate.warmPersonGate()',
            'new Thread(job,"s9-realtime-garden-person")',
            'new Thread(job,"s9-background-4k-review")',
            'gardenGateExecutor.shutdown()',
            'gateClose.close()',
            'gardenGateClassifier.inferenceBackend()',
            'garden_person_gate_stale_dropped',
            'garden_person_gate_last_queue_wait_ms',
            'garden_person_gate_prepare_errors',
            'gardenGatePrepareErrors<5',
            'warmGardenGateAsync()',
        ):
            self.assertIn(required,s)
        self.assertIn('synchronized void warmPersonGate()',model)
        self.assertIn('String inferenceBackend()',model)
        self.assertIn('volatile String backend=',model)
        self.assertNotIn('http://',model)
        self.assertNotIn('Socket(',model)

    def test_acceptance_probe_is_metadata_only_and_rejects_unready_gate(self):
        probe=HERE/'check-s9-garden-priority.py'
        source=probe.read_text()
        for forbidden in ('import cv2','import tensorflow','import PIL',
                          'ffmpeg','ffprobe','adb','subprocess',
                          '/shot.jpg','/mjpeg'):
            self.assertNotIn(forbidden,source)
        spec=importlib.util.spec_from_file_location('s9_live_gate_probe',probe)
        tool=importlib.util.module_from_spec(spec)
        spec.loader.exec_module(tool)
        healthy={
          'ok':True,'mode':'watching','native_4k_enabled':True,
          'garden_person_gate_ready':True,
          'garden_person_gate_backend':'gpu',
          'garden_zone':'near','recording_rate_max_per_hour':-1,
          'temperature_c':26.0,'sd_free_bytes':79000000000,
          'garden_person_gate_last_queue_wait_ms':85,
          'garden_person_gate_prepare_errors':0,
        }
        self.assertTrue(tool.assess(healthy,{'events':[{'clip_no':'motion_1.mp4'}]})['ok'])
        self.assertFalse(tool.assess({**healthy,'garden_person_gate_ready':False})['ok'])
        self.assertFalse(tool.assess({**healthy,'garden_person_gate_last_queue_wait_ms':4400})['ok'])
        self.assertFalse(tool.assess({**healthy,'temperature_c':42})['ok'])

    def test_recording_guard_does_not_create_still_substitutes(self):
        camera=CAMERA.read_text()
        body=camera.split('private void saveFallbackEvidence(String why){',1)[1].split(
            'private static boolean validCompleted4K(',1)[0]
        self.assertIn('skippedRecordingsWithoutStill++',body)
        self.assertNotIn('FileOutputStream',body)
        self.assertNotIn('preview_motion_',body)
        self.assertNotIn('.jpg',body)
        self.assertIn('fallback_stills_enabled",false',camera)
        self.assertIn('post_record_cooldown_ms",COOLDOWN_MS',camera)

    def test_4k_and_thermal_guards_remain_intact(self):
        s=CAMERA.read_text()
        for required in (
            'recorder.setVideoSize(3840,2160)',
            'recorder.setVideoFrameRate(30)',
            'recorder.setVideoEncodingBitRate(36000000)',
            'temperature()<415',
            'folder.getUsableSpace()>15L*1024*1024*1024',
            'COOLDOWN_MS=0',
            'recording_rate_max_per_hour',
            'PhoneMediaRange.handle',
            'PreviewJpeg.encode(copied,58)',
            'sensor_exposure_ms',
            'garden_roi_adaptive_noise_consistent_person_gate_v3',
            'Math.max(0,gateStarted-now)',
        ):
            self.assertIn(required,s)
        self.assertIn('MAX_MS=120000',s)

if __name__=='__main__':
    unittest.main(verbosity=2)
