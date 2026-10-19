#!/usr/bin/env python3
"""Host-only Java 8 dual store coordinator, no phone, actual clips, or keys."""
import ast
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
FILES=["S9MigratedMetadataLedgerV193.java",
       "S9MigratedLedgerTrustedCheckpointV196.java",
       "S9MigratedDualStoreCoordinatorV197.java",
       "S9MigratedDualStoreCoordinatorTestV197.java"]
SOURCE=ROOT/FILES[2]
TEST=ROOT/FILES[3]
CLASS="nl.kalenel.s9offline.S9MigratedDualStoreCoordinatorTestV197"

class Tests(unittest.TestCase):
 def test_java8_compiles_and_dual_store_crash_failclosed(self):
  with tempfile.TemporaryDirectory(prefix="s9-dual-v197-host-only-") as out:
   args=["javac","-source","8","-target","8","-d",out]+[
      str(ROOT/name) for name in FILES]
   comp=subprocess.run(args,capture_output=True,text=True,timeout=45)
   self.assertEqual(comp.returncode,0,"dual_store_java8_compilation_failed")
   run=subprocess.run(["java","-cp",out,CLASS],
     capture_output=True,text=True,timeout=35)
   self.assertEqual(run.returncode,0,"dual_store_java8_crash_tests_failed")
   self.assertEqual(run.stdout.strip(),
      "S9_DUAL_STORE_COORDINATOR_V197_HOST_TESTS_OK")

 def test_no_live_actions_or_original_removal(self):
  source=SOURCE.read_text()
  for forbidden in ("new URL(","HttpServer","CameraManager","MediaCodec",
     "Files.delete(","Files.move(","Files.write(","System.exit(",
     "adb push","ACTION_DELETE","review_decide","camera2.stop",
     "System.loadLibrary("):
   self.assertNotIn(forbidden,source)
  self.assertIn("journal.requireTrustedHead(previous.sequence, previous.headSha256);",source)
  self.assertIn("S9MigratedLedgerTrustedCheckpointV196.State now = checkpoint.advance(",source)
  self.assertIn("journal.requireTrustedHead(now.sequence,now.headSha256);",source)
  for code in ("unanchored_genesis_requires_explicit_enrollment",
               "dual_store_exclusive_lock_busy",
               "ledger_head_diverged_from_trusted_checkpoint",
               "authorizesRemoteMutation() { return false; }",
               "mayRemoveOriginal() { return false; }"):
   self.assertIn(code,(source+TEST.read_text()))
  self.assertIn("crash_gap_did_not_autorepair",TEST.read_text())
  self.assertIn("valid_prefix_rollback_still_denied",TEST.read_text())

if __name__=="__main__":unittest.main(verbosity=2)
