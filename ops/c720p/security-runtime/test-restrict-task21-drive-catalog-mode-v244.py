#!/usr/bin/env python3
"""Temporary-only permission tests; no real personal or media state."""
from pathlib import Path
import importlib.util
import os
import stat
import tempfile
import unittest
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
PATH=HERE/"restrict-task21-drive-catalog-mode-v244.py"
spec=importlib.util.spec_from_file_location("task21_restrict_v244",PATH)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def setup(self,d,mode=0o664):
  file=d/"drive-security-archive.json";file.write_bytes(b'{"items":[]}')
  file.chmod(mode)
  lock=d/".task21-drive-catalog-mode-v244.lock"
  return file,lock
 def test_group_write_stripped_same_inode_no_content_change(self):
  with tempfile.TemporaryDirectory() as path:
   d=Path(path);f,l=self.setup(d)
   before=f.read_bytes();inode=f.stat().st_ino
   with patch.object(m,"FILE",f),patch.object(m,"LOCK",l):
    m.apply()
   self.assertEqual(f.read_bytes(),before)
   self.assertEqual(f.stat().st_ino,inode)
   self.assertEqual(stat.S_IMODE(f.stat().st_mode),0o644)
   self.assertFalse(f.stat().st_mode&0o020)
 def test_existing_safe_0644_must_not_modify(self):
  with tempfile.TemporaryDirectory() as path:
   d=Path(path);f,l=self.setup(d,0o644)
   with patch.object(m,"FILE",f),patch.object(m,"LOCK",l),self.assertRaisesRegex(RuntimeError,"catalog_already_or_unexpectedly_fixed"):
    m.apply()
   self.assertEqual(stat.S_IMODE(f.stat().st_mode),0o644)
 def test_symlink_target_refusal(self):
  with tempfile.TemporaryDirectory() as path:
   d=Path(path);f,l=self.setup(d);alias=d/"alias"
   alias.symlink_to(f)
   with patch.object(m,"FILE",alias),patch.object(m,"LOCK",l),self.assertRaisesRegex(RuntimeError,"catalog_or_lock_symlink"):
    m.apply()
   self.assertEqual(stat.S_IMODE(f.stat().st_mode),0o664)
 def test_unexpected_permissive_mode_refusal(self):
  with tempfile.TemporaryDirectory() as path:
   d=Path(path);f,l=self.setup(d,0o666)
   with patch.object(m,"FILE",f),patch.object(m,"LOCK",l),self.assertRaisesRegex(RuntimeError,"catalog_owner_or_world_permission_drift"):
    m.apply()
   self.assertEqual(stat.S_IMODE(f.stat().st_mode),0o666)
 def test_no_media_review_or_permissions_relaxation_paths(self):
  source=PATH.read_text()
  for forbidden in ("unlink(", "rmtree(", "write_text(", "write_bytes(",
      "Camera2", "pm install", "source_media", "manual_recording_links",
      "os.chmod(FILE","os.replace("):
   self.assertNotIn(forbidden,source)
  self.assertIn("os.fchmod(fd,stat.S_IMODE(before.st_mode)&~stat.S_IWGRP)",source)
if __name__=="__main__":unittest.main(verbosity=2)
