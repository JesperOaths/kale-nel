#!/usr/bin/env python3
"""Distinguish corrupt on-phone JSON from truncated ADB transport; no device I/O."""
import hashlib
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("private_sidecar_v114",HERE/"backfill-s9-hsv32-uniform-v2.py")
helper=importlib.util.module_from_spec(spec);spec.loader.exec_module(helper)
PATH="/data/local/tmp/s9_worker/features/"+"a"*64+"-visual.json"
VALID='{"schema":"s9_offline_appearance_embedding_v1","model_type":"visual","safe":true,"repeat":"'+("a"*100)+'"}'
SHA=lambda data:hashlib.sha256(data.encode("utf-8")).hexdigest()

class FeatureTransport(unittest.TestCase):
 def invoke(self,sequence,sha):
  reads=iter(sequence)
  with patch.object(helper,"adb",side_effect=lambda *args,**kw:SimpleNamespace(stdout=next(reads))),\
       patch.object(helper,"remote_sha",return_value=sha) as remote:
   answer=helper.phone_json(PATH)
   return answer,remote.call_count
 def test_normal_valid_read_has_no_extra_hash_calls(self):
  d,n=self.invoke([VALID],SHA(VALID))
  self.assertEqual(d["model_type"],"visual")
  self.assertEqual(n,0)
 def test_transient_non_json_recovers_exact_data(self):
  d,n=self.invoke(["ADB-truncated-"+("x"*80),VALID],SHA(VALID))
  self.assertTrue(d["safe"])
  self.assertEqual(n,1)
 def test_persistently_indeterminate_transfer_defers(self):
  with self.assertRaisesRegex(RuntimeError,"transfer indeterminate"):
   self.invoke(["bad-data"*12,"bad-data"*12],SHA(VALID))
 def test_existing_corrupt_remote_is_not_silently_skipped(self):
  broken="NOT-JSON-"+("x"*90)
  with self.assertRaisesRegex(RuntimeError,"descriptor is malformed"):
   self.invoke([broken],SHA(broken))
 def test_parsable_non_object_is_rejected(self):
  body='["'+("x"*100)+'"]'
  with self.assertRaisesRegex(RuntimeError,"not a JSON object"):
   self.invoke([body],SHA(body))
 def test_transport_error_not_misrepresented_as_missing_file(self):
  with patch.object(helper,"adb",side_effect=RuntimeError("S9 unavailable")):
   with self.assertRaisesRegex(RuntimeError,"S9 unavailable"):
    helper.phone_json(PATH)
 def test_unchanged_phone_sha_reader_policy(self):
  code=(HERE/"backfill-s9-hsv32-uniform-v2.py").read_text()
  self.assertIn("def remote_exists(path)",code)
  self.assertIn("result.returncode==1 and not result.stderr.strip()",code)
  self.assertNotIn("automatic_person_assignments_created",code)

if __name__=="__main__":unittest.main(verbosity=2)
