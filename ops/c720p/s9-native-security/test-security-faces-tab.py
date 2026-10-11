#!/usr/bin/env python3
"""Verify the new Security tab does not replace or expose existing views."""
from pathlib import Path
import importlib.util
import re
import unittest

ROOT=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location("faces_nav",ROOT/"patch-security-faces-tab.py")
MOD=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MOD)

FIXTURE='''<!doctype html><html><body>
<nav><button data-tab="camera">Camera</button><button data-tab="saved">Saved</button><button data-tab="live">Live</button></nav>
<section class="panel" id="panel-camera"></section>
<section class="panel" id="panel-saved"><iframe id="s9SavedFolderFrame" data-src="/local/frontyard-security-new/clips.html"></iframe></section>
<section class="panel" id="panel-live"></section>
<script>function activate(t){if(t==='saved'){const f=$('#s9SavedFolderFrame');if(f&&!f.getAttribute('src'))f.src=f.dataset.src}}</script>
</body></html>'''

class Tests(unittest.TestCase):
 def test_fourth_tab_preserves_original_views(self):
  output=MOD.patch(FIXTURE)
  self.assertEqual(MOD.patch(output),output)
  for key in ('data-tab="camera"','data-tab="saved"','data-tab="live"','data-tab="faces"',
              'id="panel-saved"','id="panel-camera"','id="panel-live"',
              'id="panel-faces"','s9SavedFolderFrame','s9FacesGalleryFrame'):
   self.assertIn(key,output)
  self.assertEqual(output.count('data-tab="faces"'),2)
  self.assertIn('class="tab" data-tab="faces"',output)
  self.assertIn("tab.classList.add('active')",output)
  self.assertIn('queueMicrotask',output)
  self.assertNotIn('window.location.href=',output)
 def test_guard_against_unsupported_markup(self):
  for page in ('<body></body>','<body><button data-tab="saved"></button></body>',
               FIXTURE.replace('data-tab="saved"','data-tab="other"'),
               FIXTURE.replace('id="panel-saved"','id="panel-gone"')):
   with self.assertRaises(ValueError):MOD.patch(page)
 def test_face_gallery_asset_is_local_and_signed_only(self):
  source=(ROOT/'face-appearances.html.txt').read_text()
  for value in ('id="s9-faces-appearances-gallery-v1"','C720PSecureRelay',
                '/new/api/saved','/new/saved/face/','/new/saved/clip/',
                'data-kind="face"','data-kind="appearance"','data-kind="review"',
                'snapshot_name','anonymous_tracks','noindex,nofollow'):
   self.assertIn(value,source)
  self.assertNotIn('https://',source)
  self.assertNotIn('http://',source)
  self.assertNotIn('innerHTML=',source)
  scripts=re.findall(r'<script\\b([^>]*)>(.*?)</script>',source,re.S)
  self.assertEqual(len(scripts),2)
  inline=[body for attributes,body in scripts if not re.search(r'\\bsrc=',attributes)]
  local=[attributes for attributes,body in scripts if re.search(r'\\bsrc=',attributes)]
  self.assertEqual(len(inline),1)
  self.assertEqual(len(local),1)
  self.assertRegex(local[0],r'src="/local/security-video-playback[.]js[?]v=[A-Za-z0-9_-]+"')
  self.assertRegex(local[0],r'\\bdefer\\b')

if __name__=='__main__':unittest.main(verbosity=2)
