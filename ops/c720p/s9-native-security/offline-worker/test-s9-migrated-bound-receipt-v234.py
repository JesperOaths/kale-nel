#!/usr/bin/env python3
"""Synthetic host Java8: six-source binding, HMAC, journal, replay and restart.

Never accesses S9, C720P runtime, production credentials or actual originals.
"""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
SOURCES=[
 "S9MigratedMetadataLedgerV193.java",
 "S9MigratedLedgerTrustedCheckpointV196.java",
 "S9MigratedDualStoreCommitV197.java",
 "S9MigratedSignedActionV198.java",
 "S9MigratedSignedCommitGateV201.java",
 "S9MigratedVerifiedSourceV198.java",
 "S9MigratedSealedSourceManifestV216.java",
 "S9MigratedApprovedSixDigestV230.java",
 "S9MigratedReadOnlyStateV225.java",
 "S9MigratedActionWireV231.java",
 "S9MigratedPostcommitV232.java",
 "S9MigratedBoundActionReceiptV234.java",
 "S9MigratedBoundActionReceiptTestV234.java",
]
class Tests(unittest.TestCase):
 def test_synthetic_source_bound_postcommit(self):
  with tempfile.TemporaryDirectory(prefix="s9-v234-bound-host-") as out:
   compiled=subprocess.run(["javac","-source","8","-target","8","-d",out]+[
     str(ROOT/x) for x in SOURCES],
     text=True,capture_output=True,timeout=60)
   self.assertEqual(compiled.returncode,0,compiled.stderr)
   executed=subprocess.run(["java","-cp",out,
     "nl.kalenel.s9offline.S9MigratedBoundActionReceiptTestV234"],
     text=True,capture_output=True,timeout=30)
   self.assertEqual(executed.returncode,0,executed.stderr)
   self.assertIn("S9_MIGRATED_BOUND_RECEIPT_V234_HOST_VERIFIED",executed.stdout)
 def test_no_new_authority(self):
  code=(ROOT/"S9MigratedBoundActionReceiptV234.java").read_text()
  for expected in (
    "S9MigratedApprovedSixDigestV230.requireSealedManifestEqualsEnrollment(",
    "S9MigratedActionWireV231.decode(", 
    "independentlyAuthorizedAction.accept(",
    "S9MigratedReadOnlyStateV225.readForAuthenticatedOwner(",
    "fresh.manifestGeneration==1L",
    "row.decisionSequence==committed.sequence",
    "same(row.sourceSha256,request.sourceSha256)",
    "provesHumanViewedMedia",
    "allowsOriginalRemoval",
    "bound_receipt_new_head_or_source_not_current",
    "provisionsFirstEnrollment(){return false;}",
    "hasNetworkListener(){return false;}"):
   self.assertIn(expected,code)
  for dangerous in ("KeyGenerator","HttpServer","ServerSocket","Files.delete(",
    "CameraManager","System.exit(","android.os","adb install","new URL("):
   self.assertNotIn(dangerous,code)

if __name__=="__main__":unittest.main(verbosity=2)
