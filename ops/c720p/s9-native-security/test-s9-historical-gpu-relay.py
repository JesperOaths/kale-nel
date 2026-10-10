#!/usr/bin/env python3
"""Offline, synthetic contracts for the optional S9+ historical import path."""
import importlib.util
import json
from pathlib import Path
import unittest

HERE=Path(__file__).parent
spec=importlib.util.spec_from_file_location("gpu_relay",HERE/"s9-historical-gpu-relay.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class HistoricalGpuReviewTests(unittest.TestCase):
 def setUp(self):
  self.id="a"*64
  self.hash="b"*64
  self.name="NEW_20260916165945_person-1.00_20260916-165945-0189.mp4"
  self.verified={self.id:{"clip_id":self.id,"camera":"new","remote_name":self.name,"size":500000}}
  self.result={
   "source_clip_id":self.id,"source_remote_name":self.name,"source_camera":"new",
   "source":"verified_historical_google_drive","archive":"historical_drive_import_isolated",
   "import_status":"classified_pending_hub_ack",
   "model_sha256":"c"*64,"source_sha256":self.hash,"sha256":self.hash,
   "sampled_frame_count":8,"person_frames_at_050":2,"person_confidence":.83,
   "person_event_category":"single_person_repeated_candidate",
   "vehicle_confidence":0.1,"animal_confidence":0.0,"backend":"gpu"}
 def test_valid_phone_result_provenance_and_sampling(self):
  result=m.validate_result(self.result,self.verified)
  self.assertEqual(result["category"],"single_person_event_candidate")
  self.assertEqual(result["person_frame_count"],2)
  self.assertEqual(result["sampled_frames"],8)
  self.assertEqual(result["model_sha256"],"c"*64)
  self.assertEqual(result["review_backend"],"gpu")
  self.assertEqual(result["source_sha256"],self.hash)
  self.assertTrue(result["drive_read_only"])
  self.assertNotIn("appearance_vector",result)
  self.assertNotIn("visitor_id",result)
 def test_rejects_unknown_or_tampered_source(self):
  for name,value in (
   ("source_clip_id","f"*64),("source_remote_name","../other.mp4"),
   ("source_camera","s3"),("source","unverified"),
   ("source_sha256","d"*64),("model_sha256","bad"),
   ("import_status","not_ready"),("sampled_frame_count",0),
   ("person_frames_at_050",20),("person_confidence",1.3),
   ("backend","third_party"),("person_event_category","recognized_named_person")
  ):
   case=dict(self.result);case[name]=value
   with self.subTest(name=name),self.assertRaises(ValueError):
    m.validate_result(case,self.verified)
 def test_animal_vehicle_and_unresolved(self):
  for confidence,expected in [("vehicle_confidence","vehicle_candidate"),
                               ("animal_confidence","animal_candidate"),
                               (None,"unresolved_motion")]:
   case=dict(self.result)
   case["person_event_category"]="no_person_model_detection"
   case["vehicle_confidence"]=0.0
   case["animal_confidence"]=0.0
   if confidence:case[confidence]=.7
   self.assertEqual(m.category_from_phone(case),expected)
 def test_android_worker_keeps_native_4k_archive_separate(self):
  text=(HERE/"src/nl/kalenel/s9security/HistoricalImportWorker.java").read_text()
  self.assertIn("HistoricalDriveInbox",text)
  self.assertIn("verified_historical_google_drive",text)
  self.assertIn("historical_drive_import_isolated",text)
  self.assertIn("import_digest_mismatch",text)
  self.assertIn("classified_pending_hub_ack",text)
  camera=(HERE/"src/nl/kalenel/s9security/CameraService.java").read_text()
  self.assertIn("new HistoricalImportWorker(",camera)
  self.assertIn('temperature()>=370',camera)
  self.assertIn('reviewer.execute(new Runnable()',camera)
  self.assertNotIn('new File(appStorage,"Security4K")',text)
 def test_relay_only_writes_explicit_copy_and_metadata(self):
  source=(HERE/"s9-historical-gpu-relay.py").read_text()
  self.assertIn('"--drive-root-folder-id"',source)
  self.assertIn("source_exceeded_verified_size",source)
  self.assertIn("hist",source)
  self.assertNotIn("rclone move",source)
  self.assertNotIn("rclone delete",source)

if __name__=="__main__":
 unittest.main(verbosity=2)
