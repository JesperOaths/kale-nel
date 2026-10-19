#!/usr/bin/env python3
"""No-phone V3 progressive ranking tests: safe deferrals, immutable pointers."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("progressive_v113",ROOT/"run-s9-v3-progressive-ranking-v113.py")
p=importlib.util.module_from_spec(spec);spec.loader.exec_module(p)
SHA="a"*64
CID="0"*16
def doc(count=58,corpus=CID):
 return {"schema":"s9_appearance_v3_active_v1","corpus_id":corpus,
         "verified_crops":count,"map_sha256":SHA,"rankings_sha256":SHA,
         "automatic_person_assignments":0,"human_review_required":True}
class FakeRanker:
 def __init__(self,root):self.STATE_DIR=root;self.calls=[]
 def capture_rank_safe(self):self.calls.append("capture")
 def phone_temperature_c(self):self.calls.append("thermal")
 def source_inventory(self):
  self.calls.append("inventory")
  return [{"key":SHA,"visual_sidecar_sha256":SHA,
           "hsv_sidecar_sha256":SHA}]*58
 def verified_v2_baseline(self,rows):self.calls.append("baseline")
 @staticmethod
 def digest(raw):
  import hashlib
  return hashlib.sha256(raw).hexdigest()

class Progressive(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
  self.root=Path(self.tmp.name);self.m=FakeRanker(self.root)
 def pointer(self,body):
  (self.root/"s9-multivector-v3-active.json").write_text(json.dumps(body))
 def test_current_index_does_not_rerun_heavy_ranker(self):
  cid=p.corpus_for(self.m.source_inventory(),self.m)
  self.pointer(doc(corpus=cid))
  with patch.object(p,"guarded_publish",side_effect=AssertionError("must not run")):
   self.assertEqual(p.run(True,self.m),"current")
 def test_thermal_failure_never_inspects_sources(self):
  def fail():raise RuntimeError("capture_too_warm_for_ranker")
  self.m.capture_rank_safe=fail
  self.assertEqual(p.run(True,self.m),"deferred")
  self.assertEqual(self.m.calls,[])
 def test_missing_descriptor_defers(self):
  def fail():raise RuntimeError("V3 requires complete original V2 references plus one extra real descriptor")
  self.m.source_inventory=fail
  self.assertEqual(p.run(True,self.m),"deferred")
  self.assertEqual(self.m.calls,["capture","thermal"])
 def test_new_corpus_only_preflights_by_default(self):
  with patch.object(p,"guarded_publish",side_effect=AssertionError("must not run")):
   self.assertEqual(p.run(False,self.m),"preflight")
 def test_valid_expansion_and_same_count_drift(self):
  self.assertEqual(p.decision(doc(count=58,corpus=CID),"1"*16,59),"needs_expansion")
  self.assertEqual(p.decision(None,CID,58),"needs_first_index")
  self.assertEqual(p.decision(doc(),CID,58),"already_current")
  with self.assertRaisesRegex(RuntimeError,"same_size_source_changes"):
   p.decision(doc(), "1"*16,58)
  with self.assertRaisesRegex(RuntimeError,"regressed"):
   p.decision(doc(count=80), CID,58)
 def test_malformed_pointer_fails_closed(self):
  self.pointer({**doc(),"automatic_person_assignments":1})
  with self.assertRaisesRegex(RuntimeError,"untrusted_active_v3_pointer"):
   p.read_pointer(self.root/"s9-multivector-v3-active.json")
  (self.root/"s9-multivector-v3-active.json").unlink()
  (self.root/"s9-multivector-v3-active.json").symlink_to(self.root/"other")
  with self.assertRaisesRegex(RuntimeError,"symlink"):
   p.read_pointer(self.root/"s9-multivector-v3-active.json")
 def test_held_archive_lock_deferred_with_no_source_details(self):
  import subprocess
  marker="S9_V3_RANKER_DEFERRED "+json.dumps({
   "reason":"shared_archive_worker_busy","rankings_published":False,
   "automatic_person_assignments":0})+"\n"
  fake=subprocess.CompletedProcess(["python","ranker"],75,marker,
       "private/source/motion_1999999999999.mp4")
  with patch.object(p.subprocess,"run",return_value=fake):
   with self.assertRaises(p.SharedWorkerBusy):
    p.guarded_publish(self.m,"1"*16,59)
  current=p.corpus_for(self.m.source_inventory(),self.m)
  # A previous already-current pointer should remain untouched.
  self.pointer(doc(count=58,corpus=current))
  with patch.object(p,"guarded_publish",side_effect=p.SharedWorkerBusy):
   self.assertEqual(p.run(True,self.m),"current")
  (self.root/"s9-multivector-v3-active.json").unlink()
  with patch.object(p,"guarded_publish",side_effect=p.SharedWorkerBusy):
   self.assertEqual(p.run(True,self.m),"deferred")

 def test_unknown_nonzero_ranker_results_still_fail_closed(self):
  import subprocess
  for code,marker in ((75,"S9_V3_RANKER_DEFERRED {}\n"),
                      (1,"S9_V3_RANKER_DEFERRED "+json.dumps({
                       "reason":"shared_archive_worker_busy",
                       "rankings_published":False,
                       "automatic_person_assignments":0})+"\n"),
                      (75,"S9_V3_RANKER_DEFERRED "+json.dumps({
                       "reason":"other",
                       "rankings_published":False,
                       "automatic_person_assignments":0})+"\n")):
   with self.subTest(code=code),patch.object(
     p.subprocess,"run",return_value=subprocess.CompletedProcess(
      ["python"],code,marker,"untrusted private detail")):
    with self.assertRaisesRegex(RuntimeError,"guarded_ranker_failed"):
     p.guarded_publish(self.m,"1"*16,59)

 def test_old_indices_and_review_data_never_mutated_by_this_wrapper(self):
  src=(ROOT/"run-s9-v3-progressive-ranking-v113.py").read_text()
  for forbidden in ('adb install','am force-stop','assign_person','os.replace(',
                    'unlink(','delete_clip('):
   self.assertNotIn(forbidden,src)
if __name__=="__main__":unittest.main(verbosity=2)
