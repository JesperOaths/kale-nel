#!/usr/bin/env python3
"""Synthetic fail-closed S9+ physical one-original acceptance contract."""
import importlib.util
import json
from pathlib import Path
import unittest

SRC=Path(__file__).with_name("run-s9-v3-single-original-pilot.py")
spec=importlib.util.spec_from_file_location("s9_single_pilot",SRC)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

class Safety(unittest.TestCase):
    def fixture(self):
        return {"selected":1,"counts":{"already_verified":0,"new_real_512d_vector":1},
                "new_histograms":1,"missing_histograms_remaining":0,
                "ranked_v3":True,"live_api_confirmed":False,
                "remaining_at_selection":158,"processed_this_pass":[
                    "motion_1700000000000.mp4"],
                "live_camera_modified":False,"originals_modified":False,
                "review_decisions_modified":False}

    def test_summarizes_only_aggregate_without_source_ids(self):
        result=m.checked_status(self.fixture())
        self.assertEqual(result["processed"],1)
        self.assertEqual(result["new_512d_vectors"],1)
        self.assertNotIn("motion_",json.dumps(result))
        self.assertEqual(result["raw_filenames_disclosed"],False)
        self.assertEqual(result["manual_review_decisions_modified"],False)

    def test_three_accepted_completion_states(self):
        for state in ("already_verified","new_real_512d_vector",
                      "no_qualified_person_box"):
            row=self.fixture()
            row["counts"]={state:1}
            self.assertEqual(sum(m.checked_status(row)[field] for field in (
               "already_verified","new_512d_vectors","no_qualified_person_box")),1)

    def test_rejects_corrupted_results_and_identity_claims(self):
        for field,bad in (
            ("selected",0),("selected",True),
            ("counts",{"new_real_512d_vector":True}),
            ("counts",{"stale_feature":1}),
            ("counts",{"new_real_512d_vector":1,"already_verified":1}),
            ("new_histograms",11),
            ("live_api_confirmed",True),
            ("ranked_v3","true"),
            ("originals_modified",True),
            ("review_decisions_modified",True),
            ("live_camera_modified",True),
            ("missing_histograms_remaining",-1)):
            with self.subTest(field=field,bad=bad):
                with self.assertRaises(RuntimeError):
                    m.checked_status({**self.fixture(),field:bad})

    def test_controller_is_hard_capped_and_no_auto_assignments(self):
        src=SRC.read_text()
        self.assertIn('"--limit","1","--apply"',src)
        self.assertIn('capture_output=True',src)
        self.assertIn('timeout=510',src)
        self.assertIn('camera,temperature=ctrl.readiness()',src)
        self.assertIn('before_approvals!=after_approvals',src)
        self.assertIn('original_archive_catalog_regressed',src)
        self.assertIn('private_output_suppressed',src)
        self.assertNotIn('print(child.stdout',src)
        self.assertNotIn('print(child.stderr',src)
        for forbidden in ("pm install","am force-stop","assign_person",
                          "write_review_decisions","unlink("):
            self.assertNotIn(forbidden,src)

if __name__=="__main__":unittest.main(verbosity=2)
