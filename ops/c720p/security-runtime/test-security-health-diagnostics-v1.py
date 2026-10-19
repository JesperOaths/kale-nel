#!/usr/bin/env python3
"""Synthetic health contracts: never contacts S9 or modifies user data."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
ROOT=Path(__file__).parent
spec=importlib.util.spec_from_file_location("health",ROOT/"security-health-diagnostics-v1.py")
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NOW=dt.datetime(2026,10,19,4,0,tzinfo=dt.timezone.utc)
def parameters():
 return {
   "now":NOW,"root_free_bytes":4*1024**3,"root_total_bytes":20*1024**3,
   "phone":{"ok":True,"native_4k_enabled":True,"continuous_4k_ready":True,
            "continuous_4k_dropped_output_frames":0,"mode":"watching"},
   "catalog":{"source":"S9_native_microSD_sidecar_metadata","read_only":True,
              "recordings":2,"generated_at_utc":NOW.isoformat(),
              "auxiliary_mp4_inventory":{"preroll_without_verified_primary":0}},
   "activity":{"source_recordings":{"s9_microSD":2,"historical_drive_verified_new":3},
               "total_recordings":5,"media_decoded":False,"s3_excluded":True},
   "ledger":{"checks":{
       "motion_1792000000000.mp4":{"original_sha256_matches":True},
       "motion_1792000000001.mp4":{"original_sha256_matches":True}}},
   "ntp":{"NTPSynchronized":"yes","NTP":"yes","CanNTP":"yes"},
   "skew_seconds":0.3,
 }
class Tests(unittest.TestCase):
 def test_healthy_all_independent_proofs(self):
  d=m.evaluate(**parameters())
  self.assertEqual(d["overall_status"],"healthy")
  self.assertEqual(d["checks"]["combined_verified_recording_count"],5)
  self.assertTrue(d["checks"]["original_integrity_coverage_complete"])
  self.assertEqual(d["issues"],[])
  self.assertFalse(d["s3_included"])
  self.assertFalse(d["clock_changed"])
 def test_clock_and_low_disk_are_alerts_not_fake_repairs(self):
  args=parameters();args["root_free_bytes"]=650*1024**2
  args["ntp"]={"NTPSynchronized":"no","CanNTP":"no"}
  args["skew_seconds"]=92.0
  d=m.evaluate(**args)
  flags={issue["code"] for issue in d["issues"]}
  self.assertIn("c720p_root_space_low",flags)
  self.assertIn("c720p_ntp_unsynchronized",flags)
  self.assertIn("c720p_clock_offset_exceeds_30_seconds",flags)
  self.assertFalse(d["clock_changed"])
  self.assertFalse(d["automations_modified"])
 def test_camera_failure_is_critical_and_never_hidden(self):
  args=parameters();args["phone"]["continuous_4k_ready"]=False
  d=m.evaluate(**args)
  self.assertEqual(d["overall_status"],"critical")
  self.assertIn("s9_capture_not_confirmed_healthy",[x["code"] for x in d["issues"]])
 def test_digest_mismatch_requires_review_not_quarantine(self):
  args=parameters()
  args["ledger"]["checks"]["motion_1792000000000.mp4"]["original_sha256_matches"]=False
  d=m.evaluate(**args)
  self.assertEqual(d["overall_status"],"critical")
  self.assertEqual(d["checks"]["original_digest_mismatches"],1)
  self.assertFalse(d["originals_modified"])
  self.assertFalse(d["manual_reviews_modified"])
 def test_stale_catalog_and_archive_count_disagreement_visible(self):
  args=parameters();args["catalog"]["generated_at_utc"]="2026-10-18T21:00:00+00:00"
  args["activity"]["source_recordings"]["s9_microSD"]=1
  args["activity"]["total_recordings"]=4
  issues={x["code"] for x in m.evaluate(**args)["issues"]}
  self.assertIn("s9_catalog_unavailable_or_stale",issues)
  self.assertIn("combined_activity_catalog_count_mismatch",issues)
 def test_partial_digest_coverage_and_orphan_prerolls_flagged(self):
  args=parameters()
  args["ledger"]["checks"].pop("motion_1792000000001.mp4")
  args["catalog"]["auxiliary_mp4_inventory"]["preroll_without_verified_primary"]=136
  d=m.evaluate(**args)
  codes={x["code"] for x in d["issues"]}
  self.assertIn("original_integrity_audit_incomplete",codes)
  self.assertIn("unpaired_preroll_evidence_pending_classification",codes)
 def test_private_atomic_output_and_symlink_rejection(self):
  with tempfile.TemporaryDirectory() as folder:
   path=Path(folder)/"security-health.json"
   m.atomic_write(path,m.evaluate(**parameters()))
   self.assertEqual(path.stat().st_mode&0o777,0o600)
   target=Path(folder)/"link.json"
   target.symlink_to(path)
   with self.assertRaises(ValueError):m.atomic_write(target,{"never":True})
   self.assertTrue(json.loads(path.read_text())["originals_modified"] is False)
if __name__=="__main__":unittest.main(verbosity=2)
