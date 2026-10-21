#!/usr/bin/env python3
"""Synthetic shape checks only; no live Drive, media or review records."""
import importlib.util
import tempfile
from pathlib import Path
import unittest
from unittest.mock import patch
SCRIPT=Path(__file__).with_name("audit-task21-drive-config-shape-v255.py")
spec=importlib.util.spec_from_file_location("v255",SCRIPT)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Test(unittest.TestCase):
 def test_good_shape_and_safe_aggregates(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/"config.json"
   p.write_text('{"folders":{"new":{"id":"trusted123"}},"remote":"drive","rclone":"/usr/bin/rclone","rclone_config":"/does/not/exist"}')
   p.chmod(0o600)
   out=m.inspect(p)
   self.assertFalse(out["schema_refuses"])
   self.assertFalse(out["rclone_config_file_exists"])
   self.assertEqual(out["original_bytes_read"],0)
   self.assertEqual(out["manual_decisions_modified"],0)
   self.assertIn("binary_root_owned",out)
   self.assertIn("binary_named_usr_local_bin",out)
   self.assertIn("usr_bin_independent_system_binary_trusted_metadata",out)
   self.assertIn("usr_local_bin_independent_system_binary_trusted_metadata",out)
   self.assertNotIn("trusted123",str(out))
 def test_bad_remote_and_binary_do_not_leak(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/"config.json"
   p.write_text('{"folders":{"new":{"id":"secret-folder"}},"remote":"drive:unsafe","rclone":"/tmp/untrusted","rclone_config":"/private/key"}')
   p.chmod(0o600)
   r=m.inspect(p)
   self.assertTrue(r["schema_refuses"])
   self.assertFalse(r["remote_valid"])
   self.assertFalse(r["rclone_binary_valid"])
   self.assertNotIn("/private/key",str(r))
 def test_refuse_symlink_and_group_write(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/"config.json";p.write_text("{}");p.chmod(0o664)
   with self.assertRaisesRegex(RuntimeError,"trusted_config_metadata_refused"):m.inspect(p)
   alias=Path(td)/"link";alias.symlink_to(p)
   with self.assertRaisesRegex(RuntimeError,"trusted_config_unavailable"):m.inspect(alias)
 def test_never_emit_secrets(self):
  s=SCRIPT.read_text()
  for prohibited in ("print(doc)","print(raw)","print(conf)","print(remote)","unlink(","write_text(","write_bytes(","chmod("):
   self.assertNotIn(prohibited,s)
if __name__=="__main__":unittest.main(verbosity=2)
