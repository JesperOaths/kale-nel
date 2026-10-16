#!/usr/bin/env python3
"""S9+ garden GPU status: phone-only metadata, no C720P JPEG decode."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import shutil
import subprocess
import json
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
MODULE=HERE.parent/'s9-person-ml-v1'/'s9_phone_garden_status.py'
PANEL=HERE/'patch-native-garden-watch-ui.py'
PRIOR_UI=HERE/'patch-live-person-watch-ui.py'

def load(filename,name):
    spec=importlib.util.spec_from_file_location(name,filename)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

class Tests(unittest.TestCase):
    def sample(self):
        return {"ok":True,"mode":"watching",
          "motion_detector":"garden_roi_gpu_person_gate_v1",
          "last_frame_age_ms":85,"garden_zone":"near",
          "garden_person_gate_checked":0,"garden_person_gate_matches":0,
          "garden_person_gate_rejected":0,
          "garden_person_gate_last_score":0,
          "garden_person_gate_errors":0,"temperature_c":27.0,
          "garden_person_gate_backend":"gpu","garden_person_gate_ready":True}

    def test_standby_no_false_positive_then_model_event(self):
        module=load(MODULE,'phone_watch')
        baseline=self.sample()
        a=module.from_phone(baseline,now_ms=100000)
        self.assertEqual(a['status']['kind'],'garden_waiting_for_motion')
        self.assertTrue(a['on_phone_gpu_inference'])
        self.assertFalse(a['hub_frame_decoding'])
        baseline.update({"garden_person_gate_checked":1,"garden_person_gate_matches":1,
          "garden_person_gate_last_score":.73})
        b=module.from_phone(baseline,now_ms=103000)
        self.assertEqual(b['status']['kind'],'person_likely_candidate')
        self.assertEqual(b['status']['person_score'],.73)
        c=module.from_phone(baseline,now_ms=113000)
        self.assertEqual(c['status']['kind'],'garden_waiting_for_motion')
        self.assertIsNone(c['status']['person_score'])

    def test_reports_real_backend_and_queue_latency_without_guessing(self):
        module=load(MODULE,'phone_watch_actual_backend')
        sample=self.sample()
        sample.update(garden_person_gate_backend='cpu',
                      garden_person_gate_last_queue_wait_ms=120,
                      garden_person_gate_stale_dropped=4)
        report=module.from_phone(sample,now_ms=105000)
        self.assertIs(report['on_phone_gpu_inference'],False)
        self.assertTrue(report['on_phone_person_inference'])
        self.assertEqual(report['person_inference_backend'],'cpu')
        self.assertEqual(report['person_gate_queue_wait_ms'],120)
        self.assertEqual(report['person_gate_stale_results'],4)
        sample.pop('garden_person_gate_backend')
        unknown=module.from_phone(sample,now_ms=107000)
        self.assertIsNone(unknown['on_phone_gpu_inference'])
        self.assertEqual(unknown['person_inference_backend'],'unknown')

    def test_hybrid_v8_is_accepted_without_inventing_identity(self):
        module=load(MODULE,'phone_watch_hybrid_v8')
        sample=self.sample()
        sample.update({
          "motion_detector":"person_multiscale_threeframe_static_v8",
          "garden_person_multiscale_version":"garden_overlapping_person_tiles_v8",
          "garden_person_last_multiscale_passes":3,
          "garden_person_sentinel_interval_ms":1600,
          "garden_person_sentinel_checks":14,
          "garden_person_sentinel_recordings":1,
          "garden_person_inference_last_ms":112,
          "garden_person_no_motion_requires_distinct_frames":3,
          "garden_archive_auto_quarantine_enabled":False,
          "garden_person_gate_checked":14,
          "garden_person_gate_matches":2,
          "garden_person_gate_rejected":12,
        })
        report=module.from_phone(sample,now_ms=99000)
        self.assertTrue(report["ok"])
        self.assertEqual(report["detector_version"],"person_multiscale_threeframe_static_v8")
        self.assertEqual(report["detector_inference_passes"],3)
        self.assertEqual(report["person_periodic_checks"],14)
        self.assertEqual(report["person_periodic_scan_interval_ms"],1600)
        self.assertEqual(report["person_gpu_inference_ms"],112)
        self.assertEqual(report["person_without_motion_requires_frames"],3)
        self.assertFalse(report["auto_quarantine_model_negative_enabled"])
        self.assertEqual(report["status"]["identity"],"not_evaluated")

    def test_rejects_camera_offline_and_bad_counters(self):
        module=load(MODULE,'phone_watch_guards')
        with self.assertRaises(ValueError):
            module.from_phone({**self.sample(),"ok":False},now_ms=999)
        with self.assertRaises(ValueError):
            module.from_phone({**self.sample(),"garden_person_gate_matches":8},now_ms=999)

    def test_installed_v9_is_accepted_but_unknown_and_stale_are_not(self):
        module=load(MODULE,'phone_watch_v9')
        sample={**self.sample(),'motion_detector':'person_spatiotemporal_transport_v9'}
        self.assertTrue(module.from_phone(sample)['ok'])
        for changed in ({'motion_detector':'unknown'}, {'last_frame_age_ms':10000}):
            with self.assertRaises(ValueError):module.from_phone({**sample,**changed})

    def test_multicandidate_detector_is_accepted(self):
        module=load(MODULE,'phone_watch_multicandidate')
        self.assertTrue(module.from_phone({**self.sample(),'motion_detector':'person_multicandidate_transport_v38'})['ok'])

    def test_night_detector_preserves_observed_policy(self):
        module=load(MODULE,'phone_watch_night_v41')
        report=module.from_phone({**self.sample(),'motion_detector':'night_temporal_transport_v41',
            'garden_person_night_active':True,'garden_person_gate_required_positive_frames':3,
            'garden_person_night_rejected':17,'garden_person_local_motion_max_age_ms':1200})
        self.assertTrue(report['night_detection_active'])
        self.assertEqual(report['person_required_observations'],3)
        self.assertEqual(report['person_without_motion_requires_frames'],3)
        self.assertEqual(report['night_rejected_observations'],17)
        self.assertEqual(report['person_motion_evidence_max_age_ms'],1200)

    def test_extended_status_has_bounded_size(self):
        module=load(MODULE,'phone_watch_extended')
        class Response:
            status=200
            def __init__(self,raw):self.raw=raw
            def __enter__(self):return self
            def __exit__(self,*args):pass
            def read(self,size):return self.raw[:size]
        sample={**self.sample(),'extra_diagnostics':'x'*20000}
        with patch.object(module.urllib.request,'urlopen',return_value=Response(json.dumps(sample).encode())):
            self.assertTrue(module.read_report()['ok'])
        with patch.object(module.urllib.request,'urlopen',return_value=Response(b'x'*70000)):
            with self.assertRaises(ValueError):module.read_report()

    def test_python_source_does_no_video_or_image_processing(self):
        source=MODULE.read_text()
        for prohibited in ('ai_edge_litert','tensorflow','cv2','PIL','ffmpeg','ffprobe',
                           '/shot.jpg','/mjpeg','/saved/clip/','adb','detect.tflite'):
            self.assertNotIn(prohibited,source)
        self.assertIn('http://127.0.0.1:18808/status',source)

    def test_browser_panel_patch_safe_and_idempotent(self):
        m=load(PANEL,'garden_panel')
        previous=load(PRIOR_UI,'prior_status_panel')
        page=('<html><head></head><body><div id="list"></div>'
              +previous.SNIPPET+'</body></html>')
        changed=m.patch(page)
        self.assertNotEqual(changed,page)
        self.assertEqual(m.patch(changed),changed)
        self.assertEqual(changed.count(m.MARKER),1)
        self.assertIn('Garden zone',changed)
        self.assertIn('GPU inference on S9+',changed)
        self.assertNotIn('Vehicles '+ " '+",changed)
        self.assertNotIn('camera_force_stop',changed)
        with self.assertRaises(ValueError):m.patch('<html><body></body></html>')

if __name__=='__main__':
    unittest.main(verbosity=2)
