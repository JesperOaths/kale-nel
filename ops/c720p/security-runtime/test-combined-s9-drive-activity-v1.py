#!/usr/bin/env python3
"""Offline source-separation, DST, privacy and 06:00 activity contracts."""
import importlib.util
import json
from datetime import datetime,timezone
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location("combined_activity",Path(__file__).with_name("combined-s9-drive-activity-v1.py"))
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)
AT=datetime(2026,10,19,2,0,tzinfo=timezone.utc)
def phone():
    return {"source":"S9_native_microSD_sidecar_metadata","timezone":"Europe/Amsterdam",
       "operating_day_start_hour":6,"read_only":True,"camera_4k_healthy_before_and_after":True,
       "video_bytes_transferred_to_hub":False,"catalog_snapshot_id":"a"*64,
       "generated_at_utc":"2026-10-19T01:59:00+00:00","recordings":2,
       "hourly_recording_counts":{"2026-10-18T22+0200":1,"2026-10-19T02+0200":1},
       "daily_recording_counts":{"2026-10-18":2}}
def drive():
    return {"items":[
       {"state":"verified","camera":"new",
        "remote_name":"NEW_20261019053200_person-test-01.mp4",
        "timestamp":"2026-10-19 05:32:00"},
       {"state":"verified","camera":"new",
        "remote_name":"NEW_20261019063200_person-test-02.mp4",
        "timestamp":"2026-10-19 06:32:00"},
       {"state":"verified","camera":"s3",
        "remote_name":"S3_20261019073200_person-test-03.mp4",
        "timestamp":"2026-10-19 07:32:00"},
       {"state":"deleted","camera":"new",
        "remote_name":"NEW_20261019083200_person-test-04.mp4",
        "timestamp":"2026-10-19 08:32:00"}]}
class Tests(unittest.TestCase):
 def test_operating_day_separation_and_s3_exclusion(self):
    d=m.build(phone(),drive(),AT)
    self.assertEqual(d["total_recordings"],4)
    self.assertEqual(d["source_recordings"]["historical_drive_verified_new"],2)
    self.assertTrue(d["s3_excluded"])
    self.assertEqual(d["operating_days"]["2026-10-18"],{"s9_microSD":2,"historical_drive":1,"combined":3})
    self.assertEqual(d["operating_days"]["2026-10-19"],{"s9_microSD":0,"historical_drive":1,"combined":1})
    self.assertEqual(d["local_wall_clock_hours"]["05"]["historical_drive"],1)
    self.assertEqual(d["local_wall_clock_hours"]["02"]["s9_microSD"],1)
    self.assertFalse(d["media_decoded"])
    self.assertFalse(d["video_bytes_transferred"])
    self.assertNotIn("person-test",json.dumps(d))
 def test_dst_repeated_s9_hour_retains_two_recordings(self):
    p=phone()
    p["hourly_recording_counts"]={"2026-10-25T02+0200":1,"2026-10-25T02+0100":1}
    p["daily_recording_counts"]={"2026-10-24":2}
    report=m.build(p,{"items":[]},AT)
    self.assertEqual(report["local_wall_clock_hours"]["02"]["s9_microSD"],2)
    self.assertEqual(report["operating_days"]["2026-10-24"]["s9_microSD"],2)
    self.assertIn("cannot be uniquely",report["dst_caveat"])
 def test_unparseable_drive_local_time_is_not_fabricated(self):
    data=drive()
    data["items"][0]["timestamp"]="not a real recording time"
    report=m.build(phone(),data,AT)
    self.assertEqual(report["historical_drive_timestamp_unknown"],1)
    self.assertEqual(report["total_recordings"],4)
    self.assertEqual(report["operating_days"]["2026-10-18"]["historical_drive"],0)
 def test_main_camera_legacy_prefix_not_dropped(self):
    data=drive()
    data["items"][0]["remote_name"]="S9PHONE_20261019053200_archive_001.mp4"
    result=m.build(phone(),data,AT)
    self.assertEqual(result["source_recordings"]["historical_drive_verified_new"],2)
    self.assertEqual(result["operating_days"]["2026-10-18"]["historical_drive"],1)
 def test_stale_or_incomplete_phone_summary_does_not_write(self):
    for change in (
        {"generated_at_utc":"2026-10-18T01:00:00+00:00"},
        {"camera_4k_healthy_before_and_after":False},
        {"video_bytes_transferred_to_hub":True},
        {"recordings":3},
        {"hourly_recording_counts":{"2026-10-19T02":2}}):
        sample=phone();sample.update(change)
        with self.subTest(change=change),self.assertRaises(ValueError):
            m.build(sample,drive(),AT)
 def test_drive_duplicates_and_bad_names_refused(self):
    sample=drive()
    sample["items"].append(dict(sample["items"][0]))
    with self.assertRaisesRegex(ValueError,"duplicate_drive"):m.build(phone(),sample,AT)
    sample=drive();sample["items"][0]["remote_name"]="../unsafe.mp4"
    with self.assertRaisesRegex(ValueError,"untrusted_drive"):m.build(phone(),sample,AT)
 def test_atomic_report_restricts_permissions(self):
    with tempfile.TemporaryDirectory() as root:
        p=Path(root)/"report.json";m.atomic(p,{"safe":True})
        self.assertEqual(p.stat().st_mode&0o777,0o600)
        q=Path(root)/"link.json";q.symlink_to(p)
        with self.assertRaisesRegex(ValueError,"unsafe_report"):m.atomic(q,{"unsafe":True})
        self.assertEqual(json.loads(p.read_text()),{"safe":True})
if __name__=="__main__":unittest.main(verbosity=2)
