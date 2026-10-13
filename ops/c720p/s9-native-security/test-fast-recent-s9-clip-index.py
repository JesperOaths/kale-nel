#!/usr/bin/env python3
"""No camera required: ensure incremental S9 archive indexing preserves old rows."""
import importlib.util
from pathlib import Path
import unittest
from unittest import mock
import json
M=Path(__file__).with_name("fast-recent-s9-clip-index.py")
spec=importlib.util.spec_from_file_location("fast_s9",M)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class Helpers:
 @staticmethod
 def safe_native_detection_stats(m):return {"person_score":.426}
 @staticmethod
 def safe_capture_event_metadata(m,n):return {"capture_evidence_status":"recording_segment_verified"}
 @staticmethod
 def anonymous_clip_metadata(m):return {"anonymous_tracks":[]}
 @staticmethod
 def safe_face_review_metadata(m):return {"face_candidates":[]}

class FastIndexTests(unittest.TestCase):
 def test_existing_enriched_recording_refreshes_without_duplicate_or_thumbnail_copy(self):
  name="motion_1791739041453.mp4"
  old={"name":name,"size":2345000,"thumbnail":"s9-phone-thumbs/old.jpg","preserved_field":"yes"}
  index={"phone_recordings":[old]}
  manifest={"name":name,"bytes":2345000,"sha256":"b"*64,"width":3840,"height":2160,
   "person_evidence_version":"s9_person_evidence_v31","person_count":1}
  def phone(*args,**kw):
   if args[:2]==("exec-out","cat"):return json.dumps(manifest).encode()
   if args[:2]==("shell","stat"):return b"2345000\n"
   raise AssertionError("unexpected phone operation")
  with mock.patch.object(module,"adb",side_effect=phone) as read:
   rows=module.new_records(index,[name,name+".verified.pre-v31.json"],Helpers)
  self.assertEqual(read.call_count,2)
  updated=module.update_index(index,rows)
  self.assertEqual(len(updated["phone_recordings"]),1)
  row=updated["phone_recordings"][0]
  self.assertEqual(row["person_evidence_version"],"s9_person_evidence_v31")
  self.assertEqual(row["preserved_field"],"yes")
  self.assertEqual(row["thumbnail"],old["thumbnail"])
  with mock.patch.object(module,"adb",side_effect=AssertionError("already indexed")):
   self.assertEqual(module.new_records(updated,[name,name+".verified.pre-v31.json"],Helpers),[])

 def test_enrichment_marker_is_whitelisted(self):
  name="motion_1791739041453.mp4"
  manifest={"name":name,"bytes":2345000,"sha256":"b"*64,"width":3840,"height":2160,
   "person_evidence_version":{"unexpected":"value"}}
  self.assertIsNone(module.row_from_manifest(name,manifest,2345000,None,Helpers)["person_evidence_version"])

 def test_preserves_old_and_adds_verified_video(self):
  old={"storage_policy":"local_microSD","phone_recordings":[
     {"name":"motion_1791600000000.mp4","timestamp":"2026-10-10 12:00","size":55555,
      "sd_verified":True,"original_data_field":"preserved"}],"errors":["old_report_kept"]}
  name="motion_1791739041453.mp4"
  m={"name":name,"bytes":34691209,"sha256":"a"*64,"width":3840,"height":2160,
     "scene_category":"motion_other","person_count":0}
  row=module.row_from_manifest(name,m,34691209,None,Helpers)
  newer=module.update_index(old,[row])
  self.assertEqual(len(newer["phone_recordings"]),2)
  self.assertEqual(newer["phone_recordings"][0]["original_data_field"],"preserved")
  self.assertEqual(newer["phone_recordings"][1]["name"],name)
  self.assertEqual(newer["phone_recordings"][1]["person_score"],.426)
  self.assertEqual(newer["errors"],["old_report_kept"])
  self.assertEqual(len(old["phone_recordings"]),1)
  self.assertEqual(len(module.update_index(newer,[row])["phone_recordings"]),2)

 def test_rejects_unverified_media(self):
  name="motion_1791739041453.mp4"
  m={"name":name,"bytes":2345000,"sha256":"b"*64,"width":3840,"height":2160}
  for bad,actual in (({**m,"sha256":"wrong"},2345000),
                     ({**m,"width":1920},2345000),
                     ({**m,"name":"other.mp4"},2345000),
                     (m,0),({**m,"bytes":100},100)):
   with self.assertRaises(ValueError):
    module.row_from_manifest(name,bad,actual,None,Helpers)

 def test_no_camera_decoding_or_modification(self):
  raw=M.read_text()
  self.assertIn('adb("shell","ls","-1",FOLDER',raw)
  self.assertIn('adb("exec-out","cat",FOLDER+"/"+name+".verified.json"',raw)
  self.assertIn('os.replace(target,INDEX)',raw)
  self.assertNotIn("tensorflow",raw)
  self.assertNotIn("torch",raw)
  self.assertNotIn("ffmpeg",raw)
  self.assertNotIn("adb install",raw)
  self.assertNotIn("os.unlink(",raw)

if __name__=="__main__":unittest.main(verbosity=2)
