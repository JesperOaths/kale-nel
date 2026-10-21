#!/usr/bin/env python3
import importlib.util, os, stat, tempfile, unittest
from pathlib import Path
from unittest.mock import patch

P=Path(__file__).with_name("tighten-task21-drive-config-mode-v251.py")
spec=importlib.util.spec_from_file_location("task21_v251",P)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Tests(unittest.TestCase):
 def setup(self,d,mode=0o664):
  parent=Path(d)/"private";parent.mkdir(mode=0o700)
  path=parent/"config.json";path.write_text('{"service":"synthetic-only","t":"secret"}')
  path.chmod(mode)
  return path
 def test_only_group_write_removed_and_content_unchanged(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=self.setup(tmp)
   before=p.read_bytes();st=p.stat()
   proof=m.tighten(p)
   after=p.stat()
   self.assertEqual(stat.S_IMODE(after.st_mode),0o644)
   self.assertEqual(before,p.read_bytes())
   self.assertEqual((st.st_ino,st.st_mtime_ns,st.st_size),
                    (after.st_ino,after.st_mtime_ns,after.st_size))
   self.assertTrue(proof["no_review_or_original_media_changes"])
   self.assertTrue(proof["no_config_contents_read"])
   self.assertTrue(m.tighten(p)["group_write_removed"])
 def test_link_or_foreign_mode_refused(self):
  with tempfile.TemporaryDirectory() as tmp:
   p=self.setup(tmp,0o666)
   with self.assertRaisesRegex(RuntimeError,"untrusted_service_config_metadata"):
    m.tighten(p)
   p.chmod(0o664)
   l=p.parent/"unsafe";l.symlink_to(p)
   with self.assertRaisesRegex(RuntimeError,"unsafe_symlink"):m.tighten(l)
   self.assertEqual(stat.S_IMODE(p.stat().st_mode),0o664)
 def test_source_has_no_config_read_or_video_review_mutation(self):
  s=P.read_text()
  for bad in (".read_text(",".read_bytes(","read_json(","shutil.","subprocess.",
              "unlink(","rename(","replace(","FileInputStream","rclone cat",
              "getUserMedia","MediaCodec","adb push","person_review"):
   self.assertNotIn(bad,s)
  self.assertIn("os.fchmod(fd,desired)",s)
  self.assertIn("os.O_NOFOLLOW",s)
if __name__=="__main__":unittest.main(verbosity=2)
