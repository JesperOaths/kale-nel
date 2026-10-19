#!/usr/bin/env python3
"""Offline regression for C720P metadata-only, preserve-original timing scan."""
import hashlib
import importlib.util
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location("s9_timing_refresh_v127",
    HERE/"refresh-s9-timing-proof-v127.py")
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
SHA="a"*64
def data(with_timing=True):
 m={"sha256":SHA,"duration_ms":22000,"width":3840,"height":2160}
 if with_timing:m.update({
  "capture_segment_end_reason":"quiet_end",
  "capture_segment_configured_quiet_hold_ms":10000,
  "capture_segment_start_elapsed_ms":100000,
  "capture_segment_stop_elapsed_ms":115000,
  "capture_segment_last_accepted_motion_age_at_stop_ms":10200})
 return {"schema_version":"s9_native_archive_catalog_v1",
   "records":{"motion_1792200000000.mp4":{
     "bytes":98765432,"version":"b"*64,"manifest":m}}}
class Tests(unittest.TestCase):
 def test_catalog_source_hash_protected(self):
  result=mod.integrity_snapshot(data())
  self.assertEqual(len(result),1)
  self.assertEqual(list(result.values())[0][2],SHA)
 def test_timing_group_all_or_nothing(self):
  self.assertEqual(mod.timing_counts(data(True)),1)
  self.assertEqual(mod.timing_counts(data(False)),0)
  record=data()
  record["records"]["motion_1792200000000.mp4"]["manifest"].pop(
   "capture_segment_last_accepted_motion_age_at_stop_ms")
  with self.assertRaisesRegex(RuntimeError,"partial_timing_evidence_group"):
   mod.timing_counts(record)
 def test_missing_prior_original_never_counted_as_success(self):
  old=mod.integrity_snapshot(data())
  later={}
  self.assertFalse(set(old).issubset(later))
 def test_no_write_in_preflight(self):
  current=data(False)
  with (patch.object(mod,"safe_read",return_value=b"a"*1000),
        patch.object(mod,"verify_capture",return_value={"temperature_c":35.0}),
        patch.object(mod,"catalog",return_value=current),
        patch.object(mod,"show",return_value="inactive"),
        patch.object(mod,"start",side_effect=AssertionError("must not start"))):
   # Artificial module data cannot equal pinned validator; stub digest only.
   with patch.object(mod,"sha",return_value=mod.VALIDATOR_SHA):
    self.assertEqual(mod.refresh(False),"preflight")
 def test_single_verified_timing_clip_is_not_false_complete(self):
  current=data(False);updated=data(True)
  values=iter((current,updated))
  state=iter(("inactive","inactive"))
  commands=[]
  def scanner(unit,timeout):
   commands.append(unit)
  with (patch.object(mod,"safe_read",side_effect=lambda p,n:
         b"a"*1000 if p==mod.VALIDATOR else b'{"schema_version":"s9_native_saved_prefix_quiet_hold_proof_v1","eligible_count":0,"complete":false}'),
        patch.object(mod,"sha",return_value=mod.VALIDATOR_SHA),
        patch.object(mod,"verify_capture",return_value={"temperature_c":35.0}),
        patch.object(mod,"catalog",side_effect=lambda:next(values)),
        patch.object(mod,"show",return_value="inactive"),
        patch.object(mod,"start",side_effect=scanner)):
   self.assertEqual(mod.refresh(True),"verified")
  self.assertEqual(commands,[mod.CATALOG_UNIT,mod.PROOF_UNIT])
 def test_older_proof_cannot_claim_validated_saved_timing(self):
  current=data(False);updated=data(True)
  values=iter((current,updated))
  oldproof=(b'{"schema_version":"s9_native_saved_prefix_quiet_hold_proof_v1",'
            b'"eligible_count":3,"complete":true}')
  def stored(path,limit):
   if path==mod.VALIDATOR:return b"a"*1000
   return oldproof
  with (patch.object(mod,"safe_read",side_effect=stored),
        patch.object(mod,"sha",return_value=mod.VALIDATOR_SHA),
        patch.object(mod,"verify_capture",return_value={"temperature_c":35.0}),
        patch.object(mod,"catalog",side_effect=lambda:next(values)),
        patch.object(mod,"show",return_value="inactive"),
        patch.object(mod,"start",return_value=None)):
   self.assertEqual(mod.refresh(True),"verified")
  code=(HERE/"refresh-s9-timing-proof-v127.py").read_text()
  self.assertIn('proof.get("freshness_guard_active") is True',code)
  self.assertIn('"proof_complete":safe_complete',code)
 def test_no_camera_or_recording_modification_apis(self):
  source=(HERE/"refresh-s9-timing-proof-v127.py").read_text()
  for forbidden in ("adb install","am force-stop","pm install","delete_original",
                    "camera.apk","review_decide","shutil.rmtree","Security4K"):
   self.assertNotIn(forbidden,source)
  self.assertIn("historical_original_hashes_unchanged",source)
  self.assertIn("unknown_live_sanitizer_do_not_overwrite",source)
if __name__=="__main__":unittest.main(verbosity=2)
