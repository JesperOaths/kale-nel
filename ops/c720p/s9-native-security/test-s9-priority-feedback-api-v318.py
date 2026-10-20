#!/usr/bin/env python3
"""Host-only aggregate API queue tests. Never reads originals or identifies people."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE=Path(__file__).resolve().parents[1]/"s9-person-ml-v1"/"s9_evidence_quality_v1.py"
spec=importlib.util.spec_from_file_location("s9_quality_feedback_v318",SOURCE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Feedback(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory(prefix="s9-feedback-v318-")
  self.addCleanup(self.tmp.cleanup)
  self.path=Path(self.tmp.name)/"queue.json"
  self.patch=patch.object(m,"PRIORITY_QUEUE",self.path)
  self.patch.start();self.addCleanup(self.patch.stop)
 def put(self,rows,revision=4):
  self.path.write_text(json.dumps({"schema":"s9_priority_rescan_feedback_v304",
        "revision":revision,"rows":rows}))
 def test_absent_is_not_success(self):
  result=m.priority_rescan_feedback()
  self.assertEqual(result["state"],"not_installed")
  self.assertEqual(result["verified_secondary_completions"],0)
 def test_counter_snapshot_and_no_identifiers(self):
  rows=[
   {"id":"a"*64,"clip_no":"motion_1792000000000.mp4",
    "status":"completed","attempts":1,
    "outcome":{"verified_secondary_report":True,"model_sha256":m.MODEL_SHA}},
   {"id":"b"*64,"clip_no":"motion_1792000001000.mp4",
    "status":"blocked","attempts":0,"last_reason":"same_detector"},
   {"id":"c"*64,"status":"pending","attempts":0},
   {"id":"d"*64,"status":"processing","attempts":1},
   {"id":"e"*64,"status":"rejected","attempts":0},
   {"id":"f"*64,"status":"dead_letter","attempts":3},
   {"id":"g"*64,"status":"completed","attempts":1,
    "outcome":{"verified_secondary_report":True,"model_sha256":"0"*64}}
  ]
  self.put(rows,revision=9)
  result=m.priority_rescan_feedback()
  self.assertEqual(result["state"],"active")
  self.assertEqual(result["queue_revision"],9)
  self.assertEqual(result["tracked"],7)
  self.assertEqual(result["completed"],2)
  self.assertEqual(result["blocked"],1)
  self.assertEqual(result["pending"],1)
  self.assertEqual(result["processing"],1)
  self.assertEqual(result["rejected"],1)
  self.assertEqual(result["dead_letter"],1)
  self.assertEqual(result["verified_secondary_completions"],1)
  self.assertFalse(result["automated_person_assignments"])
  serialized=json.dumps(result)
  for forbidden in ("motion_","clip_no","last_reason","person_id","reference_sha"):
   self.assertNotIn(forbidden,serialized)
 def test_invalid_or_replaced_queue_fails_closed(self):
  for bad in [
   {"schema":"wrong","revision":1,"rows":[]},
   {"schema":"s9_priority_rescan_feedback_v304","revision":"1","rows":[]},
   {"schema":"s9_priority_rescan_feedback_v304","revision":1,
    "rows":[{"status":"suggested_person","attempts":0}]},
   {"schema":"s9_priority_rescan_feedback_v304","revision":1,
    "rows":[{"status":"pending","attempts":500}]},
  ]:
   with self.subTest(document=bad):
    self.path.write_text(json.dumps(bad))
    self.assertEqual(m.priority_rescan_feedback()["state"],"queue_unavailable")
  self.path.unlink()
  self.path.symlink_to(Path(self.tmp.name)/"missing")
  self.assertEqual(m.priority_rescan_feedback()["state"],"not_installed")
 def test_endpoint_splices_only_aggregate_function(self):
  code=SOURCE.read_text()
  self.assertIn("report['priority_rescan_feedback'] = priority_rescan_feedback()",code)
  self.assertNotIn("report['priority_rescan_feedback'] = doc",code)
  self.assertIn("handler.js(200, dict(report, ok=True))",code)

if __name__=="__main__":unittest.main(verbosity=2)
