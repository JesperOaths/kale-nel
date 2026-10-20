#!/usr/bin/env python3
"""Host-only signed->SHA->durable Save/Delete metadata chain; no production IO."""
from pathlib import Path
import subprocess
import tempfile
import unittest
ROOT=Path(__file__).resolve().parent
SOURCES=["S9MigratedMetadataLedgerV193.java",
         "S9MigratedLedgerTrustedCheckpointV196.java",
         "S9MigratedDualStoreCommitV197.java",
         "S9MigratedVerifiedSourceV198.java",
         "S9MigratedSignedActionV198.java",
         "S9MigratedAuthenticatedCommitV201.java",
         "S9MigratedAuthenticatedCommitTestV201.java"]

class FullChain(unittest.TestCase):
 def test_java8_signed_source_dual_store(self):
  with tempfile.TemporaryDirectory(prefix="s9-v201-host-only-") as td:
   c=subprocess.run(["javac","-source","8","-target","8","-d",td]+
       [str(ROOT/name) for name in SOURCES],
       text=True,capture_output=True,timeout=50)
   self.assertEqual(c.returncode,0,c.stderr)
   c=subprocess.run(["java","-cp",td,
       "nl.kalenel.s9offline.S9MigratedAuthenticatedCommitTestV201"],
       text=True,capture_output=True,timeout=35)
   self.assertEqual(c.returncode,0,c.stderr)
   self.assertEqual(c.stdout.strip(),"S9_AUTHENTICATED_COMMIT_V201_SYNTHETIC_OK")
 def test_no_http_camera_media_mutation_or_implicit_authority(self):
  source=(ROOT/"S9MigratedAuthenticatedCommitV201.java").read_text()
  for token in ("HttpServer","ServerSocket","android.app.",
      "CameraManager","MediaCodec","Files.delete(", "Files.write(",
      "new URL(","ProcessBuilder","run-as","adb shell","am force-stop"):
   self.assertNotIn(token,source)
  for token in ("signed.verify(request,now)","durable.commitMetadataOnly(",
      "qualifiedSource","trustedClock.verifiedEpochMillis()",
      "durable.currentDecision(intent.name)","liveRemoteEndpointEnabled(){return false;}",
      "mayRemoveOriginal(){return false;}"):
   self.assertIn(token,source)

if __name__=="__main__":unittest.main(verbosity=2)
