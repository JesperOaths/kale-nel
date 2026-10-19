#!/usr/bin/env python3
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

SOURCE=Path(__file__).with_name("s9-original-integrity-reconcile-v1.py")
spec=importlib.util.spec_from_file_location("reconcile",SOURCE)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NAME="motion_1792000000000.mp4"
ENTRY={"name":NAME,"bytes":200000,"version":"a"*64,
       "manifest":{"name":NAME,"bytes":200000,"sha256":"b"*64,"width":3840,"height":2160}}
SNAPSHOT={"snapshot_id":"c"*64,"records":{NAME:ENTRY}}

def report(name=NAME,match=True):
    return {"ok":True,"schema_version":"s9_original_sha256_readonly_v1",
        "clip":name,"checked_bytes":200000,"sha256_matches_verified_manifest":match,
        "source":"S9_microSD_original_4k","read_only":True,
        "video_copied_to_hub":False,"media_deleted_or_quarantined":False,
        "manual_review_modified":False,
        "result":"digest_match" if match else "digest_mismatch_needs_manual_investigation"}

class Tests(unittest.TestCase):
    def setUp(self):
        self.tmp=tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.path=Path(self.tmp.name)/"private.json"
    def test_runs_one_verified_original_and_saves_only_private_digest_metadata(self):
        with patch.object(m.catalog,"load_catalog",return_value=SNAPSHOT),\
             patch.object(m,"inspect",return_value=True) as checker:
            self.assertEqual(m.run_once(self.path),"matched")
            self.assertEqual(m.run_once(self.path),"fresh")
        checker.assert_called_once()
        saved=json.loads(self.path.read_text())
        self.assertEqual(saved["checked_count"],1)
        self.assertEqual(saved["mismatch_count"],0)
        self.assertEqual(saved["checks"][NAME]["catalog_version"],"a"*64)
        self.assertNotIn("face",self.path.read_text().lower())
        self.assertEqual(self.path.stat().st_mode&0o777,0o600)
    def test_mismatch_is_reported_but_never_removes_recording(self):
        with patch.object(m.catalog,"load_catalog",return_value=SNAPSHOT),\
             patch.object(m,"inspect",return_value=False):
            self.assertEqual(m.run_once(self.path),"mismatch")
        saved=json.loads(self.path.read_text())
        self.assertEqual(saved["mismatch_count"],1)
        self.assertTrue(saved["no_recordings_removed"])
        self.assertTrue(saved["no_manual_reviews_changed"])
    def test_offline_phone_preserves_previous_verified_checks(self):
        with patch.object(m.catalog,"load_catalog",return_value=SNAPSHOT),\
             patch.object(m,"inspect",return_value=True):
            m.run_once(self.path)
        before=self.path.read_bytes()
        with patch.object(m.catalog,"load_catalog",side_effect=m.catalog.Unavailable("offline")):
            self.assertEqual(m.run_once(self.path),"deferred")
        self.assertEqual(self.path.read_bytes(),before)
    def test_premature_and_wrong_reply_do_not_commit(self):
        for damage in (
            lambda r:r.update(clip="../other.mp4"),
            lambda r:r.update(video_copied_to_hub=True),
            lambda r:r.update(checked_bytes=190000),
            lambda r:r.update(result="digest_match",sha256_matches_verified_manifest=False)):
            item=report();damage(item)
            with self.subTest(item=item),patch.object(m.urllib.request,"urlopen") as source:
                source.return_value.__enter__.return_value.read.return_value=json.dumps(item).encode()
                with self.assertRaises(ValueError):m.inspect(NAME,ENTRY)
        self.assertFalse(self.path.exists())
    def test_snapshot_change_rechecks_same_original_without_reusing_old_pass(self):
        with patch.object(m.catalog,"load_catalog",return_value=SNAPSHOT),\
             patch.object(m,"inspect",return_value=True):
            m.run_once(self.path)
        current={"snapshot_id":"d"*64,"records":{NAME:{**ENTRY,"version":"e"*64}}}
        with patch.object(m.catalog,"load_catalog",return_value=current),\
             patch.object(m,"inspect",return_value=False) as audit:
            self.assertEqual(m.run_once(self.path),"mismatch")
        audit.assert_called_once()
        self.assertEqual(json.loads(self.path.read_text())["checks"][NAME]["catalog_version"],"e"*64)

if __name__=="__main__":
    unittest.main(verbosity=2)
