#!/usr/bin/env python3
"""Synthetic exact six-original SHA binding against the REAL V220/V216 format."""
from pathlib import Path
import subprocess
import tempfile
import unittest
R=Path(__file__).resolve().parent
JAVA=[
 "S9MigratedMetadataLedgerV193.java",
 "S9MigratedLedgerTrustedCheckpointV196.java",
 "S9MigratedDualStoreCommitV197.java",
 "S9MigratedVerifiedSourceV198.java",
 "S9MigratedSealedSourceManifestV216.java",
 "S9MigratedSealedManifestEnrollmentV220.java",
 "S9MigratedApprovedSixDigestV230.java",
 "S9MigratedApprovedSixDigestTestV230.java",
]
class ApprovedSix(unittest.TestCase):
 def test_real_v220_body_with_exact_enrollment_digest(self):
  with tempfile.TemporaryDirectory(prefix="s9-v230-six-originals-") as tmp:
   compile=subprocess.run(["javac","-source","8","-target","8",
        "-d",tmp]+[str(R/x) for x in JAVA],
        capture_output=True,text=True,timeout=45)
   self.assertEqual(compile.returncode,0,compile.stderr)
   test=subprocess.run(["java","-cp",tmp,
       "nl.kalenel.s9offline.S9MigratedApprovedSixDigestTestV230"],
       capture_output=True,text=True,timeout=30)
   self.assertEqual(test.returncode,0,test.stderr)
   self.assertEqual(test.stdout.strip(),"S9_APPROVED_SIX_DIGEST_V230_SYNTHETIC_OK")
 def test_boot_has_no_digestless_fallback(self):
  boot=(R/"S9MigratedCompanionBootReadinessV229.java").read_text()
  for expected in ("companion_approved_six_source_digest_required",
      "S9MigratedAndroidThreeKeyOwnerV227.verifyExistingOnly(",
      "S9MigratedApprovedSixDigestV230.requireSealedManifestEqualsEnrollment(",
      "trustedApprovedSixDigest","keys.verifyAlreadyEnrolled("):
   self.assertIn(expected,boot)
  digest=(R/"S9MigratedApprovedSixDigestV230.java").read_text()
  for forbidden in ("HttpServer","ServerSocket","CameraManager","MediaCodec",
      "Files.write(","Files.delete(","KeyGenerator",
      "getEncoded(","new URL(","Runtime.getRuntime()"):
   self.assertNotIn(forbidden,digest+boot)
if __name__=="__main__":unittest.main(verbosity=2)
