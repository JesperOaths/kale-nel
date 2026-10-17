#!/usr/bin/env python3
"""Offline recorded-player install and immutable MP4 safety regression."""
from pathlib import Path
import importlib.util,unittest
ROOT=Path(__file__).resolve().parent
INSTALL=ROOT/"deploy-s9-recording-night-view-v1.py"
SOURCE=ROOT/"s9-recording-night-view-v1.js"
spec=importlib.util.spec_from_file_location("recorded_night",INSTALL)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
PAGE='<html><body><script src="/local/c720p-secure-relay-client.js"></script><script src="/local/security-video-playback.js"></script><main class="stage"><div class="frame"><video id="player" controls></video></div></main></body></html>'
class RecordedNightInstallTests(unittest.TestCase):
 def test_insertion_is_idempotent_and_does_not_duplicate_player(self):
  updated=mod.patch(PAGE,"a"*40)
  self.assertEqual(updated.count('id="player"'),1)
  self.assertEqual(updated.count('id="s9-recording-night-script-v1"'),1)
  self.assertIn('s9-recording-night-view-v1.js?v=aaaaaaaaaaaa',updated)
  self.assertEqual(mod.patch(updated,"a"*40),updated)
 def test_unrecognized_page_rejected(self):
  for s in (PAGE.replace('id="player"','id="other"'),PAGE.replace("/local/security-video-playback.js","/broken-player.js"),PAGE.replace('id="player"','id="player" id="player"')):
   with self.assertRaises(RuntimeError):mod.patch(s,"b"*40)
 def test_recorded_originals_and_security_unmodified(self):
  s=INSTALL.read_text();js=SOURCE.read_text()
  self.assertIn("S9_RECORDED_NIGHT_VIEW_V1_VERIFIED",s)
  self.assertIn("S9_RECORDED_NIGHT_VIEW_V1_ROLLBACK_ATTEMPTED",s)
  self.assertIn("evidence_mutations",s)
  self.assertIn("sha(new_js)!=v.js_sha",s)
  self.assertIn("player.style.filter",js)
  self.assertIn("loadedmetadata",js)
  self.assertIn("select.value='original'",js)
  for bad in ("adb install","force-stop","open('/storage/","shutil.rmtree("):
   self.assertNotIn(bad,s)
  for bad in ("fetch(","XMLHttpRequest","MediaRecorder","canvas.toDataURL","video.src=","player.src=","localStorage","document.cookie"):
   self.assertNotIn(bad,js)
if __name__=="__main__":unittest.main(verbosity=2)
