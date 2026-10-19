#!/usr/bin/env python3
"""Synthetic read-only preflight safety checks. No camera or imported media."""
import ast
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SCRIPT=Path(__file__).with_name("preflight-c720p-jpeg-legacy-bridge-v183.py")
spec=importlib.util.spec_from_file_location("bridge183",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Tests(unittest.TestCase):
 def test_preview_source_has_no_mutation_calls(self):
  source=SCRIPT.read_text()
  tree=ast.parse(source)
  calls=[n.func.attr for n in ast.walk(tree) if isinstance(n,ast.Call)
         and isinstance(n.func,ast.Attribute)]
  for bad in ("unlink","rmtree","remove","replace","write_bytes","write_text",
              "chmod","Popen","restart","system","rename","mkdir"):
   self.assertNotIn(bad,calls)
  self.assertIn('"retirement_authorized":False',source)
  self.assertIn('"no_service_restarts":True',source)
  self.assertIn('private=True',source)
 def test_git_blob_known_fixture(self):
  data=b"hello world\n"
  self.assertEqual(m.gitblob(data),hashlib.sha1(
      b"blob 12\0"+data).hexdigest())
 def test_hash_drift_detected_and_symlink_rejected(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)/"source"
   p.write_bytes(b"A"*100);p.chmod(0o600)
   self.assertEqual(m.read(p,200,private=True),b"A"*100)
   p.chmod(0o644)
   with self.assertRaisesRegex(RuntimeError,"private_manifest_permission_drift"):
    m.read(p,200,private=True)
   alias=Path(tmp)/"alias"
   alias.symlink_to(p)
   with self.assertRaisesRegex(RuntimeError,"required_source_missing"):
    m.read(alias,200)
 def test_never_considers_a_manifest_sufficient_for_deletion(self):
  body=SCRIPT.read_text()
  self.assertNotIn("unlink()",body)
  self.assertIn('"retirement_authorized":False',body)
  self.assertIn('source.count(VID_TAG)!=1',body)
  self.assertIn('"snapshot_8795_8794_sha_proof_missing"',body)

if __name__=="__main__":unittest.main(verbosity=2)
