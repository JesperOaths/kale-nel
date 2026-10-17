#!/usr/bin/env python3
"""Pure regression tests for guarded S9 camera-control night-mode passthrough."""
import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parent
TARGET=ROOT/"deploy-s9-night-controls-v19.py"
spec=importlib.util.spec_from_file_location("s9nightv19",TARGET)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class TestNightControlRelay(unittest.TestCase):
 def test_existing_native_camera_proxy_only_gets_night_mode(self):
  original=('VALUES={"zoom":re.compile(r"1\\Z"),\n'
   '        "recording_rotation":re.compile(r"(?:auto|0|90|180|270)\\Z"),\n'
   '        "garden_zone":re.compile(r"(?:strict|near|wide|all)\\Z")}\n'
   'def handler(d, options, self):\n'
   ' self.js(200,{"can_change_while_recording":False,"mode":d.get("mode"),"controls":options})\n')
  patched=module.updated_source(module.PROXY,original.encode())
  self.assertIn(b'"night_mode":re.compile',patched)
  self.assertIn(b'"night_active":d["controls"].get("night_active")',patched)
  self.assertEqual(module.updated_source(module.PROXY,patched),patched)
  self.assertEqual(patched.count(b'night_mode'),1)
  self.assertIn(b'"garden_zone":re.compile',patched)

 def test_existing_authenticated_relay_only_gets_night_mode(self):
  original=('SECURITY_NATIVE_CAMERA2_RELAY_V18\n'
   'def check(d,self):\n'
   " if d['key'] not in ('zoom','exposure_ev','torch','focus','recording_rotation','garden_zone'):return self.empty(400)\n")
  patched=module.updated_source(module.LAN,original.encode())
  self.assertIn(b"'night_mode')",patched)
  self.assertIn(b"SECURITY_NATIVE_CAMERA2_RELAY_V18",patched)
  self.assertEqual(module.updated_source(module.LAN,patched),patched)

 def test_unknown_runtime_source_is_not_modified(self):
  for path in (module.PROXY,module.LAN):
   with self.assertRaises(RuntimeError):
    module.updated_source(path,b"unknown app code")

 def test_restore_paths_and_no_camera_commands(self):
  text=TARGET.read_text()
  for phrase in ("S9_NIGHT_CONTROLS_V19_VERIFIED",
      "S9_NIGHT_CONTROLS_V19_ROLLBACK_ATTEMPTED",
      "native_camera_night_mode_not_ready_no_changes",
      "saved_archive", "no_camera_commands_sent"):
   if phrase!="saved_archive":self.assertIn(phrase,text)
  self.assertIn("PROXY_STATUS_NEW",text)
  self.assertIn('isinstance(status.get("night_active"),bool)',text)
  self.assertIn("data=r.read(2_000_001)",text)
  self.assertIn('camera_metadata_response_too_large',text)
  self.assertNotIn("r.read(150000)",text)
  for banned in ("adb install","am force-stop","cameraControls.select(",
                 "shutil.rmtree(", "shell=True", "eval("):
   self.assertNotIn(banned,text)

if __name__=="__main__":
 unittest.main(verbosity=2)
