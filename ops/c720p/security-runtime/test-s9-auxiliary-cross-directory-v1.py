#!/usr/bin/env python3
"""Synthetic verification for isolated read-only cross-directory evidence report."""
import importlib.util
import tempfile
from pathlib import Path
from types import SimpleNamespace
import unittest

HERE=Path(__file__).resolve().parent
SPEC=importlib.util.spec_from_file_location("s9_cross_directory",HERE/"s9-auxiliary-cross-directory-v1.py")
m=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(m)
A="motion_1792000000000.mp4"
B="motion_1792000003000.mp4"
C="motion_1792000006000.mp4"
D="motion_1792000009000.mp4"
E="motion_1792000012000.mp4"

class CrossDirectory(unittest.TestCase):
    def test_preserves_all_four_mutually_exclusive_roles(self):
        active={A,A+".preroll.mp4",B+".preroll.mp4",C+".preroll.mp4",
                D+".preroll.mp4",E+".complete.mp4"}
        data=m.reconcile({A},active,{B},{C,E},True)
        self.assertEqual(data["preroll"],{"companion_files":4,"original_active":1,
            "original_quarantined":1,"only_historical_deletion_record":1,"original_unlocated":1})
        self.assertEqual(data["complete"]["only_historical_deletion_record"],1)
        self.assertFalse(data["media_changed"])
    def test_quarantine_presence_precedes_audit_history(self):
        d=m.reconcile({A},{A,B+".preroll.mp4"},{B},{B},True)
        self.assertEqual(d["preroll"]["original_quarantined"],1)
        self.assertEqual(d["preroll"]["only_historical_deletion_record"],0)
    def test_missing_verified_original_fails_closed(self):
        with self.assertRaises(m.Unavailable):
            m.reconcile({A},{A+".preroll.mp4"},set(),set(),False)
    def test_remote_listing_error_not_interpreted_as_empty(self):
        def fail(*_,**__):return SimpleNamespace(returncode=1,stdout=b"",stderr=b"no access")
        with self.assertRaises(m.Unavailable):m.names(m.QUARANTINE,runner=fail)
        with self.assertRaises(ValueError):m.names("/sdcard/Download",runner=fail)
    def test_historical_proof_is_separate_from_physical_presence(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp)
            d=p/"s9-permanent-empty-clip-purge";d.mkdir()
            (d/"purge-20261019T060000Z.json").write_text(
                '{"records":[{"clip":"'+B+'","status":"deleted"},{"clip":"'+C+'","status":"protected"}]}')
            deleted,available=m.previous_deletions(p)
            self.assertTrue(available)
            self.assertEqual(deleted,{B})
    def test_invalid_purge_name_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            p=Path(tmp);d=p/"s9-permanent-empty-clip-purge";d.mkdir()
            (d/"purge-20261019T060000Z.json").write_text(
                '{"records":[{"clip":"../escape.mp4","status":"deleted"}]}')
            with self.assertRaises(m.Unavailable):m.previous_deletions(p)
    def test_source_cannot_issue_media_writes(self):
        source=(HERE/"s9-auxiliary-cross-directory-v1.py").read_text()
        self.assertNotIn("['adb','-s',SERIAL,'shell','rm'",source)
        for token in (".unlink(", ".rename(", ".replace(", "os.remove(", "os.rename(", "shutil.move(", "shutil.copy("):
            self.assertNotIn(token,source)
        self.assertIn("media_changed\":False",source)
if __name__=="__main__":unittest.main(verbosity=2)
