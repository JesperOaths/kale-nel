#!/usr/bin/env python3
"""Offline tests of S9 review labels: no real images, names or devices."""
import hashlib,importlib.util,io,json,pathlib,tempfile,unittest
BASE=pathlib.Path(__file__).resolve().parents[1]
def load(relative):
 p=BASE/relative
 spec=importlib.util.spec_from_file_location("review_test_"+p.stem,p)
 m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m
class Tests(unittest.TestCase):
 def setUp(self):
  x=tempfile.TemporaryDirectory();self.addCleanup(x.cleanup)
  d=pathlib.Path(x.name);m=load("s9-person-ml-v1/s9_human_thumbnail_review.py")
  self.m=m;m.CAT=d/"catalog.json";m.STORE=d/"labels.json";m.AUDIT=d/"audit.jsonl";m.BENCH=d/"bench.json";m.THUMBS=d/"thumbs";m.THUMBS.mkdir()
  self.name="motion_1791589900000.mp4";self.file=self.name+".thumb.jpg"
  self.blob=b"\xff\xd8\xff"+b"x"*6800+b"\xff\xd9";self.digest=hashlib.sha256(self.blob).hexdigest()
  (m.THUMBS/self.file).write_bytes(self.blob)
  m.CAT.write_text(json.dumps({"phone_recordings":[{"name":self.name,"sd_verified":True,
    "timestamp":"2026-10-09 22:00","scene_category":"one_person",
    "thumbnail":"s9-phone-thumbs/"+self.file},
   {"name":"../unsafe.mp4","sd_verified":True,"thumbnail":"s9-phone-thumbs/../unsafe.mp4.thumb.jpg"}]}))
 def test_hash_binding_and_audit(self):
  m=self.m;self.assertEqual(m.report()["counts"]["unreviewed"],1)
  self.assertEqual(m.save_label(self.name,self.digest,"person_visible")[0],200)
  self.assertEqual(m.report()["images"][0]["human_label"],"person_visible")
  self.assertEqual(m.STORE.stat().st_mode&0o777,0o600)
  self.assertEqual(m.AUDIT.stat().st_mode&0o777,0o600)
  self.assertEqual(m.save_label(self.name,"0"*64,"no_person_visible")[0],409)
  self.assertEqual(m.save_label(self.name,self.digest,["person_visible"])[0],400)
  self.assertEqual(m.save_label("../escape.mp4",self.digest,"person_visible")[0],400)
  self.assertEqual(m.save_label(self.name,self.digest,"clear")[0],200)
  self.assertEqual(m.report()["counts"]["unreviewed"],1)
  self.assertEqual(len(m.AUDIT.read_text().splitlines()),2)
 def test_provenance_and_no_premature_rates(self):
  m=self.m;m.BENCH.write_text(json.dumps({"per_image":{
   "ssd":{"model_sha256":m.MODEL_SHAS["ssd"],"frames":{self.file:{"input_sha256":self.digest,"person_score":0.81}}},
   "lite0":{"model_sha256":m.MODEL_SHAS["lite0"],"frames":{self.file:{"input_sha256":"0"*64,"person_score":0.99}}}}))
  self.assertEqual(m.report()["images"][0]["person_scores"],{"ssd":0.81})
  self.assertEqual(m.save_label(self.name,self.digest,"no_person_visible")[0],200)
  stats=m.report()["metrics"]["ssd"]
  self.assertEqual(stats["fp"],1)
  self.assertIsNone(stats["false_positive_rate"])
  (m.THUMBS/self.file).write_bytes(b"\xff\xd8\xff"+b"y"*6800+b"\xff\xd9")
  self.assertIsNone(m.report()["images"][0]["human_label"])
  self.assertEqual(m.report()["images"][0]["person_scores"],{})
 def test_signed_write_intent_and_old_routes(self):
  m=self.m
  class H:
   def __init__(self,path,body=b"",headers=None):
    self.path=path;self.command="POST";self.headers=headers or {}
    self.rfile=io.BytesIO(body);self.status=None;self.payload=None
   def go(self):self.status=418
   def do_POST(self):self.status=418
   def js(self,code,payload):self.status=code;self.payload=payload
  m.install(H)
  body=json.dumps({"name":self.name,"sha256":self.digest,"label":"person_visible"}).encode()
  h={"Content-Type":"application/json","Content-Length":str(len(body))}
  x=H("/new/api/thumbnail-review",body,h);x.do_POST();self.assertEqual(x.status,403)
  self.assertFalse(m.STORE.exists())
  h["X-S9-Review-Intent"]="human-thumbnail-v1";h["Origin"]="https://attacker.test"
  x=H("/new/api/thumbnail-review",body,h);x.do_POST();self.assertEqual(x.status,403)
  h["Origin"]="https://kalenel.nl"
  x=H("/new/api/thumbnail-review",body,h);x.do_POST();self.assertEqual(x.status,200)
  x=H("/new/api/thumbnail-review");x.go();self.assertEqual(x.status,200)
  self.assertEqual(x.payload["scope"],"visible_content_of_single_thumbnail_not_entire_video")
  x=H("/new/api/saved/delete");x.do_POST();self.assertEqual(x.status,418)
 def test_ui_patch(self):
  m=load("s9-native-security/patch-thumbnail-review-ui.py")
  before='<html><script id="c720p-s9-phone-clips-ui-v1"></script></body></html>'
  after=m.patch_text(before);self.assertEqual(m.patch_text(after),after)
  self.assertIn("Label ONLY what is visible",after)
  self.assertIn("X-S9-Review-Intent",after)
  with self.assertRaises(ValueError):m.patch_text("<html></body></html>")
if __name__=="__main__":unittest.main(verbosity=2)
