#!/usr/bin/env python3
"""Source-only fail-closed consumer tests: no original media or identity access."""
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
BIN=HERE.parent/"s9-person-ml-v1"
sys.path.insert(0,str(BIN))
import s9_evidence_quality_v1 as q
spec=importlib.util.spec_from_file_location(
    "anonymous_consumer_v361",BIN/"s9_anonymous_evidence_consumer_v361.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Consumer(unittest.TestCase):
 def setUp(self):
  tmp=tempfile.TemporaryDirectory()
  self.addCleanup(tmp.cleanup)
  self.root=Path(tmp.name)
  self.catalog=self.root/"catalog.json"
  self.queue=self.root/"queue.json"
  self.report=self.root/"report.json"
  self.name="motion_1792200000000.mp4"
  self.sha="a"*64;self.version="b"*64;self.size=1234567
  self.cat={"schema_version":"s9_native_archive_catalog_v1",
      "snapshot_id":"c"*64,
      "records":{self.name:{"bytes":self.size,"version":self.version,
          "manifest":{"name":self.name,"bytes":self.size,"sha256":self.sha,
                      "width":3840,"height":2160}}}}
  self.task={"id":"d"*64,"status":"completed","clip_no":self.name,
      "source_sha256":self.sha,"source_bytes":self.size,
      "media_revision":self.version,"required_analysis":q.GAP_ANALYSIS,
      "priority_reason":"no_indexed_image",
      "model_sha256":q.MODEL_SHA,
      "outcome":{"verified_secondary_report":True,
                 "consumer_visibility_confirmed":True,
                 "model_sha256":q.MODEL_SHA,"sampled_frames":3,
                 "source_revision":self.version}}
  self.jobs={"schema":"s9_priority_rescan_feedback_v304",
             "revision":10,"rows":[self.task]}
  self.priority={"analysis_version":q.VERSION,
      "detector_model_sha256":q.MODEL_SHA,"original_recordings":1,
      "generated_at":"2026-10-21T03:20:00+00:00",
      "recordings":[{"clip_no":self.name,"native_face_pass_complete":True,
                     "targeted_rescan_priority":True,
                     "extraction_status":"no_indexed_image"}]}
  self.item={"clip_no":self.name,"source_sha256":self.sha,
      "source_revision":self.version,"source_bytes":self.size,
      "model_sha256":q.MODEL_SHA,"analysis_version":q.GAP_ANALYSIS,
      "duration_ms":15000,"samples":[
          {"time_ms":n,"state":"decoded",
           "original_resolution":[3840,2160],"face_candidates":[]}
          for n in (1000,5000,11000)]}
  self.doc={"ok":True,"original_gap_benchmark":{
      "analysis_version":q.GAP_ANALYSIS,
      "detector_model_sha256":q.MODEL_SHA,
      "source_binding_status":"source_qualified_active_queue_only",
      "source_bound_records_visible":1,
      "source_bound_records_not_current":0,
      "identity_inference_performed":False,
      "original_recordings_modified":False,
      "recordings":[self.item]}}
  self.current={self.name:{"clip_no":self.name,"face_candidates":[],
       "face_deep_review_version":q.NATIVE_PASS}}
  self.appearance={
       "ok":True,"status":"provisional_appearance_only_original_revision_unverified",
       "source_binding_status":"crop_and_corpus_sha_valid_original_revision_unverified",
       "evidence_consumption_eligible":False,
       "person_reference_eligible":False,"verified_same_person":False,
       "human_review_required":True,"automatic_person_assignments":0}
  for name,value in (("PRIORITY_CATALOG",self.catalog),
                     ("PRIORITY_QUEUE",self.queue),
                     ("REPORT",self.report)):
   p=patch.object(q,name,value);p.start();self.addCleanup(p.stop)
  self.write()
 def write(self):
  self.catalog.write_text(json.dumps(self.cat))
  self.queue.write_text(json.dumps(self.jobs))
  self.report.write_text(json.dumps(self.priority))
 def run_case(self,appearance=None):
  self.write()
  return m.consume(self.doc,self.current,self.name,appearance)
 def test_verified_three_frame_manual_quality_and_versioned_receipt(self):
  status,body=self.run_case(self.appearance)
  self.assertEqual(status,200)
  self.assertEqual(body["schema_version"],m.SCHEMA)
  self.assertEqual(body["source_revision"],self.version)
  self.assertEqual(body["source_binding_status"],
                   "revalidated_original_and_queue_at_consumption")
  self.assertEqual(body["sampled_face_candidate_count"],0)
  self.assertEqual(body["observation"],
                   "no_supported_face_in_three_sampled_frames")
  self.assertEqual(body["appearance_v3"],"provisional_not_admitted")
  self.assertFalse(body["appearance_evidence_eligible"])
  self.assertFalse(body["pose_gait_measured"])
  self.assertFalse(body["verified_same_person"])
  self.assertEqual(body["automatic_person_assignments"],0)
  self.assertEqual(self.run_case(self.appearance)[1]["evidence_revision_sha256"],
                   body["evidence_revision_sha256"])
  self.assertEqual(len(body["evidence_revision_sha256"]),64)
  self.assertNotIn("person_id",json.dumps(body))
  self.assertNotIn("embedding",json.dumps(body))
  self.assertNotIn("identity_probability",json.dumps(body))

 def test_source_and_revision_revocation_without_claiming_no_person(self):
  self.run_case()
  mutations=(
    lambda:self.cat["records"][self.name].__setitem__("version","f"*64),
    lambda:self.cat["records"][self.name]["manifest"].__setitem__("sha256","e"*64),
    lambda:self.cat["records"][self.name].__setitem__("bytes",self.size+1),
    lambda:self.task.__setitem__("status","pending"),
    lambda:self.current[self.name].__setitem__("face_candidates",[{"snapshot_name":"new"}]),
    lambda:self.current[self.name].__setitem__("face_deep_review_version","new_native_pass"))
  import copy
  clean=(copy.deepcopy(self.cat),copy.deepcopy(self.jobs),
         copy.deepcopy(self.current))
  for mutation in mutations:
   with self.subTest(mutation=repr(mutation)):
    self.cat,self.jobs,self.current=copy.deepcopy(clean)
    self.task=self.jobs["rows"][0]
    mutation()
    status,body=self.run_case()
    self.assertEqual(status,410)
    self.assertEqual(body["error"],"source_revision_or_evidence_revoked")
    self.assertNotIn("no_person",json.dumps(body))
  self.cat,self.jobs,self.current=clean

 def test_status_and_model_provenance_fail_closed(self):
  self.doc["original_gap_benchmark"]["detector_model_sha256"]="9"*64
  status,_=self.run_case()
  self.assertEqual(status,503)
  self.doc["original_gap_benchmark"]["detector_model_sha256"]=q.MODEL_SHA
  self.doc["original_gap_benchmark"]["source_binding_status"]="legacy_unqualified"
  self.assertEqual(self.run_case()[0],503)
  self.doc["original_gap_benchmark"]["source_binding_status"]="source_qualified_active_queue_only"
  self.doc["original_gap_benchmark"]["recordings"][0]["model_sha256"]="f"*64
  self.assertEqual(self.run_case()[0],410)

 def test_cached_reader_must_revalidate_and_detect_interrupted_state(self):
  with patch.object(m,"snapshot_state",side_effect=[("a","b"),("a","c")]):
   self.assertEqual(m.consume(self.doc,self.current,self.name)[0],503)
  self.assertEqual(m.consume(self.doc,self.current,"invalid.mp4")[0],400)
  self.doc["original_gap_benchmark"]["source_bound_records_visible"]=7
  self.assertEqual(self.run_case()[0],503)

 def test_mutating_queue_changes_revision_no_auto_approved_decisions(self):
  _,start=self.run_case()
  self.jobs["revision"]+=1
  _,end=self.run_case()
  self.assertNotEqual(start["evidence_revision_sha256"],
                      end["evidence_revision_sha256"])
  self.item["samples"][0]["face_candidates"]=[{"box":[12,20,40,50]}]
  _,observed=self.run_case()
  self.assertEqual(observed["observation"],"unreviewed_detector_candidates_present")
  self.assertEqual(observed["sampled_face_candidate_count"],1)
  self.assertEqual(observed["automatic_person_assignments"],0)


 def test_withdrawn_or_changed_quality_priority_immediately_revokes_completed(self):
  # An unchanged original, completed queue receipt and no new crop are
  # insufficient after the independent producer withdraws authorization.
  self.assertEqual(self.run_case()[0],200)
  self.priority["recordings"][0]["targeted_rescan_priority"]=False
  status,body=self.run_case()
  self.assertEqual(status,410)
  self.assertEqual(body["error"],"source_revision_or_evidence_revoked")
  self.priority["recordings"][0]["targeted_rescan_priority"]=True
  self.priority["recordings"][0]["extraction_status"]="secondary_detector_has_no_supported_face"
  self.assertEqual(self.run_case()[0],410)
  self.priority["recordings"][0]["extraction_status"]="no_indexed_image"
  self.priority["recordings"][0]["native_face_pass_complete"]=False
  self.assertEqual(self.run_case()[0],410)
  self.priority["recordings"][0]["native_face_pass_complete"]=True
  self.assertEqual(self.run_case()[0],200)

 def test_priority_report_corruption_fails_closed_in_reader_and_consumer(self):
  self.assertEqual(self.run_case()[0],200)
  self.priority["recordings"].append(dict(self.priority["recordings"][0]))
  self.priority["original_recordings"]=2
  self.assertEqual(self.run_case()[0],503)
  self.priority["recordings"].pop()
  self.priority["original_recordings"]=1
  self.priority["detector_model_sha256"]="f"*64
  self.assertEqual(self.run_case()[0],503)
  self.priority["detector_model_sha256"]=q.MODEL_SHA
  self.write()
  self.report.unlink()
  self.assertEqual(m.consume(self.doc,self.current,self.name)[0],503)
  self.assertEqual(self.run_case()[0],200)

 def test_priority_snapshot_is_a_revision_source_even_without_original_drift(self):
  status,first=self.run_case()
  self.assertEqual(status,200)
  self.priority["generated_at"]="2026-10-21T03:25:00+00:00"
  status,second=self.run_case()
  self.assertEqual(status,200)
  self.assertNotEqual(first["evidence_revision_sha256"],second["evidence_revision_sha256"])

 def test_provisional_v3_cannot_become_person_reference(self):
  bad=dict(self.appearance,person_reference_eligible=True)
  self.assertEqual(self.run_case(bad)[0],503)
  bad=dict(self.appearance,verified_same_person=True)
  self.assertEqual(self.run_case(bad)[0],503)
  status,result=self.run_case(self.appearance)
  self.assertEqual(status,200)
  self.assertEqual(result["appearance_evidence_eligible"],False)

if __name__=="__main__":unittest.main(verbosity=2)
