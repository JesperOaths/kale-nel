#!/usr/bin/env python3
"""No-hub regression: only synthetic HTML, no real Save/index or media."""
import ast
import importlib.util
from pathlib import Path
import tempfile
import unittest

SOURCE=Path(__file__).with_name("audit-c720p-jpeg-index-regen-v191.py")
spec=importlib.util.spec_from_file_location("dual_index_v191",SOURCE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class FakeGuard:
 ANCHOR="<title>Camera Security</title>"
 def new_html(self,old):
  source=old.decode()
  if source.count(m.V)>1 or source.count(m.J)>1:
   raise ValueError("duplicate")
  result=source
  if m.V not in result:result=result.replace(self.ANCHOR,self.ANCHOR+m.V,1)
  if m.J not in result:result=result.replace(self.ANCHOR,self.ANCHOR+m.J,1)
  return None if result==source else result.encode()

class Safety(unittest.TestCase):
 def test_synthetic_dual_bridge_restore(self):
  report=m.exercise(FakeGuard())
  self.assertTrue(report["both_missing_restored"])
  self.assertTrue(report["video_only_restored"])
  self.assertTrue(report["jpeg_only_restored"])
  self.assertTrue(report["idempotent_with_both_present"])
  self.assertTrue(report["old_save_control_preserved"])
 def test_unknown_live_content_is_not_written_by_diagnostic(self):
  source=SOURCE.read_text()
  tree=ast.parse(source)
  invoked=[node.func.attr for node in ast.walk(tree) if
           isinstance(node,ast.Call) and isinstance(node.func,ast.Attribute)]
  for forbidden in ("write_bytes","write_text","unlink","rmtree",
                    "remove","Popen","chmod","mkdir","system","restart"):
   self.assertNotIn(forbidden,invoked)
  self.assertNotIn("module.apply()",source)
  self.assertNotIn("os.replace(",source)
  self.assertIn('"no_index_regenerated":True',source)
  self.assertIn('"originals_retained":True',source)
 def test_private_symlink_source_rejected(self):
  with tempfile.TemporaryDirectory() as td:
   root=Path(td);p=root/"source";p.write_bytes(b"U"*150)
   link=root/"link";link.symlink_to(p)
   with self.assertRaisesRegex(RuntimeError,"source_absent_or_symlink"):
    m.read(link,500)

if __name__=="__main__":unittest.main(verbosity=2)
