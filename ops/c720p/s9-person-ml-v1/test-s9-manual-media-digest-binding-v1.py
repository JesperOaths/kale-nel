#!/usr/bin/env python3
"""Forward-only manual media digest binding regression, synthetic ONLY.

Does not touch the installed review store, source SD, Drive, original bytes
or person identities. Existing old state remains historically authoritative.
"""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
BACKEND=HERE/"s9_manual_recording_links.py"
BIND=HERE/"s9_manual_media_digest_binding_v1.py"
spec=importlib.util.spec_from_file_location("manual_links_task21",BACKEND)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
b_spec=importlib.util.spec_from_file_location("digest_contract_task21",BIND)
b=importlib.util.module_from_spec(b_spec);b_spec.loader.exec_module(b)
SD="motion_1792200000000.mp4"
DRIVE="drive_2026-05-12_08-30-00.mp4"
SHA="a"*64

class BytesAttested:
 def __init__(self):
  self.revisions={
   ("sd",SD):("sd-object-0001","sd-original-v4"),
   ("drive",DRIVE):("drive-object-001","drive-revision-10")}
  self.fail=False;self.flip_after_read=False
 def verify_bytes(self,source,name):
  if self.fail or (source,name) not in self.revisions:
   raise OSError("independent original unavailable")
  identifier,revision=self.revisions[source,name]
  return {"source":source,"name":name,"source_identity":identifier,
    "source_revision":revision,"sha256":SHA,"size_bytes":600000,
    "verified_at_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
    "verified_original_bytes":True,"method":"streamed_sha256_original_mp4",
    "verifier":"phone-original-byte-auditor" if source=="sd"
       else "drive-original-byte-auditor"}
 def current_revision(self,source,name):
  if self.fail:return None
  identity,revision=self.revisions[(source,name)]
  if self.flip_after_read:
   revision="later-revision"
  return {"source_identity":identity,"source_revision":revision}

