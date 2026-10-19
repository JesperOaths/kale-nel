#!/usr/bin/env python3
"""No-phone, no-media regression coverage for installed mirror inventory audit."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/"audit-c720p-s9-mirror-v150.py"
spec=importlib.util.spec_from_file_location("mirror_v150",SOURCE)
s=importlib.util.module_from_spec(spec);spec.loader.exec_module(s)
def worker():
 return b"\n".join(x.encode() for x in (
 "MAX_TEMP_C=37.0","RESERVE=15*1024**3",
 "all_local_recordings_preserved","phone_file_matches",
 "camera_ready()","sha256_file","atomic_write(old)",
 "verified_partial_promoted","preexisting_partial_not_matching_preserved",
 "camera_became_unhealthy_before_promotion"))
class Tests(unittest.TestCase):
 def test_current_has_resumable_and_safety(self):
  blob=worker()
  with patch.object(s,"CURRENT_BLOB",s.git_blob(blob)):
   d=s.inspect_worker(blob)
  self.assertEqual(d["worker_version"],"current")
  self.assertTrue(d["partial_resume_logic_present"])
  self.assertTrue(d["thermal_hash_storage_guards_present"])
  self.assertFalse(d["contains_media_deletion"])
 def test_unknown_or_old_worker_not_reported_current(self):
  a=worker()
  with patch.object(s,"CURRENT_BLOB","0"*40):
   self.assertEqual(s.inspect_worker(a)["worker_version"],"unknown")
  with patch.object(s,"OLD_BLOCKING_BLOBS",(s.git_blob(a),)):
   self.assertEqual(s.inspect_worker(a)["worker_version"],"old_blocks_partials")
  with self.assertRaisesRegex(RuntimeError,"unsafe_mirror_media_delete_logic"):
   s.inspect_worker(a+b"\npath.unlink(")
 def test_private_manifest_inventory(self):
  with tempfile.TemporaryDirectory() as td:
   p=Path(td)/"manifest.json"
   records={}
   for i in range(6):
    records["clip"+str(i)+".mp4"]={
      "sha256":"a"*64,"bytes":12000+i,"indexed":True}
   p.write_text(json.dumps({"schema_version":"c720p_s9_verified_import_v2",
     "records":records}))
   p.chmod(0o600)
   with patch.object(s,"MANIFEST",p):
    d=s.manifest_summary()
    self.assertEqual(d["verified_import_manifest_entries"],6)
    self.assertEqual(d["manifest_bytes"],sum(12000+i for i in range(6)))
    p.chmod(0o644)
    with self.assertRaisesRegex(RuntimeError,"private_manifest_not_private"):
     s.manifest_summary()
 def test_diagnostic_cannot_delete_or_modify_media(self):
  src=SOURCE.read_text()
  for bad in ("adb push","adb pull","subprocess.Popen","--copy\",action",
              "shutil.rmtree(","os.remove(","path.unlink(","os.replace(",
              "systemctl --user restart"):
   self.assertNotIn(bad,src)
  self.assertIn('"originals_still_required":True',src)
  self.assertIn('"no_worker_copy_or_verify_run":True',src)
  self.assertIn('raise SystemExit(1)',src)
if __name__=="__main__":unittest.main(verbosity=2)
