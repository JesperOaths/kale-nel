#!/usr/bin/env python3
"""Offline private S9+ manual case registry and request-auth regression tests."""
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
MODULE=ROOT.parent/"s9-person-ml-v1/s9_manual_evidence_cases.py"
spec=importlib.util.spec_from_file_location("step2_case_backend",MODULE)
cases=importlib.util.module_from_spec(spec);spec.loader.exec_module(cases)
A="motion_1792200000000.mp4"
B="motion_1792200060000.mp4"
C="motion_1792200120000.mp4"

class CaseBackend(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory()
  self.addCleanup(self.temp.cleanup)
  root=Path(self.temp.name)
  self.patchers=[patch.object(cases,"CAT",root/"catalog.json"),
    patch.object(cases,"STORE",root/"private-cases.json"),
    patch.object(cases,"AUDIT",root/"private-case-audit.jsonl")]
  for p in self.patchers:self.addCleanup(p.stop);p.start()
  self.rows=[{"name":n,"size":1000000+i*1000,"sd_verified":True,
      "resolution":"3840x2160","timestamp":"2026-10-17 07:00"}
    for i,n in enumerate((A,B,C))]
  self.save_catalog()
 def save_catalog(self):
  cases.CAT.write_text(json.dumps({"phone_recordings":self.rows}))
 def send(self,action,case_id=None,clip=None,revision=None,confirmed=True):
  return cases.mutate({"action":action,"case_id":case_id,"clip":clip,
   "revision":cases.report()["revision"] if revision is None else revision,
   "confirmed":confirmed})
 def test_all_lifecycle_and_persistence(self):
  status,created=self.send("create",clip=A)
  self.assertEqual(status,200)
  cid=created["case_id"]
  self.assertEqual(cid,"CASE-0001")
  self.assertEqual(cases.report()["cases"][0]["clips"][0]["clip"],A)
  status,added=self.send("add",case_id=cid,clip=B)
  self.assertEqual(status,200)
  self.assertEqual(cases.report()["linked_available_clips"],2)
  self.assertEqual(self.send("add",cid,B)[0],409)
  self.assertEqual(self.send("close",cid)[0],200)
  self.assertEqual(self.send("add",cid,C)[0],409)
  self.assertEqual(self.send("reopen",cid)[0],200)
  self.assertEqual(self.send("remove",cid,A)[0],200)
  self.assertEqual(len(cases.report()["cases"][0]["clips"]),1)
  self.assertEqual(len(cases.AUDIT.read_text().splitlines()),5)
  self.assertEqual(cases.STORE.stat().st_mode&0o777,0o600)
  self.assertTrue(cases.report()["manual_collection_only"])
  self.assertFalse(cases.report()["auto_identity"])
 def test_no_unreviewed_or_unverified_clips(self):
  self.assertEqual(self.send("create",clip=A,confirmed=False)[0],400)
  self.assertEqual(self.send("create",clip="motion_1.mp4")[0],400)
  self.rows[0]["sd_verified"]=False;self.save_catalog()
  self.assertEqual(self.send("create",clip=A)[0],404)
  self.rows[0]["sd_verified"]=True;self.rows[0]["resolution"]="1920x1080"
  self.save_catalog()
  self.assertEqual(self.send("create",clip=A)[0],404)
 def test_revision_and_duplicate_case_conflicts(self):
  id1=self.send("create",clip=A)[1]["case_id"]
  stale=cases.report()["revision"]
  id2=self.send("create",clip=B)[1]["case_id"]
  self.assertEqual(self.send("add",id1,C,revision=stale)[0],409)
  self.assertEqual(self.send("add",id1,B)[0],409)
  self.assertEqual(cases.report()["total_cases"],2)
 def test_source_changed_flag_without_changing_saved_links(self):
  cid=self.send("create",clip=A)[1]["case_id"]
  self.rows[0]["size"]+=1500;self.save_catalog()
  status=cases.report()
  self.assertFalse(status["cases"][0]["clips"][0]["available"])
  self.assertEqual(status["linked_available_clips"],0)
  self.assertEqual(self.send("remove",cid,A)[0],200)
 def test_invalid_state_never_overwritten(self):
  cases.STORE.write_text("{invalid JSON")
  with self.assertRaisesRegex(RuntimeError,"corrupted"):
   cases.report()
  with self.assertRaisesRegex(RuntimeError,"corrupted"):
   cases.mutate({"action":"create","case_id":None,"clip":A,
       "revision":0,"confirmed":True})
  self.assertEqual(cases.STORE.read_text(),"{invalid JSON")
 def test_request_shape_cannot_add_names_or_embeddings(self):
  self.assertEqual(cases.mutate({"action":"create","case_id":None,"clip":A,
   "revision":0,"confirmed":True,"identity":"Joe"})[0],400)
  self.assertEqual(self.send("create",clip=C,confirmed="true")[0],400)
 def test_handler_blocks_cross_origin_and_missing_intent(self):
  class H:
   def go(self):return "old"
   def do_POST(self):return "old_post"
   def js(self,code,payload):self.answer=(code,payload)
  cases.install(H)
  instance=H()
  instance.path=cases.ROUTE
  body=json.dumps({"action":"create","case_id":None,"clip":A,
                   "revision":0,"confirmed":True}).encode()
  instance.rfile=io.BytesIO(body)
  instance.headers={"Content-Type":"application/json","Content-Length":str(len(body)),
                    "X-S9-Case-Intent":"manually-reviewed-evidence-v1",
                    "Origin":"https://unsafe.example"}
  instance.do_POST()
  self.assertEqual(instance.answer[0],403)
  self.assertFalse(cases.STORE.exists())
  instance.headers["Origin"]="https://kalenel.nl"
  instance.rfile=io.BytesIO(body);instance.do_POST()
  self.assertEqual(instance.answer[0],200)
  self.assertEqual(instance.answer[1]["case_id"],"CASE-0001")
  instance.command="GET";instance.go()
  self.assertTrue(instance.answer[1]["ok"])
if __name__=="__main__":unittest.main(verbosity=2)
