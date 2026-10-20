#!/usr/bin/env python3
"""Host-only Safety: temporary test aliases, no production key or camera access."""
import unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parent
class Safety(unittest.TestCase):
 def test_manifest_permissions_and_uid(self):
  s=(ROOT/"s9-keystore-probe-v219/AndroidManifest.xml").read_text()
  self.assertIn('package="nl.kalenel.s9keyprobev219"',s)
  self.assertIn('android:allowBackup="false"',s)
  for forbidden in ("uses-permission","nl.kalenel.s9security","nl.kalenel.s9edge"):
   self.assertNotIn(forbidden,s)
 def test_ephemeral_keys_deleted_and_nonexportable(self):
  s=(ROOT/"s9-keystore-probe-v219/KeyProbe.java").read_text()
  for required in ("KeyProperties.KEY_ALGORITHM_HMAC_SHA256",
     '"AndroidKeyStore"','store.containsAlias(A)||store.containsAlias(B)',
     "store.deleteEntry(B)","store.deleteEntry(A)",
     "a.getEncoded()==null && b.getEncoded()==null",
     "MessageDigest.isEqual(first,repeat)",
     "!MessageDigest.isEqual(first,second)",
     "production_aliases_modified=false"):
   self.assertIn(required,s)
  for forbidden in ("FileInputStream","new File(","Socket","HttpServer",
     "CameraManager","MediaCodec","System.loadLibrary"):
   self.assertNotIn(forbidden,s)
 def test_harness_has_guards_and_uninstall(self):
  s=(ROOT/"probe-s9-ephemeral-keystore-v219.py").read_text()
  for required in ('g.current_camera()','temperature_c',
    'shutil.disk_usage("/").free>=850*1048576',
    'g.adb("uninstall",PACKAGE','require(not was_present,',
    'g.LOCK.open("r")','apksigner','disposable_app_uninstalled'):
   self.assertIn(required,s)
if __name__=="__main__":unittest.main(verbosity=2)
