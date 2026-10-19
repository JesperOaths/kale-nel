#!/usr/bin/env python3
"""S3 privacy-health semantics. No phone connection or camera image required."""
import datetime as dt
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("s3_motion_health",HERE/"s3-motion-readonly-health.py")
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Tests(unittest.TestCase):
 def test_recent_closed_debug_port_not_treated_as_camera_proof(self):
  with tempfile.TemporaryDirectory() as root:
   path=Path(root)/"private.json"
   path.write_text(json.dumps({"checked_at_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
                                "result":"adb_port_not_listening"}))
   with patch.object(m,"PRIVACY_STATE",path):
    self.assertTrue(m.privacy_adb_intentionally_closed())
   path.write_text(json.dumps({"checked_at_utc":"2026-01-01T00:00:00+00:00",
                                "result":"adb_port_not_listening"}))
   with patch.object(m,"PRIVACY_STATE",path):
    self.assertFalse(m.privacy_adb_intentionally_closed())

 def test_closed_adb_means_unknown_motion_health_not_false_camera_outage(self):
  with tempfile.TemporaryDirectory() as root:
   local=Path(root)
   # A privacy-closed diagnostic must never claim the motion engine is healthy.
   with patch.object(m,"OUT",local/"status.json"),patch.object(m,"USERSTATE",local/"private.json"),\
        patch.object(m,"HISTORY",local/"history.json"),patch.object(m,"parse") as parse,\
        patch.object(m,"privacy_adb_intentionally_closed",return_value=True):
    m.main()
    parse.assert_not_called()
   report=json.loads((local/"private.json").read_text())
   self.assertIsNone(report["healthy"])
   self.assertIsNone(report["motion_analysis_active"])
   self.assertFalse(report["motion_health_verified"])
   self.assertTrue(report["privacy_adb_port_closed_recently"])
   self.assertFalse(report["images_or_audio_copied"])

if __name__=="__main__":
 unittest.main()
