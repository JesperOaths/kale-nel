#!/usr/bin/env python3
"""No-device contract for metadata-only review deployment camera preflight."""
from pathlib import Path
import importlib.util,json,unittest
from unittest.mock import patch
from io import BytesIO

HERE=Path(__file__).resolve().parent
SOURCE=HERE/"deploy-s9-drive-v28-review.py"
spec=importlib.util.spec_from_file_location("v28_ui_deploy_gate",SOURCE)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class Response:
 def __init__(self,payload):self.data=BytesIO(json.dumps(payload).encode())
 def __enter__(self):return self
 def __exit__(self,*args):return False
 def read(self,*args):return self.data.read(*args)

class Tests(unittest.TestCase):
 def run_gate(self,overrides):
  status={"ok":True,"mode":"watching","last_frame_age_ms":90,
    "continuous_4k_ready":False,
    "continuous_4k_last_result":"fallback_thermal_guard",
    "continuous_4k_production_persisted":True,
    "preroll_ready":True,"preroll_buffered_ms":6900,
    "temperature_c":36.7}
  status.update(overrides)
  with patch.object(mod.urllib.request,"urlopen",return_value=Response(status)):
   return mod.cam()

 def test_known_fallback_retains_live_preview_and_preroll(self):
  self.assertEqual(self.run_gate({})["continuous_4k_ready"],False)
  self.assertTrue(self.run_gate({"continuous_4k_ready":True})["ok"])

 def test_unknown_failure_or_missing_capture_safety_must_defer(self):
  conditions=({"continuous_4k_last_result":"fallback_codec_health_guard"},
    {"preroll_ready":False},{"preroll_buffered_ms":100},
    {"continuous_4k_production_persisted":False},
    {"temperature_c":39.5},{"last_frame_age_ms":5000},
    {"mode":"recording"},{"ok":False})
  for fields in conditions:
   with self.subTest(fields=fields),self.assertRaises(RuntimeError):
    self.run_gate(fields)

 def test_ui_deployment_never_reconfigures_phone(self):
  code=SOURCE.read_text()
  camera=code.split("def cam():",1)[1].split("def run(",1)[0]
  for operation in ('force-stop','adb("install"','am start','camera-control'):
   self.assertNotIn(operation,camera)
  self.assertIn("original_media_modified",code)
  self.assertIn("continuous_4k_healthy_at_ui_deploy",code)

if __name__=="__main__":unittest.main(verbosity=2)
