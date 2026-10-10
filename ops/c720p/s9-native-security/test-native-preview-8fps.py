#!/usr/bin/env python3
"""S9+ 8-FPS preview guard: preserve 4K 30fps MP4 and garden phone GPU."""
import importlib.util
from pathlib import Path
import unittest

ROOT=Path(__file__).resolve().parent
FILE=ROOT/'src/nl/kalenel/s9security/CameraService.java'
PATCH=ROOT/'patch-security-live-8fps-display.py'
spec=importlib.util.spec_from_file_location('fps8',PATCH)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class Tests(unittest.TestCase):
 def test_preview_fast_without_4k_quality_change(self):
  s=FILE.read_text()
  for contract in [
   'jpegEvery="recording".equals(mode)?250L:120L',
   'PreviewJpeg.encode(copied,58)',
   'PreviewJpeg.snapshot(frame)',
   'jpegEncoder.execute(new Runnable()',
   'jpegEncoder.shutdownNow()',
   'Thread.sleep(75)',
   'preview_jpeg_interval_ms","recording".equals(mode)?250:120',
   'recorder.setVideoSize(3840,2160)',
   'recorder.setVideoFrameRate(30)',
   'recorder.setVideoEncodingBitRate(36000000)',
   'PhoneMediaRange.handle',
   'garden_roi_gpu_person_gate_v1',
   'lastFrameAt<cooldownUntil',
   'garden_person_gate_checked',
  ]:self.assertIn(contract,s)
  self.assertNotIn('Thread.sleep(950)',s)
  self.assertNotIn('lastJpegAt>=1200',s)
 def test_live_html_patch_is_scoped_and_idempotent(self):
  html=('<html><head></head><body>'
   '<div id="cameraLive"></div>'
   '<!-- s9-live-scroll-and-frame-fps-v1 -->'
   '<script>/* S9_SECURITY_LIVE_V4_AUTHENTICATED_MJPEG_FETCH_FALLBACK */'
   'if(now-lastFrame>=240){s9ShowFetchedFrame(frame,gen)}</script>'
   '<div id="s9SavedFolderFrame"></div></body></html>')
  updated=mod.patch(html)
  self.assertEqual(mod.patch(updated),updated)
  self.assertEqual(updated.count(mod.MARKER),1)
  self.assertIn(mod.NEW,updated)
  self.assertNotIn(mod.OLD,updated)
  self.assertIn('s9SavedFolderFrame',updated)
  with self.assertRaises(ValueError):mod.patch(html.replace(mod.OLD,'if(now-lastFrame>=42)'))

if __name__=='__main__':
 unittest.main(verbosity=2)
