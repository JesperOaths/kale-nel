#!/usr/bin/env python3
"""Synthetic JPEG regressions for native face-crop evidence; no device access."""
import base64
import copy
import hashlib
import importlib.util
import io
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent.parent
def load(name,path):
 spec=importlib.util.spec_from_file_location(name,path)
 mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
 return mod
catalog=load("snapshot_catalog",ROOT/"s9-person-ml-v1/local-sd-catalog.py")
proxy=load("snapshot_proxy",ROOT/"s9-person-ml-v1/s9_sd_proxy_extension.py")
# Real 70x70 solid-colour JPEG generated for this test. No person or camera data.
JPEG=base64.b64decode("/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAMCAgMCAgMDAwMEAwMEBQgFBQQEBQoHBwYIDAoMDAsKCwsNDhIQDQ4RDgsLEBYQERMUFRUVDA8XGBYUGBIUFRT/2wBDAQMEBAUEBQkFBQkUDQsNFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBQUFBT/wAARCABGAEYDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDEooor0zzwooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigAooooAKKKKACiiigD/9k=")
CLIP="motion_1792000000000.mp4"
NAME="motion_1792000000000__r5full_pending_1__450_0.jpg"
def manifest():
 return {"name":CLIP,"face_review_version":"s9_face_review_v1",
  "face_review_status":"review_complete_unverified_matches",
  "face_candidates":[{"match_status":"not_comparable_manual_review","time_ms":450,
   "face_crop_requires_manual_review":True,"snapshot":NAME,
   "snapshot_size_bytes":len(JPEG),"snapshot_sha256":hashlib.sha256(JPEG).hexdigest()}]}

class Handler:
 def __init__(self,command="GET"):
  self.command=command;self.wfile=io.BytesIO();self.headers={};self.code=None
 def send_response(self,code):self.code=code
 def send_header(self,key,value):self.headers[key]=value
 def end_headers(self):pass
 def js(self,code,value):self.code=code;self.error=value

class SnapshotIntegrity(unittest.TestCase):
 def test_small_real_jpeg_is_indexed_without_upscaling(self):
  self.assertLess(len(JPEG),2000)
  self.assertEqual(proxy.jpeg_snapshot_dimensions(JPEG),(70,70))
  source=manifest();before=copy.deepcopy(source)
  out=catalog.safe_face_review_metadata(source)
  self.assertEqual(out["face_snapshots_saved"],1)
  self.assertEqual(out["face_candidate_records"],1)
  self.assertEqual(out["face_candidates"][0]["snapshot_name"],NAME)
  self.assertEqual(source,before)
 def test_counter_does_not_call_missing_reference_a_saved_image(self):
  m=manifest();m["face_candidates"][0].pop("snapshot_sha256")
  out=catalog.safe_face_review_metadata(m)
  self.assertEqual(out["face_candidate_records"],1)
  self.assertEqual(out["face_snapshots_saved"],0)
  self.assertIsNone(out["face_candidates"][0]["snapshot_name"])
 def test_invalid_name_size_or_digest_is_not_indexed(self):
  for change in ({"snapshot":"../"+NAME},{"snapshot":NAME.replace("1792000000000","1792000000001")},
    {"snapshot_size_bytes":True},{"snapshot_size_bytes":511},{"snapshot_size_bytes":2200001},
    {"snapshot_sha256":"x"*64}):
   with self.subTest(change=change):
    m=manifest();m["face_candidates"][0].update(change)
    self.assertEqual(catalog.safe_face_review_metadata(m)["face_snapshots_saved"],0)
 def test_small_image_relay_checks_digest_and_keeps_private_headers(self):
  out=catalog.safe_face_review_metadata(manifest());h=Handler()
  with patch.object(proxy.subprocess,"run",return_value=SimpleNamespace(stdout=JPEG)) as call:
   proxy.serve_face_snapshot(h,NAME,out)
  self.assertEqual(h.code,200)
  self.assertEqual(h.wfile.getvalue(),JPEG)
  self.assertEqual(h.headers["Cache-Control"],"private,no-store")
  self.assertEqual(h.headers["X-Content-Type-Options"],"nosniff")
  self.assertIn("/FaceSnapshots/"+NAME,call.call_args.args[0][-1])
 def test_digest_or_length_mismatch_fails_closed(self):
  for data in (JPEG[:-3],JPEG[:100]+b"x"+JPEG[101:]):
   with self.subTest(length=len(data)):
    out=catalog.safe_face_review_metadata(manifest());h=Handler()
    with patch.object(proxy.subprocess,"run",return_value=SimpleNamespace(stdout=data)):
     proxy.serve_face_snapshot(h,NAME,out)
    self.assertEqual(h.code,503);self.assertEqual(h.wfile.getvalue(),b"")
 def test_too_small_native_dimensions_rejected_even_with_matching_digest(self):
  data=bytearray(JPEG);pos=data.index(b"\xff\xc0")
  data[pos+5:pos+9]=b"\x00\x10\x00\x10";data=bytes(data)
  self.assertIsNone(proxy.jpeg_snapshot_dimensions(data))
  out=catalog.safe_face_review_metadata(manifest())
  out["face_candidates"][0]["snapshot_sha256"]=hashlib.sha256(data).hexdigest();h=Handler()
  with patch.object(proxy.subprocess,"run",return_value=SimpleNamespace(stdout=data)):
   proxy.serve_face_snapshot(h,NAME,out)
  self.assertEqual(h.code,503)
 def test_bad_segment_length_and_missing_end_marker_are_rejected(self):
  self.assertIsNone(proxy.jpeg_snapshot_dimensions(JPEG[:-2]))
  self.assertIsNone(proxy.jpeg_snapshot_dimensions(JPEG[:4]+b"\xff\xff"+JPEG[6:]))
  self.assertIsNone(proxy.jpeg_snapshot_dimensions(b"not an image"*100))
 def test_head_validates_image_without_sending_body(self):
  out=catalog.safe_face_review_metadata(manifest());h=Handler("HEAD")
  with patch.object(proxy.subprocess,"run",return_value=SimpleNamespace(stdout=JPEG)):
   proxy.serve_face_snapshot(h,NAME,out)
  self.assertEqual(h.code,200);self.assertEqual(h.wfile.getvalue(),b"")
  self.assertEqual(h.headers["Content-Length"],str(len(JPEG)))
