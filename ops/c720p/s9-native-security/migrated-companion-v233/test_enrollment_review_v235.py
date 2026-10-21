#!/usr/bin/env python3
"""All fixtures are synthetic; these tests never represent a real approval."""
import hashlib
import unittest
from pathlib import Path
import importlib.util
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("six",ROOT/"prepare_enrollment_review_v235.py")
six=importlib.util.module_from_spec(spec)
spec.loader.exec_module(six)
class ReviewTests(unittest.TestCase):
 def fixture(self):
  sizes=[35_000_000]*5+[39_181_934]
  self.assertEqual(sum(sizes),214_181_934)
  return {"rows":[{"name":"synthetic_%d.mp4"%i,
        "c720p_original":{"sha256":hashlib.sha256(("source-%d"%i).encode()).hexdigest(),
             "bytes":sizes[i],"receipt_id":"original-fixture-%03d"%i},
        "s9_copy":{"sha256":hashlib.sha256(("source-%d"%i).encode()).hexdigest(),
             "bytes":sizes[i],"receipt_id":"copied-fixture-%03d"%i}}
             for i in range(6)]}
 def test_valid_synthetic_digest_matches_independent_preimage(self):
  inp=self.fixture(); d=six.canonical(inp["rows"])
  items=sorted(inp["rows"],key=lambda x:x["name"])
  pre="S9-MIGRATED-MANIFEST-V216|1|6\n"+"".join(
    "FILE|%s|%s|%d|1\n"%(x["name"],x["c720p_original"]["sha256"],
                 x["c720p_original"]["bytes"]) for x in items)
  self.assertEqual(d["canonical_preimage_sha256"],hashlib.sha256(pre.encode()).hexdigest())
  self.assertEqual(len(d["rows"]),6)
  self.assertEqual(d["total_bytes"],214181934)
  result=six.review(inp)
  self.assertFalse(result["approved"])
  self.assertFalse(result["ready_for_human_approval"])
  self.assertFalse(result["first_enrollment_performed"])
  self.assertFalse(result["original_media_removal_authorized"])
  self.assertEqual(result["production_signing_certificate_sha256"],None)
 def test_empty_template_avoids_fabricated_source_or_signer(self):
  result=six.review(None)
  self.assertIsNone(result["six"])
  self.assertIsNone(result["unsigned_apk_sha256"])
  self.assertIsNone(result["production_signing_certificate_sha256"])
  self.assertFalse(result["ready_for_human_approval"])
 def test_tampering_and_ambiguity_fail_closed(self):
  def rejects(mutator):
   payload=self.fixture();mutator(payload)
   with self.assertRaises(ValueError):six.canonical(payload["rows"])
  rejects(lambda d:d["rows"][0]["s9_copy"].update(bytes=35000001))
  rejects(lambda d:d["rows"][0]["s9_copy"].update(sha256="0"*64))
  rejects(lambda d:d["rows"][0].update(name=d["rows"][1]["name"]))
  rejects(lambda d:d["rows"][0].update(name="../person.mp4"))
  rejects(lambda d:d["rows"][0]["c720p_original"].update(receipt_id=""))
  rejects(lambda d:d["rows"].pop())
  rejects(lambda d:d["rows"][5]["c720p_original"].update(bytes=39181935))
 def test_no_cert_secret_allowed(self):
  import tempfile
  with tempfile.TemporaryDirectory() as d:
   p=Path(d)/"key.pem"
   p.write_text("-----BEGIN PRIVATE KEY-----\nnot-real\n")
   with self.assertRaises(ValueError):six.cert_fingerprint(p)
if __name__=="__main__":unittest.main(verbosity=2)
