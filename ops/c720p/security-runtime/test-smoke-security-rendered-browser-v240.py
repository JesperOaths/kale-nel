#!/usr/bin/env python3
"""No device: verify real rendered browser test refuses unsound evidence."""
import importlib.util
from pathlib import Path
import unittest

SRC=Path(__file__).with_name("smoke-security-rendered-system-playback-v240.py")
sp=importlib.util.spec_from_file_location("browser_acceptance_task240",SRC)
m=importlib.util.module_from_spec(sp);sp.loader.exec_module(m)

def good():
 return {"ok":True,"health_sections":3,"rendered_live":True,
  "warnings_reflect_unavailable":True,"receipt_ages_rendered":True,
  "controls_panel_visible":True,"hidden_health_requests":0,
  "live_panel_returned":True,"playback_stream_http":206,
  "bounded_range_bytes":1024,"play_pause_seek_replay":True,
  "six_migrated_manifest_entries":6,"all_six_decoded_claimed":False,
  "security_save_delete_invoked":False,"person_filing_invoked":False,
  "private_clip_names_returned":False,"signed_urls_returned":False,
  "media_modified":False,"rendered_video_frames":42,
  "video_width":1920,"video_height":1080}

class Test(unittest.TestCase):
 def test_actual_browser_metrics_have_to_pass(self):
  report=m.validate(good())
  self.assertTrue(report["one_video_play_pause_seek_verified"])
  self.assertTrue(report["client_cache_refresh_across_release_not_tested"])
  self.assertFalse(report["video_file_or_url_disclosed"])
  for k,v in [("hidden_health_requests",1),("bounded_range_bytes",0),
      ("rendered_video_frames",0),("play_pause_seek_replay",False),
      ("receipt_ages_rendered",False),
      ("warnings_reflect_unavailable",False),
      ("all_six_decoded_claimed",True),
      ("person_filing_invoked",True),
      ("playback_stream_http",200)]:
   with self.subTest(k=k),self.assertRaisesRegex(
           RuntimeError,"security_browser_v240_metrics"):
    m.validate({**good(),k:v})
 def test_source_is_read_only_and_runs_actual_video_element(self):
  js=m.js()
  self.assertIn("video.requestVideoFrameCallback(frame)",js)
  self.assertIn("video.currentTime=target",js)
  self.assertIn("await timeout(video.play(),5500)",js)
  self.assertIn("await timeout(video.play(),4500)",js)
  self.assertIn("facesButton.click()",js)
  self.assertIn("await wait(16400)",js)
  self.assertIn("document.getElementById('security-component-health-live')",js)
  self.assertIn("relay.fetch('/new/api/security-component-health'",js)
  self.assertIn("headers:{Range:'bytes=0-1023'}",js)
  self.assertIn("video.removeAttribute('src');video.load();video.remove()",js)
  for banned in ["saveClip(","deleteClip(","approve(","review_decision_update",
      "manual-original-review-links-v1","/new/api/s9-manual-recording-links",
      "window.localStorage.setItem(","navigator.mediaDevices","am force-stop",
      "adb install","getUserMedia("]:
   self.assertNotIn(banned,js)
  self.assertIn("client_cache_refresh_across_release_not_tested",SRC.read_text())
if __name__=="__main__":unittest.main(verbosity=2)
