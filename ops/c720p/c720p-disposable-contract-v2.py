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
 def test_never_claim_another_filesystem_as_root_reclaim(self):
  root_dev=Path("/").stat().st_dev
  self.assertTrue(mod.same_root_filesystem(Path("/"),root_dev))
  self.assertFalse(mod.same_root_filesystem(Path("/"),root_dev+1))
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/"candidate";p.mkdir()
   self.assertFalse(mod.same_root_filesystem(p,p.stat().st_dev+1))
   self.assertTrue(mod.same_root_filesystem(p,p.stat().st_dev))
   link=Path(d)/"symlink"
   link.symlink_to(p,target_is_directory=True)
   self.assertFalse(mod.same_root_filesystem(link,p.stat().st_dev))
  # Source must invoke the mount guard in *actual* deletion admission.
  original=SRC.read_text()
  self.assertIn("if not same_root_filesystem(path):return False",original)
  self.assertIn("if not allowed(path, DIRECTORIES",original)

 def test_cross_filesystem_cleanup_is_rejected(self):
  with tempfile.TemporaryDirectory() as temp:
   candidate=Path(temp)/"transient-build"
   candidate.mkdir()
   local_device=candidate.stat().st_dev
   self.assertTrue(mod.same_root_filesystem(candidate,local_device))
   self.assertFalse(mod.same_root_filesystem(candidate,local_device+1))
   self.assertFalse(mod.same_root_filesystem(Path(temp)/"missing",local_device))
   outside=Path(temp)/"link"
   outside.symlink_to(candidate,target_is_directory=True)
   self.assertFalse(mod.same_root_filesystem(outside,local_device))
 def test_root_only_policy_cannot_target_protected_origins(self):
  source=SRC.read_text()
  self.assertIn("if not same_root_filesystem(path):return False",source)
  self.assertIn("original.st_dev==root_device",source)
  for forbidden in ("os.system(","sudo -S","docker system prune","/opt/homeassistant/config/www/frontyard-security-new/clips"):
   self.assertNotIn(forbidden,source)
 def test_apply_is_opt_in_and_capped(self):
  s=SRC.read_text()
  self.assertIn('p.add_argument("--apply",action="store_true")',s)
  self.assertIn('MAX_TOTAL = 800 * 1024 * 1024',s)
  self.assertIn('double=audit(path,min_hours,max_mb,process_paths())',s)
  self.assertIn('report["phone_after"]=health()',s)
  self.assertNotIn("docker system prune",s)
if __name__=="__main__":unittest.main(verbosity=2)
