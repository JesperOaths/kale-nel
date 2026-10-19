#!/usr/bin/env python3
"""Host-only cross-language synthetic verification. No phone or real clips."""
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
RUNTIME=HERE.parent.parent/"security-runtime"
sys.path.insert(0,str(RUNTIME))
from s9_migrated_save_delete_contract_v181 import (
 ROOT,preview,receipt_authorized,canonical_receipt
)
JAVA=HERE/"S9MigratedMetadataLedgerV193.java"
TEST=HERE/"S9MigratedMetadataLedgerTestV193.java"
CLASS="nl.kalenel.s9offline.S9MigratedMetadataLedgerTestV193"
KEY=b"synthetic-test-only-s9-migrated-ledger-32-byte-secret"
NAME="motion_1792200000000.mp4"
ROW={NAME:{"sd_path":ROOT+"/"+NAME,"sha256":"a"*64,
          "bytes":123456,"indexed":True}}
EVENT={"clip":"clips/"+NAME,"saved":False,"other":"retained_review_context"}

class Ledger(unittest.TestCase):
 def test_synthetic_java_journal_and_python_v2_receipt_agree(self):
  with tempfile.TemporaryDirectory(prefix="s9-v193-javac-") as temp:
   compile=subprocess.run(["javac","-source","8","-target","8","-d",temp,
       str(JAVA),str(TEST)],capture_output=True,text=True,timeout=35)
   self.assertEqual(compile.returncode,0,"java_v193_compile_failed")
   run=subprocess.run(["java","-cp",temp,CLASS],
      capture_output=True,text=True,timeout=22)
   self.assertEqual(run.returncode,0,"java_v193_selftest_failed")
   lines=run.stdout.splitlines()
   self.assertIn("S9_LEDGER_V193_SYNTHETIC_TESTS_OK",lines)
   markers=[v.split("S9_LEDGER_V193_SYNTHETIC_RECEIPT ",1)[1]
      for v in lines if v.startswith("S9_LEDGER_V193_SYNTHETIC_RECEIPT ")]
   self.assertEqual(len(markers),1)
   receipt=json.loads(markers[0])
   self.assertTrue(receipt_authorized(
       receipt,NAME,ROW[NAME],"save",KEY))
   self.assertFalse(receipt_authorized(
       receipt,NAME,ROW[NAME],"delete",KEY))
   self.assertFalse(receipt_authorized(
       receipt,NAME,{**ROW[NAME],"bytes":123457},"save",KEY))
   self.assertFalse(receipt_authorized(
       receipt,NAME,ROW[NAME],"save",b"wrong-synthetic-key-at-least-32-bytes-x"))
   shadow=preview(NAME,EVENT,ROW,"save",receipt=receipt,secret=KEY)
   self.assertEqual(shadow.status,"shadow_only")
   self.assertFalse(shadow.may_remove_local_original)
   self.assertFalse(shadow.remote_mutation_executed)
   self.assertEqual(EVENT["other"],"retained_review_context")
   self.assertFalse(EVENT["saved"])

 def test_source_has_no_original_media_operation_or_live_endpoint(self):
  source=JAVA.read_text()
  for forbidden in ("void main(", "Files.delete(", ".delete()",
    ".renameTo(", "rm -rf", "CameraManager", "ImageReader",
    "ClipClassifier", "System.loadLibrary", "urlopen(",
    "VideoCapture", "MediaCodec", "Files.move("):
   self.assertNotIn(forbidden,source)
  self.assertIn("getFD().sync()",source)
  self.assertIn("FileLock held",source)
  self.assertIn("nonce_replay_conflict",source)
  self.assertIn("metadata_only",TEST.read_text())
  self.assertIn("mayRemoveOriginal()",source)
  self.assertIn("ledger_integrity_failed",source)
  self.assertIn("preprovisioned_private_ledger_required",source)

if __name__=="__main__":unittest.main(verbosity=2)
