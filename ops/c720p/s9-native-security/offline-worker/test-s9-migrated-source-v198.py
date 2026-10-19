#!/usr/bin/env python3
"""Host only. No Android, imported MP4s, private keys, or service install."""
from pathlib import Path
import subprocess
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
FILES=(
 "S9MigratedMetadataLedgerV193.java",
 "S9MigratedLedgerTrustedCheckpointV196.java",
 "S9MigratedDualStoreCommitV197.java",
 "S9MigratedVerifiedSourceV198.java",
 "S9MigratedVerifiedSourceTestV198.java",
)
CLASS="nl.kalenel.s9offline.S9MigratedVerifiedSourceTestV198"

class VerifiedSource(unittest.TestCase):
 def test_synthetic_java8_stream_sha_and_separate_user_permission(self):
  with tempfile.TemporaryDirectory(prefix="s9-v198-source-host-only-") as out:
   cmd=["javac","-source","8","-target","8","-d",out]+[
     str(ROOT/n) for n in FILES]
   compiled=subprocess.run(cmd,capture_output=True,text=True,timeout=45)
   self.assertEqual(compiled.returncode,0,"java8_source_proof_compile_failed")
   result=subprocess.run(["java","-cp",out,CLASS],
      capture_output=True,text=True,timeout=45)
   self.assertEqual(result.returncode,0,"synthetic_source_proof_failed")
   self.assertEqual(result.stdout.strip(),
      "S9_MIGRATED_SHA_SOURCE_V198_HOST_ONLY_PASSED")
 def test_no_phone_or_delete_capability(self):
  body=(ROOT/FILES[-2]).read_text()
  for prohibited in ("Files.delete(","Files.write(","Files.move(",
       "Camera2","HttpServer","new URL(","am force-stop",
       "adb push","review_decide","MediaCodec","System.loadLibrary("):
   self.assertNotIn(prohibited,body)
  for required in ("LinkOption.NOFOLLOW_LINKS","MessageDigest.isEqual",
     "qualified_source_sha256_mismatch",
     "separate_action_authorization_refused",
     "qualified_source_changed_during_sha",
     "TrustedUserAuthorization","mutatesMedia(){return false;}"):
   self.assertIn(required,body)
  self.assertIn("on_disk_digest_validated",(ROOT/FILES[-1]).read_text())
  self.assertIn("qualified_source_file_not_regular",(ROOT/FILES[-1]).read_text())

if __name__=="__main__":unittest.main(verbosity=2)
