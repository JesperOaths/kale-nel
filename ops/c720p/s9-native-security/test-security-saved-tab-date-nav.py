#!/usr/bin/env python3
"""Saved tab microSD date folders vs historical Drive archived content."""
import importlib.util
import re
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
p=ROOT/'patch-security-saved-tab-date-nav.py'
spec=importlib.util.spec_from_file_location('s9_saved_tab',p)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Tests(unittest.TestCase):
 def fixture(self):
  return ('''<html><head></head><body><section class="panel" id="panel-saved"><iframe id="cameraSavedFrame" data-src="/local/c720p-drive-saved.html?camera=camera&v=SAVED_THUMB_UI_V115_20261007"></iframe></section>'''
          '''<script>function tab(t){if(t==='saved'){const f=$('#cameraSavedFrame');if(!f.getAttribute('src'))f.src=f.dataset.src}}</script></body></html>''')

 def test_idempotent_preserves_drive_and_replaces_activation(self):
  old=self.fixture();new=m.patch(old)
  self.assertNotEqual(new,old);self.assertEqual(m.patch(new),new)
  self.assertIn('s9SavedFolderFrame',new)
  self.assertIn('Historical Drive archive',new)
  self.assertIn('/local/c720p-drive-saved.html',new)
  self.assertIn('savedFolders=1',new)
  self.assertIn("if(t==='saved'){const f=$('#s9SavedFolderFrame')",new)
  self.assertIn('data-s9-saved="microSD"',new)
  self.assertIn('data-s9-saved="drive"',new)
  self.assertEqual(new.count(m.MARKER),1)

 def test_refuses_unrecognized_saved_tab_layout(self):
  with self.assertRaises(ValueError):m.patch('<body></body>')
  with self.assertRaises(ValueError):m.patch(self.fixture().replace('cameraSavedFrame','unsupported'))

 def test_scripts_are_valid_javascript(self):
  node=shutil.which('node')
  if not node:self.skipTest('Node unavailable')
  with tempfile.TemporaryDirectory() as td:
   js=Path(td)/'saved.js'
   parts=[m.JS.split('<script id="s9-saved-tab-folders-script-v1">',1)[1].split('</script>',1)[0]]
   self.assertEqual(len(parts),1)
   js.write_text(parts[0])
   r=subprocess.run([node,'--check',str(js)],capture_output=True,text=True,timeout=15)
   self.assertEqual(r.returncode,0,r.stderr)

if __name__=='__main__':
 unittest.main(verbosity=2)
