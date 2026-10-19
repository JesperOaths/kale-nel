#!/usr/bin/env python3
import importlib.util
from pathlib import Path
import unittest
import tempfile
import json
ROOT=Path(__file__).resolve().parent
p=ROOT/"s9_7s_saved_timing_proof_v1.py"
sp=importlib.util.spec_from_file_location("timing",p)
m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)
def clip(prefix=7100,age=10400):
 elapsed=14000
 return {"width":3840,"height":2160,"duration_ms":elapsed+prefix,
 "capture_segment_end_reason":"quiet_end",
 "capture_segment_configured_quiet_hold_ms":10000,
 "capture_segment_start_elapsed_ms":100,"capture_segment_stop_elapsed_ms":100+elapsed,
 "capture_segment_last_accepted_motion_age_at_stop_ms":age}
def catalog(*rows):
 return {"schema_version":"s9_native_archive_catalog_v1","records":{
  f"motion_{1792000010000+i:013d}.mp4":{"manifest":v} for i,v in enumerate(rows)}}
class Tests(unittest.TestCase):
 def test_three_verified_saved_segments(self):
  result=m.assess(catalog(clip(7150,10200),clip(7200,10600),clip(6900,10800)))
  self.assertTrue(result["complete"])
  self.assertEqual(result["eligible_count"],3)
  self.assertGreaterEqual(result["estimated_prefix_median_ms"],6700)
  self.assertEqual(result["quiet_tail_10_to_15_seconds"],3)
  self.assertFalse(result["full_frame_decode_verified"])
 def test_five_second_old_prefix_not_proved(self):
  data=m.assess(catalog(clip(5300),clip(5450),clip(5050)))
  self.assertFalse(data["complete"])
  self.assertLess(data["estimated_prefix_median_ms"],6700)
 def test_early_and_not_quiet_are_excluded(self):
  source=clip()
  source["capture_segment_end_reason"]="max_segment"
  x=m.assess(catalog(clip(),source))
  self.assertEqual(x["eligible_count"],1)
  self.assertFalse(x["complete"])
 def test_no_old_metadata_mistaken_for_proof(self):
  source=clip()
  del source["capture_segment_last_accepted_motion_age_at_stop_ms"]
  self.assertEqual(m.assess(catalog(source))["eligible_count"],0)
 def test_rollout_must_be_actually_installed(self):
  with tempfile.TemporaryDirectory() as td:
   f=Path(td)/"state.json"
   doc={"schema_version":"s9_native_7s_cool_rollout_v1",
        "state":"done","installed":False,
        "candidate_sha256":m.verified_new_rollout.__code__.co_consts[-1] if False else "37091d542b8708db26f520a67af8a4edbb687c80d2b24c01d87bf1a2d8b5d059"}
   f.write_text(json.dumps(doc))
   self.assertFalse(m.verified_new_rollout(f))
   doc["installed"]=True
   f.write_text(json.dumps(doc))
   self.assertTrue(m.verified_new_rollout(f))
 def test_no_media_or_review_write_operations(self):
  src=p.read_text()
  for token in ("adb ","ffmpeg","MediaCodec","shutil.rmtree","--apply","sudo ","video.write("):
   self.assertNotIn(token,src)
  self.assertIn("no_video_bytes_read",src)
  self.assertIn("os.fchmod(out.fileno(),0o600)",src)
 def test_interval_and_nonpersistent_timer(self):
  timer=(ROOT/"c720p-s9-native-timing-proof-v1.timer").read_text()
  self.assertIn("OnUnitInactiveSec=2h",timer)
  self.assertIn("Persistent=false",timer)
if __name__=="__main__":unittest.main(verbosity=2)
