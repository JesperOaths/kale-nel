#!/usr/bin/env python3
"""Offline safety regressions for the guarded disk reclaim."""
import importlib.util
import tempfile
import unittest
from pathlib import Path

SRC=Path(__file__).with_name("reclaim-audited-disposable-20261014.py")
spec=importlib.util.spec_from_file_location("disk_guard",SRC)
mod=importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

class GuardedReclaim(unittest.TestCase):
 def test_targets_are_exact_and_inside_staging_roots(self):
  self.assertEqual(len(mod.DIRECTORIES),len(set(mod.DIRECTORIES)))
  for p in (*mod.DIRECTORIES,*mod.FILES):
   self.assertIn(p.parent,mod.EXPECTED_PARENTS)
   self.assertNotIn("backups",str(p))
   self.assertNotIn("Security4K",str(p))
   self.assertNotIn("/opt/homeassistant",str(p))
   self.assertNotIn("frontyard-security-new",str(p))
 def test_non_allowlisted_rejected(self):
  self.assertFalse(mod.allowed(Path("/var/lib/docker"),mod.DIRECTORIES))
  self.assertFalse(mod.allowed(Path("/tmp/anything-else"),mod.FILES))
 def test_symlink_not_followed_when_sizing(self):
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/"demo";p.mkdir()
   (p/"sample").write_bytes(b"abc")
   (p/"link").symlink_to("/etc/passwd")
   size,_=mod.size_and_newest(p)
   self.assertLess(size,1048576)
 def test_apply_is_opt_in_and_capped(self):
  s=SRC.read_text()
  self.assertIn('p.add_argument("--apply",action="store_true")',s)
  self.assertIn('MAX_TOTAL = 800 * 1024 * 1024',s)
  self.assertIn('double=audit(path,min_hours,max_mb,process_paths())',s)
  self.assertIn('report["phone_after"]=health()',s)
  self.assertNotIn("docker system prune",s)
if __name__=="__main__":unittest.main(verbosity=2)
