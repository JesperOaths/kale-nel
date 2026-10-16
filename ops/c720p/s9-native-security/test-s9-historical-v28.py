#!/usr/bin/env python3
"""V28 legacy Drive re-review: verified-source selection and additive metadata only."""
import importlib.util, pathlib, unittest, copy

HERE=pathlib.Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("s9_historical_v28",HERE/"s9-historical-gpu-relay.py")
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)

class Tests(unittest.TestCase):
 def setUp(self):
  self.key="a"*64
  self.original={"clip_id":self.key,"camera":"new","remote_name":"NEW_20261001000000_test-12345678.mp4",
     "size":2000000,"legacy_person_score":0.8}
  self.row={"clip_id":self.key,"camera":"new","remote_name":self.original["remote_name"],
    "status":"classified","category":"single_person_event_candidate",
    "person_score":0.92,"human_review":"pending","custom_old_evidence":{"safe":"unchanged"}}
  self.entry={"clip_id":self.key,"camera":"new","remote_name":self.original["remote_name"],
    "status":"classified","category":"multiple_people_candidate","person_score":0.8,
    "person_frame_count":4,"sampled_frames":12,"possible_person_frame_count":8,
    "max_simultaneous_person_boxes":2,"vehicle_score":0.05,"animal_score":0.0,
    "review_backend":"gpu","model_sha256":"f"*64,
    "original_source_sha256":"b"*64,
    "analysis_input_preprocessing":"ffmpeg_h264_960x540_all_intra_12samples",
    "processed_at_utc":"2026-10-17T00:00:00Z"}

 def test_v28_rescans_prior_classified_verified_and_never_uses_deleted_sources(self):
  verified={self.key:self.original}
  stored={self.key:self.row,"b"*64:{"status":"classified"}}
  selected=module.v28_candidates(verified,stored)
  self.assertEqual(len(selected),1)
  self.assertEqual(selected[0]["clip_id"],self.key)
  cat={"items":{self.key:copy.deepcopy(self.row)}}
  module.merge_v28_recheck(cat,self.entry)
  self.assertEqual(module.v28_candidates(verified,cat["items"]),[])

 def test_identity_unverified_and_baseline_preserved(self):
  cat={"items":{self.key:copy.deepcopy(self.row)}}
  original=copy.deepcopy(self.row)
  review=module.merge_v28_recheck(cat,self.entry)
  old=dict(cat["items"][self.key]);old.pop("v28_person_recheck")
  self.assertEqual(old,original)
  self.assertEqual(review["identity_status"],"not_verified")
  self.assertEqual(review["category"],"multiple_people_candidate")
  self.assertNotIn("person_id",review)
  self.assertNotIn("embedding",review)

 def test_reject_missing_or_mismatched_baseline(self):
  with self.assertRaisesRegex(ValueError,"missing_baseline"):
   module.merge_v28_recheck({"items":{}},self.entry)
  with self.assertRaisesRegex(ValueError,"source_mismatch"):
   module.merge_v28_recheck({"items":{self.key:dict(self.row,camera="s3")}},self.entry)

 def test_retry_budget_prevents_indefinite_s9_processing(self):
  row=dict(self.row,v28_person_recheck={"status":"error","attempts":3})
  self.assertEqual(module.v28_candidates({self.key:self.original},{self.key:row}),[])

 def test_source_is_read_only_and_cleanup_applies_to_temporary_media_only(self):
  script=(HERE/"s9-historical-gpu-relay.py").read_text()
  self.assertIn('source_clip_id',script)
  self.assertIn('"--drive-root-folder-id"',script)
  self.assertIn('RECHECK_VERSION="v28_s9_gpu_historical_person_review_v1"',script)
  self.assertIn('ready.get("review_request_version")==RECHECK_VERSION',script)
  self.assertIn('m.write_catalog(cat)',script)
  self.assertNotIn("rclone delete",script)
  self.assertNotIn("rclone move",script)
  self.assertIn('mark_v28_failed_source(error)',script)
  self.assertIn('attempts=int(before.get("attempts",0))+1',script)
  self.assertIn('int(rereview.get("attempts",0))>=3',script)

if __name__=="__main__":unittest.main(verbosity=2)
