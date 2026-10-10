#!/usr/bin/env python3
"""Offline regression tests for phone-only face snapshots and hub-safe metadata."""
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest import mock

HERE=Path(__file__).resolve().parent
PHONE=HERE.parent/"s9-person-ml-v1"
sys.path.insert(0,str(PHONE))

def load(path,name):
 spec=importlib.util.spec_from_file_location(name,path)
 module=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(module)
 return module

class FaceReviewTests(unittest.TestCase):
 def setUp(self):
  self.catalog=load(PHONE/"local-sd-catalog.py","s9_face_catalog")
  self.proxy=load(PHONE/"s9_sd_proxy_extension.py","s9_face_proxy")
  self.ui=load(HERE/"patch-s9-face-review-ui.py","s9_face_ui")

 def test_safe_metadata_without_biometric_exfiltration(self):
  m={"face_review_version":"s9_face_review_v1",
     "face_review_status":"review_complete_unverified_matches",
     "face_review_sampled_frames":4,"face_snapshots_saved":2,
     "face_model_sha256":"deadbeef",
     "face_embedding":[.2]*128,
     "face_candidates":[
      {"person_id":"unknown_00001","match_status":"new_anonymous_candidate",
       "snapshot":"motion_1791600000000__unknown_00001__1600_0.jpg","time_ms":1600,
       "embedding":[.2]*128,"cosine_similarity":.908},
      {"person_id":"known_candidate_Alice","candidate_name":"Alice",
       "match_status":"reference_similarity_unverified","time_ms":2800,
       "snapshot":"face.jpg","cosine_similarity":.943}
     ]}
  safe=self.catalog.safe_face_review_metadata(m)
  self.assertEqual(safe["face_snapshots_saved"],2)
  self.assertEqual(safe["face_candidates"][0]["person_id"],"unknown_00001")
  self.assertEqual(safe["face_candidates"][1]["candidate_name"],"Alice")
  output=json.dumps(safe)
  for blocked in ("face_embedding","embedding","face_model_sha256","snapshot\":","face.jpg"):
   self.assertNotIn(blocked,output)

 def test_older_clips_and_malicious_labels(self):
  self.assertEqual(self.catalog.safe_face_review_metadata({})["face_candidates"],[])
  malicious={"face_review_version":"s9_face_review_v1",
     "face_review_status":"review_complete_unverified_matches",
     "face_candidates":[{"person_id":"../../escape","candidate_name":"<script>alert(1)</script>",
       "match_status":"reference_similarity_unverified","time_ms":1000}]}
  result=self.catalog.safe_face_review_metadata(malicious)
  self.assertIsNone(result["face_candidates"][0]["person_id"])
  self.assertIsNone(result["face_candidates"][0]["candidate_name"])
  malicious["face_candidates"]=[{}]*50
  self.assertEqual(self.catalog.safe_face_review_metadata(malicious)["face_candidates"],[])

 def test_api_has_labels_only(self):
  class Handler:
   def __init__(self):
    self.path="/new/api/saved";self.result=None
   def go(self):raise AssertionError("missing wrapped handler")
   def do_POST(self):raise AssertionError("unexpected POST")
   def js(self,code,result):self.result=(code,result)
  self.proxy.install_local_sd(Handler)
  k="motion_1791600000000.mp4"
  item={"name":k,"timestamp":"2026-10-10 09:20","size":230000,"sd_verified":True,
        "face_review_status":"review_complete_unverified_matches",
        "face_review_sampled_frames":4,"face_snapshots_saved":1,
        "face_candidates":[{"person_id":"unknown_00001","match_status":"new_anonymous_candidate","time_ms":1600}]}
  with mock.patch.object(self.proxy,"rows",return_value={k:item}),mock.patch.object(self.proxy,"preview_rows",return_value={}):
   h=Handler();h.go()
  code,response=h.result
  self.assertEqual(code,200)
  row=response["events"][0]
  self.assertEqual(row["face_candidates"][0]["person_id"],"unknown_00001")
  self.assertEqual(row["face_review_sampled_frames"],4)
  self.assertNotIn("embedding",json.dumps(row))


 def test_authenticated_face_preview_served_on_demand_with_verified_digest(self):
  import hashlib
  from types import SimpleNamespace
  key="motion_1791600000000.mp4"
  filename="motion_1791600000000__unknown_00001__1600_0.jpg"
  jpeg=b"\xff\xd8\xff"+b"A"*2400+b"\xff\xd9"
  manifest={"name":key,"face_review_version":"s9_face_review_v1",
    "face_review_status":"face_embedding_unavailable_snapshots_only",
    "face_review_sampled_frames":12,
    "face_candidates":[{"match_status":"new_anonymous_candidate","person_id":"unknown_00001",
       "snapshot":filename,"snapshot_size_bytes":len(jpeg),
       "snapshot_sha256":hashlib.sha256(jpeg).hexdigest(),"time_ms":1600}]}
  safe=self.catalog.safe_face_review_metadata(manifest)
  self.assertTrue(safe["face_candidates"][0]["snapshot_on_s9"])
  self.assertEqual(safe["face_candidates"][0]["snapshot_name"],filename)
  class Handler:
   def __init__(self,path):
    import io
    self.path=path;self.command="GET";self.result=None;self.body=None
    self.wfile=io.BytesIO();self.headers={}
   def go(self):pass
   def do_POST(self):pass
   def js(self,code,data):self.result=code;self.body=data
   def send_response(self,code):self.result=code
   def send_header(self,key,val):self.headers[key]=val
   def end_headers(self):pass
  row={"name":key,"size":250000,"timestamp":"2026-10-10 09:20",
       "sd_verified":True,**safe}
  self.proxy.install_local_sd(Handler)
  request=Handler("/new/saved/face/"+filename)
  with mock.patch.object(self.proxy,"rows",return_value={key:row}),mock.patch.object(
    self.proxy,"preview_rows",return_value={}),mock.patch.object(
    self.proxy.subprocess,"run",return_value=SimpleNamespace(stdout=jpeg)):
   request.go()
  self.assertEqual(request.result,200)
  self.assertEqual(request.headers["Content-Type"],"image/jpeg")
  self.assertEqual(request.wfile.getvalue(),jpeg)
  tampered=Handler("/new/saved/face/"+filename)
  with mock.patch.object(self.proxy,"rows",return_value={key:row}),mock.patch.object(
    self.proxy,"preview_rows",return_value={}),mock.patch.object(
    self.proxy.subprocess,"run",return_value=SimpleNamespace(stdout=b"bad image")):
   tampered.go()
  self.assertEqual(tampered.result,503)
  self.assertEqual(tampered.wfile.getvalue(),b"")
  unindexed=Handler("/new/saved/face/motion_1791600000000__unknown_00002__1600_0.jpg")
  with mock.patch.object(self.proxy,"rows",return_value={key:row}),mock.patch.object(
    self.proxy,"preview_rows",return_value={}):
   unindexed.go()
  self.assertEqual(unindexed.result,404)

 def test_ui_is_idempotent_and_requires_security_page(self):
  page='<html><script id="c720p-s9-phone-clips-ui-v1"></script></body></html>'
  once=self.ui.patch_text(page)
  self.assertIn('id="s9-face-review-script-v1"',once)
  self.assertIn("C720PSecureRelay",once)
  self.assertEqual(self.ui.patch_text(once),once)
  with self.assertRaises(ValueError):self.ui.patch_text("<html></body></html>")

 def test_native_processing_and_no_hub_embedding(self):
  src=(HERE/"src/nl/kalenel/s9security/S9FaceReview.java").read_text()
  classify=(HERE/"src/nl/kalenel/s9security/ClipClassifier.java").read_text()
  service=(HERE/"src/nl/kalenel/s9security/CameraService.java").read_text()
  self.assertIn("FaceDetector",src)
  self.assertIn("face_embedding.tflite",src)
  self.assertIn("new S9FaceReview(app,folder,name)",classify)
  self.assertIn("faceReview.sample(bitmap",classify)
  self.assertIn("maybeFaceBackfill();",service)
  self.assertIn("face_backfill_queued",service)
  self.assertIn("getFilesDir()",src) # persistent biometrics stay app-private
  self.assertIn("FaceSnapshots",src)
  self.assertNotIn("face_embedding", (PHONE/"s9_sd_proxy_extension.py").read_text())

if __name__=="__main__":unittest.main(verbosity=2)
