#!/usr/bin/env python3
"""Host-only canonical V230 preimage comparison; NO device or live enrollment."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

ROOT=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location(
    "v235",ROOT/"s9_migrated_enrollment_provenance_crosscheck_v235.py")
V235=importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(V235)
NAMES=[f"synthetic_179280000{i}000.mp4" for i in range(6)]
SHA="a"*64

def manifest_rows():
    return [{"name":name,"sha256":SHA,
             "bytes":214121934 if i==5 else 12000,
             "hash_complete":True}
            for i,name in enumerate(NAMES)]

class Crosscheck(unittest.TestCase):
 def setUp(self):
  self.temp=tempfile.TemporaryDirectory(prefix="v235-synthetic-")
  self.addCleanup(self.temp.cleanup)
  self.root=Path(self.temp.name)
  self.first=self.root/"c720p-hashes.json"
  self.second=self.root/"s9-hashes.json"
  self.source={"schema":V235.SCHEMA,"role":V235.ORIGINAL_ROLE,
               "items":manifest_rows()}
  self.copy={"schema":V235.SCHEMA,"role":V235.COPIED_ROLE,
               "items":list(reversed(manifest_rows()))}
  self.write()
 def write(self):
  self.first.write_text(json.dumps(self.source))
  self.second.write_text(json.dumps(self.copy))
 def denies(self,message):
  self.write()
  with self.assertRaises(V235.UnverifiedProvenance) as found:
   V235.candidate_comparison(self.first,self.second)
  self.assertIn(message,str(found.exception))
 def test_matching_independently_named_reports_never_approved(self):
  out=V235.candidate_comparison(self.first,self.second)
  expected="S9-MIGRATED-MANIFEST-V216|1|6\n"
  for row in sorted(manifest_rows(),key=lambda x:x["name"]):
   expected+=f"FILE|{row['name']}|{row['sha256']}|{row['bytes']}|1\n"
  self.assertEqual(out["candidate_manifest_preimage_sha256"],
    hashlib.sha256(expected.encode("ascii")).hexdigest())
  self.assertEqual(out["source_bytes"],214181934)
  self.assertEqual(out["source_count"],6)
  self.assertEqual(out["manifest_generation"],1)
  self.assertFalse(out["independently_authenticated"])
  self.assertFalse(out["human_owner_approved"])
  self.assertFalse(out["keystore_enrolled"])
  self.assertFalse(out["allows_signed_actions"])
  self.assertFalse(out["allows_media_retirement"])
  self.assertNotIn("approve_once",out)
 def test_copy_mismatch_does_not_yield_candidate(self):
  self.copy["items"][0]["sha256"]="b"*64
  self.denies("independent_inventory_bytes_or_digest_mismatch")
 def test_byte_size_mismatch_rejected(self):
  self.copy["items"][0]["bytes"]+=1
  self.denies("six_original_source_total_mismatch")
 def test_incomplete_hash_rejected(self):
  self.copy["items"][0]["hash_complete"]=False
  self.denies("unverified_source_hashing")
 def test_duplicate_source_refused(self):
  self.copy["items"][1]["name"]=self.copy["items"][0]["name"]
  self.denies("duplicate_source_name")
 def test_noncanonical_name_and_uppercase_sha_refused(self):
  self.copy["items"][0]["name"]="../private.mp4"
  self.denies("invalid_source_name")
  self.copy["items"][0]["name"]=NAMES[5]
  self.copy["items"][0]["sha256"]="F"*64
  self.denies("invalid_source_sha256")
 def test_wrong_role_and_extraneous_authority(self):
  self.copy["role"]=V235.ORIGINAL_ROLE
  self.denies("inventory_role_not_independently_identified")
  self.copy["role"]=V235.COPIED_ROLE
  self.copy["owner_approved"]=True
  self.denies("unrecognized_report_schema")
 def test_types_exact_and_bounds(self):
  self.copy["items"][0]["bytes"]=True
  self.denies("invalid_source_bytes")
  self.copy["items"][0]["bytes"]=12000.0
  self.denies("invalid_source_bytes")
 def test_report_json_duplicate_key_denied(self):
  self.write()
  raw=self.first.read_text()
  raw=raw.replace('"role":', '"role":"forged","role":',1)
  self.first.write_text(raw)
  with self.assertRaisesRegex(V235.UnverifiedProvenance,"duplicate_json_key"):
   V235.candidate_comparison(self.first,self.second)
 def test_symlink_to_fake_source_denied(self):
  self.write()
  link=self.root/"linked.json"
  link.symlink_to(self.first)
  with self.assertRaisesRegex(V235.UnverifiedProvenance,"report_must_be_regular_file"):
   V235.candidate_comparison(link,self.second)
 def test_does_not_touch_system_or_approval(self):
  src=(ROOT/"s9_migrated_enrollment_provenance_crosscheck_v235.py").read_text()
  for forbidden in ("subprocess", "android.keystore", "adb", "urllib",
                    "requests", "socket", "os.system", "os.remove", "unlink(",
                    "enrollOnce(", "VirginApproval(", "chmod("):
   self.assertNotIn(forbidden,src)
  self.assertIn('"human_owner_approved":False',src)
  self.assertIn('"allows_media_retirement":False',src)

if __name__=="__main__":unittest.main(verbosity=2)
