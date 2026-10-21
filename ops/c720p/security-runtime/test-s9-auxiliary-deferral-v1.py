#!/usr/bin/env python3
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import sys
import tempfile
import types
import unittest
from unittest import mock

BIN=Path(__file__).resolve().parent
DIR=Path(__file__).resolve().parent
sys.path.insert(0,str(BIN))
spec=importlib.util.spec_from_file_location('aux_candidate',DIR/'s9_auxiliary_low_duty_refresh_v1.py')
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Tests(unittest.TestCase):
 def test_competing_job_classified_exactly(self):
  p=mock.patch.object(m.subprocess,'run',return_value=types.SimpleNamespace(stdout='active\n',returncode=0))
  with p, self.assertRaises(m.CompetingJobDeferral):
   m.check_other_jobs()
 def setup_fake(self,root,first=False,mid=False,general=False):
  paths=Path(root)
  report=paths/'report.json'
  report.write_text('{"prior":"must_survive"}')
  prior=report.read_bytes()
  dex=paths/'isolated.dex'; dex.write_bytes(b'harmless synthetic test fixture')
  m.DEX=dex;m.DEX_SHA=hashlib.sha256(dex.read_bytes()).hexdigest()
  m.STATE=paths;m.LOCK=paths/'aux.lock';m.REPORT=report
  status=dict(temperature_c=33.0,mode='watching',continuous_4k_ready=True,
              continuous_4k_dropped_output_frames=0)
  fixtures=[
    mock.patch.object(m,'age_seconds',return_value=1000000),
    mock.patch.object(m.urllib.request,'urlopen',
      side_effect=lambda *a,**kw: io.BytesIO(json.dumps(status).encode())),
  ]
  for f in fixtures:f.start()
  self.addCleanup(lambda:[f.stop() for f in reversed(fixtures)])
  exception=m.CompetingJobDeferral('competing_s9_integrity_or_catalog_job') if not general else RuntimeError('unrelated_dex_or_media_failure')
  guard=mock.patch.object(m,'check_other_jobs',side_effect=exception if first else None)
  guard.start();self.addCleanup(guard.stop)
  scan=mock.patch.object(m.scanlib,'scan',side_effect=exception if mid or general else None)
  mocked_scan=scan.start();self.addCleanup(scan.stop)
  return report,prior,mocked_scan
 def test_precheck_conflict_is_successful_deferral(self):
  with tempfile.TemporaryDirectory() as d:
   report,prior,scan=self.setup_fake(d,first=True)
   self.assertEqual(m.run(execute=True),'deferred')
   self.assertEqual(report.read_bytes(),prior)
   scan.assert_not_called()
 def test_midbatch_conflict_is_successful_deferral(self):
  with tempfile.TemporaryDirectory() as d:
   report,prior,scan=self.setup_fake(d,mid=True)
   self.assertEqual(m.run(execute=True),'deferred')
   self.assertEqual(report.read_bytes(),prior)
   scan.assert_called_once()
 def test_unrelated_failure_still_raises(self):
  with tempfile.TemporaryDirectory() as d:
   report,prior,scan=self.setup_fake(d,general=True)
   with self.assertRaisesRegex(RuntimeError,'unrelated_dex_or_media_failure'):
    m.run(execute=True)
   self.assertEqual(report.read_bytes(),prior)
 def test_actual_thermal_guard_defers_without_scan(self):
  with tempfile.TemporaryDirectory() as d:
   report,prior,scan=self.setup_fake(d,mid=True)
   def hot(*a,**kw):return io.BytesIO(b'{"temperature_c":38.5,"mode":"watching","continuous_4k_ready":true,"continuous_4k_dropped_output_frames":0}')
   with mock.patch.object(m.urllib.request,'urlopen',side_effect=hot):
    self.assertEqual(m.run(execute=True),'deferred')
   scan.assert_not_called()
   self.assertEqual(report.read_bytes(),prior)
if __name__=='__main__':unittest.main(verbosity=2)
