#!/usr/bin/env python3
"""Do not interpret disconnected S9 ADB transport as missing HSV or rank data."""
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch,Mock

HERE=Path(__file__).resolve().parent

def module(name,path):
    spec=importlib.util.spec_from_file_location(name,HERE/path)
    imported=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(imported)
    return imported

hist=module("s9_hsv_transport_v107","backfill-s9-hsv32-uniform-v2.py")
rank=module("s9_rank_transport_v107","run-s9-uniform-appearance-rankings-v3.py")
PRIVATE=hist.ROOT+"/features/"+"a"*64+"-hsv-v2.json"

class TransportSafety(unittest.TestCase):
    def test_missing_hsv_exact_exit_one_with_no_stderr(self):
        with patch.object(hist,"adb",return_value=SimpleNamespace(
            returncode=1,stderr="",stdout="")):
            self.assertFalse(hist.remote_exists(PRIVATE))
        with patch.object(hist,"adb",return_value=SimpleNamespace(
            returncode=0,stderr="",stdout="")):
            self.assertTrue(hist.remote_exists(PRIVATE))

    def test_offline_or_permission_rejected_for_hsv(self):
        for code,stderr in ((1,"error: device offline"),
                            (255,"error: no devices"),
                            (13,"Permission denied"),(2,"")):
            with self.subTest(code=code):
                with patch.object(hist,"adb",return_value=SimpleNamespace(
                    returncode=code,stderr=stderr,stdout="")):
                    with self.assertRaisesRegex(RuntimeError,"indeterminate"):
                        hist.remote_exists(PRIVATE)

    def test_missing_rank_input_is_distinct_from_adb_failure(self):
        with patch.object(rank.subprocess,"run",return_value=SimpleNamespace(
            returncode=1,stdout="",stderr="")):
            self.assertIsNone(rank.existing_sha(PRIVATE))
        for code,stderr in ((1,"error: device offline"),(255,"error"),(13,"")):
            with self.subTest(code=code):
                with patch.object(rank.subprocess,"run",return_value=SimpleNamespace(
                    returncode=code,stdout="",stderr=stderr)):
                    with self.assertRaisesRegex(RuntimeError,"indeterminate"):
                        rank.existing_sha(PRIVATE)

    def test_valid_sha_only_for_readable_existing_reference(self):
        valid="b"*64+"  "+PRIVATE
        with patch.object(rank.subprocess,"run",return_value=SimpleNamespace(
             returncode=0,stdout="",stderr="")), \
             patch.object(rank,"phone",return_value=valid):
            self.assertEqual(rank.existing_sha(PRIVATE),"b"*64)
        with patch.object(rank.subprocess,"run",return_value=SimpleNamespace(
             returncode=0,stdout="",stderr="")), \
             patch.object(rank,"phone",return_value="not-a-digest"):
            with self.assertRaisesRegex(RuntimeError,"checksum malformed"):
                rank.existing_sha(PRIVATE)

    def test_no_camera_or_original_media_changes(self):
        for name in ("backfill-s9-hsv32-uniform-v2.py",
                     "run-s9-uniform-appearance-rankings-v3.py"):
            code=(HERE/name).read_text()
            for action in ("pm install","am force-stop","delete_original",
                           "review_decide","auto_assign_person"):
                self.assertNotIn(action,code)

if __name__=="__main__":unittest.main(verbosity=2)
