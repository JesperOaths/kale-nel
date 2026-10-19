#!/usr/bin/env python3
"""No-video-change tests for persistent C720P generator + S9 authenticated bridge."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent
SCRIPT=ROOT/"patch-c720p-legacy-index-s9-v1.py"
SPEC=importlib.util.spec_from_file_location("legacy_index",SCRIPT)
m=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(m)
JS=ROOT/"c720p-migrated-index-playback-v1.js"

def gen():
 return '''from pathlib import Path
ROOT=Path("/tmp/fake")
def write_html(events):
    # Legacy template src='{e['clip']}' is unchanged
    html = f"""<title>Camera Security</title><video src='clips/example.mp4'>"""
    (ROOT / 'index.html').write_text(html)
def save_index(events):
    write_html(events)
'''
def page():
 return "<title>Camera Security</title><video src='clips/example.mp4'></video><button onclick='saveClip(1)'>Save</button>"
class Tests(unittest.TestCase):
 def test_legacy_source_and_page_keep_save(self):
  with tempfile.TemporaryDirectory() as d:
   root=Path(d);source=root/"generator.py";index=root/"index.html";js=root/"c720p-migrated-index-playback-v1.js";backup=root/"backup"
   source.write_text(gen());index.write_text(page())
   with patch.object(m,"SOURCE",source),patch.object(m,"INDEX",index),\
        patch.object(m,"LIVE_JS",js),patch.object(m,"BACKUP",backup):
    before,old,new,newindex=m.apply(JS.read_bytes())
    self.assertEqual(source.read_bytes(),new)
    self.assertEqual(index.read_bytes(),newindex)
    self.assertIn(b"save_index",new)
    self.assertIn(b"saveClip(",newindex)
    self.assertIn(b"c720p-migrated-index-playback-v1.js",new)
    self.assertTrue(js.exists())
    self.assertEqual(len(list(backup.iterdir())),2)
 def test_duplicate_injection_and_source_drift_rejected(self):
  with self.assertRaises(ValueError):m.replacement(m.TITLE+m.INJECT)
  with self.assertRaises(ValueError):m.replacement("no title")
  self.assertIn("C720PSecureRelay",JS.read_text())
 def test_s9_bridge_fails_closed_and_keeps_old_controls(self):
  s=JS.read_text()
  for marker in ("not_s9_original_recordings","not_person_assignments",
                 "/new/api/c720p-migrated-clips","/new/saved/c720p-migrated/clip/",
                 "data.originalSrc","C720PSecureRelay","Security → Recordings"):
   if marker=="data.originalSrc":self.assertIn("dataset.originalSrc",s)
   else:self.assertIn(marker,s)
  for unsafe in ("fetch('http://","localStorage","eval(","innerHTML","/delete","/save?"):
   self.assertNotIn(unsafe,s)
 def test_no_video_or_review_delete(self):
  source=SCRIPT.read_text()
  for op in ("sudo ","os.system(","shutil.rmtree","adb ","ffmpeg","remove_originals"):
   self.assertNotIn(op,source)
  self.assertIn("source_restart_needed_for_persistence",source)
if __name__=="__main__":unittest.main(verbosity=2)
