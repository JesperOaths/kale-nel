#!/usr/bin/env python3
"""Synthetic private-source + durable queue + real derived report contract."""
import importlib.util,json,os
from pathlib import Path
import tempfile,unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
MOD=HERE/"s9_priority_rescan_feedback_v304.py"
spec=importlib.util.spec_from_file_location("s9_priority_v304",MOD)
v=importlib.util.module_from_spec(spec);spec.loader.exec_module(v)

class QueueTest(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory(prefix="s9priority-v304-")
  self.addCleanup(self.t.cleanup)
  self.root=Path(self.t.name);self.state=self.root/"queue";self.state.mkdir()
  self.catalog=self.root/"catalog.json";self.report=self.root/"report.json"
  self.secondary=self.root/"gap.json";self.lock=self.root/"s9lock";self.lock.touch()
  self.image_lock=self.root/"image-worker.lock";self.image_lock.touch()
  self.orig={};self.rows=[]
  for i in range(4):
   name=f"motion_{1792000000000+i*1000}.mp4"
   sha=str(i+1)*64;version=str(i+5)*64
   self.orig[name]={"name":name,"bytes":1000000+i,"version":version,"thumbnail":True,
     "thumbnail_version":"1000:abc",
     "manifest":{"name":name,"bytes":1000000+i,"width":3840,"height":2160,
                 "sha256":sha}}
   reason="no_indexed_image" if i<2 else "secondary_detector_has_no_supported_face"
   self.rows.append({"clip_no":name,"native_face_pass_complete":True,
        "targeted_rescan_priority":True,"extraction_status":reason})
  self.patch=[
   patch.object(v,"STATE",self.state),
   patch.object(v,"QUEUE",self.state/"queue.json"),
   patch.object(v,"LOCK",self.state/"queue.lock"),
   patch.object(v,"AUDIT",self.state/"transitions.jsonl"),
   patch.object(v,"REPORT",self.report),
   patch.object(v,"ARCHIVE",self.catalog),
   patch.object(v,"SECONDARY",self.secondary),
   patch.object(v,"CROSS_LOCK",self.lock),
   patch.object(v,"IMAGE_LOCK",self.image_lock)]
  for x in self.patch:x.start();self.addCleanup(x.stop)
  self.store()
 def store(self):
  self.report.write_text(json.dumps({"analysis_version":"s9_evidence_quality_v1",
   "detector_model_sha256":v.MODEL_SHA,"recordings":self.rows}))
  self.catalog.write_text(json.dumps({"schema_version":"s9_native_archive_catalog_v1",
   "snapshot_id":"a"*64,"records":self.orig}))
 def test_producer_qualifies_and_prevents_duplicates(self):
  a=v.produce()
  self.assertEqual(a["new_admissions"],4)
  self.assertEqual(a["tally"]["pending"],2)
  self.assertEqual(a["tally"]["blocked"],2)
  self.assertEqual(v.produce()["new_admissions"],0)
  ids=[row["id"] for row in v.items()["rows"]]
  self.assertEqual(len(ids),len(set(ids)))
  self.assertTrue(all(len(x)==64 for x in ids))
  self.assertTrue(all("model_sha256" in x and "source_sha256" in x
      and "media_revision" in x for x in v.items()["rows"]))

 def test_processing_persists_real_secondary_feedback(self):
  v.produce()
  original=v.items()["rows"][0]
  record={"clip_no":original["clip_no"],"duration_ms":18000,
        "source_sha256":original["source_sha256"],
        "source_bytes":original["source_bytes"],
        "source_revision":original["media_revision"],
        "samples":[{"time_ms":t,"state":"decoded","face_candidates":[]}
                   for t in (3000,9000,15000)]}
  with patch.object(v,"camera_guard",return_value={"ok":True}),\
       patch.object(v,"evaluate_one",return_value=record):
   done=v.work()
  self.assertEqual(done["status"],"completed")
  self.assertEqual(done["verified_secondary"],True)
  self.assertEqual(v.items()["rows"][0]["outcome"]["sampled_frames"],3)
  derived=json.loads(self.secondary.read_text())
  self.assertEqual(derived["recordings"][0]["clip_no"],original["clip_no"])
  self.assertEqual(derived["queue_revision"],v.items()["revision"])
  self.assertEqual(derived["identity_inference_performed"],False)
  self.assertEqual(v.produce()["new_admissions"],0)
  self.assertEqual(v.items()["rows"][0]["status"],"completed")
 def test_stale_source_is_not_reused(self):
  v.produce()
  original=v.items()["rows"][0]
  self.orig[original["clip_no"]]["version"]="f"*64
  self.store()
  # The old revision is rejected when no longer a current priority ID.
  result=v.produce()
  self.assertEqual(result["new_admissions"],1)
  states={row["id"]:row["status"] for row in v.items()["rows"]}
  self.assertEqual(states[original["id"]],"rejected")
 def test_denied_unbounded_or_missing_catalog(self):
  v.produce()
  self.catalog.unlink()
  with self.assertRaises(v.Refusal):v.produce()
  self.catalog.write_text(json.dumps({"schema_version":"wrong","records":{}}))
  with self.assertRaises(v.Refusal):v.produce()
 def test_dead_letter_bounded_and_no_automatic_human_decision(self):
  v.produce()
  with patch.object(v,"camera_guard",return_value={"ok":True}),\
       patch.object(v,"evaluate_one",side_effect=RuntimeError("synthetic_detector_failure")):
   for attempt in range(3):
    x=v.work()
    self.assertEqual(x["status"],"pending" if attempt<2 else "dead_letter")
    doc=v.items()
    doc["rows"][0]["next_attempt_at"]=0
    v.atomic(v.QUEUE,doc)
  self.assertEqual(v.items()["rows"][0]["attempts"],3)
  self.assertEqual(v.items()["rows"][0]["status"],"dead_letter")
  self.assertNotIn("human_approved",MOD.read_text())
 def test_existing_image_worker_mutex_blocks_rescan(self):
  import fcntl
  v.produce()
  with self.image_lock.open("r") as conflicting:
   fcntl.flock(conflicting,fcntl.LOCK_EX|fcntl.LOCK_NB)
   with self.assertRaises(v.Refusal) as caught:
    v.work()
   self.assertEqual(str(caught.exception),"evidence_quality_worker_busy")
  self.assertEqual(v.items()["rows"][0]["attempts"],0)
  self.assertEqual(v.items()["rows"][0]["status"],"pending")

 def test_camera_busy_does_not_consume_attempt(self):
  v.produce()
  with patch.object(v,"camera_guard",side_effect=v.Refusal("camera_battery_thermal_recording_or_worker_exclusion")):
   with self.assertRaises(v.Refusal):v.work()
  self.assertEqual(v.items()["rows"][0]["attempts"],0)
  self.assertEqual(v.items()["rows"][0]["status"],"pending")

if __name__=="__main__":unittest.main(verbosity=2)
