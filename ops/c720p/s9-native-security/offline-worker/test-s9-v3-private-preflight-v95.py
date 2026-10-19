#!/usr/bin/env python3
"""No-device checks for redacted V3 archive preflight and fail-closed policy."""
import importlib.util
from pathlib import Path
import unittest
from unittest import mock

SRC=Path(__file__).with_name("run-s9-v3-private-preflight-v95.py")
spec=importlib.util.spec_from_file_location("private_v3_preflight",SRC)
mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)

class Check(unittest.TestCase):
    def test_counts_without_names(self):
        raw={"eligible_originals":184,"previously_logged":4,
             "pending":180,"selected":["motion_1700000000000.mp4"],
             "videos_modified":False,"human_reviews_modified":False}
        result=mod.summarize(raw)
        self.assertEqual(result["candidate_count"],1)
        self.assertNotIn("motion_",str(result))
        self.assertEqual(result["pending"],180)
    def test_reject_unsafe_or_malformed_results(self):
        example={"eligible_originals":184,"previously_logged":0,"pending":184,
            "selected":[],"videos_modified":False,"human_reviews_modified":False}
        variants=[{"pending":-1},{"pending":True},{"selected":None},
                  {"selected":["/secrets/person.mp4"]},
                  {"selected":["motion_1.mp4"]*4},
                  {"human_reviews_modified":True},{"videos_modified":True}]
        for bad in variants:
            with self.subTest(bad=bad):
                with self.assertRaises((ValueError,TypeError)):
                    mod.summarize({**example,**bad})
    def test_wrapper_runs_controller_without_apply_and_redacts_stdout(self):
        source=SRC.read_text()
        self.assertIn('"--limit","3"',source)
        self.assertNotIn('"--apply"',source)
        self.assertIn('capture_output=True',source)
        self.assertIn('private_output_suppressed',source)
        self.assertIn('raw_filenames_disclosed',source)
        self.assertNotIn('print(child.stdout',source)
        self.assertNotIn('print(child.stderr',source)

if __name__=="__main__":unittest.main(verbosity=2)
