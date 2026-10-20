#!/usr/bin/env python3
"""Static app-ownership admission and synthetic trusted-state regressions.

No Android phone, no real manifest/Keystore alias/recording, no auth grant.
"""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/"S9MigratedCompanionBootReadinessV229.java"
PREREQS=[
 "S9MigratedMetadataLedgerV193.java",
 "S9MigratedLedgerTrustedCheckpointV196.java",
 "S9MigratedDualStoreCommitV197.java",
 "S9MigratedVerifiedSourceV198.java",
 "S9MigratedSealedSourceManifestV216.java",
 "S9MigratedReadOnlyStateV225.java",
 "S9MigratedReadOnlyStateTestV225.java",
]

class Tests(unittest.TestCase):
 def test_synthetic_sealed_source_and_six_decision_snapshot_regression(self):
  with tempfile.TemporaryDirectory(prefix="s9-companion-boot-v229-host-") as out:
   args=["javac","-source","8","-target","8","-d",out]+[
     str(ROOT/x) for x in PREREQS]
   compiled=subprocess.run(args,capture_output=True,text=True,timeout=45)
   self.assertEqual(compiled.returncode,0,
     "prior_authenticated_six_state_java8_compilation_failed: "+compiled.stderr)
   executed=subprocess.run(["java","-cp",out,
     "nl.kalenel.s9offline.S9MigratedReadOnlyStateTestV225"],
      capture_output=True,text=True,timeout=35)
   self.assertEqual(executed.returncode,0,
     "prior_six_state_snapshot_regression_failed")
   self.assertIn("S9_READONLY_STATE_V225_HOST_VERIFIED",executed.stdout)

 def test_app_private_preprovisioned_read_only_boot(self):
  s=SOURCE.read_text()
  for expected in (
    "getApplicationContext()",
    "getExternalFilesDirs(null)",
    "Files.isSymbolicLink(metadataDir.toPath())",
    "LinkOption.NOFOLLOW_LINKS",
    "target.getParent()",
    "companion_external_metadata_not_app_owned",
    "trustedMinimumGeneration<1",
    "companion_approved_six_source_digest_required",
    "S9MigratedAndroidThreeKeyOwnerV227.verifyExistingOnly(",
    "S9MigratedApprovedSixDigestV230.requireSealedManifestEqualsEnrollment(",
    "S9MigratedManifestKeyCustodyV227.openExisting(app)",
    "keys.verifyAlreadyEnrolled(trustedMinimumGeneration)",
    "sources.sourceRows.size()!=6",
    "total!=214181934L",
    "new S9MigratedDualStoreCommitV197(",
    "S9MigratedReadOnlyStateV225.readForAuthenticatedOwner(",
    "snapshot.rows.size()!=6",
    "saved+deleted+unknown!=6",
    "authorizesLocalClipRetirement(){return false;}",
    "acceptsSignedActions(){return false;}",
    "confirmsOriginalMediaBytes(){return false;}",
    "provisionsProductionHmacKeys(){return false;}"):
   self.assertIn(expected,s)
  for forbidden in ("KeyGenerator","generateKey(","setEntry(","deleteEntry(",
     "getEncoded(","new ServerSocket(","HttpServer","Socket(",
     "FileOutputStream(","Files.write(","Files.delete(",
     "startService(","startForegroundService(","CameraManager",
     "getUserMedia","System.loadLibrary(","System.exit("):
   self.assertNotIn(forbidden,s)

if __name__=="__main__":unittest.main(verbosity=2)
