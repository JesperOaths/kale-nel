#!/usr/bin/env python3
"""No camera required: ensure incremental S9 archive indexing preserves old rows."""
import importlib.util
import json
from unittest.mock import patch
from pathlib import Path
import unittest
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

 def test_modified_known_4k_clip_reconciles_face_review_without_dropping_data(self):
  name="motion_1791739041453.mp4"
  old={"name":name,"timestamp":"2026-10-12 12:00","size":34691209,
       "sd_verified":True,"thumbnail":"s9-phone-thumbs/example.jpg",
       "face_snapshots_saved":0,"face_deep_review_version":None,
       "human_review_note":"keep unchanged"}
  index={"storage_policy":"local_microSD","phone_recordings":[old]}
  meta={"name":name,"bytes":34691209,"sha256":"a"*64,
        "width":3840,"height":2160,"person_count":0,
        "face_review_version":"s9_face_review_v1",
        "face_deep_review_version":"s9_onphone_36_samples_person_or_tile_v3",
        "face_review_sampled_frames":48}
  class FaceHelpers(Helpers):
   @staticmethod
   def safe_face_review_metadata(m):
    return {"face_deep_review_version":m.get("face_deep_review_version"),
            "face_review_sampled_frames":m.get("face_review_sampled_frames")}
  with patch.object(module,"adb",return_value=json.dumps(meta).encode()) as mocked:
   updates=module.recent_existing_face_updates(
    index,[name+".verified.json"],{name},FaceHelpers,limit=8)
  self.assertEqual(mocked.call_count,1)
  self.assertEqual(len(updates),1)
  self.assertEqual(updates[0]["face_deep_review_version"],"s9_onphone_36_samples_person_or_tile_v3")
  self.assertEqual(updates[0]["human_review_note"],"keep unchanged")
  self.assertEqual(updates[0]["thumbnail"],old["thumbnail"])
  newer=module.update_index(index,updates)
  self.assertEqual(len(newer["phone_recordings"]),1)
  self.assertIsNone(index["phone_recordings"][0]["face_deep_review_version"])
  self.assertEqual(module.recent_existing_face_updates(
    index,[name+".verified.json"],set(),FaceHelpers),[])

 def test_guarded_fast_index_deployer_uses_real_helper_contract(self):
  d=Path(__file__).with_name("deploy-fast-face-v26.py").read_text()
  self.assertIn('b"recent_existing_face_updates"',d)
  self.assertIn('b"safe_face_review_metadata"',d)
  self.assertNotIn('b"face_deep_review_version" not in updated',d)

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
