#!/usr/bin/env python3
"""Ongoing mirror may copy verified clips to S9, never purge or misclassify them."""
from pathlib import Path
import importlib.util
import unittest
ROOT=Path(__file__).resolve().parent
SERVICE=(ROOT/"c720p-s9-verified-local-mirror-v2.service").read_text()
TIMER=(ROOT/"c720p-s9-verified-local-mirror-v2.timer").read_text()
MIRROR=(ROOT/"c720p_to_s9_verified_media_stage_v2.py").read_text()
class Tests(unittest.TestCase):
 def test_retained_source_only_copy(self):
  self.assertIn("c720p_to_s9_verified_media_stage_v2.py --copy",SERVICE)
  self.assertNotIn("--delete",SERVICE)
  self.assertNotIn("sudo",SERVICE)
  self.assertIn("NoNewPrivileges=yes",SERVICE)
  self.assertIn("IOSchedulingClass=idle",SERVICE)
 def test_low_duty_timer_does_not_backfill_at_boot(self):
  for term in ("OnBootSec=1h","OnUnitInactiveSec=3h",
      "RandomizedDelaySec=30min","Persistent=false"):
   self.assertIn(term,TIMER)
  self.assertNotIn("OnCalendar=",TIMER)
 def test_script_retains_thermal_disk_and_digest_interlocks(self):
  for term in ("MAX_TEMP_C=37.0","RESERVE=15*1024**3",
      "MIN_AGE=180","sha256_file(path)!=digest",
      'old["records"][path.name]',"atomic_write(old)",
      "all_local_recordings_preserved"):
   self.assertIn(term,MIRROR)
  for danger in ("os.remove(", "shutil.rmtree(", "path.unlink(",
    'adb("shell","rm"', "sudo ", "delete_source"):
   self.assertNotIn(danger,MIRROR)
 def test_manifest_cannot_confuse_local_mp4_with_native_s9_original(self):
  self.assertIn("C720PMigrated",MIRROR)
  self.assertIn("c720p_s9_verified_import_v2",MIRROR)
  self.assertNotIn("Automatic Person",MIRROR)
if __name__=="__main__":unittest.main(verbosity=2)
