#!/usr/bin/env python3
"""Synthetic host-only independent S9 checkpoint, never installs on phone."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/"S9MigratedLedgerTrustedCheckpointV196.java"
LEDGER=ROOT/"S9MigratedMetadataLedgerV193.java"
TEST=ROOT/"S9MigratedLedgerTrustedCheckpointTestV196.java"
CLASS="nl.kalenel.s9offline.S9MigratedLedgerTrustedCheckpointTestV196"

class InternalCheckpoint(unittest.TestCase):
 def test_java8_atomic_checkpoint_and_sd_divergence(self):
  with tempfile.TemporaryDirectory(prefix="s9-internal-checkpoint-v196-") as path:
   compiler=subprocess.run(["javac","-source","8","-target","8",
       "-d",path,str(SOURCE),str(LEDGER),str(TEST)],
       capture_output=True,text=True,timeout=45)
   self.assertEqual(compiler.returncode,0,"internal_checkpoint_compile_failure")
   run=subprocess.run(["java","-cp",path,CLASS],
       capture_output=True,text=True,timeout=30)
   self.assertEqual(run.returncode,0,"internal_checkpoint_regression_failed")
   self.assertEqual(run.stdout.strip(),
       "S9_INTERNAL_LEDGER_CHECKPOINT_V196_HOST_TESTS_OK")

 def test_no_media_or_network_mutation_capabilities(self):
  body=SOURCE.read_text()
  for banned in ("CameraManager","MediaCodec","ClipClassifier",
                 "adb push","am force-stop","HttpServer","Files.delete(",
                 ".mp4\"","new URL(","send_response("):
   self.assertNotIn(banned,body)
  for required in ("StandardCopyOption.ATOMIC_MOVE","FileLock locked=channel.lock()",
                   "stream.getFD().sync()","root.force(true)",
                   "trusted_checkpoint_cas_conflict",
                   "trusted_checkpoint_must_not_be_on_micro_sd",
                   "durableAnchorVerified","mayRemoveOriginal()"):
   self.assertIn(required,body)
  self.assertIn("complete_delete_tombstone_missing",TEST.read_text())
  self.assertIn("wrong_checkpoint_key",TEST.read_text())

if __name__=="__main__":unittest.main(verbosity=2)