class ExtractionAnalysis(unittest.TestCase):
 def test_complete_sampling_still_reports_missing_image_quality_gaps(self):
  analysis=load('crop_analysis',ROOT/'s9-native-security/analyze-original4k-face-extraction-v1.py')
  rows=[]
  for i in range(4):
   rows.append({'clip_no':'motion_'+str(1792000000000+i)+'.mp4',
    'face_deep_review_version':analysis.TARGET,'face_candidates':[]})
  rows[0]['face_candidates']=[{'snapshot_name':NAME,'face_crop_requires_manual_review':True}]
  rows[1].update(face_rejected_insufficient_native_eye_detail=3,person_track_count=1)
  rows[2].update(face_rejected_dark_or_blurry=2)
  before=copy.deepcopy(rows)
  out=analysis.analyze({'archive_mode':'S9-microSD-only','events':rows})
  self.assertTrue(out['all_originals_current_v5'])
  self.assertEqual(out['unique_indexed_images'],1)
  self.assertEqual(out['person_supported_recordings_without_saved_face_image'],1)
  self.assertEqual(out['recording_extraction_cohorts'],{
   'saved_images_available_for_manual_review':1,'no_saved_image_insufficient_native_detail':1,
   'no_saved_image_dark_or_blurry':1,'no_face_hit_in_sampled_frames':1})
  self.assertFalse(out['identity_inference_performed'])
  self.assertEqual(rows,before)
 def test_invalid_references_and_old_pass_are_not_counted_as_current_images(self):
  analysis=load('crop_analysis_invalid',ROOT/'s9-native-security/analyze-original4k-face-extraction-v1.py')
  row={'clip_no':CLIP,'face_deep_review_version':'old',
   'face_candidates':[{}, {'snapshot_name':'../'+NAME}]}
  out=analysis.analyze({'archive_mode':'S9-microSD-only','events':[row]})
  self.assertEqual(out['remaining_v5_reviews'],1)
  self.assertEqual(out['unique_indexed_images'],0)
  self.assertEqual(out['candidate_records_without_image'],1)
  self.assertEqual(out['invalid_image_references'],1)

if __name__=="__main__":unittest.main(verbosity=2)
