#!/usr/bin/env python3
"""Host Java8 synthetic only. No Android service, action credentials or originals."""
from pathlib import Path
import subprocess,tempfile,unittest

ROOT=Path(__file__).resolve().parent
SOURCES=[
 "S9MigratedMetadataLedgerV193.java",
 "S9MigratedLedgerTrustedCheckpointV196.java",
 "S9MigratedDualStoreCommitV197.java",
 "S9MigratedSignedActionV198.java",
 "S9MigratedSignedCommitGateV201.java",
 "S9MigratedActionWireV231.java",
 "S9MigratedPostcommitV232.java",
 "S9MigratedPostcommitTestV232.java",
]
class Tests(unittest.TestCase):
 def test_java8_signed_action_durable_replay_restart(self):
  with tempfile.TemporaryDirectory(prefix="s9-v232-fake-root-") as target:
   compiled=subprocess.run(["javac","-source","8","-target","8","-d",target]+[
      str(ROOT/name) for name in SOURCES],
      capture_output=True,text=True,timeout=60)
   self.assertEqual(compiled.returncode,0,compiled.stderr)
   tested=subprocess.run(["java","-cp",target,
      "nl.kalenel.s9offline.S9MigratedPostcommitTestV232"],
      capture_output=True,text=True,timeout=40)
   self.assertEqual(tested.returncode,0,tested.stderr)
   self.assertEqual(tested.stdout.strip(),
      "S9_MIGRATED_POSTCOMMIT_V232_HOST_VERIFIED")
 def test_source_is_nonnetwork_and_no_retirement(self):
  text=(ROOT/"S9MigratedPostcommitV232.java").read_text()
  for gate in ("S9MigratedActionWireV231.decode",
     "approvalGate.commit(","journal.currentDecisions(",
     "postcommit_checkpoint_mismatch",
     "postcommit_action_state_mismatch",
     "authorizesMediaRetirement(){return false;}",
     "hasListener(){return false;}",
     "provisionsEnrollment(){return false;}"):
   self.assertIn(gate,text)
  for dangerous in ("new ServerSocket(", "HttpServer(", "KeyGenerator",
                    "deleteFile(", "Files.delete(", "Runtime.getRuntime()",
                    "CameraManager", "enableForBrowser(", "set-ntp"):
   self.assertNotIn(dangerous,text)
if __name__=="__main__":unittest.main(verbosity=2)
