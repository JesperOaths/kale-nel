#!/usr/bin/env python3
"""Synthetic negative signed-release checks; never generate production signer."""
from pathlib import Path
import json,os,tempfile,unittest
import verify_signed_release_v236 as signed
HERE=Path(__file__).resolve().parent

class SignedGateTests(unittest.TestCase):
 def test_missing_cert_never_accepted(self):
  with tempfile.TemporaryDirectory() as tmp:
   t=Path(tmp)
   apk=t/"empty.apk";apk.write_bytes(b"not an apk")
   recipe=t/"receipt.json"
   recipe.write_text(json.dumps({"schema":"s9_companion_unsigned_build_receipt_v234",
     "installed":False,"enrolled":False,"dex_sha256":"0"*64}))
   with self.assertRaises((ValueError,OSError)):
    signed.verify_signed(apk,t/"unapproved-x509.pem",recipe)
 def test_unsigned_actual_companion_cannot_pass_production_signature_gate(self):
  directory=os.environ.get("S9_COMPANION_STAGING_DIR")
  if not directory:self.skipTest("Build receipt provided only by CI actual unsigned APK")
  root=Path(directory)
  apk=root/"s9-migrated-companion-unenrolled-unsigned-preview-1169.apk"
  receipt=root/"companion-build-attestation-preview-1169.json"
  self.assertTrue(apk.exists() and receipt.exists())
  with tempfile.TemporaryDirectory() as tmp:
   false_cert=Path(tmp)/"unapproved.pem"
   false_cert.write_text("-----BEGIN CERTIFICATE-----\nno-signer-authority\n-----END CERTIFICATE-----\n")
   with self.assertRaises((ValueError,OSError)):
    signed.verify_signed(apk,false_cert,receipt)
  self.assertFalse((root/"approved-production-signer.json").exists())
 def test_never_conflate_crypto_with_human_approval(self):
  code=(HERE/"verify_signed_release_v236.py").read_text()
  for required in ("signer_owner_authority_verified","independent_source_enrollment_approved",
                   "device_package_installed","app_keys_enrolled","human_release_approval_required",
                   "signed_artifact_bytecode_diverged_from_pin","unapproved_or_multiple_signer_certificates"):
   self.assertIn(required,code)
  for forbidden in ("apksigner sign","keytool -genkey","adb install","pm grant","enrollFirstOnly(",
                    "Files.delete","force-stop"):
   self.assertNotIn(forbidden,code)
if __name__=="__main__":unittest.main(verbosity=2)
