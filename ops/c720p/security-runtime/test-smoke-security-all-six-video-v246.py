#!/usr/bin/env python3
import ast,importlib.util
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parent
FILE=ROOT/"smoke-security-all-six-video-v246.py"
spec=importlib.util.spec_from_file_location("browser_six_v246",FILE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Safety(unittest.TestCase):
 def test_six_real_rendered_videos_not_only_manifest(self):
  value={"ok":True,"actual_decoded_video_count":6,
    "authenticated_bounded_range_count":6,"pause_seek_replay_count":6,
    "decoded_frame_callbacks_total":34,"min_width":1920,"min_height":1080,
    "simultaneous_media_elements_max":1,
    "original_c720p_media_unchanged":True,"original_reviews_unchanged":True,
    "clip_names_not_returned":True,"signed_urls_not_returned":True,
    "local_fallback_not_removed":True}
  self.assertEqual(m.validate(value)["actual_migrated_mp4s_play_pause_seek_decoded"],6)
  for key,val in (("actual_decoded_video_count",5),
    ("authenticated_bounded_range_count",5),("pause_seek_replay_count",5),
    ("decoded_frame_callbacks_total",17),("min_width",0),
    ("original_c720p_media_unchanged",False),("signed_urls_not_returned",False)):
   with self.subTest(key=key),self.assertRaises(RuntimeError):
    m.validate({**value,key:val})
 def test_bounded_readonly_client(self):
  js=m.js()
  for expected in ("Range:'bytes=0-1023'","v.requestVideoFrameCallback",
    "v.pause();v.removeAttribute('src');v.load();v.remove()",
    "return {ok:completed===6&&rangeOK===6&&seeks===6",
    "local_fallback_not_removed:true"):
   self.assertIn(expected,js)
  for bad in ("saveClip(","deleteClip(","/new/api/s9-manual-recording-links",
     "getUserMedia(","/new/api/people?","window.localStorage.setItem("):
   self.assertNotIn(bad,js)
  calls=[n.func.attr for n in ast.walk(ast.parse(FILE.read_text()))
    if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute)]
  for bad in ("unlink","write_bytes","write_text","chmod","Popen","system","restart"):
   self.assertNotIn(bad,calls)
if __name__=="__main__":unittest.main(verbosity=2)
