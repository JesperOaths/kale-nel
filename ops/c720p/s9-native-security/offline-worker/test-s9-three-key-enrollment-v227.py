#!/usr/bin/env python3
"""Host-only KeyStore fake tests; no phone, production keys, or APK installation."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
class FirstEnrollment(unittest.TestCase):
 def test_crash_barrier_and_three_distinct_hmac_signers(self):
  with tempfile.TemporaryDirectory(prefix="s9-3keys-v227-fake-") as td:
   sources=["S9MigratedThreeKeyEnrollmentV227.java",
            "S9MigratedThreeKeyEnrollmentTestV227.java"]
   result=subprocess.run(["javac","-source","8","-target","8",
      "-d",td]+[str(ROOT/n) for n in sources],
      capture_output=True,text=True,timeout=35)
   self.assertEqual(result.returncode,0,result.stderr)
   tested=subprocess.run(["java","-cp",td,
      "nl.kalenel.s9offline.S9MigratedThreeKeyEnrollmentTestV227"],
      capture_output=True,text=True,timeout=30)
   self.assertEqual(tested.returncode,0,tested.stderr)
   self.assertEqual(tested.stdout.strip(),
       "S9_THREE_KEY_ENROLLMENT_V227_SYNTHETIC_OK")
 def test_native_aliases_match_prior_keystore_owner(self):
  prior=(ROOT/"S9MigratedAndroidKeystoreOwnerV202.java").read_text()
  core=(ROOT/"S9MigratedThreeKeyEnrollmentV227.java").read_text()
  self.assertIn('"nl.kalenel.s9migrated.checkpoint.hmac.v202"',prior)
  self.assertIn('"nl.kalenel.s9migrated.journal.hmac.v202"',prior)
  self.assertIn('"nl.kalenel.s9migrated.checkpoint.hmac.v202"',core)
  self.assertIn('"nl.kalenel.s9migrated.journal.hmac.v202"',core)
  self.assertIn('"nl.kalenel.s9migrated.source_manifest.hmac.v227"',core)
  import re
  custodian=(ROOT/"S9MigratedManifestKeyCustodyV227.java").read_text()
  source=re.search(r'public static final String SOURCE="([^"]+)"',core)
  existing=re.search(r'public static final String SOURCE_MANIFEST_ALIAS=\\s*"([^"]+)"',custodian)
  self.assertIsNotNone(source)
  self.assertIsNotNone(existing)
  self.assertEqual(source.group(1),existing.group(1),
                   "Source enrollment and read-only custody must use the same actual Android alias")
 def test_no_remote_media_mutations_or_automatic_rollback(self):
  core=(ROOT/"S9MigratedThreeKeyEnrollmentV227.java").read_text()
  android=(ROOT/"S9MigratedAndroidThreeKeyOwnerV227.java").read_text()
  for required in ("StandardOpenOption.CREATE_NEW","channel.force(true)",
     "forceDir(path.getParent())","prior_enrollment_requires_manual_audit",
     "preexisting_key_requires_manual_audit","independent_first_enrollment_denied",
     "distinct_aliases_share_hmac_key","new SecureRandom().nextBytes(nonceBytes)",
     "provisionsRelaySigningKey(){return false;}"):
   self.assertIn(required,core)
  for disallowed in ("deleteEntry(","Files.delete(","Files.write(",
     "Runtime.getRuntime()","System.exit(","HttpServer","ServerSocket",
     "CameraManager","MediaCodec","FileInputStream",
     "new URL(","getExternalFilesDir("):
   self.assertNotIn(disallowed,core+android)
  for needed in ("nl.kalenel.s9migrated",
     "KeyProperties.KEY_ALGORITHM_HMAC_SHA256",
     "generator.generateKey()","result.getEncoded()!=null",
     'KeyStore.getInstance("AndroidKeyStore")'):
   self.assertIn(needed,android)

if __name__=="__main__":unittest.main(verbosity=2)
