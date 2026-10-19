#!/usr/bin/env python3
"""No-device regression tests for bounded source-qualified S9 archive processing."""
import importlib.util
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parent
def load(alias,name):
    p=ROOT/name
    spec=importlib.util.spec_from_file_location(alias,p)
    obj=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(obj)
    return obj

s=load("s9_v3_archive_loop_test","run-s9-v3-resumable-archive.py")
roi=load("s9_v3_source_target_test","backfill-s9-original-roi-osnet-temporal-v2.py")
hsv=load("s9_v3_hsv_missing_test","backfill-s9-hsv32-uniform-v2.py")

class Archive(unittest.TestCase):
    def test_expected_name_guards_growing_archive_reorder(self):
        a="motion_1700000000000.mp4"
        b="motion_1700000001000.mp4"
        roi.verify_expected_clip([(False,a,{})],a)
        with self.assertRaisesRegex(RuntimeError,"reordered"):
            roi.verify_expected_clip([(False,b,{})],a)
        with self.assertRaisesRegex(RuntimeError,"reordered"):
            roi.verify_expected_clip([(False,a,{}),(False,b,{})],a)

    def test_resumable_ledger_and_safe_status_contract(self):
        with tempfile.TemporaryDirectory() as temp:
            old=s.LEDGER
            s.LEDGER=Path(temp)/"source-ledger.jsonl"
            self.addCleanup(setattr,s,"LEDGER",old)
            self.assertEqual(s.reviewed_ledger(),{})
            clip="motion_1700000000000.mp4"
            s.append_ledger(clip,"no_qualified_person_box")
            self.assertEqual(s.reviewed_ledger()[clip],"no_qualified_person_box")
            s.append_ledger(clip,"new_real_512d_vector")
            self.assertEqual(s.reviewed_ledger()[clip],"new_real_512d_vector")
            with self.assertRaises(RuntimeError):
                s.append_ledger("../escape.mp4","already_verified")
            status=s.single_status({
                "attempted":1,"counts":{"new_real_512d_vector":1},
                "human_review_required":True,
                "recordings_modified":False,
                "camera_apk_modified":False,
                "review_decisions_modified":False})
            self.assertEqual(status,"new_real_512d_vector")
            with self.assertRaises(RuntimeError):
                s.single_status({
                    "attempted":1,"counts":{"auto_identity_assigned":1},
                    "human_review_required":True,"recordings_modified":False,
                    "camera_apk_modified":False,"review_decisions_modified":False})

    def test_single_status_mixed_zero_counts_and_invalid_values(self):
        base={"attempted":1,"human_review_required":True,
              "recordings_modified":False,"camera_apk_modified":False,
              "review_decisions_modified":False}
        valid={"already_verified":0,"new_real_512d_vector":1,
               "no_qualified_person_box":0}
        self.assertEqual(s.single_status({**base,"counts":valid}),
                         "new_real_512d_vector")
        for invalid in (
            {"already_verified":True,"new_real_512d_vector":0},
            {"already_verified":-1,"new_real_512d_vector":2},
            {"already_verified":0,"new_real_512d_vector":0},
            {"already_verified":1,"new_real_512d_vector":1},
            {"stale_feature":1},
            {}):
            with self.subTest(invalid=invalid):
                with self.assertRaises(RuntimeError):
                    s.single_status({**base,"counts":invalid})

    def test_missing_only_requires_explicit_v3_mode(self):
        source=(ROOT/"backfill-s9-hsv32-uniform-v2.py").read_text()
        self.assertIn('if opts.missing_only:',source)
        self.assertIn('not opts.include_unreviewed or opts.offset!=0',source)
        self.assertIn('if include_unreviewed',source)
        self.assertIn('backfill-s9-original-roi-osnet-temporal-v2.py',source)
        self.assertIn('backfill-s9-original-person-roi-osnet.py',source)
        orchestrator=(ROOT/"run-s9-v3-resumable-archive.py").read_text()
        self.assertIn('"--expected-clip",clip,"--apply"',orchestrator)
        self.assertIn('if len(catalog)>=58 and missing_remaining==0',orchestrator)
        self.assertIn('active_count<len(catalog)',orchestrator)
        self.assertIn('missing_histograms_remaining',orchestrator)
        self.assertIn('"--missing-only","--limit",',orchestrator)
        self.assertIn('str(count),"--write"',orchestrator)
        self.assertIn("review_decisions_modified",orchestrator)
        self.assertIn("v1_v2_indices_sha256_unchanged",orchestrator)
        ranking=(ROOT/"run-s9-uniform-appearance-rankings-v3.py").read_text()
        self.assertIn("s9-ranking-v3-400-worker.jar",ranking)
        self.assertNotIn("s9-ranking-v3-worker.jar",ranking)
        for code in (source,orchestrator):
            for banned in ("pm install","am force-stop","delete_original",
                           "review_decide"):
                self.assertNotIn(banned,code)

    def test_archive_dry_run_no_remote_write(self):
        from types import SimpleNamespace
        clips=[(False,"motion_1700000000000.mp4",{}),
               (True,"motion_1700000001000.mp4",{})]
        with patch.object(s,"helper",side_effect=[
                 SimpleNamespace(),SimpleNamespace()]),\
             patch.object(s,"capture_candidate_list",return_value=clips),\
             patch.object(s,"reviewed_ledger",return_value={
                 "motion_1700000000000.mp4":"already_verified"}),\
             patch.object(sys,"argv",["run-s9-v3-resumable-archive.py"]):
            s.main()

if __name__=="__main__":unittest.main(verbosity=2)
