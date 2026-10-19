#!/usr/bin/env python3
"""Offline Save/Delete AST contract test. No camera or recording access."""
import ast
import importlib.util
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parent
SCRIPT=ROOT/"audit-c720p-legacy-save-delete-v168.py"
spec=importlib.util.spec_from_file_location("legacy_save_delete_v168",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def fixture(missing=False,remote=False):
 lines=[
  "def handle(parsed,events,keep,ROOT,refs):",
  "    if parsed.path == '/save':",
  "        for e in events:",
  "            e['saved'] = True",
  "        save_index(events)",
  "    if parsed.path == '/delete':",
  "        for rel in refs:",
  "            (ROOT / rel).unlink(" + ("missing_ok=True" if missing else "") + ")",
  "        save_index(keep,replace=True)",
 ]
 if remote:lines.append("        remote_delete()")
 return ("\n".join(lines)+"\n").encode()

class Tests(unittest.TestCase):
 def test_old_save_and_delete_block_retirement(self):
  d=m.summarize(fixture())
  self.assertTrue(d["save_marks_event_saved_true"])
  self.assertTrue(d["delete_unlinks_local_files"])
  self.assertTrue(d["save_persists_index_locally"])
  self.assertEqual(d["delete_unlink_calls"],1)
  self.assertFalse(d["delete_handles_missing_local_with_missing_ok"])
  self.assertFalse(d["delete_has_direct_remote_call"])
  self.assertFalse(d["remote_save_delete_compatibility_demonstrated"])
  self.assertTrue(d["local_originals_retention_required"])
 def test_reject_missing_or_rewritten_handler(self):
  for broken in (b"def other():pass",fixture().replace(b"/delete",b"/other"),
                 fixture().replace(b"e['saved'] = True",b"pass"),
                 fixture().replace(b"save_index(keep,replace=True)",b"pass"),
                 fixture()+fixture()):
   with self.subTest(size=len(broken)),self.assertRaises(RuntimeError):
    m.summarize(broken)
 def test_remote_call_distinguished_from_proven_compatibility(self):
  d=m.summarize(fixture(missing=True,remote=True))
  self.assertTrue(d["delete_has_direct_remote_call"])
  self.assertTrue(d["delete_handles_missing_local_with_missing_ok"])
  self.assertFalse(d["remote_save_delete_compatibility_demonstrated"])
 def test_no_local_mutations_are_executed_by_auditor(self):
  parsed=ast.parse(SCRIPT.read_text())
  calls=[n.func.attr for n in ast.walk(parsed) if isinstance(n,ast.Call)
   and isinstance(n.func,ast.Attribute)]
  for dangerous in ("unlink","rmtree","replace","write_bytes","write_text",
                    "mkdir","chmod","system","Popen","kill","terminate"):
   self.assertNotIn(dangerous,calls)
  self.assertNotIn("subprocess",SCRIPT.read_text())
  self.assertIn('"local_originals_retention_required":True',SCRIPT.read_text())
  self.assertIn('"no_save_or_delete_executed":True',SCRIPT.read_text())

if __name__=="__main__":unittest.main(verbosity=2)
