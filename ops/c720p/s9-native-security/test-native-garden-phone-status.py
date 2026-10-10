#!/usr/bin/env python3
"""S9+ garden GPU status: phone-only metadata, no C720P JPEG decode."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import shutil
import subprocess

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
          "garden_person_gate_errors":0,"temperature_c":27.0}

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

    def test_rejects_camera_offline_and_bad_counters(self):
        module=load(MODULE,'phone_watch_guards')
        with self.assertRaises(ValueError):
            module.from_phone({**self.sample(),"ok":False},now_ms=999)
        with self.assertRaises(ValueError):
            module.from_phone({**self.sample(),"garden_person_gate_matches":8},now_ms=999)

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