class Cases(unittest.TestCase):
 def setUp(self):
  self.t=tempfile.TemporaryDirectory();self.addCleanup(self.t.cleanup)
  for attr,filename in (("STORE","manual.json"),("AUDIT","manual.audit.jsonl"),
                        ("LOCK","manual.lock"),("DRIVE","drive.json")):
   patcher=patch.object(m,attr,Path(self.t.name)/filename)
   patcher.start();self.addCleanup(patcher.stop)
  m.DRIVE.write_text(json.dumps({"items":[
   {"remote_name":DRIVE,"size":600000,"state":"verified"}]}))
  self.att=BytesAttested()
 def req(self,source="sd",name=SD,action="assign",revision=0,
          folder="G1",folders=None):
  request={"action":action,"source":source,"name":name,
            "folder":folder,"revision":revision,"human_confirmed":True}
  if folders is not None:request["folders"]=folders
  return request
 def write(self,payload,attestor=None,required=False):
  return m.mutate(payload,{SD:{"verified":True}},attestor=attestor,
                  require_binding=required)
 def test_legacy_decision_keeps_authority_and_is_not_backfilled(self):
  code,_=self.write(self.req())
  self.assertEqual(code,200)
  before=m.STORE.read_bytes()
  prior=m.current()["items"]["sd:"+SD]
  self.assertEqual(prior["folder"],"G1")
  self.assertNotIn("media_binding",prior)
  self.assertEqual(b.display_status(prior,self.att),"historically_unbound")
  self.assertEqual(m.STORE.read_bytes(),before)
  self.assertEqual(b.public_diagnostics(m.current()["items"],self.att)["counts"][
                    "historically_unbound"],1)
 def test_new_verified_sd_group_and_drive_bind_source_and_revision(self):
  sd=self.req(action="assign_many",folder="G1",folders=["G1","G2","G3"])
  self.assertEqual(self.write(sd,attestor=self.att,required=True)[0],200)
  drive=self.req(source="drive",name=DRIVE,revision=1,folder="G4")
  self.assertEqual(self.write(drive,attestor=self.att,required=True)[0],200)
  data=m.current()
  self.assertEqual(data["revision"],2)
  self.assertEqual(data["items"]["sd:"+SD]["folders"],["G1","G2","G3"])
  for source,name in (("sd",SD),("drive",DRIVE)):
   entry=data["items"][source+":"+name]
   proof=entry["media_binding"]
   self.assertEqual(proof["source"],source)
   self.assertEqual(proof["name"],name)
   self.assertEqual(proof["sha256"],SHA)
   self.assertTrue(proof["verified_at_decision"])
   self.assertEqual(b.display_status(entry,self.att),"bound")
  log=[json.loads(x) for x in m.AUDIT.read_text().splitlines()]
  self.assertEqual(len(log),2)
  self.assertTrue(all(x["manual"] and x["media_binding"]["sha256"]==SHA
                     and x["at"] and x["revision"]>0 for x in log))
 def test_return_to_review_is_bound_but_does_not_reinstate_memberships(self):
  self.assertEqual(self.write(self.req(action="assign_many",folders=["G1","G2"]),
                              attestor=self.att,required=True)[0],200)
  ret=self.req(action="return_to_queue",revision=1,folder=None)
  self.assertEqual(self.write(ret,attestor=self.att,required=True)[0],200)
  saved=m.current()["items"]["sd:"+SD]
  self.assertEqual(saved["review_status"],"inbox")
  self.assertEqual(saved["folders"],[])
  self.assertEqual(b.display_status(saved,self.att),"bound")
  self.assertEqual(len(m.AUDIT.read_text().splitlines()),2)
 def test_changed_media_refused_without_overwriting_prior_review(self):
  self.assertEqual(self.write(self.req(),attestor=self.att,required=True)[0],200)
  before=m.STORE.read_bytes();audit=m.AUDIT.read_bytes()
  self.att.flip_after_read=True
  code,reply=self.write(self.req(revision=1,folder="G2"),
                        attestor=self.att,required=True)
  self.assertNotEqual(code,200)
  self.assertEqual(m.STORE.read_bytes(),before)
  self.assertEqual(m.AUDIT.read_bytes(),audit)
  self.assertEqual(m.current()["items"]["sd:"+SD]["folder"],"G1")
  self.assertEqual(b.display_status(m.current()["items"]["sd:"+SD],self.att),
                   "revision_mismatch")
 def test_missing_source_reports_source_unavailable_not_unreviewed(self):
  self.assertEqual(self.write(self.req(),attestor=self.att,required=True)[0],200)
  self.att.fail=True
  state=m.current()["items"]["sd:"+SD]
  self.assertEqual(b.display_status(state,self.att),"source_unavailable")
  self.assertEqual(state["review_status"],"assigned")
  self.assertEqual(self.write(self.req(revision=1,folder="G2"),
                   attestor=self.att,required=True)[0],503)
 def test_legacy_writer_cannot_erase_existing_binding(self):
  self.assertEqual(self.write(self.req(),attestor=self.att,required=True)[0],200)
  before=m.STORE.read_bytes()
  code,_=self.write(self.req(revision=1,folder="G2"))
  self.assertEqual(code,503)
  self.assertEqual(m.STORE.read_bytes(),before)
 def test_old_revision_replay_and_duplicate_group_refused(self):
  self.assertEqual(self.write(self.req(action="assign_many",folders=["G1","G2"],
                            folder="G1"),attestor=self.att,required=True)[0],200)
  self.assertEqual(self.write(self.req(action="assign_many",folders=["G1","G2"],
                            folder="G1"),attestor=self.att,required=True)[0],409)
  self.assertEqual(self.write(self.req(action="assign_many",folders=["G1","G1"],
                            folder="G1",revision=1),attestor=self.att,required=True)[0],400)
  self.assertEqual(len(m.AUDIT.read_text().splitlines()),1)
 def test_attestor_cannot_use_sidecar_only_or_forged_body_digest(self):
  class Bad(BytesAttested):
   def verify_bytes(self,source,name):
    data=super().verify_bytes(source,name)
    data["verified_original_bytes"]=False
    return data
  self.assertNotEqual(self.write(self.req(),attestor=Bad(),required=True)[0],200)
  request=self.req();request["sha256"]=SHA
  self.assertEqual(self.write(request,attestor=self.att,required=True)[0],400)
  self.assertFalse(m.STORE.exists())
 def test_binding_status_not_authority_to_revoke_historical(self):
  self.assertEqual(self.write(self.req(),attestor=self.att,required=True)[0],200)
  entry=m.current()["items"]["sd:"+SD]
  self.assertEqual(b.public_diagnostics({"sd:"+SD:entry})["counts"]["source_unavailable"],1)
  self.assertTrue(b.public_diagnostics({"sd:"+SD:entry})["historical_authority_preserved"])
  self.assertFalse(b.public_diagnostics({"sd:"+SD:entry})["reviews_reopened"])

if __name__=="__main__":unittest.main(verbosity=2)
