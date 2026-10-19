#!/usr/bin/env python3
"""Offline tests: no phone, camera, archive or review resources used."""
import json
import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import s9_standalone_phone_catalog_v1 as m

NAME="motion_1792000000000.mp4"
def sample():
    record={"name":NAME,"bytes":200000,"version":"a"*64,
        "thumbnail":False,"thumbnail_version":"",
        "manifest":{"name":NAME,"bytes":200000,"width":3840,"height":2160,"sha256":"b"*64}}
    return {"ok":True,"schema_version":"s9_native_archive_cli_v1","source":"S9_android_app_process",
      "snapshot_id":"c"*64,"metadata_only":True,"read_only":True,
      "camera_apk_modified":False,"video_decode_performed":False,
      "records":[record],"total_records":1,
      "summary":{"source":"S9_native_microSD_sidecar_metadata",
        "timezone":"Europe/Amsterdam","operating_day_start_hour":6,
        "recordings":1,"thumbnail_present_count":0,
        "person_candidate_recording_count":0,
        "sidecar_claimed_video_bytes":200000,
        "sd_usable_bytes":100000,"sd_total_bytes":200000,
        "counts_are_recordings_not_distinct_people":True,
        "read_only":True,
        "originals_sha256_rechecked":False,
        "hourly_recording_counts":{"2026-10-15T18+0200":1},
        "daily_recording_counts":{"2026-10-15":1}}}

class Tests(unittest.TestCase):
    def test_approved_metadata_parses_without_identity_vectors(self):
        data=m.MARKER+json.dumps(sample())
        catalog,summary=m.parse(data.encode())
        self.assertEqual(set(catalog["records"]),{NAME})
        self.assertEqual(summary["recordings"],1)
        self.assertEqual(catalog["schema_version"],m.schema.VERSION)
    def test_unverified_or_inconsistent_metadata_rejected(self):
        mutants=[
          lambda d:d.update(camera_apk_modified=True),
          lambda d:d.update(video_decode_performed=True),
          lambda d:d.update(source="hub_fake"),
          lambda d:d["records"][0].update(bytes=190000),
          lambda d:d["summary"].update(recordings=0),
          lambda d:d["summary"].update(sd_usable_bytes=300000),
          lambda d:d["summary"].update(daily_recording_counts={"2026-10-15":2}),
          lambda d:d["summary"].update(hourly_recording_counts={"2026-10-15T02":1}),
          lambda d:d.update(total_records=2)
        ]
        for mutate in mutants:
            data=sample();mutate(data)
            with self.subTest(data=data),self.assertRaises(ValueError):
                m.parse((m.MARKER+json.dumps(data)).encode())
    def test_atomic_0600_and_non_symlink(self):
        with tempfile.TemporaryDirectory() as root:
            p=Path(root)/"report.json"
            m.atomic(p,{"secret":False})
            self.assertEqual(p.stat().st_mode&0o777,0o600)
            self.assertEqual(json.loads(p.read_text()),{"secret":False})
            q=Path(root)/"alias.json"
            q.symlink_to(p)
            with self.assertRaises(ValueError):m.atomic(q,{"unsafe":True})
    def test_phone_failure_does_not_mutate_prior_results(self):
        with tempfile.TemporaryDirectory() as root:
            state=Path(root)
            original={"frozen":True}
            m.atomic(state/"s9-standalone-archive-catalog-v1.json",original)
            initial=(state/"s9-standalone-archive-catalog-v1.json").read_bytes()
            with patch.object(m,"camera",side_effect=RuntimeError("phone_offline")):
                with self.assertRaises(RuntimeError):m.run(Path("/dev/null"),"0"*64,True,state)
            self.assertEqual((state/"s9-standalone-archive-catalog-v1.json").read_bytes(),initial)
    def test_hub_phone_mismatch_refuses_output(self):
        d=sample();catalog,summary=m.parse((m.MARKER+json.dumps(d)).encode())
        with tempfile.TemporaryDirectory() as root:
            with patch.object(m,"camera",return_value={"ok":True,"temperature_c":31}),\
                 patch.object(m,"hub_names",return_value={"motion_1792000000001.mp4"}),\
                 patch.object(m,"scan",return_value=(catalog,summary)):
                with self.assertRaises(RuntimeError):
                    m.run(Path("unused.dex"),"a"*64,True,Path(root))
            self.assertFalse((Path(root)/"s9-standalone-archive-catalog-v1.json").exists())

if __name__=="__main__":unittest.main(verbosity=2)
