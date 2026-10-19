#!/usr/bin/env python3
"""No-device alignment staging and recording-preservation regression."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
import json
ROOT=Path(__file__).resolve().parent
path=ROOT/"stage-s9-five-point-yunet-v120.py"
spec=importlib.util.spec_from_file_location("s9_yunet_v120",path)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Response:
 status=200
 def __init__(self,doc):self.data=json.dumps(doc).encode()
 def __enter__(self):return self
 def __exit__(self,*args):return False
 def read(self,n):return self.data[:n]
def camera(**override):
 d={"ok":True,"mode":"watching","temperature_c":35.2,
  "native_4k_enabled":True,"continuous_4k_ready":True,
  "continuous_4k_dropped_output_frames":0,
  "continuous_4k_buffered_ms":8995,"sd_free_bytes":80*1024**3}
 d.update(override);return d
class Tests(unittest.TestCase):
 def test_pinned_upstream_lfs_identity(self):
  self.assertEqual(m.BYTES,232589)
  self.assertEqual(m.SHA,"8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4")
  self.assertIn("opencv/opencv_zoo",m.SRC)
 def test_healthy_nonrecording_camera(self):
  with patch.object(m.urllib.request,"urlopen",return_value=Response(camera())):
   self.assertEqual(m.health()["continuous_4k_buffered_ms"],8995)
 def test_unsafe_camera_never_allows_transfer(self):
  for overrides in ({"temperature_c":41},{"recording_active":True},
     {"continuous_4k_ready":False},{"continuous_4k_dropped_output_frames":1},
     {"continuous_4k_buffered_ms":0},{"face_backfill_queued":True}):
   with self.subTest(overrides=overrides),patch.object(m.urllib.request,"urlopen",
      return_value=Response(camera(**overrides))):
    with self.assertRaisesRegex(RuntimeError,"capture_not_cool_idle_healthy"):
     m.health()
 def test_script_never_touches_camera_or_review_files(self):
  code=path.read_text()
  for banned in ("am force-stop","pm install","Camera2.apk","Security4K",
                 "assign_person","review_decide","unlink("):
   self.assertNotIn(banned,code)
  self.assertIn("landmark_inference_verified",code)
  self.assertIn("camera_pid_changed_during_model_stage",code)
if __name__=="__main__":unittest.main(verbosity=2)
