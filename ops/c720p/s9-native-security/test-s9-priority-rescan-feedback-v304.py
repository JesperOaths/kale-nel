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
   patch.object(v,"TERMINALS",self.state/"terminal-archive-v360.json"),
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
       patch.object(v,"evaluate_one",return_value=record),\
       patch.object(v,"consumer_visible",return_value=True):
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
 def test_no_success_until_real_consumer_has_matching_source_revision(self):
  v.produce()
  row=v.items()["rows"][0]
  record={"clip_no":row["clip_no"],"duration_ms":18000,
      "source_sha256":row["source_sha256"],
      "source_revision":row["media_revision"],
      "model_sha256":v.MODEL_SHA,"samples":[
          {"time_ms":3000,"state":"decoded","face_candidates":[]},
          {"time_ms":9000,"state":"decoded","face_candidates":[]},
          {"time_ms":15000,"state":"decoded","face_candidates":[]}]}
  from unittest.mock import Mock
  good={"ok":True,"original_gap_benchmark":{
    "analysis_version":v.ANALYSIS,"detector_model_sha256":v.MODEL_SHA,
    "source_binding_status":"source_qualified_active_queue_only",
    "source_bound_records_visible":1,"source_bound_records_not_current":0,
    "original_recordings_modified":False,"identity_inference_performed":False,
    "recordings":[record]}}
  class Reply:
   status=200
   def __init__(self,value):self.value=value
   def __enter__(self):return self
   def __exit__(self,*args):return False
   def read(self,limit):
    return json.dumps(self.value).encode()
  with patch.object(v.urllib.request,"urlopen",
      return_value=Reply(good)):
   self.assertTrue(v.consumer_visible(record))
  bad=json.loads(json.dumps(good))
  bad["original_gap_benchmark"]["recordings"][0]["source_revision"]="f"*64
  with patch.object(v.urllib.request,"urlopen",
      return_value=Reply(bad)):
   with self.assertRaises(v.Refusal):v.consumer_visible(record)
  bad_hash=json.loads(json.dumps(good))
  bad_hash["original_gap_benchmark"]["recordings"][0]["source_sha256"]="0"*64
  with patch.object(v.urllib.request,"urlopen",
      return_value=Reply(bad_hash)):
   with self.assertRaises(v.Refusal):v.consumer_visible(record)
  for defect in ("no_attestation","zero_attested","forged_frames",
                 "claims_identity","inconsistent_revocation_count"):
   with self.subTest(defect=defect):
    invalid=json.loads(json.dumps(good))
    gap=invalid["original_gap_benchmark"]
    if defect=="no_attestation":
     del gap["source_binding_status"]
    elif defect=="zero_attested":
     gap["source_bound_records_visible"]=0
    elif defect=="forged_frames":
     gap["recordings"][0]["samples"][0]["time_ms"]=7777
    elif defect=="claims_identity":
     gap["identity_inference_performed"]=True
    else:
     gap["source_bound_records_not_current"]=-1
    with patch.object(v.urllib.request,"urlopen",
         return_value=Reply(invalid)):
     with self.assertRaises(v.Refusal):v.consumer_visible(record)
  with patch.object(v,"camera_guard",return_value={"ok":True}),\
       patch.object(v,"evaluate_one",return_value=record),\
       patch.object(v,"consumer_visible",
            side_effect=v.Refusal("source_bound_secondary_result_not_visible")):
   result=v.work()
  self.assertEqual(result["status"],"pending")
  self.assertFalse(result["verified_secondary"])
  self.assertFalse(result["consumer_visibility_confirmed"])
  self.assertEqual(v.items()["rows"][0]["attempts"],1)
  self.assertIsNone(v.items()["rows"][0]["outcome"])
  saved=json.loads(self.secondary.read_text())
  self.assertFalse(saved["source_sha256_verified_before_processing"])
  self.assertTrue(saved["source_sha256_bound_to_private_catalog_before_processing"])
  self.assertTrue(saved["human_review_required"])

 def test_live_consumer_without_attestation_defers_without_burning_retry(self):
  v.produce()
  with patch.object(v,"camera_guard",return_value={"ok":True}),\
       patch.object(v,"evaluate_one",return_value={
        "clip_no":v.items()["rows"][0]["clip_no"],"samples":[]}),\
       patch.object(v,"consumer_visible",
            side_effect=v.Refusal("secondary_consumer_source_attestation_unavailable")):
   out=v.work()
  self.assertEqual(out["status"],"pending")
  self.assertEqual(out["attempts"],0)
  task=v.items()["rows"][0]
  self.assertEqual(task["deferrals"],1)
  self.assertEqual(task["last_reason"],"secondary_consumer_source_attestation_unavailable")
  self.assertIsNone(task["outcome"])

 def test_temporary_relay_outage_does_not_burn_retries(self):
  import urllib.error
  v.produce()
  with patch.object(v,"camera_guard",return_value={"ok":True}),\
       patch.object(v,"evaluate_one",
            side_effect=urllib.error.URLError("synthetic_transport_offline")):
   result=v.work()
  self.assertEqual(result["status"],"pending")
  self.assertEqual(result["attempts"],0)
  self.assertEqual(v.items()["rows"][0]["attempts"],0)
  self.assertEqual(v.items()["rows"][0]["last_reason"],
                   "temporary_source_or_consumer_transport_unavailable")
  self.assertIsNone(v.items()["rows"][0]["outcome"])

 def test_transient_camera_or_network_deferrals_have_finite_block_limit(self):
  import urllib.error
  v.produce()
  with patch.object(v,"camera_guard",return_value={"ok":True}),\
       patch.object(v,"evaluate_one",
          side_effect=urllib.error.URLError("synthetic_transport_unreachable")):
   for i in range(v.MAX_TRANSIENT_DEFERRALS):
    output=v.work()
    expected="blocked" if i==v.MAX_TRANSIENT_DEFERRALS-1 else "pending"
    self.assertEqual(output["status"],expected)
    queue=v.items()
    row=queue["rows"][0]
    self.assertEqual(row["attempts"],0)
    self.assertEqual(row["deferrals"],i+1)
    self.assertEqual(row["status"],expected)
    if expected=="pending":
     row["next_attempt_at"]=0
     v.atomic(v.QUEUE,queue)
  self.assertEqual(v.items()["rows"][0]["last_reason"],
                   "repeated_transient_dependency_unavailable")
  self.assertEqual(v.items()["rows"][0]["next_attempt_at"],0)
  # Another pending clip remains eligible, but this failed clip is now
  # permanently blocked until a separately reviewed requalification.
  self.assertEqual(v.items()["rows"][0]["status"],"blocked")

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
 def test_terminal_capacity_compaction_and_restart_dedup(self):
  # Two producer generations: terminal non-hits once occupied the entire
  # 340-row lifetime cap. A larger catalog must not lose their provenance.
  def extend(end):
   for i in range(len(self.rows),end):
    name=f"motion_{1792000000000+i*1000}.mp4"
    size=1000000+i
    sha=f"{i+1000:064x}";revision=f"{i+2000:064x}"
    self.orig[name]={"name":name,"bytes":size,"version":revision,
                     "manifest":{"name":name,"bytes":size,
                                 "width":3840,"height":2160,"sha256":sha}}
    self.rows.append({"clip_no":name,"native_face_pass_complete":True,
          "targeted_rescan_priority":True,
          "extraction_status":"secondary_detector_has_no_supported_face"})
   self.store()
  extend(290)
  one=v.produce()
  self.assertEqual(one["new_admissions"],290)
  self.assertEqual(one["tally"]["blocked"],288)
  self.assertEqual(one["tally"]["pending"],2)
  self.assertFalse(v.TERMINALS.exists())
  extend(360)
  two=v.produce()
  self.assertEqual(two["new_admissions"],70)
  self.assertEqual(two["archived_this_tick"],288)
  self.assertEqual(two["tally"]["blocked"],358)
  self.assertEqual(two["tally"]["pending"],2)
  self.assertEqual(two["tally"]["archived_terminal"],288)
  self.assertEqual(len(v.items()["rows"]),72)
  archived=v.terminal_ledger()["rows"]
  self.assertEqual(len(archived),288)
  self.assertTrue(all(x["last_reason"]=="same_yunet_model_cannot_validate_its_own_non_detection"
                      for x in archived.values()))
  self.assertEqual(v.produce()["new_admissions"],0)
  # Mimic power loss after terminal ledger fsync but before queue replace.
  backup=v.items()
  restored=next(iter(archived.values()))
  backup["rows"].append(dict(restored))
  v.atomic(v.QUEUE,backup)
  recovered=v.produce()
  self.assertEqual(recovered["new_admissions"],0)
  self.assertEqual(len(v.items()["rows"]),72)
  self.assertEqual(recovered["tally"]["blocked"],358)

 def test_terminal_source_collision_fails_closed(self):
  v.produce()
  d=v.items();x=dict(d["rows"][2])
  ledger={"schema":v.TERMINAL_SCHEMA,"rows":{x["id"]:dict(x)}}
  v.atomic(v.TERMINALS,ledger,maximum=16000000)
  self.assertEqual(v.produce()["new_admissions"],0)
  self.assertEqual(len(v.items()["rows"]),3)
  d=v.items()
  d["rows"].append(dict(x,status="pending"))
  v.atomic(v.QUEUE,d)
  with self.assertRaisesRegex(v.Refusal,"terminal_archive_queue_collision"):
   v.produce()

 def test_full_terminal_archive_refuses_with_all_state_preserved(self):
  v.produce()
  archive=v.terminal_ledger()
  row=dict(v.items()["rows"][2])
  for i in range(v.MAX_TERMINALS):
   key=f"{i:064x}"
   archive["rows"][key]=dict(row,id=key)
  v.atomic(v.TERMINALS,archive,maximum=16000000)
  before=v.QUEUE.read_bytes()
  with self.assertRaisesRegex(v.Refusal,"terminal_ledger_integrity_invalid|terminal_archive_capacity"):
   # Next generation must exceed active LIMIT before archival is needed.
   v.MAX_TERMINALS=10
   try:
    v.produce()
   finally:
    v.MAX_TERMINALS=10000
  self.assertEqual(v.QUEUE.read_bytes(),before)

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

 def test_expired_worker_lease_persisted_even_if_no_task_runnable(self):
  v.produce()
  doc=v.items()
  task=doc["rows"][0]
  task.update({"status":"processing","attempts":1,"lease_until":100,"next_attempt_at":0})
  v.atomic(v.QUEUE,doc)
  recovered=v.recover_expired_leases(doc,200)
  self.assertEqual(recovered,1)
  persisted=v.items()
  self.assertEqual(persisted["revision"],doc["revision"])
  self.assertEqual(persisted["rows"][0]["status"],"pending")
  self.assertEqual(persisted["rows"][0]["next_attempt_at"],260)
  self.assertEqual(v.recover_expired_leases(persisted,201),0)
  self.assertEqual(v.items()["revision"],persisted["revision"])
  persisted["rows"][0].update({"status":"processing","attempts":3,"lease_until":100})
  self.assertEqual(v.recover_expired_leases(persisted,210),1)
  self.assertEqual(v.items()["rows"][0]["status"],"dead_letter")

 def test_camera_busy_does_not_consume_attempt(self):
  v.produce()
  with patch.object(v,"camera_guard",side_effect=v.Refusal("camera_battery_thermal_recording_or_worker_exclusion")):
   with self.assertRaises(v.Refusal):v.work()
  self.assertEqual(v.items()["rows"][0]["attempts"],0)
  self.assertEqual(v.items()["rows"][0]["status"],"pending")

if __name__=="__main__":unittest.main(verbosity=2)
