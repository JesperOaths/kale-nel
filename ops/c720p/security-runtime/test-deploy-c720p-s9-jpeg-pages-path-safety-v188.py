#!/usr/bin/env python3
"""Synthetic symlink and backup-path refusal, no live camera or user files."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
SRC=HERE/"deploy-c720p-s9-jpeg-pages-v187.py"
spec=importlib.util.spec_from_file_location("jpeg_v187_hardened",SRC)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Safety(unittest.TestCase):
 def test_apply_rejects_symlinked_lock_before_open_or_prepare(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp);outside=p/"target"
   outside.write_text("untouched")
   link=p/"lock"
   link.symlink_to(outside)
   with patch.object(m,"LOCK",link),patch.object(m,"prepare",
       side_effect=AssertionError("must not prepare")):
    with self.assertRaisesRegex(m.Refused,"unsafe_index_guard_lock"):
     m.apply()
   self.assertEqual(outside.read_text(),"untouched")
 def test_apply_rejects_symlinked_backup_before_chmod_or_install(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=Path(tmp)
   target=p/"secret-elsewhere";target.mkdir()
   backup=p/"backups";backup.symlink_to(target)
   lock=p/"lock"
   with patch.object(m,"LOCK",lock),patch.object(m,"BACKUPS",backup),patch.object(
    m,"prepare",return_value=({},{})),patch.object(m,"camera_ok",return_value=32.1),patch.object(
    m.os,"statvfs",return_value=SimpleNamespace(f_bavail=900000,f_frsize=4096)):
    with self.assertRaisesRegex(m.Refused,"unsafe_private_backup_directory"):
     m.apply()
   self.assertEqual(list(target.iterdir()),[])
   self.assertEqual(target.stat().st_mode&0o777,0o755)
 def test_idempotent_pins_still_guard_source(self):
  src=SRC.read_text()
  self.assertIn('"pinned_"+label+"_source_drift"',src)
  self.assertIn('"originals_deleted":False',src)
  self.assertIn('"save_delete_modified":False',src)
  self.assertIn('"reviews_modified":False',src)
  self.assertIn('"unsafe_private_backup_directory"',src)

if __name__=="__main__":unittest.main(verbosity=2)
