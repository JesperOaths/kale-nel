#!/usr/bin/env python3
"""Offline fixtures only. Do NOT run SHA/ADB against real recordings in CI."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
SCRIPT=HERE/"audit-s9-six-migrated-sha-v239.py"
spec=importlib.util.spec_from_file_location("s9_import_sha_v239",SCRIPT)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
SIZES=(1441550,1872833,34336235,46472721,60377356,69681239)

def fixture(root):
    source=root/"clips"
    source.mkdir()
    records={}
    for i,size in enumerate(SIZES):
        name=f"synthetic_v239_{i}.mp4"
        (source/name).touch()
        with (source/name).open("r+b") as io:
            io.truncate(size)  # Sparse TEST fixtures; never real clips.
        records[name]={"sd_path":m.SD+"/"+name,
                       "sha256":chr(97+i)*64,
                       "bytes":size,"indexed":True}
    manifest=root/"synthetic-import.json"
    manifest.write_text(json.dumps({
        "schema_version":m.SCHEMA,"records":records}))
    manifest.chmod(0o600)
    return manifest,source,records

class FakeResponse:
    def __init__(self,doc):
        self.status=200
        self._data=json.dumps(doc).encode()
    def __enter__(self):return self
    def __exit__(self,*args):return False
    def read(self,n):return self._data[:n]

def good_health():
    return {"ok":True,"mode":"watching","native_4k_enabled":True,
      "continuous_4k_ready":True,"continuous_4k_dropped_output_frames":0,
      "continuous_4k_buffered_ms":7000,
      "continuous_4k_error":False,"temperature_c":32.8,
      "recording_active":False,"face_backfill_queued":False}

class Tests(unittest.TestCase):
    def test_private_six_files_and_exact_true_paths(self):
        with tempfile.TemporaryDirectory(prefix="synthetic-v239-") as d:
            p,c,_=fixture(Path(d))
            rows=m.read_import_provenance(p,c)
            self.assertEqual(len(rows),6)
            self.assertEqual(sum(x[0] for x in rows),214181934)
            self.assertTrue(all(row[3].startswith(m.SD+"/") for row in rows))
            self.assertEqual(m.ORIGINALS.as_posix(),
                "/opt/homeassistant/config/www/frontyard-security-new/clips")

    def test_suspicious_manifest_and_missing_original_refused(self):
        with tempfile.TemporaryDirectory(prefix="synthetic-v239-") as d:
            p,c,records=fixture(Path(d))
            for change in ("unsafe_perms","unindexed","other_path","missing"):
                with self.subTest(change=change):
                    if change=="unsafe_perms":
                        p.chmod(0o644)
                    elif change=="unindexed":
                        records["synthetic_v239_0.mp4"]["indexed"]=False
                        p.write_text(json.dumps({"schema_version":m.SCHEMA,
                            "records":records}))
                    elif change=="other_path":
                        records["synthetic_v239_0.mp4"]["sd_path"]="../wrong.mp4"
                        p.write_text(json.dumps({"schema_version":m.SCHEMA,
                            "records":records}))
                    else:
                        (c/"synthetic_v239_0.mp4").unlink()
                    with self.assertRaises(m.Refusal):
                        m.read_import_provenance(p,c)
                    p.chmod(0o600)
                    records["synthetic_v239_0.mp4"].update({
                       "indexed":True,
                       "sd_path":m.SD+"/synthetic_v239_0.mp4"})
                    p.write_text(json.dumps({"schema_version":m.SCHEMA,
                        "records":records}))

    def test_exact_three_per_batch_and_forged_digest_refused(self):
        with tempfile.TemporaryDirectory(prefix="synthetic-v239-") as d:
            p,c,_=fixture(Path(d))
            rows=m.read_import_provenance(p,c)
            expected={path:sha for _,_,sha,path in rows}
            calls=[]
            def adb(args,timeout):
                calls.append(args)
                if args==("shell","getprop ro.product.model"):return m.MODEL
                if args==("shell","pidof nl.kalenel.s9security"):return "1234"
                raise AssertionError("unexpected adb command")
            def hash_ok(path):
                calls.append(("sha256sum",path))
                return expected[path]
            for batch in ("small","large"):
                calls.clear()
                result=m.audited_batch(rows,batch,
                    checking_health=lambda:32.0,
                    checking_adb=adb,hashing=hash_ok)
                self.assertEqual(result["phone_sha256_verified"],3)
                self.assertEqual(result["camera_output_drops_after"],0)
                self.assertEqual(len([c for c in calls if c[0]=="sha256sum"]),3)
            with self.assertRaises(m.Refusal):
                m.audited_batch(rows,"small",checking_health=lambda:32.,
                    checking_adb=adb,hashing=lambda path:"0"*64)
            self.assertEqual(len(rows),6)

    def test_camera_busy_halts_without_phone_reads(self):
        for mutation in (
            {"recording_active":True},
            {"historical_import_queued":True},
            {"face_backfill_queued":True},
            {"temperature_c":35.5},
            {"continuous_4k_dropped_output_frames":1},
            {"continuous_4k_buffered_ms":4000}
        ):
            doc={**good_health(),**mutation}
            with patch.object(m.urllib.request,"urlopen",
                return_value=FakeResponse(doc)):
                with self.assertRaises(m.Refusal):
                    m.health()

    def test_default_mode_will_not_hash_and_source_never_mutates(self):
        self.assertIn('default="none"',SCRIPT.read_text())
        content=SCRIPT.read_text()
        for required in ('fcntl.LOCK_EX|fcntl.LOCK_NB',
             'len(selected)==3','hub_root_reserve_below_850_mib',
             'phone_digest_output_invalid','micro_sd_sha_differs_from_private_import_provenance',
             'native_camera_recording_or_worker_busy'):
            self.assertIn(required,content)
        for prohibited in ('adb("install"', 'adb("push"',
          'os.remove(', 'os.unlink(', 'Files.delete(',
          'shutil.rmtree(', 'subprocess.Popen(', 'sudo ',
          'HttpServer', 'CameraManager'):
            self.assertNotIn(prohibited,content)

if __name__=="__main__":
    unittest.main(verbosity=2)
