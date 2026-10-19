#!/usr/bin/env python3
"""Synthetic source-only test. No real hub, clips, person files or network."""
import ast
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE=Path(__file__).resolve().parent/"audit-c720p-jpeg-generator-drift-v189.py"
spec=importlib.util.spec_from_file_location("c720p_jpeg_v189",SOURCE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def sample(generator_jpeg="",index_jpeg="",clips_jpeg="",watchdog_jpeg=""):
 return {
  "generator":("def write_html(events):\n  pass\n"
      "if parsed.path == '/save':\n  pass\n"
      "if parsed.path == '/delete':\n  pass\n"+m.VIDEO_TAG+generator_jpeg).encode(),
  "watchdog":("EXPECTED_BRIDGE_SHA256=\n"
      "os.replace(tmp,INDEX)\n"+watchdog_jpeg).encode(),
  "index":("<html>"+m.VIDEO_TAG+index_jpeg+
      "<button onclick='saveClip(2)'>Save</button>clips/a.mp4</html>").encode(),
  "clips":("Save some clips "+clips_jpeg).encode(),
  "video_js":b"C720PSecureRelay video",
  "jpeg_js":b"C720PSecureRelay MutationObserver image"
 }

class Safety(unittest.TestCase):
 def test_generator_only_drift_is_distinct_from_partial_install(self):
  d=sample()
  approved={k:hashlib.sha256(v).hexdigest() for k,v in d.items()}
  approved["generator"]="0"*64
  with patch.object(m,"EXPECTED",approved):
   report=m.classify(d)
   self.assertEqual(report["source_state"],"generator_only_drift")
   self.assertFalse(report["physical_apply_allowed_by_this_audit"])
   self.assertTrue(report["local_originals_retained"])
   altered=sample(generator_jpeg=m.JPEG_TAG)
   self.assertEqual(m.classify(altered)["source_state"],"partial_or_concurrent_integration")
 def test_fully_integrated_or_duplicate_marker(self):
  d=sample(m.JPEG_TAG,m.JPEG_TAG,m.CLIPS_TAG,
   'EXPECTED_SNAPSHOT_GIT_BLOB="abc"\n')
  with patch.object(m,"EXPECTED",{}):
   self.assertEqual(m.classify(d)["source_state"],"already_fully_integrated")
   corrupt=dict(d);corrupt["clips"]+=m.CLIPS_TAG.encode()
   self.assertEqual(m.classify(corrupt)["source_state"],"duplicate_bridge_markers")
 def test_only_read_methods_and_no_private_values_emitted(self):
  tree=ast.parse(SOURCE.read_text())
  called=[n.func.attr for n in ast.walk(tree) if isinstance(n,ast.Call)
          and isinstance(n.func,ast.Attribute)]
  for op in ("write_text","write_bytes","unlink","rmtree","replace",
    "chmod","mkdir","Popen","kill","system","restart","remove"):
   self.assertNotIn(op,called)
  src=SOURCE.read_text()
  self.assertIn('"physical_apply_allowed_by_this_audit":False',src)
  self.assertIn('"local_originals_retained":True',src)
 def test_symlink_source_rejected(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/"data";p.write_bytes(b"test"*55)
   link=Path(td)/"alias";link.symlink_to(p)
   with self.assertRaisesRegex(RuntimeError,"unsafe_file"):
    m.read(link)

if __name__=="__main__":unittest.main(verbosity=2)
