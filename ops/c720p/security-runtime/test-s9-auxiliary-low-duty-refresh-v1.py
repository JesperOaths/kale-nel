#!/usr/bin/env python3
"""Offline low-duty refresh tests, independent of live Camera2 APK/media."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

BASE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location("s9_recovery_refresh",BASE/"s9_auxiliary_low_duty_refresh_v1.py")
m=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(m)

class Tests(unittest.TestCase):
 def test_not_due_for_recent_private_report(self):
  with tempfile.TemporaryDirectory() as td:
   f=Path(td)/"report.json"
   now=dt.datetime(2026,10,19,12,0,tzinfo=dt.timezone.utc)
   f.write_text(json.dumps({"schema_version":"s9_auxiliary_structural_report_v1",
        "generated_at_utc":(now-dt.timedelta(hours=4)).isoformat()}))
   self.assertAlmostEqual(m.age_seconds(f,now),14400)
   self.assertLess(m.age_seconds(f,now),m.MIN_AGE)
 def test_old_report_becomes_due(self):
  with tempfile.TemporaryDirectory() as td:
   f=Path(td)/"report.json"
   now=dt.datetime(2026,10,19,12,0,tzinfo=dt.timezone.utc)
   f.write_text(json.dumps({"schema_version":"s9_auxiliary_structural_report_v1",
        "generated_at_utc":(now-dt.timedelta(days=4)).isoformat()}))
   self.assertGreater(m.age_seconds(f,now),m.MIN_AGE)
 def test_unknown_clock_and_symlinks_fail_closed(self):
  with tempfile.TemporaryDirectory() as td:
   f=Path(td)/"data.json"
   f.write_text('{"schema_version":"s9_auxiliary_structural_report_v1","generated_at_utc":"2028-10-19T00:00:00+00:00"}')
   with self.assertRaises(ValueError):m.age_seconds(f,dt.datetime(2026,10,19,tzinfo=dt.timezone.utc))
   link=Path(td)/"link.json";link.symlink_to(f)
   with self.assertRaisesRegex(ValueError,"symlink"):m.age_seconds(link)
 def test_timeout_gate_and_no_media_writes(self):
  txt=(BASE/"s9_auxiliary_low_duty_refresh_v1.py").read_text()
  self.assertEqual(m.MAX_TEMP_C,37.0)
  self.assertIn("competing_s9_integrity_or_catalog_job",txt)
  self.assertIn('status.get("mode")!="watching"',txt)
  self.assertIn('scanlib.scan(DEX,DEX_SHA,save=True)',txt)
  self.assertIn("originals_modified",txt)
  for danger in ("shutil.rmtree(", ".unlink(", "adb pull", "CameraManager", "sudo ", "rm -rf"):
   self.assertNotIn(danger,txt)
  sampler=(BASE/"s9_auxiliary_media_probe_v1.py").read_text()
  self.assertIn('0<float(value.get("temperature_c") or 100)<39',sampler)
 def test_timer_is_sparse_and_non_persistent(self):
  timer=(BASE/"c720p-s9-auxiliary-recovery-refresh-v1.timer").read_text()
  service=(BASE/"c720p-s9-auxiliary-recovery-refresh-v1.service").read_text()
  for token in ("OnBootSec=2h","OnUnitInactiveSec=3d",
       "RandomizedDelaySec=4h","Persistent=false"):
   self.assertIn(token,timer)
  self.assertNotIn("OnCalendar=",timer)
  self.assertIn("Nice=15",service)
  self.assertIn("IOSchedulingClass=idle",service)
  self.assertIn("s9_auxiliary_low_duty_refresh_v1.py --execute",service)
if __name__=="__main__":unittest.main(verbosity=2)
