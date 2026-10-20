#!/usr/bin/env python3
"""Static safety checks for no-content-read disposable on-phone storage probe."""
from pathlib import Path
import unittest
ROOT=Path(__file__).resolve().parent
PROBE=ROOT/"s9-storage-probe-v204/StorageProbe.java"
MAN=ROOT/"s9-storage-probe-v204/AndroidManifest.xml"
RUN=ROOT/"probe-s9-disposable-storage-access-v204.py"

class Safety(unittest.TestCase):
 def test_no_camera_network_write_or_privileged_permission(self):
  m=MAN.read_text()
  for required in ('package="nl.kalenel.s9storageprobev204"',
         "android.permission.READ_EXTERNAL_STORAGE",
         'android:allowBackup="false"'):
   self.assertIn(required,m)
  for bad in ("android.permission.CAMERA","android.permission.INTERNET",
      "android.permission.WRITE_EXTERNAL_STORAGE",
      "android.permission.MANAGE_EXTERNAL_STORAGE","android.permission.RECORD_AUDIO"):
   self.assertNotIn(bad,m)
 def test_receiver_opens_zero_bytes_only_and_redacts_identity(self):
  s=PROBE.read_text()
  for need in ("FileInputStream stream=new FileInputStream(file)",
     "bytes_read=0","media_modified=false","Log.i(TAG,"):
   self.assertIn(need,s)
  for bad in ("stream.read();","FileOutputStream","Socket","CameraManager",
      "MediaCodec","System.loadLibrary","Files.delete(","Files.write("):
   self.assertNotIn(bad,s)
 def test_runner_has_camera_guard_uninstall_and_no_bypass(self):
  s=RUN.read_text()
  for required in ("g.current_camera()","g.LOCK.open(","temperature_c",
       "g.adb(\"uninstall\",PACKAGE","require(not packages(g)",
       "hub_disk_reserve_for_build","media_bytes_read\":0"):
   self.assertIn(required,s)
if __name__=="__main__":unittest.main(verbosity=2)
