#!/usr/bin/env python3
"""Source-only C720P legacy player migration safety checks."""
import importlib.util
from pathlib import Path
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/"patch-c720p-legacy-s9-migrated-player-v1.py"
s=importlib.util.spec_from_file_location("legacy",SOURCE)
m=importlib.util.module_from_spec(s);s.loader.exec_module(m)

def fixture():
 return ("<script> async function prepareBlob(play){ function releaseBlob(){} "
         "async function playPhone(rec){} function deleteClip(){} "
         "const eventsUrl='events.json'; const label='Save'; "
         +m.ANCHOR+" const report={"+m.VERSION_ANCHOR+"}; } </script>")
class Test(unittest.TestCase):
 def test_remapping_uses_verified_relay_with_stable_selection(self):
  updated=m.patch(fixture())
  self.assertIn("String(current.clip)!==requestClip",updated)
  self.assertIn("String(current.clip_no)!==requestClipNo",updated)
  self.assertNotIn("requestGeneration",updated)
  self.assertNotIn("!==generation",updated)
  self.assertIn("const relay=window.C720PSecureRelay",updated)
  self.assertIn("window.parent.C720PSecureRelay",updated)
  self.assertIn("await relay.fetch(",updated)
  self.assertIn("await relay.url(",updated)
  self.assertIn("/new/saved/c720p-migrated/clip/",updated)
  self.assertIn("mode:\'range-local\',src:url",updated)
  self.assertNotIn("rangeOrigin",updated)
  self.assertIn("url=BASE+path",updated)
 def test_source_drift_and_duplicate_patch_fail_closed(self):
  with self.assertRaises(ValueError):m.patch("<script></script>")
  with self.assertRaises(ValueError):m.patch(m.patch(fixture()))
 def test_no_original_or_review_writes(self):
  src=SOURCE.read_text()
  for danger in ("shutil.rmtree(","adb push","os.remove(","sudo ","ffmpeg"):
   self.assertNotIn(danger,src)
  self.assertIn("legacy_local_backup",src)
if __name__=="__main__":unittest.main(verbosity=2)
