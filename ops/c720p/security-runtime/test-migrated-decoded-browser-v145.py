#!/usr/bin/env python3
"""Synthetic browser decode results and no media mutation contract."""
import importlib.util
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/"smoke-c720p-migrated-decoded-browser-v145.py"
spec=importlib.util.spec_from_file_location("s9_migrated_decode",SOURCE)
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
def good():
 return dict(authenticated_manifest=True,migrated_recordings_count=6,
   decode_supported=True,playback_started=True,playback_error=None,
   browser_video_error=None,decoded_frame_callbacks=7,
   video_current_time=2.3,video_ready_state=4,video_width=1280,
   video_height=720,no_user_media_mutations=True,signed_url_not_returned=True)
class Checks(unittest.TestCase):
 def test_actual_decoded_evidence_is_required(self):
  d=s.validate(good())
  self.assertTrue(d["authenticated_migrated_video_decoded"])
  self.assertEqual(d["decoded_frames"],7)
 def test_metadata_only_and_no_frames_is_not_success(self):
  for mutate in (
   {"decoded_frame_callbacks":0},{"decoded_frame_callbacks":2},
   {"video_current_time":0},{"video_ready_state":1},
   {"playback_started":False},{"decode_supported":False},
   {"browser_video_error":4},{"playback_error":"playback_timeout"},
   {"migrated_recordings_count":0},{"no_user_media_mutations":False},
   {"signed_url_not_returned":False}):
   d=good();d.update(mutate)
   with self.subTest(mutate=mutate),self.assertRaises(RuntimeError):
    s.validate(d)
 def test_one_short_readonly_playback_and_cleanup(self):
  source=SOURCE.read_text();js=s.js()
  for must in ("3200","v.pause();v.removeAttribute('src');v.load();v.remove();",
    "requestVideoFrameCallback","v.muted=true","document.body.append(v)",
    "C720PSecureRelay","migrated_recordings_count","Target.closeTarget",
    "Target.activateTarget","camera_dropped_output_frames_after"):
   self.assertIn(must,source)
  for bad in ("SaveClip(","DeleteClip(","review_decide","unlink(", "ffmpeg",
              "pm install","adb push","camera.setPictureSize"):
   self.assertNotIn(bad,source)
  for bad in ("return {signed:", "return {filename:", "return {clip:", "console.log(signed)"):
   self.assertNotIn(bad,js)
if __name__=="__main__":unittest.main(verbosity=2)
