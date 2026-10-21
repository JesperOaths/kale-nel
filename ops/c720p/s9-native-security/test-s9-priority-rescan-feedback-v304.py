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
ACTUAL_READER_PREFLIGHT=v.qualified_reader_preflight

class QueueTest(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory(prefix="s9priority-v304-")
  self.addCleanup(self.t.cleanup)
  self.root=Path(self.t.name);self.state=self.root/"queue";self.state.mkdir()
  self.catalog=self.root/"catalog.json";self.report=self.root/"report.json"
  self.secondary=self.root/"gap.json";self.lock=self.root/"s9lock";self.lock.touch()
  self.image_lock=self.root/"image-worker.lock";self.image_lock.touch()
  self.consumer=self.root/"s9_anonymous_evidence_consumer_v361.py"
  self.consumer.write_text("# synthetic installed downstream module only\\n"*12)
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
   patch.object(v,"IMAGE_LOCK",self.image_lock),
   patch.object(v,"ANONYMOUS_CONSUMER",self.consumer),
   patch.object(v,"qualified_reader_preflight",return_value=True)]
  for x in self.patch:x.start();self.addCleanup(x.stop)
  self.store()
 def store(self):
  self.report.write_text(json.dumps({"analysis_version":"s9_evidence_quality_v1",
   "detector_model_sha256":v.MODEL_SHA,"recordings":self.rows}))
  self.catalog.write_text(json.dumps({"schema_version":"s9_native_archive_catalog_v1",
   "snapshot_id":"a"*64,"records":self.orig}))

 def test_running_http_reader_contract_must_precede_4k_or_any_lease(self):
  v.produce()
  old=v.QUEUE.read_bytes()
  with patch.object(v,"qualified_reader_preflight",
                    side_effect=v.Refusal("qualified_evidence_reader_unavailable_before_scan")),\
       patch.object(v,"camera_guard") as camera,\
       patch.object(v,"evaluate_one") as decode:
   with self.assertRaisesRegex(v.Refusal,
                               "qualified_evidence_reader_unavailable_before_scan"):
    v.work()
   camera.assert_not_called()
   decode.assert_not_called()
  self.assertEqual(v.QUEUE.read_bytes(),old)
  self.assertEqual(v.items()["rows"][0]["attempts"],0)

 def test_actual_http_reader_capability_rejects_old_echo_and_transport(self):
  class Reply:
   status=200
   def __init__(self,payload):self.payload=payload
   def __enter__(self):return self
   def __exit__(self,*args):return False
   def read(self,limit):return json.dumps(self.payload).encode()
  for payload in (
      {"ok":True,"state":"not_yet_available"},
      {"ok":True,"gap_reader_contract":"older_unqualified_reader"},
      {"ok":False,"gap_reader_contract":v.READER_HTTP_CONTRACT},
      []):
   with self.subTest(payload=payload),\
        patch.object(v.urllib.request,"urlopen",return_value=Reply(payload)):
    with self.assertRaisesRegex(v.Refusal,
                                "qualified_evidence_reader_unavailable_before_scan"):
     ACTUAL_READER_PREFLIGHT()
  with patch.object(v.urllib.request,"urlopen",side_effect=TimeoutError):
   with self.assertRaisesRegex(v.Refusal,
                               "qualified_evidence_reader_unavailable_before_scan"):
    ACTUAL_READER_PREFLIGHT()
  with patch.object(v.urllib.request,"urlopen",
       return_value=Reply({"ok":True,"gap_reader_contract":v.READER_HTTP_CONTRACT,
                           "state":"not_yet_available"})):
   with self.assertRaisesRegex(v.Refusal,
                               "qualified_evidence_reader_not_ready_before_scan"):
    ACTUAL_READER_PREFLIGHT()
  with patch.object(v.urllib.request,"urlopen",
       return_value=Reply({"ok":True,"gap_reader_contract":v.READER_HTTP_CONTRACT,
                           "analysis_version":"s9_evidence_quality_v1",
                           "recordings":[{"clip_no":"motion_1792000000000.mp4"}]})):
   self.assertTrue(ACTUAL_READER_PREFLIGHT())

 def test_missing_or_symlinked_v361_backend_refuses_before_4k_or_lease(self):
  v.produce()
  old=v.QUEUE.read_bytes()
  self.consumer.unlink()
  with patch.object(v,"camera_guard") as camera,\
       patch.object(v,"evaluate_one") as decode:
   with self.assertRaisesRegex(v.Refusal,
                               "anonymous_consumer_unavailable_before_scan"):
    v.work()
   camera.assert_not_called()
   decode.assert_not_called()
  self.assertEqual(v.QUEUE.read_bytes(),old)
  self.consumer.symlink_to(self.root/"nonexistent")
  with self.assertRaisesRegex(v.Refusal,
                              "anonymous_consumer_unavailable_before_scan"):
   v.work()
  self.consumer.unlink()
  self.consumer.write_text("# synthetic installed downstream module only\\n"*12)
  self.assertEqual(v.items()["rows"][0]["attempts"],0)

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


 def test_blocked_same_model_can_become_runnable_once_at_same_original_revision(self):
  v.produce()
  name=self.rows[2]["clip_no"]
  first=next(r for r in v.items()["rows"] if r["clip_no"]==name)
  self.assertEqual(first["status"],"blocked")
  self.rows[2]["extraction_status"]="no_indexed_image"
  self.store()
  moved=v.produce()
  self.assertEqual(moved["new_admissions"],1)
  self.assertEqual(moved["retired_with_provenance"],1)
  current=next(r for r in v.items()["rows"] if r["clip_no"]==name)
  self.assertEqual(current["status"],"pending")
  self.assertEqual(current["priority_reason"],"no_indexed_image")
  self.assertNotEqual(current["id"],first["id"])
  self.assertEqual(current["legacy_source_key"],first["id"])
  self.assertEqual(current["source_sha256"],first["source_sha256"])
  self.assertEqual(current["media_revision"],first["media_revision"])
  past=json.loads((v.retired_dir()/(first["id"]+".json")).read_text())
  # Source priority withdrawal durably supersedes the old blocked state;
  # its immutable priority reason and specific terminal explanation remain.
  self.assertEqual(past["final"]["status"],"rejected")
  self.assertEqual(past["final"]["last_reason"],
                   "source_revision_or_priority_no_longer_current")
  self.assertEqual(past["final"]["priority_reason"],
                   "secondary_detector_has_no_supported_face")
  self.assertEqual(v.produce()["new_admissions"],0)
  self.assertEqual(len([r for r in v.items()["rows"] if r["clip_no"]==name]),1)
  # The original reason can return without repeating the permanently
  # unsupported detector pass, and its provenance is never overwritten.
  self.rows[2]["extraction_status"]="secondary_detector_has_no_supported_face"
  self.store()
  out=v.produce()
  self.assertEqual(out["new_admissions"],0)
  self.assertEqual(out["retired_with_provenance"],1)
  self.assertFalse(any(r["clip_no"]==name for r in v.items()["rows"]))
  self.assertEqual(json.loads((v.retired_dir()/(first["id"]+".json")).read_text()),
                   past)
  self.rows[2]["extraction_status"]="no_indexed_image"
  self.store()
  self.assertEqual(v.produce()["new_admissions"],0)


 def test_previously_parked_unsupported_source_can_qualify_new_reason_once(self):
  v.produce()
  name=self.rows[2]["clip_no"]
  old=next(r for r in v.items()["rows"] if r["clip_no"]==name)
  # First persist immutable unsupported provenance as on a capacity park.
  self.rows[2]["targeted_rescan_priority"]=False
  self.store()
  retired=v.produce()
  self.assertEqual(retired["retired_with_provenance"],1)
  proof=v.retired_dir()/(old["id"]+".json")
  self.assertTrue(proof.is_file())
  immutable_before=proof.read_bytes()
  self.rows[2]["targeted_rescan_priority"]=True
  self.rows[2]["extraction_status"]="no_indexed_image"
  self.store()
  admitted=v.produce()
  self.assertEqual(admitted["new_admissions"],1)
  row=next(r for r in v.items()["rows"] if r["clip_no"]==name)
  self.assertEqual(row["status"],"pending")
  self.assertNotEqual(row["id"],old["id"])
  self.assertEqual(row["legacy_source_key"],old["id"])
  self.assertEqual(row["source_sha256"],old["source_sha256"])
  self.assertEqual(proof.read_bytes(),immutable_before)
  self.assertEqual(v.produce()["new_admissions"],0)

 def test_live_runnable_reclassified_unsupported_is_not_reprocessed(self):
  v.produce()
  name=self.rows[0]["clip_no"]
  legacy=next(r for r in v.items()["rows"] if r["clip_no"]==name)
  self.rows[0]["extraction_status"]="secondary_detector_has_no_supported_face"
  self.store()
  out=v.produce()
  self.assertEqual(out["retired_with_provenance"],1)
  blocked=next(r for r in v.items()["rows"] if r["clip_no"]==name)
  self.assertEqual(blocked["status"],"blocked")
  self.assertNotEqual(blocked["id"],legacy["id"])
  self.assertEqual(blocked["source_sha256"],legacy["source_sha256"])
  self.assertEqual(blocked["media_revision"],legacy["media_revision"])
  self.assertEqual(v.produce()["new_admissions"],0)
  archive=json.loads((v.retired_dir()/(legacy["id"]+".json")).read_text())
  self.assertEqual(archive["final"]["status"],"rejected")
  self.assertEqual(archive["final"]["last_reason"],
                   "source_revision_or_priority_no_longer_current")

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


 def test_retirement_budget_refuses_growth_without_mutating_queue_or_audit(self):
  # This protects the immutable audit when storage is saturated. The
  # authorized source change is retained for a later backed capacity review.
  v.produce()
  before=v.QUEUE.read_bytes()
  old=v.items()["rows"][0]
  name=old["clip_no"]
  self.orig[name]["version"]="f"*64
  self.store()
  with patch.object(v,"MAX_RETIRED_ROWS",0):
   result=v.produce()
   self.assertEqual(result["status"],"retired_provenance_capacity_deferred")
   self.assertEqual(result["new_admissions"],0)
   self.assertEqual(v.QUEUE.read_bytes(),before)
   self.assertEqual(len(list(v.retired_dir().glob("*.json"))),0)
  with patch.object(v,"MAX_RETIRED_BYTES",100):
   result=v.produce()
   self.assertEqual(result["status"],"retired_provenance_capacity_deferred")
   self.assertEqual(v.QUEUE.read_bytes(),before)
  after=v.produce()
  self.assertEqual(after["retired_with_provenance"],1)
  self.assertEqual(after["new_admissions"],1)
  self.assertEqual(v.produce()["retired_with_provenance"],0)

 def test_budget_counts_preexisting_private_bytes_and_rejects_unknown_entries(self):
  v.produce()
  old=dict(v.items()["rows"][0],status="rejected")
  v.retire_obsolete([old],set())
  entry=v.retired_dir()/(old["id"]+".json")
  self.assertGreater(entry.stat().st_size,100)
  with patch.object(v,"MAX_RETIRED_ROWS",1):
   self.assertTrue(v.retirement_budget([old]))
  new=dict(old,id="e"*64)
  with patch.object(v,"MAX_RETIRED_ROWS",1):
   self.assertFalse(v.retirement_budget([new]))
  with patch.object(v,"MAX_RETIRED_BYTES",entry.stat().st_size):
   self.assertFalse(v.retirement_budget([new]))
   self.assertTrue(v.retirement_budget([old]))
  extra=v.retired_dir()/"unexpected.txt"
  extra.write_text("x"*42)
  extra.chmod(0o600)
  try:
   with self.assertRaisesRegex(v.Refusal,"unexpected_private_retirement_entry"):
    v.retirement_budget([new])
  finally:
   extra.unlink()

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

 def test_current_unsupported_backlog_is_parked_only_for_new_runnable_work(self):
  # Every blocker remains a real current catalog priority, not an obsolete
  # row. Old V358 could never admit the next runnable clip once full.
  for i in range(4,v.LIMIT):
   name=f"motion_{1792700000000+i*1000}.mp4"
   size=1000000+i
   self.orig[name]={"name":name,"bytes":size,"version":f"{i+2000:064x}",
      "manifest":{"name":name,"bytes":size,"sha256":f"{i+1000:064x}",
                  "width":3840,"height":2160}}
   self.rows.append({"clip_no":name,"native_face_pass_complete":True,
        "targeted_rescan_priority":True,
        "extraction_status":"secondary_detector_has_no_supported_face"})
  self.store()
  initial=v.produce()
  self.assertEqual(initial["new_admissions"],v.LIMIT)
  self.assertEqual(initial["tally"]["blocked"],v.LIMIT-2)
  self.assertEqual(initial["parked_same_model_blocked"],0)
  new="motion_1792999999999.mp4"
  self.orig[new]={"name":new,"bytes":1234567,"version":"d"*64,
     "manifest":{"name":new,"bytes":1234567,"width":3840,
                 "height":2160,"sha256":"e"*64}}
  self.rows.append({"clip_no":new,"native_face_pass_complete":True,
        "targeted_rescan_priority":True,"extraction_status":"no_indexed_image"})
  self.store()
  out=v.produce()
  self.assertEqual(out["new_admissions"],1)
  self.assertEqual(out["parked_same_model_blocked"],1)
  self.assertEqual(out["capacity_deferred"],0)
  state=v.items()
  self.assertEqual(len(state["rows"]),v.LIMIT)
  self.assertIn(new,[row["clip_no"] for row in state["rows"]])
  archived=list(v.retired_dir().glob("*.json"))
  self.assertEqual(len(archived),1)
  body=json.loads(archived[0].read_text())
  self.assertEqual(body["final"]["status"],"blocked")
  self.assertEqual(body["final"]["last_reason"],
                   "same_yunet_model_cannot_validate_its_own_non_detection")
  self.assertEqual(archived[0].stat().st_mode & 0o077,0)
  # A subsequent restart/tick must NOT re-enqueue this archived blocker.
  again=v.produce()
  self.assertEqual(again["new_admissions"],0)
  self.assertEqual(again["parked_same_model_blocked"],0)
  self.assertEqual(len(list(v.retired_dir().glob("*.json"))),1)
  self.assertEqual(len(v.items()["rows"]),v.LIMIT)
  # Tampering source or model provenance of an archived key must fail
  # closed without rewriting the intact running queue or audit.
  old=v.QUEUE.read_bytes()
  body["final"]["source_sha256"]="f"*64
  archived[0].write_text(json.dumps(body))
  with self.assertRaisesRegex(v.Refusal,"retired_provenance_changed_or_untrusted"):
   v.produce()
  self.assertEqual(v.QUEUE.read_bytes(),old)

 def test_no_parked_current_completed_or_other_blocker_reason(self):
  v.produce()
  rows=v.items()["rows"]
  rows[2]["last_reason"]="repeated_transient_dependency_unavailable"
  ids=v.park_same_model_blockers({x["id"]:x for x in rows},
    {x["id"] for x in rows},[{"priority_reason":"no_indexed_image"}]*v.LIMIT)
  self.assertNotIn(rows[2]["id"],ids)
  rows[0]["status"]="completed"
  ids=v.park_same_model_blockers({x["id"]:x for x in rows},
    {x["id"] for x in rows},[{"priority_reason":"no_indexed_image"}]*v.LIMIT)
  self.assertNotIn(rows[0]["id"],ids)

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
  self.assertTrue(v.items()["rows"][0]["outcome"]["anonymous_v361_live_consumed_before_completion"])
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
      "source_sha256":row["source_sha256"],"source_bytes":row["source_bytes"],
      "source_revision":row["media_revision"],
      "model_sha256":v.MODEL_SHA,"analysis_version":v.ANALYSIS,"samples":[
          {"time_ms":3000,"state":"decoded","face_candidates":[]},
          {"time_ms":9000,"state":"decoded","face_candidates":[]},
          {"time_ms":15000,"state":"decoded","face_candidates":[]}]}
  # Integrates the ACTUAL consumer call site; V361 itself has separate
  # end-to-end source/queue/priority revocation contract tests.
  from types import SimpleNamespace
  fake_quality=SimpleNamespace(
     MODEL_SHA=v.MODEL_SHA,
     fetch=lambda url,limit: b'{"archive_mode":"S9-microSD-only"}',
     validate_sources=lambda archive:[{"clip_no":row["clip_no"]}])
  def admitted(document,current,clip):
   return 200,{"ok":True,
     "schema_version":"s9_anonymous_quality_consumption_v361",
     "source_binding_status":"revalidated_original_and_queue_at_consumption",
     "eligibility":"anonymous_quality_manual_review_only",
     "clip_no":clip,"source_sha256":record["source_sha256"],
     "source_bytes":record["source_bytes"],
     "source_revision":record["source_revision"],
     "model_sha256":record["model_sha256"],
     "analysis_version":record["analysis_version"],
     "sample_count":3,"sample_times_ms":[s["time_ms"] for s in record["samples"]],
     "evidence_revision_sha256":"a"*64,
     "human_review_required":True,"verified_same_person":False,
     "pose_gait_measured":False,"appearance_evidence_eligible":False,
     "automatic_person_assignments":0,"originals_modified":False,
     "review_decisions_modified":False}
  fake_consumer=SimpleNamespace(
    SCHEMA="s9_anonymous_quality_consumption_v361",consume=admitted)
  pinned=patch.object(v,"load_module",side_effect=lambda path,name:
      fake_quality if path==v.EVIDENCE else fake_consumer)
  pinned.start();self.addCleanup(pinned.stop)
  from unittest.mock import Mock
  good={"ok":True,"gap_reader_contract":v.READER_HTTP_CONTRACT,
        "original_gap_benchmark":{
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
   fake_consumer.consume=lambda *args:(410,{"ok":False})
   with self.assertRaisesRegex(v.Refusal,"anonymous_consumer_source_or_priority_revoked"):
    v.consumer_visible(record)
   fake_consumer.consume=lambda *args:(503,{"ok":False})
   with self.assertRaisesRegex(v.Refusal,"anonymous_consumer_revalidation_unavailable"):
    v.consumer_visible(record)
   fake_consumer.consume=lambda *args:(200,dict(admitted(*args)[1],verified_same_person=True))
   with self.assertRaisesRegex(v.Refusal,"anonymous_consumer_receipt_inconsistent"):
    v.consumer_visible(record)
   fake_consumer.consume=admitted
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

 def test_v361_revocation_rejects_and_never_completes_stale_source(self):
  v.produce()
  row=v.items()["rows"][0]
  evidence={"clip_no":row["clip_no"],"duration_ms":18000,
     "source_sha256":row["source_sha256"],"source_bytes":row["source_bytes"],
     "source_revision":row["media_revision"],"model_sha256":v.MODEL_SHA,
     "analysis_version":v.ANALYSIS,"samples":[
        {"time_ms":t,"state":"decoded","original_resolution":[3840,2160],
         "face_candidates":[]} for t in (3000,9000,15000)]}
  with patch.object(v,"camera_guard",return_value={"ok":True}),\
       patch.object(v,"evaluate_one",return_value=evidence),\
       patch.object(v,"consumer_visible",
         side_effect=v.Refusal("anonymous_consumer_source_or_priority_revoked")):
   result=v.work()
  self.assertEqual(result["status"],"rejected")
  self.assertFalse(result["consumer_visibility_confirmed"])
  self.assertIsNone(v.items()["rows"][0]["outcome"])
  self.assertEqual(v.items()["rows"][0]["last_reason"],
                   "anonymous_consumer_source_or_priority_revoked")
  self.assertEqual(v.produce()["new_admissions"],0)

 def test_v361_unavailable_defers_without_spending_retry_or_authorizing_person(self):
  v.produce()
  row=v.items()["rows"][0]
  evidence={"clip_no":row["clip_no"],"duration_ms":18000,
     "source_sha256":row["source_sha256"],"source_bytes":row["source_bytes"],
     "source_revision":row["media_revision"],"model_sha256":v.MODEL_SHA,
     "analysis_version":v.ANALYSIS,"samples":[
        {"time_ms":t,"state":"decoded","original_resolution":[3840,2160],
         "face_candidates":[]} for t in (3000,9000,15000)]}
  with patch.object(v,"camera_guard",return_value={"ok":True}),\
       patch.object(v,"evaluate_one",return_value=evidence),\
       patch.object(v,"consumer_visible",
         side_effect=v.Refusal("anonymous_consumer_revalidation_unavailable")):
   result=v.work()
  self.assertEqual(result["status"],"pending")
  self.assertFalse(result["consumer_visibility_confirmed"])
  self.assertEqual(v.items()["rows"][0]["attempts"],0)
  self.assertEqual(v.items()["rows"][0]["deferrals"],1)
  self.assertIsNone(v.items()["rows"][0]["outcome"])

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
