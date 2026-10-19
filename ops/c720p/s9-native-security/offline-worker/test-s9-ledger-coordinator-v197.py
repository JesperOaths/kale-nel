#!/usr/bin/env python3
"""Host-only Java 8 synthetic dual-store Save/Delete safety regression."""
from pathlib import Path
import subprocess
import tempfile
import unittest
R=Path(__file__).resolve().parent
SRC=["S9MigratedMetadataLedgerV193.java",
     "S9MigratedLedgerTrustedCheckpointV196.java",
     "S9MigratedLedgerCoordinatorV197.java",
     "S9MigratedLedgerCoordinatorTestV197.java"]

class DualStore(unittest.TestCase):
 def test_host_crash_and_prefix_rollback(self):
  with tempfile.TemporaryDirectory(prefix="s9-v197-coordinator-") as td:
   p=subprocess.run(["javac","-source","8","-target","8","-d",td,
     *[str(R/n) for n in SRC]],capture_output=True,text=True,timeout=45)
   self.assertEqual(p.returncode,0,p.stderr)
   p=subprocess.run(["java","-cp",td,"nl.kalenel.s9offline.S9MigratedLedgerCoordinatorTestV197"],
     capture_output=True,text=True,timeout=35)
   self.assertEqual(p.returncode,0,p.stderr)
   self.assertEqual(p.stdout.strip(),"S9_DUALSTORE_COORDINATOR_V197_HOST_TESTS_OK")
 def test_no_live_actions(self):
  s=(R/SRC[2]).read_text()
  for disallowed in ("CameraManager","MediaCodec","HttpServer","Files.delete(",
                     ".delete()","Files.move(","new URL(","android.app.",
                     "am force-stop","adb push","ProcessBuilder"):
   self.assertNotIn(disallowed,s)
  for expected in ("anchor.advance(","journal.requireTrustedHead(",
                   "dualstore_receipt_not_current","independentHeadVerified",
                   "dualstore_read_race","mayRemoveOriginal(){return false;}"):
   self.assertIn(expected,s)

if __name__=="__main__":unittest.main(verbosity=2)
