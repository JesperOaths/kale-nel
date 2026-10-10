"""Safe C720P storage helpers: local fixtures only, no device or disk mutation."""
import importlib.util,pathlib,tempfile,time,unittest
from unittest.mock import patch
ROOT=pathlib.Path(__file__).resolve().parents[1]
def load(name,alias):
 spec=importlib.util.spec_from_file_location(alias,ROOT/name)
 mod=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(mod)
 return mod
cache=load("reclaim-safe-cache-20261010.py","cache_reclaim")
copy=load("stage-c720p-clips-on-s9-microsd-20261010.py","s9_sd_copy")
class StorageSafety(unittest.TestCase):
 def test_cleanup_is_exact_allowlist(self):
  self.assertFalse(cache.guard(pathlib.Path("/opt/homeassistant/config/configuration.yaml")))
  self.assertFalse(cache.guard(pathlib.Path("/home/jespern/c720p-home-hub/state")))
  self.assertFalse(cache.guard(pathlib.Path("/opt/homeassistant/config/www/frontyard-security-new/clips")))
 def test_no_symlink_traversal_and_index_only(self):
  with tempfile.TemporaryDirectory() as d:
   root=pathlib.Path(d); clips=root/"clips";clips.mkdir()
   now=time.time()-600
   good=clips/"motion_1735555555555.mp4"
   good.write_bytes(b"a"*12000)
   old=now
   import os
   os.utime(good,(old,old))
   outside=root/"outside.mp4";outside.write_bytes(b"b"*13000)
   malicious=clips/"trick.mp4";malicious.symlink_to(outside)
   recent=clips/"recent.mp4";recent.write_bytes(b"c"*12000)
   (root/"events.json").write_text(
     '[{"clip":"motion_1735555555555.mp4"},{"clip":"trick.mp4"},'
     '{"clip":"recent.mp4"},{"clip":"../../outside.mp4"}]',encoding="utf8")
   with patch.object(copy,"EVENTS",root/"events.json"),patch.object(copy,"CLIPS",clips):
    paths=copy.indexed()
   self.assertEqual(paths,[good])
 def test_filename_restrictions(self):
  self.assertIsNotNone(copy.NAME.fullmatch("motion_1735555555555.mp4"))
  for bad in ("../abc.mp4","abc.mp4;touch /tmp/x","abc.mkv","/etc/passwd"):
   self.assertIsNone(copy.NAME.fullmatch(bad))
 def test_transfer_requires_reserve(self):
  self.assertEqual(copy.RESERVE,15*1024**3)
if __name__=="__main__":unittest.main()
