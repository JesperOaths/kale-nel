#!/usr/bin/env python3
"""Contracts for the non-destructive compact saved/live Security layout."""
import importlib.util
from pathlib import Path
import unittest

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('compact_layout',HERE/'patch-security-compact-layout.py')
compact=importlib.util.module_from_spec(spec)
spec.loader.exec_module(compact)

class LayoutTests(unittest.TestCase):
 def saved(self):
  return ('<html><head><title>Clips</title></head><body>'
   '<script src="/local/c720p-secure-relay-client.js"></script>'
   '<video id="player" controls></video><div id="list"></div>'
   '<script id="s9-video-orientation-script-v1"></script>'
   '<script id="s9-saved-virtual-folders-script-v1"></script></body></html>')
 def live(self):
  return ('<html><head></head><body><section id="panel-live">'
   '<div class="c720p-s9-live-only"><div class="cam">'
   '<img id="cameraLive"></div></div></section>'
   '<section id="panel-saved">Keep Drive</section></body></html>')
 def test_saved_side_by_side_and_existing_video_preserved(self):
  old=self.saved()
  new=compact.patch(old,'saved')
  self.assertEqual(compact.patch(new,'saved'),new)
  self.assertIn('grid-template-columns:minmax(290px,370px) minmax(0,1fr)',new)
  self.assertIn("const player=video.closest('.s9-rotation-shell')||video;",new)
  self.assertIn('right.append(list)',new)
  self.assertIn('left.append(player)',new)
  self.assertIn('video.closest(\'dialog\')',new)
  self.assertEqual(new.count('<video id="player" controls></video>'),1)
  self.assertIn('overflow-y:auto',new)
 def test_live_fits_viewport_without_touching_archive_or_encoding(self):
  original=self.live();after=compact.patch(original,'live')
  self.assertEqual(after,compact.patch(after,'live'))
  self.assertIn('70dvh',after)
  self.assertIn('object-fit:contain!important',after)
  self.assertIn('<section id="panel-saved">Keep Drive</section>',after)
  self.assertNotIn('MediaRecorder',after)
 def test_unknown_shapes_fail_closed(self):
  with self.assertRaises(ValueError):compact.patch(self.saved().replace('id="list"','id="lost"'),'saved')
  with self.assertRaises(ValueError):compact.patch(self.live().replace('id="cameraLive"','id="lost"'),'live')
 def test_single_level_day_and_same_original_4k_player(self):
  gallery=(HERE/'patch-security-date-category-folders.py').read_text()
  self.assertIn("button.className" if False else "tag('button','s9-v4-date')",gallery)
  self.assertIn('s9-v4-date-dots',gallery)
  self.assertIn('s9-v4-legend',gallery)
  self.assertIn("root.classList.add('s9-curated-ready')",gallery)
  self.assertNotIn("folder.append(tag('summary'",gallery)
  orientation=(HERE/'patch-s9-saved-video-orientation.py').read_text()
  self.assertIn('(window.innerHeight||800)*.42,220',orientation)

if __name__=='__main__':
 unittest.main(verbosity=2)
