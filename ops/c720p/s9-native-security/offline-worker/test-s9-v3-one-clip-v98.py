#!/usr/bin/env python3
"""No-device tests for the private single-clip S9 V3 workload."""
import importlib.util
from pathlib import Path
import unittest
import tempfile
from unittest.mock import patch

spec=importlib.util.spec_from_file_location("one_clip",Path(__file__).with_name("run-s9-v3-one-clip-v98.py"))
w=importlib.util.module_from_spec(spec);spec.loader.exec_module(w)

def report(n=1,counts=None):
    return {"selected":n,"counts":counts if counts is not None else {"new_real_512d_vector":n},
        "originals_modified":False,"camera_apk_modified":False,
        "review_decisions_modified":False,"appearance_rankings_modified":False,
        "automatic_assignments_created":0,
        "ledger_phone_integrity_audit":{"checked":0,"stale":0,"reasons":{}}}

class OneClip(unittest.TestCase):
    def test_exact_private_ledger_receipt(self):
        out=w.summarize(report(),3,4)
        self.assertEqual(out["outcomes"],{"new_real_512d_vector":1})
        self.assertFalse(out["private_names_disclosed"])
        self.assertEqual(w.summarize(report(0,{}),0,0)["source_originals_processed"],0)
    def test_refuse_out_of_scope_and_false_counts(self):
        base=report()
        variants=[
            ({**base,"camera_apk_modified":True},1,2),
            ({**base,"review_decisions_modified":True},1,2),
            ({**base,"appearance_rankings_modified":True},1,2),
            ({**base,"automatic_assignments_created":1},1,2),
            ({**base,"selected":2,"counts":{"new_real_512d_vector":2}},1,3),
            ({**base,"counts":{"already_verified":True}},1,2),
            ({**base,"counts":{"new_real_512d_vector":0}},1,2),
            ({**base,"counts":{"unverified":1}},1,2),
            ({**base,"ledger_phone_integrity_audit":{}},1,2),
            (base,1,1),
        ]
        for item,before,after in variants:
            with self.subTest(item=item):
                with self.assertRaises(ValueError):
                    w.summarize(item,before,after)
    def test_symlink_ledger_fails_closed(self):
        with tempfile.TemporaryDirectory() as tmp:
            original=w.LEDGER
            dest=Path(tmp)/"other";dest.write_text("sensitive")
            symlink=Path(tmp)/"ledger";symlink.symlink_to(dest)
            w.LEDGER=symlink
            try:
                with self.assertRaises(RuntimeError):w.ledger_lines()
            finally:w.LEDGER=original
    def test_no_private_child_output_emitted(self):
        source=Path(w.__file__).read_text()
        self.assertIn("capture_output=True",source)
        self.assertNotIn("print(result.stdout",source)
        self.assertNotIn("print(result.stderr",source)
        self.assertIn('"--apply","--limit","1","--roi-only"',source)

if __name__=="__main__":unittest.main(verbosity=2)
