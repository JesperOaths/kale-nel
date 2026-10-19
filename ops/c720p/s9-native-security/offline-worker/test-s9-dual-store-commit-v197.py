#!/usr/bin/env python3
"""Host-only Java 8 crash-gap regression; never accesses connected devices."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
SOURCES=[
 "S9MigratedMetadataLedgerV193.java",
 "S9MigratedLedgerTrustedCheckpointV196.java",
 "S9MigratedDualStoreCommitV197.java",
 "S9MigratedDualStoreCommitTestV197.java",
]
TESTCLASS="nl.kalenel.s9offline.S9MigratedDualStoreCommitTestV197"

class TwoStore(unittest.TestCase):
 def test_java_host_simulated_crash_and_rollback(self):
  with tempfile.TemporaryDirectory(prefix="s9-v197-dual-store-") as directory:
   compiled=subprocess.run(["javac","-source","8","-target","8","-d",directory]
       +[str(ROOT/name) for name in SOURCES],
       capture_output=True,text=True,timeout=35)
   self.assertEqual(compiled.returncode,0,
                    "synthetic_dual_store_javac_failed")
   test=subprocess.run(["java","-cp",directory,TESTCLASS],
        capture_output=True,text=True,timeout=30)
   self.assertEqual(test.returncode,0,
                    "synthetic_dual_store_crash_or_replay_test_failed")
   self.assertEqual(test.stdout.strip(),
                    "S9_DUAL_STORE_COMMIT_V197_HOST_TESTS_OK")

 def test_separate_private_lock_and_no_live_mutation(self):
  code=(ROOT/"S9MigratedDualStoreCommitV197.java").read_text()
  for required in ("journal.commit(", "checkpoint.advance(", "verifyBothStores()",
       "journal.requireTrustedHead(", "afterJournalHook.afterMicroSdSync()",
       "authenticated_source_verifier_required", "unverified_genesis_requires_secure_provisioning",
       "stale_expected_commit_head", "bothStoresVerified=true",
       "preprovisioned_coordinator_lock_required",
       "takeLock(channel)", "return false;", "mayRemoveOriginal()"):
   self.assertIn(required,code)
  for forbidden in ("CameraManager","OrtEnvironment","MediaCodec",
                    "Files.delete(", "Files.write(", "System.exit(",
                    "adb push","rm -rf","new URL(", "HttpServer",
                    "S9SecurityCameraService", "openMediaFile("):
   self.assertNotIn(forbidden,code)
  tests=(ROOT/"S9MigratedDualStoreCommitTestV197.java").read_text()
  for required in ("host_test_injected_after_micro_sd_sync",
       "retry_cannot_hide_unanchored_action",
       "current_tombstone_idempotent",
       "independent_checkpoint_rejects_complete_delete_rollback",
       "public_genesis_not_authorized"):
   self.assertIn(required,tests)

if __name__=="__main__":unittest.main(verbosity=2)
