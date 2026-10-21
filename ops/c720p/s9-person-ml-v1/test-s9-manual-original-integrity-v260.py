#!/usr/bin/env python3
"""Host-only, single synthetic future decision; never reads private video."""
import copy
import datetime as dt
import importlib.util
from pathlib import Path
import unittest

HERE=Path(__file__).resolve().parent
def load(name,path):
 s=importlib.util.spec_from_file_location(name,HERE/path)
 m=importlib.util.module_from_spec(s);s.loader.exec_module(m)
 return m
m=load("integrity_v260","s9_manual_original_integrity_v260.py")
b=load("binding_v1_for_integrity","s9_manual_media_digest_binding_v1.py")
SD="motion_1792200000000.mp4"
SHA="a"*64
NOW=dt.datetime.now(dt.timezone.utc)
class Probe:
 def __init__(self):
  self.sha=SHA
  self.rev="rev:initial"
  self.identity="sd:motion_1792200000000.mp4"
  self.bytes=320000
  self.fail=False
  self.flips=False
  self.read_count=0
  self.revision_count=0
 def current_revision(self,source,name):
  self.revision_count+=1
  if self.fail:raise OSError("private_source_path")
  if self.flips and self.revision_count==2:self.rev="rev:changed"
  return {"source_identity":self.identity,"source_revision":self.rev}
 def verify_bytes(self,source,name):
  self.read_count+=1
  if self.fail:raise OSError("private_original_name")
  return {"source":"sd","name":SD,"source_identity":self.identity,
   "source_revision":self.rev,"sha256":self.sha,"size_bytes":self.bytes,
   "verified_at_utc":NOW.isoformat(),"verified_original_bytes":True,
   "method":"streamed_sha256_original_mp4",
   "verifier":"phone-original-byte-auditor"}

class Integrity(unittest.TestCase):
 def setUp(self):
  self.probe=Probe()
  binding=b.bind_new_decision("sd",SD,self.probe,NOW)
  self.probe.revision_count=0
  self.entry={"source":"sd","name":SD,"folder":"G1",
    "folders":["G1","G2"],"review_status":"assigned",
    "media_binding":binding}
  self.key="sd:"+SD
 def result(self):
  return m.public_result(self.key,self.entry,self.probe,NOW)
 def test_bound_uses_real_proof_sha_and_revision_twice(self):
  old=copy.deepcopy(self.entry)
  out=self.result()
  self.assertEqual(out["integrity_status"],"bound_current_bytes")
  self.assertEqual(self.probe.read_count,2) # one initial binding, one audit
  self.assertEqual(self.probe.revision_count,2)
  self.assertEqual(self.entry,old)
  self.assertFalse(out["automatic_polling_enabled"])
  self.assertFalse(out["source_digests_returned"])
 def test_same_revision_different_original_sha_refused(self):
  self.probe.sha="b"*64
  self.assertEqual(self.result()["integrity_status"],"digest_mismatch")
  self.assertEqual(self.entry["folders"],["G1","G2"])
 def test_changed_source_revision_and_late_change(self):
  self.probe.rev="rev:later"
  self.assertEqual(self.result()["integrity_status"],"revision_mismatch")
  self.probe.rev="rev:initial";self.probe.revision_count=0;self.probe.flips=True
  self.assertEqual(self.result()["integrity_status"],"revision_mismatch")
 def test_missing_original_and_invalid_original_proof(self):
  self.probe.fail=True
  self.assertEqual(self.result()["integrity_status"],"source_unavailable")
  self.probe.fail=False;self.probe.sha="not_original_sha"
  self.assertEqual(self.result()["integrity_status"],"source_unavailable")
 def test_historical_decision_remains_historically_unbound_without_sha_read(self):
  old=copy.deepcopy(self.entry);old.pop("media_binding")
  n=self.probe.read_count
  result=m.public_result(self.key,old,self.probe,NOW)
  self.assertEqual(result["integrity_status"],"historically_unbound")
  self.assertEqual(self.probe.read_count,n)
  self.assertTrue(result["historical_authority_preserved"])
  self.assertEqual(old["folders"],["G1","G2"])
 def test_return_to_review_and_group_history_never_modified(self):
  self.entry["folder"]=None;self.entry["folders"]=[]
  self.entry["review_status"]="inbox"
  old=copy.deepcopy(self.entry)
  self.assertEqual(self.result()["integrity_status"],"bound_current_bytes")
  self.assertEqual(self.entry,old)
  self.assertFalse(self.result()["user_review_reopened"])
 def test_forged_bound_entry_and_source_identity_rejected(self):
  self.entry["media_binding"]["sha256"]="z"*64
  self.assertEqual(self.result()["integrity_status"],"invalid_bound_metadata")
  self.entry["media_binding"]["sha256"]=SHA
  self.entry["media_binding"]["source"]="drive"
  self.assertEqual(self.result()["integrity_status"],"invalid_bound_metadata")
 def test_public_output_never_leaks_id_digest_name(self):
  out=str(self.result())
  for token in (SHA,SD,self.probe.identity):
   self.assertNotIn(token,out)
 def test_no_disk_network_or_manual_mutations(self):
  src=(HERE/"s9_manual_original_integrity_v260.py").read_text()
  for banned in ("unlink(","write_text(","write_bytes(","atomic(",
    "mutate(","delete(","subprocess","requests.","urllib.request",
    "os.remove(","Files.delete","person_review_update"):
   self.assertNotIn(banned,src)
  self.assertIn("single entry",src.lower())
if __name__=="__main__":unittest.main(verbosity=2)
