#!/usr/bin/env python3
"""Layout and event-loop contracts for S9+ Live panel scrolling and MJPEG."""
from pathlib import Path
import importlib.util
import unittest

HERE=Path(__file__).resolve().parent
SRC=HERE/'patch-security-live-scroll-fps.py'
spec=importlib.util.spec_from_file_location('live_scroll',SRC)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Tests(unittest.TestCase):
 def page(self):
  return ('<html><head><style>html,body{overflow:hidden}.view{overflow:hidden}'
   '.panel{display:none;position:absolute;inset:0}.livegrid{height:100%}'
   '.cam{overflow:hidden}.cam img{width:100%;height:100%}</style></head>'
   '<body><section id="panel-live" class="panel"><div class="c720p-s9-live-only">'
   '<div class="cam"><img id="cameraLive"><div id="cameraStatus"></div></div></div></section>'
   '<div id="s9SavedFolderFrame"></div>'
   '<script>/* S9_SECURITY_LIVE_V4_AUTHENTICATED_MJPEG_FETCH_FALLBACK */'
   'if(now-lastFrame>=650){s9ShowFetchedFrame(frame,gen)}</script></body></html>')
 def test_scroll_is_scope_only_and_idempotent(self):
  original=self.page();new=m.patch(original)
  self.assertEqual(m.patch(new),new)
  self.assertEqual(new.count(m.MARKER),1)
  self.assertIn('#panel-live.active{',new)
  self.assertIn('overflow-y:auto!important;',new)
  self.assertIn('touch-action:pan-y',new)
  self.assertIn('aspect-ratio:4/3!important;',new)
  self.assertIn('if(now-lastFrame>=240)',new)
  self.assertIn('s9SavedFolderFrame',new)
  self.assertNotIn('#panel-saved ',m.PATCH)
  self.assertNotIn('html,body{',m.PATCH)
  self.assertNotIn('.view{',m.PATCH)
 def test_rejects_modified_live_runtime(self):
  with self.assertRaises(ValueError):m.patch(self.page().replace('lastFrame>=650','lastFrame>=200'))
  with self.assertRaises(ValueError):m.patch(self.page().replace('cameraLive','cameraUnknown'))
  with self.assertRaises(ValueError):m.patch('<html><body></body></html>')

if __name__=='__main__':
 unittest.main(verbosity=2)
