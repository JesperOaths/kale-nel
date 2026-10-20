#!/usr/bin/env python3
"""Synthetic SD/Drive historical digest coverage: never touches HA files."""
import importlib.util
from pathlib import Path
import unittest
HERE=Path(__file__).resolve().parent
SRC=HERE/"audit-manual-digest-coverage-task21.py"
spec=importlib.util.spec_from_file_location("audit_task21",SRC)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NAME="motion_1792200000000.mp4"
DRIVE="drive_2025_01.mp4"
class Tests(unittest.TestCase):
 def test_hist_unbound_still_preserved(self):
  manual={"version":1,"revision":35,"items":{
    "sd:"+NAME:{"folder":"P1","folders":["P1","P2"],
      "review_status":"assigned"},
    "drive:"+DRIVE:{"folder":"P3","folders":["P3"],
      "review_status":"assigned"}}}
  sd={"records":{NAME:{"manifest":{"sha256":"a"*64}}}}
  drive={"items":[{"remote_name":DRIVE,"state":"verified","md5":"b"*32}]}
  doc=m.count(manual,sd,drive)
  self.assertEqual(doc["manual_decision_count"],2)
  self.assertEqual(doc["counts"]["historically_unbound"],2)
  self.assertEqual(doc["counts"]["source_claimed_sha_only"],1)
  self.assertEqual(doc["counts"]["drive_indexed_md5_only"],1)
  self.assertEqual(doc["counts"]["group_assignments_preserved"],1)
  self.assertFalse(doc["historical_digest_backfilled"])
  self.assertEqual(doc["original_bytes_hashed_in_this_audit"],0)
 def test_source_unavailable_is_different_from_new_binding(self):
  bound={"status":"bound_at_decision","sha256":"f"*64}
  manual={"version":1,"revision":2,"items":{
    "sd:"+NAME:{"media_binding":bound,"review_status":"assigned"}}}
  d=m.count(manual,{"records":{}},{"items":[]})
  self.assertEqual(d["counts"]["source_unavailable"],1)
  self.assertEqual(d["counts"]["bound_at_decision"],1)
  self.assertEqual(d["counts"]["bound_without_current_record"],1)
 def test_only_nonwritable_catalog_permissions_are_accepted(self):
  import tempfile
  with tempfile.TemporaryDirectory() as tmp:
   src=Path(tmp)/"source"
   src.write_bytes(b"x"*120)
   src.chmod(0o644)
   self.assertEqual(m.read(src,200,private=False),b"x"*120)
   with self.assertRaisesRegex(RuntimeError,"private_source_untrusted"):
    m.read(src,200,private=True)
   for mode in (0o664,0o666,0o646):
    src.chmod(mode)
    with self.subTest(mode=oct(mode)),self.assertRaisesRegex(
        RuntimeError,"private_source_untrusted"):
     m.read(src,200,private=False)
   src.chmod(0o600)
   self.assertEqual(m.read(src,200,private=True),b"x"*120)
 def test_no_writes_or_privileged_browser_operations(self):
  text=SRC.read_text()
  for bad in ("write_text(","write_bytes(","unlink(","shutil.rmtree",
      "os.replace(","adb install","curl ","sudo ","response.body",
      "FileOutputStream","review_update("):
   self.assertNotIn(bad,text)
  self.assertIn('original_bytes_hashed_in_this_audit":0',text)
if __name__=="__main__":unittest.main(verbosity=2)
