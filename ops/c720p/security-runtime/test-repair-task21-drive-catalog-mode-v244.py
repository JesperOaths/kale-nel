#!/usr/bin/env python3
import hashlib,importlib.util,os,stat
from pathlib import Path
import tempfile,unittest
from unittest.mock import patch
SRC=Path(__file__).with_name("repair-task21-drive-catalog-mode-v244.py")
spec=importlib.util.spec_from_file_location("task21_chmod_v244",SRC)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Cases(unittest.TestCase):
 def setUp(self):
  self.tmp=tempfile.TemporaryDirectory();self.root=Path(self.tmp.name)
  self.cat=self.root/"drive-security-archive.json"
  self.cat.write_bytes(b'{"items":[{"state":"verified"}]}')
  self.cat.chmod(0o664)
  self.lock=self.root/"drive-security-archive.lock";self.lock.write_text("")
  self.lock.chmod(0o600)
  self.p1=patch.object(m,"CAT",self.cat);self.p2=patch.object(m,"LOCK",self.lock)
  self.p1.start();self.p2.start()
 def tearDown(self):
  self.p2.stop();self.p1.stop();self.tmp.cleanup()
 def test_tighten_only_group_write_and_reverify_bytes(self):
  original=self.cat.read_bytes()
  m.repair()
  self.assertEqual(stat.S_IMODE(self.cat.stat().st_mode),0o644)
  self.assertEqual(self.cat.read_bytes(),original)
  m.repair()
  self.assertEqual(self.cat.read_bytes(),original)
 def test_symlink_and_writable_parent_refused_without_changes(self):
  alias=self.root/"alias";alias.symlink_to(self.cat)
  with patch.object(m,"CAT",alias),self.assertRaisesRegex(RuntimeError,"archive_path_untrusted"):
   m.repair()
  self.assertTrue(self.cat.stat().st_mode&stat.S_IWGRP)
  self.root.chmod(0o777)
  with self.assertRaisesRegex(RuntimeError,"archive_parent_untrusted"):
   m.repair()
  self.assertTrue(self.cat.stat().st_mode&stat.S_IWGRP)
 def test_no_other_archive_source_or_identity_modifications(self):
  code=SRC.read_text()
  for x in ("s9-manual-recording-links-v1.json",
    "s9-manual-recording-links-v1.audit.jsonl",
    "os.remove(", "shutil.rmtree(","CameraManager","adb install",
    "Files.delete","review_decision"):
   self.assertNotIn(x,code)
  self.assertIn("os.fchmod(fd,desired)",code)
  self.assertIn("sha(CAT)!=digest",code)
if __name__=="__main__":unittest.main(verbosity=2)
