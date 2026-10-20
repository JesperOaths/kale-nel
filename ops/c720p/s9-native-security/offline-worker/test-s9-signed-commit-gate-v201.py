#!/usr/bin/env python3
"""Source-only Java 8 verified-request to dual-store tests, no device or media."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
JAVAS=["S9MigratedMetadataLedgerV193.java",
       "S9MigratedLedgerTrustedCheckpointV196.java",
       "S9MigratedDualStoreCommitV197.java",
       "S9MigratedSignedActionV198.java",
       "S9MigratedSignedCommitGateV201.java",
       "S9MigratedSignedCommitGateTestV201.java"]
ACT=ROOT/"S9MigratedSignedActionV198.java"
GATE=ROOT/"S9MigratedSignedCommitGateV201.java"
TEST=ROOT/"S9MigratedSignedCommitGateTestV201.java"
class SignedCommit(unittest.TestCase):
 def test_java8_host_keystore_and_failed_authorization(self):
  with tempfile.TemporaryDirectory(prefix="s9-signed-commit-v201-host-only-") as out:
   result=subprocess.run(["javac","-source","8","-target","8",
      "-d",out]+[str(ROOT/name) for name in JAVAS],
      capture_output=True,text=True,timeout=40)
   self.assertEqual(result.returncode,0,
      "source_only_signed_keystore_commit_java8_compilation_failed")
   run=subprocess.run(["java","-cp",out,
      "nl.kalenel.s9offline.S9MigratedSignedCommitGateTestV201"],
      capture_output=True,text=True,timeout=35)
   self.assertEqual(run.returncode,0,
      "source_only_signed_keystore_commit_failure")
   self.assertEqual(run.stdout.strip(),
      "S9_SIGNED_COMMIT_GATE_V201_HOST_PARITY_OK")

 def test_no_key_export_or_live_action_server_capability(self):
  act=ACT.read_text();gate=GATE.read_text()
  self.assertIn("h.init(signingKey);",act)
  self.assertIn("authenticated_relay_keystore_hmac_required",act)
  self.assertIn("independent_user_approval",gate)
  self.assertIn("signedVerifier.verify(raw,trustedPhoneMillis)",gate)
  self.assertIn("metadata.commitMetadataOnly(approved.action,approved.name,",gate)
  self.assertIn("sourceProof);",gate)
  self.assertNotIn("getEncoded()",act)
  for forbidden in ("Socket(", "HttpServer", "CameraManager",
        "Files.delete(", "FileOutputStream", "new URL(",
        "adb push", "am force-stop", "pm install",
        "person_review", "System.loadLibrary("):
   self.assertNotIn(forbidden,gate)
  self.assertIn("authorizesMediaDeletion(){return false;}",gate)
  self.assertIn("hasLiveTransport(){return false;}",gate)
  self.assertIn("deniedMethod",TEST.read_text())
  self.assertIn("stale_retry_cannot_recreate_save",TEST.read_text())

if __name__=="__main__":unittest.main(verbosity=2)
