#!/usr/bin/env python3
"""No-phone verification of three independent existing HMAC custody domains."""
from pathlib import Path
import subprocess
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
GUARD=HERE/"S9MigratedThreeKeyCustodyV227.java"
OWNER=HERE/"S9MigratedManifestKeyCustodyV227.java"
TEST=HERE/"S9MigratedThreeKeyCustodyTestV227.java"

class Tests(unittest.TestCase):
 def test_host_three_way_key_independence_and_refusals(self):
  with tempfile.TemporaryDirectory(prefix="s9-three-keystore-v227-host-") as out:
   compile=subprocess.run(["javac","-source","8","-target","8","-d",out,
             str(GUARD),str(TEST)],capture_output=True,text=True,timeout=40)
   self.assertEqual(compile.returncode,0,
     "three_key_guard_java8_compile_failed")
   test=subprocess.run(["java","-cp",out,
      "nl.kalenel.s9offline.S9MigratedThreeKeyCustodyTestV227"],
      capture_output=True,text=True,timeout=30)
   self.assertEqual(test.returncode,0,
     "three_key_guard_host_regression_failed")
   self.assertEqual(test.stdout.strip(),
     "S9_THREE_DISTINCT_KEY_CUSTODY_V227_HOST_OK")

 def test_android_app_only_source_prevents_implicit_provisioning(self):
  o=OWNER.read_text();g=GUARD.read_text()
  for expected in (
   "S9MigratedAndroidKeystoreOwnerV202.openExisting(context)",
   'KeyStore.getInstance("AndroidKeyStore")',
   "source_manifest_keystore_alias_missing",
   "source_manifest_hmac_key_untrusted",
   "third.getEncoded()!=null",
   "S9MigratedThreeKeyCustodyV227.requireDistinct(",
   "external_source_generation_anchor_required",
   "S9MigratedSealedSourceManifestV216.verifyExisting(",
   "provisionsProductionKeys(){return false;}",
   "installsCompanionService(){return false;}"):
   self.assertIn(expected,o)
  for forbidden in ("KeyGenerator","generateKey(","deleteEntry(",
    "setEntry(","setKeyEntry(", "getEncoded().clone()",
    "HttpServer", "new ServerSocket(", "createTempFile(",
    "Files.write(", "Files.delete(", "pm install","CameraManager",
    "startForegroundService(", "getSharedPreferences("):
   self.assertNotIn(forbidden,o+g)
  self.assertIn("Mac.getInstance(\"HmacSHA256\")",g)
  self.assertIn("MessageDigest.isEqual",g)
  self.assertIn("Arrays.fill(tag,(byte)0)",g)
  self.assertIn("reused_checkpoint_handle",TEST.read_text())
  self.assertIn("same_material_different_handle",TEST.read_text())

if __name__=="__main__":unittest.main(verbosity=2)
