#!/usr/bin/env python3
"""Private, synthetic tests of cross-clip human-confirmed visitor linking."""
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
import sys
sys.path.insert(0,str(HERE))  # native outfit-review helper shares stage with test
REVIEW=HERE.parent/"s9-person-ml-v1/s9_drive_visitor_review.py"
PATCH=HERE/"patch-drive-visitor-review-ui.py"

def load(filename,key):
 spec=importlib.util.spec_from_file_location(key,filename)
 obj=importlib.util.module_from_spec(spec);spec.loader.exec_module(obj);return obj

class Tests(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory();self.addCleanup(self.temp.cleanup)
  d=Path(self.temp.name)
  self.m=m=load(REVIEW,"review_visitor_test")
  m.CAT=d/"cat.json";m.INDEX=d/"index.json";m.CONFIG=d/"config.json"
  m.STORE=d/"links.json";m.AUDIT=d/"audit.jsonl"
  self.name1="NEW_20260916165945_person-1.00_20260916-165945-0189.mp4"
  self.name2="NEW_20260916142248_person-1.00_20260916-142248-0153.mp4"
  self.name3="S3_20260903180600_motion_test_0001.mp4"
  self.key1=hashlib.sha256(("new\0"+self.name1).encode()).hexdigest()
  self.key2=hashlib.sha256(("new\0"+self.name2).encode()).hexdigest()
  self.key3=hashlib.sha256(("s3\0"+self.name3).encode()).hexdigest()
  m.INDEX.write_text(json.dumps({"items":[
   {"state":"verified","camera":"new","remote_name":self.name1},
   {"state":"verified","camera":"new","remote_name":self.name2},
   {"state":"verified","camera":"s3","remote_name":self.name3},
   {"state":"deleted","camera":"new","remote_name":"NEW_20260825213125_foo.mp4"}
  ]}))
  m.CAT.write_text(json.dumps({"items":{
   self.key1:{"status":"classified","clip_id":self.key1,"camera":"new",
              "remote_name":self.name1,"category":"single_person_event_candidate","person_score":.91},
   self.key2:{"status":"classified","clip_id":self.key2,"camera":"new",
              "remote_name":self.name2,"category":"possible_person_needs_review","person_score":.72},
   self.key3:{"status":"classified","clip_id":self.key3,"camera":"s3",
              "remote_name":self.name3,"category":"multiple_people_candidate","person_score":.88}
  },"summary":{"eligible":3,"processed":3,"remaining":0}}))
  m.CONFIG.write_text(json.dumps({"folders":{"new":{"id":"12345678901234567890"},"s3":{"id":"98765432101234567890"}}}))
 def test_human_confirmed_ids_stable_without_biometrics(self):
  m=self.m
  self.assertEqual(m.report()["processed"],3)
  self.assertEqual(m.report()["reviewed_single_person_links"],0)
  self.assertEqual(m.save_link(self.key1,"create",None,False)[0],400)
  code,out=m.save_link(self.key1,"create",None,True)
  self.assertEqual(code,200)
  self.assertEqual(out["visitor_id"],"VIS-0001")
  self.assertEqual(m.save_link(self.key2,"link","VIS-0001",True)[0],200)
  self.assertEqual(m.report()["reviewed_single_person_links"],2)
  self.assertEqual(m.save_link(self.key3,"link","VIS-0001",True)[0],409)
  self.assertEqual(m.save_link("f"*64,"create",None,True)[0],404)
  self.assertEqual(m.STORE.stat().st_mode&0o777,0o600)
  self.assertEqual(m.AUDIT.stat().st_mode&0o777,0o600)
  self.assertEqual(len(m.AUDIT.read_text().splitlines()),2)
  self.assertEqual(m.save_link(self.key2,"unlink",None,False)[0],200)
  self.assertEqual(m.report()["reviewed_single_person_links"],1)
  self.assertNotIn("embedding",json.dumps(m.registry()))
  self.assertNotIn("face",json.dumps(m.registry()))
 def test_api_intent_origin_and_existing_routes(self):
  m=self.m
  class H:
   def __init__(self,path,body=b"",headers=None):
    self.path=path;self.headers=headers or {}
    self.rfile=io.BytesIO(body);self.code=None;self.reply=None
   def js(self,code,obj):self.code=code;self.reply=obj
   def go(self):self.code=418
   def do_POST(self):self.code=418
  m.install(H)
  body=json.dumps({"clip_id":self.key1,"action":"create","visitor_id":None,"human_confirmed":True}).encode()
  h={"Content-Type":"application/json","Content-Length":str(len(body))}
  x=H("/new/api/drive-person-review",body,h);x.do_POST()
  self.assertEqual(x.code,403);self.assertFalse(m.STORE.exists())
  h["X-S9-Visitor-Intent"]="manual-confirmed-visitor-v1";h["Origin"]="https://wrong.example"
  x=H("/new/api/drive-person-review",body,h);x.do_POST()
  self.assertEqual(x.code,403)
  h["Origin"]="https://kalenel.nl"
  x=H("/new/api/drive-person-review",body,h);x.do_POST()
  self.assertEqual(x.code,200)
  x=H("/new/api/drive-person-review");x.go()
  self.assertEqual(x.code,200);self.assertEqual(x.reply["reviewed_single_person_links"],1)
  x=H("/new/api/saved");x.go();self.assertEqual(x.code,418)
  x=H("/new/api/saved/delete");x.do_POST();self.assertEqual(x.code,418)
 def test_sampled_frame_coverage_in_drive_review(self):
  m=self.m
  doc=json.loads(m.CAT.read_text())
  doc["items"][self.key1].update({"sampled_frames":20,"person_frame_count":5})
  doc["items"][self.key2].update({"sampled_frames":20,"person_frame_count":0})
  doc["items"][self.key3].update({"sampled_frames":0,"person_frame_count":0})
  m.CAT.write_text(json.dumps(doc))
  result=m.report()["clips"]
  by_id={row["clip_id"]:row for row in result}
  self.assertEqual(by_id[self.key1]["person_presence_percent"],25.0)
  self.assertEqual(by_id[self.key1]["person_detected_frames_050"],5)
  self.assertEqual(by_id[self.key2]["person_presence_percent"],0.0)
  self.assertIsNone(by_id[self.key3]["person_presence_percent"])
  self.assertNotIn("face_embeddings",json.dumps(result))

 def test_idempotent_ui_and_no_media(self):
  p=load(PATCH,"review_patch_test")
  before='<html><script id="c720p-s9-phone-clips-ui-v1"></script></body></html>'
  after=p.patch(before)
  self.assertEqual(p.patch(after),after)
  stale=after.replace("Peak person-detection score:","Previous model score:",1)
  self.assertNotEqual(stale,after)
  self.assertEqual(p.patch(stale),after)
  self.assertIn("manual-confirmed-visitor-v1",after)
  self.assertIn("person",after)
  with self.assertRaises(ValueError):p.patch("<html></body></html>")
  doc=(HERE/"drive-person-batch-catalog.py").read_text()
  for anchor in ("decode_frames(cc,name,110)","drive_read_only","media_saved_on_hub","CAMERAS"):
   self.assertIn(anchor,doc)

if __name__=="__main__":unittest.main(verbosity=2)
