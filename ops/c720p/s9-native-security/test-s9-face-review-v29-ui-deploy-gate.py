#!/usr/bin/env python3
"""No-device contract for metadata-only Face folders deployment."""
from pathlib import Path
from unittest.mock import patch
import importlib.util,json,unittest
ROOT=Path(__file__).resolve().parent
source=ROOT/"deploy-s9-face-review-v29.py"
spec=importlib.util.spec_from_file_location("s9_face_ui_deploy",source)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class GateTests(unittest.TestCase):
 def status_for(self,change):
  doc={"ok":True,"mode":"watching","native_4k_enabled":True,
   "last_frame_age_ms":80,"continuous_4k_ready":False,
   "continuous_4k_last_result":"fallback_thermal_guard",
   "continuous_4k_production_persisted":True,"preroll_ready":True,
   "preroll_buffered_ms":6900,"temperature_c":38.3}
  doc.update(change)
  with patch.object(module,"get",return_value=json.dumps(doc).encode()):
   return module.status()
 def test_known_thermal_fallback_allows_only_metadata_page_change(self):
  status=self.status_for({})
  self.assertFalse(status["continuous_4k_ready"])
  self.assertTrue(self.status_for({"continuous_4k_ready":True})["ok"])
 def test_unknown_or_unsafe_states_rejected(self):
  for case in ({"ok":False},{"mode":"recording"},{"native_4k_enabled":False},
    {"last_frame_age_ms":3000},{"continuous_4k_last_result":"codec_error"},
    {"continuous_4k_production_persisted":False},{"preroll_ready":False},
    {"preroll_buffered_ms":0},{"temperature_c":39.6}):
   with self.subTest(case=case),self.assertRaises(RuntimeError):
    self.status_for(case)
 def test_ui_only_never_controls_s9(self):
  s=source.read_text()
  self.assertNotIn('"adb"',s)
  self.assertNotIn('force-stop',s)
  self.assertIn('"camera_apk_changed":False',s)
  self.assertIn('"ui_never_controls_camera":True',s)

if __name__=="__main__":unittest.main(verbosity=2)
