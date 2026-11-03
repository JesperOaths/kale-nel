#!/usr/bin/env python3
"""Read-only verification of an explicitly pinned, unsigned preview APK."""
from pathlib import Path
import hashlib,json,os,subprocess,sys,unittest,zipfile
HERE=Path(__file__).resolve().parent
PREVIEW="source-pins-preview-1169.json"
EXPECTED="58fe20a65561b4283153c1249228790905b93027"
CORRECTED_SHA="a252b747806f7dc8068225960da37b0941787d18e97ffb1e5e5326a3b6c1c740"
class Tests(unittest.TestCase):
 def test_preview_pin_must_not_redefine_main_v233_source(self):
  live=json.loads((HERE/"source-pins.json").read_text())
  preview=json.loads((HERE/PREVIEW).read_text())
  self.assertEqual(preview["revision"],EXPECTED)
  self.assertEqual(len(preview["files"]),20)
  self.assertEqual(len({x["name"] for x in preview["files"]}),20)
  orig={r["name"]:r for r in live["files"]}
  for r in preview["files"]:
   self.assertEqual(r["pinned_ref"],EXPECTED)
   self.assertEqual(len(r["sha256"]),64)
   if r["name"]!="S9MigratedActionWireV231":
    self.assertEqual(r["sha256"],orig[r["name"]]["sha256"])
    self.assertEqual(r["bytes"],orig[r["name"]]["bytes"])
   else:
    self.assertEqual(r["sha256"],CORRECTED_SHA)
    self.assertEqual(r["bytes"],3862)
 def test_built_preview_is_exact_parser_signedness_and_checksum(self):
  directory=os.environ.get("S9_COMPANION_STAGING_DIR")
  if not directory:
   self.skipTest("set S9_COMPANION_STAGING_DIR to verify built APK receipt")
  root=Path(directory)
  apk=root/"s9-migrated-companion-unenrolled-unsigned-preview-1169.apk"
  att=root/"companion-build-attestation-preview-1169.json"
  self.assertTrue(apk.is_file() and att.is_file(),"exact candidate build absent")
  report=json.loads(att.read_text())
  self.assertEqual(report["source_pin_revision"],EXPECTED)
  self.assertEqual(report["source_pin_manifest"],PREVIEW)
  self.assertEqual(report["parser_sha256"],CORRECTED_SHA)
  self.assertFalse(report["signature_verified"])
  self.assertFalse(report["installed"])
  self.assertFalse(report["enrolled"])
  self.assertFalse(report["contains_android_service"])
  self.assertEqual(hashlib.sha256(apk.read_bytes()).hexdigest(),
                   report["unsigned_apk_sha256"])
  self.assertEqual(apk.stat().st_size,report["unsigned_apk_bytes"])
  self.assertLess(apk.stat().st_size,2_000_000)
  with zipfile.ZipFile(apk) as z:
   self.assertEqual(set(z.namelist()),{"AndroidManifest.xml","classes.dex"})
   dex=z.read("classes.dex")
   self.assertIn(b"wire_decimal_leading_zero_",dex)
   self.assertEqual(hashlib.sha256(dex).hexdigest(),report["dex_sha256"])
   self.assertEqual(hashlib.sha256(z.read("AndroidManifest.xml")).hexdigest(),
                    report["packaged_manifest_sha256"])
  self.assertEqual(report["manifest_sha256_scope"],"source_xml_pre_aapt")
  self.assertEqual(hashlib.sha256((HERE/"AndroidManifest.xml").read_bytes()).hexdigest(),
                   report["manifest_sha256"])
  for f in ("AndroidManifest.xml","source-pins.json",PREVIEW):
   self.assertTrue((HERE/f).is_file())
  raw=subprocess.run(["apksigner","verify","--min-sdk-version","29",str(apk)],
     capture_output=True,timeout=20)
  self.assertNotEqual(raw.returncode,0,"Unsigned preview unexpectedly signed")
if __name__=="__main__":unittest.main(verbosity=2)
