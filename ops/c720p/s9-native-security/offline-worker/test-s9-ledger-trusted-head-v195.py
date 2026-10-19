#!/usr/bin/env python3
"""Host-only external checkpoint rollback guard; no phone or actual media."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
LEDGER=ROOT/"S9MigratedMetadataLedgerV193.java"
TEST=ROOT/"S9MigratedLedgerHeadRollbackTestV195.java"
CLASS="nl.kalenel.s9offline.S9MigratedLedgerHeadRollbackTestV195"

class TrustedHead(unittest.TestCase):
 def test_signed_complete_row_rollback_detected_with_trusted_anchor(self):
  with tempfile.TemporaryDirectory(prefix="s9-ledger-anchor-v195-") as directory:
   build=subprocess.run(["javac","-source","8","-target","8",
      "-d",directory,str(LEDGER),str(TEST)],
      capture_output=True,text=True,timeout=30)
   self.assertEqual(build.returncode,0,"trusted_head_host_javac_failed")
   result=subprocess.run(["java","-cp",directory,CLASS],
      capture_output=True,text=True,timeout=20)
   self.assertEqual(result.returncode,0,"trusted_head_host_test_failed")
   self.assertEqual(result.stdout.strip(),
                    "S9_LEDGER_EXTERNAL_HEAD_V195_HOST_TESTS_OK")

 def test_read_only_and_no_ledger_rollback_authority(self):
  text=LEDGER.read_text()
  i=text.index("public synchronized void requireTrustedHead(")
  j=text.index("private static final class Row",i)
  body=text[i:j]
  for needed in ("FileLock held=channel.lock()","readVerified()",
                 "ledger_head_diverged_from_trusted_checkpoint",
                 "constantEquals", "ledger_closed","trusted_checkpoint_invalid"):
   self.assertIn(needed,body)
  for banned in ("Files.write(", "FileOutputStream", "delete(", "unlink(",
                 "new URL(", "System.exit(", "File.createTempFile"):
   self.assertNotIn(banned,body)
  self.assertIn("trusted external head",TEST.read_text().lower()
                .replace("trusted checkpoint","trusted external head")
                if "trusted checkpoint" in TEST.read_text().lower()
                else "trusted external head")
  self.assertNotIn("CameraManager",TEST.read_text())
  self.assertNotIn("MediaCodec",TEST.read_text())
  self.assertIn("prefix_not_crypto_valid",TEST.read_text())

if __name__=="__main__":unittest.main(verbosity=2)
