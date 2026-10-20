#!/usr/bin/env python3
"""Host-only, source-scoped Safety and Java8 synthetic sealed-manifest enrollment."""
from pathlib import Path
import subprocess
import tempfile
import unittest
ROOT=Path(__file__).resolve().parent
SOURCES=["S9MigratedMetadataLedgerV193.java",
 "S9MigratedLedgerTrustedCheckpointV196.java",
 "S9MigratedDualStoreCommitV197.java",
 "S9MigratedVerifiedSourceV198.java",
 "S9MigratedSealedSourceManifestV216.java",
 "S9MigratedSealedManifestEnrollmentV220.java",
 "S9MigratedSealedManifestEnrollmentTestV220.java"]
SRC=ROOT/"S9MigratedSealedManifestEnrollmentV220.java"
TEST=ROOT/"S9MigratedSealedManifestEnrollmentTestV220.java"
class Tests(unittest.TestCase):
 def test_compile_and_verify_fresh_create_only_seal(self):
  with tempfile.TemporaryDirectory(prefix="s9-sealed-genesis-v220-hostonly-") as d:
   result=subprocess.run(["javac","-source","8","-target","8","-d",d]+
       [str(ROOT/x) for x in SOURCES],capture_output=True,text=True,timeout=50)
   self.assertEqual(result.returncode,0,"synthetic_enrollment_java8_compile_failed")
   result=subprocess.run(["java","-cp",d,
       "nl.kalenel.s9offline.S9MigratedSealedManifestEnrollmentTestV220"],
       capture_output=True,text=True,timeout=30)
   self.assertEqual(result.returncode,0,"synthetic_first_enrollment_tests_failed")
   self.assertEqual(result.stdout.strip(),
       "S9_INITIAL_SEALED_ENROLLMENT_V220_SYNTHETIC_OK")
 def test_reject_private_source_overwrite_and_original_deletion(self):
  source=SRC.read_text();tests=TEST.read_text()
  for required in ("Files.createLink(target,temp)",
     "forceDirectory(directory)", "channel.force(true)",
     "initial_manifest_existing_target_never_replaced",
     "initial_manifest_historical_total_mismatch",
     "firstEnrollmentAuthority.approvesVirginBatch",
     "verifyExisting(","OWNER_READ","OWNER_WRITE",
     "INITIAL_SEALED_ENROLLMENT" if False else "Initial"):
   if required=="Initial":continue
   self.assertIn(required,source)
  for forbidden in ("Files.move(", "REPLACE_EXISTING","KeyGenerator",
     "KeyStore.getInstance(", "Files.walk(", "Socket(",
     "FileOutputStream(","HttpServer","AndroidKeyStore",
     "CameraManager","MediaCodec","System.exit("):
   self.assertNotIn(forbidden,source)
  for expected in ("denial_did_not_write","invalid_sum_did_not_write",
    "bad_provenance_did_not_write","existing_manifest_never_overwritten",
    "generation_rollback_detected","tampering_refused"):
   self.assertIn(expected,tests)
  self.assertIn("canRemoveLegacyMedia(){return false;}",source)
  self.assertIn("liveEndpointInstalled(){return false;}",source)
if __name__=="__main__":unittest.main(verbosity=2)
