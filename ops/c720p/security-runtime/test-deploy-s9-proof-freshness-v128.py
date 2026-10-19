#!/usr/bin/env python3
"""No-device tests for exact source version and post-upgrade timing verifier."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import json
ROOT=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("freshness_v128",
   ROOT/"deploy-s9-proof-freshness-v128.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class Checks(unittest.TestCase):
 def test_missing_version_never_accepted(self):
  with self.assertRaisesRegex(RuntimeError,"unknown_saved_proof_schema"):
   m.checked_proof(b'{"schema_version":"invented","complete":true}')
  with self.assertRaisesRegex(RuntimeError,"unknown_saved_proof_schema"):
   m.checked_proof(json.dumps({"schema_version":m.SCHEMA,"complete":"yes"}).encode())
 def test_valid_incomplete_proof(self):
  doc=m.checked_proof(json.dumps({"schema_version":m.SCHEMA,
    "complete":False,"eligible_count":1,"freshness_guard_active":True}).encode())
  self.assertFalse(doc["complete"])
  self.assertEqual(doc["eligible_count"],1)
 def test_exact_previous_source_required(self):
  with tempfile.TemporaryDirectory() as directory:
   path=Path(directory)/"old";path.write_bytes(b"old")
   with self.assertRaisesRegex(RuntimeError,"exact_source_digest_mismatch"):
    m.source(path,"a"*64)
 def test_full_rollback_contract(self):
  src=(ROOT/"deploy-s9-proof-freshness-v128.py").read_text()
  for text in ("freshness_guard_active","pre_upgrade_excluded",
               "rollout_cutoff_not_applied","newer_live_timing_proof_do_not_overwrite",
               "atomic(MODULE,current)","atomic(PROOF,","proof_worker_busy"):
   self.assertIn(text,src)
  for banned in ("pm install","am force-stop","adb install","delete_original",
                 "Security4K","review_decide","os.system("):
   self.assertNotIn(banned,src)
 def test_old_source_can_never_claim_new_gate(self):
  old=(ROOT/"s9_7s_saved_timing_proof_v1.py").read_text()
  self.assertIn("def verified_rollout_epoch_ms(",old)
  self.assertIn("after_rollout_ms=cutoff",old)
if __name__=="__main__":unittest.main(verbosity=2)
