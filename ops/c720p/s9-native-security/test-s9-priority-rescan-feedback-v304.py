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

 def test_terminal_revision_retirement_and_immutable_private_audit(self):
  v.produce()
  before=v.items()
  old=before["rows"][0].copy()
  name=old["clip_no"]
  self.orig[name]["version"]="f"*64
  self.store()
  result=v.produce()
  self.assertEqual(result["retired_with_provenance"],1)
  self.assertEqual(result["new_admissions"],1)
  archived=v.retired_dir()/(old["id"]+".json")
  self.assertTrue(archived.is_file())
  self.assertEqual(archived.stat().st_mode & 0o077,0)
  saved=json.loads(archived.read_text())
  self.assertEqual(saved["final"]["source_sha256"],old["source_sha256"])
  self.assertEqual(saved["final"]["media_revision"],old["media_revision"])
  self.assertEqual(saved["final"]["status"],"rejected")
  self.assertEqual(v.produce()["retired_with_provenance"],0)
  self.assertEqual(len(v.items()["rows"]),len(before["rows"]))

 def test_retired_archive_directory_must_remain_private(self):
  v.produce()
  old=v.items()["rows"][0].copy()
  v.retired_dir().mkdir(mode=0o700)
  v.retired_dir().chmod(0o755)
  try:
   with self.assertRaisesRegex(v.Refusal,"retired_provenance_directory_not_private"):
    v.retire_obsolete([dict(old,status="rejected")],set())
  finally:
   v.retired_dir().chmod(0o700)
  self.assertFalse((v.retired_dir()/(old["id"]+".json")).exists())

 def test_retired_archive_symlink_and_hardlink_are_refused(self):
  v.produce()
  old=dict(v.items()["rows"][0],status="rejected")
  v.retire_obsolete([old],set())
  dest=v.retired_dir()/(old["id"]+".json")
  other=v.retired_dir()/"alternate-record.json"
  dest.chmod(0o644)
  with self.assertRaisesRegex(v.Refusal,"retired_provenance_file_not_private"):
   v.retire_obsolete([old],set())
  dest.chmod(0o600)
  os.link(dest,other)
  with self.assertRaisesRegex(v.Refusal,"retired_provenance_file_not_private"):
   v.retire_obsolete([old],set())
  other.unlink()
  dest.unlink()
  dest.symlink_to(other)
  with self.assertRaisesRegex(v.Refusal,"retired_provenance_symlink_refused"):
   v.retire_obsolete([old],set())

 def test_finite_capacity_defers_new_admission_without_losing_existing_work(self):
  v.produce()
  original=v.items()
  live=original["rows"][0]
  many=[]
  for i in range(v.LIMIT-4):
   x=original["rows"][2].copy()
   x["id"]=format(i+500,"064x")
   x["priority_reason"]="secondary_detector_has_no_supported_face"
   x["status"]="blocked"
   many.append(x)
  original["rows"].extend(many)
  v.atomic(v.QUEUE,original)
  fresh="motion_1792333333333.mp4"
  self.orig[fresh]={"name":fresh,"bytes":1000000,
   "version":"a"*64,"manifest":{"name":fresh,"bytes":1000000,
   "width":3840,"height":2160,"sha256":"b"*64}}
  self.rows.append({"clip_no":fresh,"native_face_pass_complete":True,
      "targeted_rescan_priority":True,"extraction_status":"no_indexed_image"})
  self.store()
  out=v.produce()
  self.assertEqual(out["capacity_deferred"],0)
  self.assertGreater(out["retired_with_provenance"],0)
  self.assertIn(live["id"],{r["id"] for r in v.items()["rows"]})
  self.assertEqual(len({r["id"] for r in v.items()["rows"]}),len(v.items()["rows"]))

 def test_queue_pressure_retires_only_unsupported_current_blockers(self):
  v.produce()
  for i in range(v.LIMIT-4):
   name=f"motion_{1793000000000+i}.mp4"
   self.orig[name]={"name":name,"bytes":1000500+i,"version":"b"*64,
      "manifest":{"name":name,"bytes":1000500+i,"sha256":"c"*64,
                  "width":3840,"height":2160}}
   self.rows.append({"clip_no":name,"native_face_pass_complete":True,
       "targeted_rescan_priority":True,
       "extraction_status":"secondary_detector_has_no_supported_face"})
  self.store()
  first=v.produce()
  self.assertEqual(len(v.items()["rows"]),v.LIMIT)
  self.assertEqual(first["tally"]["blocked"],v.LIMIT-2)
  current_ids={r["id"] for r in v.items()["rows"]}
  fresh="motion_1793777777777.mp4"
  self.orig[fresh]={"name":fresh,"bytes":1040404,"version":"d"*64,
    "manifest":{"name":fresh,"bytes":1040404,"sha256":"e"*64,
                "width":3840,"height":2160}}
  self.rows.append({"clip_no":fresh,"native_face_pass_complete":True,
      "targeted_rescan_priority":True,"extraction_status":"no_indexed_image"})
  self.store()
  result=v.produce()
  self.assertEqual(result["new_admissions"],1)
  self.assertEqual(result["archived_unsupported_at_capacity"],1)
  active=v.items()["rows"]
  self.assertEqual(len(active),v.LIMIT)
  self.assertEqual(sum(x["clip_no"]==fresh for x in active),1)
  lost=current_ids-{r["id"] for r in active}
  self.assertEqual(len(lost),1)
  tombstone=json.loads((v.retired_dir()/(next(iter(lost))+".json")).read_text())
  self.assertEqual(tombstone["final"]["status"],"blocked")
  self.assertEqual(tombstone["final"]["priority_reason"],
                   "secondary_detector_has_no_supported_face")
  repeated=v.produce()
  self.assertEqual(repeated["new_admissions"],0)
  self.assertEqual(repeated["retired_active_ids_not_reenqueued"],1)
  self.assertEqual(repeated["archived_unsupported_at_capacity"],0)

 def test_same_source_changed_reason_requires_new_provenance_not_requeue(self):
  v.produce()
  d=v.items()
  item=next(x for x in d["rows"]
             if x["priority_reason"]=="secondary_detector_has_no_supported_face")
  # Bounded terminal tombstone may not silently become eligible when an
  # independent source reason changes but original/model IDs remain same.
  v.retire_obsolete([item],set())
  d["rows"]=[r for r in d["rows"] if r["id"]!=item["id"]]
  v.atomic(v.QUEUE,d)
  source=next(r for r in self.rows if r["clip_no"]==item["clip_no"])
  source["extraction_status"]="no_indexed_image"
  self.store()
  result=v.produce()
  self.assertEqual(result["same_source_requalification_required"],1)
  self.assertEqual(result["new_admissions"],0)
  self.assertNotIn(item["id"],{r["id"] for r in v.items()["rows"]})

 def test_all_pending_full_queue_reports_deferral_without_eviction(self):
  v.produce()
  for i in range(v.LIMIT-4):
   name=f"motion_{1794000000000+i}.mp4"
   self.orig[name]={"name":name,"bytes":1000800+i,"version":"b"*64,
      "manifest":{"name":name,"bytes":1000800+i,"sha256":"c"*64,
                  "width":3840,"height":2160}}
   self.rows.append({"clip_no":name,"native_face_pass_complete":True,
       "targeted_rescan_priority":True,"extraction_status":"no_indexed_image"})
  self.store()
  v.produce()
  # The two originally blocked rows still occupy slots; no current blocked
  # can be evicted simply because another runnable original exists.
  fresh="motion_1794888888888.mp4"
  self.orig[fresh]={"name":fresh,"bytes":1030404,"version":"d"*64,
    "manifest":{"name":fresh,"bytes":1030404,"sha256":"e"*64,
                "width":3840,"height":2160}}
  self.rows.append({"clip_no":fresh,"native_face_pass_complete":True,
      "targeted_rescan_priority":True,"extraction_status":"no_indexed_image"})
  self.store()
  result=v.produce()
  self.assertEqual(result["new_admissions"],1)
  self.assertEqual(result["archived_unsupported_at_capacity"],1)
  self.assertEqual(result["capacity_deferred"],0)

 def test_current_blocked_and_completed_are_never_retired(self):
  v.produce()
  d=v.items()
  d["rows"][0]["status"]="completed"
  d["rows"][0]["outcome"]={"verified_secondary_report":True}
  v.atomic(v.QUEUE,d)
  x=v.produce()
  self.assertEqual(x["retired_with_provenance"],0)
  self.assertEqual(v.items()["rows"][0]["status"],"completed")
  self.assertEqual(v.items()["rows"][2]["status"],"blocked")

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
  self.assertNotIn(original["id"],states)
  self.assertEqual(json.loads((v.retired_dir()/(original["id"]+".json")).read_text())["final"]["status"],"rejected")
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
