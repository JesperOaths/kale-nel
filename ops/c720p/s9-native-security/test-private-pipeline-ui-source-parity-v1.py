#!/usr/bin/env python3
"""Exact production-parity and privacy-sensitive health presentation regressions.

No camera, media, human review, live HTTP, auth or external system mutations.
"""
import ast
import datetime as dt
import hashlib
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

THIS=Path(__file__).resolve().parent
RUNTIME=THIS.parent/"security-runtime/s9_security_component_health_v1.py"
BLOBS={
 RUNTIME:"3a6065f790e1946c19ac0be47c3d02e201a76356",
 THIS/"security-hub-v30.js":"e5687004d39c72e0e1de9c9160f560d3dd721155",
 THIS/"security-hub-v31.js":"e694fd75c3db526f39be8fc2544b69c589b9c4ae",
 THIS/"security-hub-v30.html.snapshot.txt":"0155c15e5d16f414965fa6ca64320bdaf5cc54e9",
 THIS/"c720p-surveillance.html.snapshot.txt":"c1b05255ceb0ca8c82bc5ab0d8965ee1cbdaa540",
}
def blob(raw):
 return hashlib.sha1(b"blob "+str(len(raw)).encode()+b"\0"+raw).hexdigest()
def mod():
 spec=importlib.util.spec_from_file_location("test_private_health_projection",RUNTIME)
 module=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(module)
 return module
def envelope(now):
 return {
  "schema_version":2,"observed_at":now.isoformat(),
  "security_pipeline":{"schema_version":"security_pipeline_cloud_health_v1",
   "rescan":{"state":"reported","revision":9,"tracked":5,"pending":1,"processing":0,
             "completed":1,"blocked":3,"rejected":0,"dead_letter":0,
             "worker_activity_verified":None,"results_current_source_verified":None},
   "s3":{"state":"current","age_seconds":20,"healthy":None,
         "motion_analysis_active":None,"motion_health_verified":False,
         "privacy_adb_port_closed_recently":True},
   "manual_binding":{"state":"reported","revision":50,"decisions":48,
         "reported_bound_at_decision":0,"without_reported_binding":48,
         "current_source_binding_verified":None,
         "live_write_binding_verified":None}}}

class SecurityPrivateUI(unittest.TestCase):
 def test_exact_deployed_asset_bytes(self):
  for f,expected in BLOBS.items():
   self.assertEqual(blob(f.read_bytes()),expected,str(f))
 def test_precise_versioned_shells_and_private_only_reader(self):
  expected="security-hub-v31.js?v=private-pipeline-safe-status-v31-20261021"
  self.assertIn(expected,(THIS/"c720p-surveillance.html.snapshot.txt").read_text())
  self.assertIn(expected,(THIS/"security-hub-v30.html.snapshot.txt").read_text())
  script=(THIS/"security-hub-v31.js").read_text()
  for phrase in ("security-component-health","pipeline_summary",
    "security_ui_pipeline_summary_v1",
    "historical/unbound", "UNKNOWN · private motion/heartbeat",
    "Per-record blocked reasons/revocations unavailable",
    "document.hidden","visibilitychange"):
   self.assertIn(phrase,script)
  for phrase in ("storageAlert", "aggregate_stale", "report_transport_error", "historical/unbound"):
   self.assertIn(phrase,script)
  self.assertNotIn("verified_same_person:true",script)
 def test_typed_private_payload_and_missing_data_fail_closed(self):
  x=mod()
  now=dt.datetime.now(dt.timezone.utc)
  with tempfile.TemporaryDirectory() as d:
   x.STATE=Path(d)
   self.assertEqual(x.ui_pipeline_summary()["state"],"unavailable")
   path=x.STATE/"c720p-cloud-health-report.json"
   payload=envelope(now)
   path.write_text(json.dumps(payload))
   p=x.ui_pipeline_summary()
   self.assertEqual(p["state"],"reported")
   self.assertEqual(p["rescan"]["blocked"],3)
   self.assertIsNone(p["s3"]["healthy"])
   self.assertFalse(p["s3"]["motion_health_verified"])
   self.assertIsNone(p["manual_binding"]["live_write_binding_verified"])
   self.assertEqual(p["manual_binding"]["without_reported_binding"],48)
   payload["security_pipeline"]["rescan"]["blocked"]=-4
   path.write_text(json.dumps(payload))
   self.assertEqual(x.ui_pipeline_summary()["state"],"unavailable")
   payload=envelope(now-dt.timedelta(hours=4))
   path.write_text(json.dumps(payload))
   self.assertEqual(x.ui_pipeline_summary()["state"],"unavailable")
 def test_no_recursive_health_projection_or_biometric_labels(self):
  s=RUNTIME.read_text()
  self.assertIn("read_report(STATE,'c720p-cloud-health-report.json',65536)",s)
  self.assertNotIn("from s9_pipeline_cloud_health_v1 import build",s)
  ast.parse(s)
  script=(THIS/"security-hub-v31.js").read_text()
  self.assertIn("manual_binding",script)
  self.assertIn("Not verified",script)
  self.assertIn("UNKNOWN",script)
  self.assertIn("Appearance and pose observations do not confirm",script)

if __name__=="__main__":unittest.main()
