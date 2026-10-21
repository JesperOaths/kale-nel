#!/usr/bin/env python3
"""Anonymous original-gap evidence may be consumed only while source/queue-valid."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE=Path(__file__).resolve().parents[1]/"s9-person-ml-v1/s9_evidence_quality_v1.py"
spec=importlib.util.spec_from_file_location("s9_gap_revoke_v355",SOURCE)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class CurrentGap(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix="s9-gap-revocation-v355-")
  self.addCleanup(self.temp.cleanup)
  root=Path(self.temp.name)
  self.cat=root/"catalog.json";self.queue=root/"queue.json"
  for key,path in (("PRIORITY_CATALOG",self.cat),("PRIORITY_QUEUE",self.queue)):
   change=patch.object(m,key,path);change.start();self.addCleanup(change.stop)
  self.name="motion_1792200000000.mp4"
  self.sha="a"*64;self.version="b"*64;self.size=2345678
  self.meta={"name":self.name,"bytes":self.size,
             "sha256":self.sha,"width":3840,"height":2160}
  self.catalog={"schema_version":"s9_native_archive_catalog_v1",
    "snapshot_id":"c"*64,
    "records":{self.name:{"manifest":self.meta,"bytes":self.size,
                           "version":self.version}}}
  self.row={"id":"d"*64,"clip_no":self.name,"status":"processing",
            "attempts":1,"source_sha256":self.sha,
            "source_bytes":self.size,"media_revision":self.version,
            "model_sha256":m.MODEL_SHA,"required_analysis":m.GAP_ANALYSIS}
  self.job={"schema":"s9_priority_rescan_feedback_v304",
            "revision":3,"rows":[self.row]}
  self.record={"clip_no":self.name,"source_sha256":self.sha,
               "source_revision":self.version,"source_bytes":self.size,
               "model_sha256":m.MODEL_SHA,"analysis_version":m.GAP_ANALYSIS,
               "samples":[{"time_ms":t,"state":"decoded",
                           "original_resolution":[3840,2160],
                           "face_candidates":[]} for t in (1000,3000,5000)]}
  self.gap={"analysis_version":m.GAP_ANALYSIS,
            "detector_model_sha256":m.MODEL_SHA,
            "recordings":[self.record]}
  self.current={self.name:{"clip_no":self.name}}
  self.save()
 def save(self):
  self.cat.write_text(json.dumps(self.catalog))
  self.queue.write_text(json.dumps(self.job))
 def read(self):
  self.save()
  return m.source_current_gap_report(self.gap,self.current)
 def test_active_processing_can_be_read_back_before_worker_commits(self):
  d=self.read()
  self.assertEqual(len(d["recordings"]),1)
  self.assertEqual(d["source_bound_records_visible"],1)
  self.assertFalse(d["identity_inference_performed"])
 def test_completed_requires_both_verified_published_and_visible(self):
  self.row["status"]="completed"
  self.assertEqual(self.read()["recordings"],[])
  self.row["outcome"]={"verified_secondary_report":True,
       "consumer_visibility_confirmed":True,"model_sha256":m.MODEL_SHA}
  self.assertEqual(len(self.read()["recordings"]),1)
  self.row["outcome"]["consumer_visibility_confirmed"]=False
  self.assertEqual(self.read()["recordings"],[])
 def test_latest_queue_finality_revokes_old_visible_result(self):
  for state in ("pending","rejected","blocked","dead_letter"):
   with self.subTest(state=state):
    self.row["status"]=state
    d=self.read()
    self.assertEqual(d["recordings"],[])
    self.assertEqual(d["source_bound_records_not_current"],1)
 def test_media_version_bytes_sha_and_model_all_authoritative(self):
  import copy
  original=(copy.deepcopy(self.catalog),copy.deepcopy(self.gap),
            copy.deepcopy(self.job),copy.deepcopy(self.current))
  tests=(
    ("revision",lambda:self.catalog["records"][self.name].__setitem__("version","0"*64),False),
    ("sha",lambda:self.meta.__setitem__("sha256","1"*64),False),
    ("bytes",lambda:self.meta.__setitem__("bytes",self.size+1),False),
    ("model",lambda:self.gap.__setitem__("detector_model_sha256","f"*64),True),
    ("queue_revision",lambda:self.row.__setitem__("media_revision","9"*64),False),
    ("original_removed",lambda:self.current.clear(),False),
  )
  for key,action,raise_bad in tests:
   with self.subTest(key=key):
    self.catalog,self.gap,self.job,self.current=copy.deepcopy(original)
    self.meta=self.catalog["records"][self.name]["manifest"]
    self.row=self.job["rows"][0]
    self.record=self.gap["recordings"][0]
    action()
    if raise_bad:
     with self.assertRaises(ValueError):self.read()
    else:self.assertEqual(self.read()["recordings"],[])
 def test_unproven_sampling_shape_is_revoked(self):
  self.record["samples"][1]["original_resolution"]=[1280,720]
  self.assertEqual(self.read()["recordings"],[])
  self.record["samples"][1]["original_resolution"]=[3840,2160]
  self.record["samples"][0]["state"]="estimated"
  self.assertEqual(self.read()["recordings"],[])
 def test_unavailable_catalog_or_queue_fails_closed(self):
  self.cat.unlink()
  with self.assertRaisesRegex(ValueError,"source_attestation_file_unavailable"):
   m.source_current_gap_report(self.gap,self.current)
  self.save()
  self.job["schema"]="bad"
  self.save()
  with self.assertRaisesRegex(ValueError,"source_attestation_schema_unavailable"):
   m.source_current_gap_report(self.gap,self.current)
  self.save()
 def test_cross_clip_duplicate_or_invalid_rows_are_never_promoted(self):
  self.gap["recordings"]=[self.record,dict(self.record)]
  r=self.read()
  self.assertEqual(len(r["recordings"]),1)
  self.assertEqual(r["source_bound_records_not_current"],1)
 def test_consumption_reader_does_not_publish_identity_or_touch_original(self):
  src=SOURCE.read_text()
  self.assertIn("source_current_gap_report(gap, current)",src)
  self.assertNotIn("row for row in gap.get('recordings', []) if row.get('clip_no') in current",src)
  self.assertIn("source_attestation_unavailable",src)
  self.assertIn("identity_inference_performed=False",src)

if __name__=="__main__":unittest.main(verbosity=2)
