#!/usr/bin/env python3
"""Prove v151 never executes the timing writer or reads video bytes."""
import ast
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
S=HERE/"audit-s9-true-joint-timing-v151.py"
spec=importlib.util.spec_from_file_location("joint151",S)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class ReadOnly(unittest.TestCase):
 def test_source_does_not_write_or_start_recording(self):
  src=S.read_text()
  tree=ast.parse(src)
  calls=[]
  for n in ast.walk(tree):
   if isinstance(n,ast.Call) and isinstance(n.func,ast.Attribute):
    calls.append(n.func.attr)
  for banned in ("atomic","write_text","write_bytes","unlink","replace",
    "Popen","kill","terminate","remove","rmtree"):
   self.assertNotIn(banned,calls)
  for banned in ("--copy","--delete","pm install","adb push","video.play("):
   self.assertNotIn(banned,src)
  self.assertIn('mod.assess(catalog,after_rollout_ms=cutoff)',src)
  self.assertNotIn('mod.main()',src)
 def test_private_schema_and_symlink_rejection(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/"test.json"
   p.write_text('{"ok": true}')
   p.chmod(0o600)
   with self.assertRaisesRegex(RuntimeError,"untrusted_private_timing_state"):
    m.read(p,100000)
   p.write_text('{"ok": true, "some_data": "long_enough_to_pass_minimum"}'+" "*150)
   self.assertTrue(m.read(p,100000)["ok"])
   link=Path(td)/"link"
   link.symlink_to(p)
   with self.assertRaisesRegex(RuntimeError,"missing_or_unsafe_private_timing_state"):
    m.read(link,100000)

if __name__=="__main__":unittest.main(verbosity=2)
