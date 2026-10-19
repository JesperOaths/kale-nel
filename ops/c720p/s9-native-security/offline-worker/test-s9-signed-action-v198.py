#!/usr/bin/env python3
"""Synthetic HMAC request-auth verification; never calls phone or relay."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/"S9MigratedSignedActionV198.java"
TEST=ROOT/"S9MigratedSignedActionTestV198.java"
CLASS="nl.kalenel.s9offline.S9MigratedSignedActionTestV198"

class SignedIntent(unittest.TestCase):
 def test_exact_hmac_clock_and_source_field_binding(self):
  with tempfile.TemporaryDirectory(prefix="s9-signed-intent-v198-") as folder:
   compiled=subprocess.run(["javac","-source","8","-target","8",
      "-d",folder,str(SOURCE),str(TEST)],
      capture_output=True,text=True,timeout=35)
   self.assertEqual(compiled.returncode,0,"v198_java_compile_failed")
   run=subprocess.run(["java","-cp",folder,CLASS],
      capture_output=True,text=True,timeout=20)
   self.assertEqual(run.returncode,0,"v198_signed_envelope_regression_failed")
   self.assertEqual(run.stdout.strip(),"S9_SIGNED_ACTION_V198_HOST_TESTS_OK")

 def test_no_route_credentials_or_media_access(self):
  source=SOURCE.read_text()
  for required in ("HmacSHA256","MessageDigest.isEqual(",
       "s9_c720p_migrated_action_auth_v198",
       "s9-microsd-metadata-only",
       'private static final String METHOD="POST"',
       "signed_action_expired_or_phone_clock_untrusted",
       "signed_action_hmac_invalid","isActualMediaSourceVerified()"):
   self.assertIn(required,source)
  for forbidden in ("HttpServer","ServerSocket","Socket(", "CameraManager",
       "OrtEnvironment","Files.readAllBytes","FileOutputStream",
       "getSharedPreferences", "new URL(", "pm install",
       "adb push", "personReviewsModified(", "Files.delete("):
   self.assertNotIn(forbidden,source)
  test=TEST.read_text()
  self.assertIn("tampered_field_",test)
  self.assertIn("even_valid_signature_cannot_authorize_put",test)
  self.assertIn("overlong_signed_lifetime",test)

if __name__=="__main__":unittest.main(verbosity=2)
