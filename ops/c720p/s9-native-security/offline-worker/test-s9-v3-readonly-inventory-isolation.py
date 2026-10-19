#!/usr/bin/env python3
"""Offline tests for bounded source-qualified S9 V3 inventory diagnostics."""
from pathlib import Path
import importlib.util
import unittest
from unittest.mock import patch
from types import SimpleNamespace

SRC=Path(__file__).with_name("run-s9-v3-readonly-inventory-isolation.py")
spec=importlib.util.spec_from_file_location("s9_v3_inventory_probe",SRC)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

class Dummy:
    ROOT="/data/local/tmp/s9_worker"
    def __init__(self):
        self.safe_checks=0
    def inventory(self,include_unreviewed=False):
        assert include_unreviewed
        return [
          {"key":f"{i+1:064x}","crop_sha256":"f"*64,
           "cohort":"v40" if i<51 else "approved_new"}
          for i in range(57)]
    def remote_exists(self,path):
        return not path.endswith("1-hsv-v2.json")
    def safe_visual(self,key,crop):
        self.safe_checks+=1
        return True

class Checks(unittest.TestCase):
    def test_produces_aggregate_only_and_no_identifiers(self):
        fake=Dummy()
        with patch.object(m,"sibling",return_value=fake):
            report=m.audit()
        self.assertTrue(report["ok"])
        self.assertEqual(report["inventory_crops"],57)
        self.assertEqual(report["v40_crops"],51)
        self.assertEqual(report["approved_new_crops"],6)
        self.assertEqual(report["sample_osnet_valid"],5)
        self.assertFalse(report["identifiers_disclosed"])
        self.assertNotIn("key",report)
        self.assertEqual(fake.safe_checks,5)
    def test_failure_categories_are_constant_codes(self):
        for message,result in [
           ("Newer S9 person crop provenance invalid","new_roi_provenance"),
           ("Ambiguous V40 full-person source","ambiguous_old_crop"),
           ("private person somebody motion_111.mp4","unclassified_aggregate_only")]:
            self.assertEqual(m.categorized(RuntimeError(message)),result)
        class Bad(Dummy):
            def inventory(self,include_unreviewed=False):
                raise RuntimeError("Duplicate source-qualified crop keys")
        with patch.object(m,"sibling",return_value=Bad()):
            report=m.audit()
        self.assertEqual(report["failure_class"],"duplicate_crop_key")
    def test_file_performs_no_changes(self):
        text=SRC.read_text()
        for bad in ("--apply","os.replace(", ".write_text(", ".write_bytes(",
                    "rm -f","pm install","am force-stop","subprocess.run(",
                    "assign_person","review_decide"):
            self.assertNotIn(bad,text)
if __name__=="__main__":unittest.main(verbosity=2)
