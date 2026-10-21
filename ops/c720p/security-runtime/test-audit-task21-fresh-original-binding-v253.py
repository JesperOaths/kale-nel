#!/usr/bin/env python3
"""No actual original/video/review writes. Synthetic physical acceptance gate."""
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
FILE=HERE/"audit-task21-fresh-original-binding-v253.py"
spec=importlib.util.spec_from_file_location("task21_v253",FILE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Tests(unittest.TestCase):
 def test_select_one_bounded_eligible_original_per_source(self):
  manual={"version":1,"revision":39,"items":{
    "sd:motion_1792100000000.mp4":{"review_status":"assigned","folders":["a","b"]},
    "drive:archive_001.mp4":{"review_status":"inbox","folders":[]},
    "sd:motion_1792100000001.mp4":{"review_status":"assigned","folders":["a"]}
  }}
  class Att:
   def source(self,source,name):
    if source=="sd":return ({"bytes":11000 if name.endswith("0001.mp4") else 16000},None)
    return ({"size":12000},None)
  picked,size=m.choose("sd",manual,Att())
  self.assertTrue(picked.endswith("0001.mp4"))
  self.assertEqual(size,11000)
  self.assertEqual(m.choose("drive",manual,Att())[1],12000)
  with self.assertRaisesRegex(RuntimeError,"bounded_original_sample_not_available"):
   m.choose("sd",{"version":1,"items":{"drive:archive_001.mp4":{}}},Att())

 def test_actual_synthetic_binding_consumer_invoked_without_real_writes(self):
  name="motion_1792100000000.mp4"
  payload=json.dumps({"version":1,"revision":9,"items":{
    "sd:"+name:{"review_status":"assigned","folders":["first","second"]}}}).encode()
  original=b"audit synthetic only\n"
  verified={"status":"bound_at_decision","source":"sd","name":name,
    "verified_at_decision":True,"size_bytes":12000,
    "method":"streamed_sha256_original_mp4","sha256":"a"*64}
  att=SimpleNamespace(source=lambda source,name:({"bytes":12000},None),
      IndependentOriginalAttestor=lambda:object())
  calls=[]
  binder=SimpleNamespace(
    bind_new_decision=lambda *args:(calls.append(("bind",args)) or verified),
    require_unchanged=lambda *args:calls.append(("cas",args)))
  with patch.object(m,"load",side_effect=[att,binder]),patch.object(
    m,"secure_source",side_effect=[payload,original,payload,original]):
   result=m.execute("sd")
  self.assertTrue(result["physical_original_sha256_verified"])
  self.assertFalse(result["historical_binding_backfilled"])
  self.assertFalse(result["production_binding_activated"])
  self.assertEqual(len(calls),2)
  self.assertEqual([a[0] for a in calls],["bind","cas"])
 def test_registry_or_audit_change_fails(self):
  name="motion_1792100000000.mp4"
  payload=json.dumps({"version":1,"revision":9,"items":{"sd:"+name:{}}}).encode()
  bind={"status":"bound_at_decision","source":"sd","name":name,
        "verified_at_decision":True,"size_bytes":12000,
        "method":"streamed_sha256_original_mp4","sha256":"a"*64}
  att=SimpleNamespace(source=lambda *args:({"bytes":12000},None),
      IndependentOriginalAttestor=lambda:object())
  binder=SimpleNamespace(bind_new_decision=lambda *args:bind,
      require_unchanged=lambda *args:None)
  with patch.object(m,"load",side_effect=[att,binder]),patch.object(
     m,"secure_source",side_effect=[payload,b"old journal",payload,b"changed journal"]):
   with self.assertRaisesRegex(RuntimeError,"historical_review_audit_changed"):
    m.execute("sd")
 def test_safe_refusal_categories_distinguish_untrusted_config(self):
  doc={"version":1,"revision":3,"items":{"drive:synthetic_001.mp4":{}}}
  att=SimpleNamespace(source=lambda *_:(_ for _ in ()).throw(
      RuntimeError("drive_worker_config_untrusted")))
  with self.assertRaisesRegex(RuntimeError,
       "candidate_drive_worker_config_untrusted"):
   m.choose("drive",doc,att)

 def test_no_real_or_historical_review_actions(self):
  source=FILE.read_text()
  for bad in ("manual_links.mutate(","unlink(","write_bytes(","write_text(",
    "Files.delete(", "FileOutputStream", "assign_many","return_to_queue",
    "Camera2", "pm install","getUserMedia("):
   self.assertNotIn(bad,source)
  for required in ("bind.bind_new_decision(", "bind.require_unchanged(",
     "historical_binding_backfilled","manual_reviews_written"):
   self.assertIn(required,source)
if __name__=="__main__":unittest.main(verbosity=2)
