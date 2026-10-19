#!/usr/bin/env python3
"""Read-only Security recording analytics route and privacy regressions."""
import datetime
import importlib.util
import io
import json
import sys
from types import SimpleNamespace
from unittest.mock import patch
from pathlib import Path
import tempfile
import unittest

spec=importlib.util.spec_from_file_location("sd_proxy",Path(__file__).with_name("s9_sd_proxy_extension.py"))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def sample():
    hour={f"{i:02d}":{"s9_microSD":0,"historical_drive":0,"combined":0} for i in range(24)}
    hour["05"]={"s9_microSD":2,"historical_drive":3,"combined":5}
    day={"2026-10-18":{"s9_microSD":2,"historical_drive":3,"combined":5}}
    return {"schema_version":"security_s9_drive_activity_v1",
      "generated_at_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
      "timezone":"Europe/Amsterdam","operating_day_start_local":"06:00",
      "s3_excluded":True,"media_decoded":False,"video_bytes_transferred":False,
      "source_recordings":{"s9_microSD":2,"historical_drive_verified_new":3},
      "total_recordings":5,"historical_drive_timestamp_unknown":0,
      "local_wall_clock_hours":hour,"operating_days":day,
      "private_person_name":"must not appear","source_directory":"private"}

class Handler:
    def __init__(self,path="/new/api/security-recording-activity",command="GET"):
        self.path=path;self.command=command;self.wfile=io.BytesIO()
        self.response_code=None;self.headers={};self.json_response=None
    def go(self):return "delegated"
    def js(self,status,payload):
        self.response_code=status;self.json_response=payload
    def send_response(self,code):self.response_code=code
    def send_header(self,k,v):self.headers[k]=v
    def end_headers(self):pass
# Isolate this read-only endpoint from unrelated review and camera overlays.
overlays=("s9_human_thumbnail_review","s9_drive_visitor_review",
 "s9_manual_evidence_cases","s9_manual_recording_links",
 "s9_automatic_person_review","s9_native_camera_controls",
 "s9_evidence_quality_v1")
with patch.dict(sys.modules,{name:SimpleNamespace(install=lambda *args,**kwargs:None)
 for name in overlays}):
 m.install_local_sd(Handler)

class Tests(unittest.TestCase):
    def setUp(self):
        folder=tempfile.TemporaryDirectory();self.addCleanup(folder.cleanup)
        self.folder=Path(folder.name);self.p=self.folder/"private.json"
        self.save(sample())
        self.before=m.ACTIVITY_REPORT;m.ACTIVITY_REPORT=self.p
        self.addCleanup(lambda:setattr(m,"ACTIVITY_REPORT",self.before))
        # The helper default path is captured at definition time; route calls
        # a path argument during this test to avoid changing production code.
    def save(self,record):
        self.p.write_text(json.dumps(record));self.p.chmod(0o600)
    def test_private_reconciled_counts_and_no_sensitive_fields(self):
        output=m.read_private_recording_activity(self.p)
        self.assertEqual(output["total_recordings"],5)
        self.assertEqual(output["operating_days"]["2026-10-18"]["combined"],5)
        self.assertNotIn("private_person_name",output)
        self.assertNotIn("source_directory",output)
        self.assertFalse(output["s3_included"])
        self.assertTrue(output["recordings_not_people"])
    def test_tampered_counts_and_s3_inclusion_fail_closed(self):
        for delta in (
          {"total_recordings":6},
          {"s3_excluded":False},
          {"video_bytes_transferred":True},
          {"media_decoded":True}):
            item=sample();item.update(delta)
            self.save(item)
            with self.subTest(delta=delta),self.assertRaises(ValueError):
                m.read_private_recording_activity(self.p)
    def test_permissions_symlink_and_staleness_fail_closed(self):
        self.p.chmod(0o644)
        with self.assertRaises(ValueError):m.read_private_recording_activity(self.p)
        self.p.chmod(0o600)
        alt=self.folder/"link.json";alt.symlink_to(self.p)
        with self.assertRaises(ValueError):m.read_private_recording_activity(alt)
        item=sample();item["generated_at_utc"]="2026-10-01T00:00:00+00:00"
        self.save(item)
        with self.assertRaises(ValueError):m.read_private_recording_activity(self.p)
    def test_get_only_without_query(self):
        invalid=Handler(path="/new/api/security-recording-activity?file=secret")
        invalid.go()
        self.assertEqual(invalid.response_code,400)
        invalid=Handler(command="POST")
        invalid.go()
        self.assertEqual(invalid.response_code,400)
    def test_authenticated_relay_handler_returns_no_store_aggregates(self):
        original=m.read_private_recording_activity
        m.read_private_recording_activity=lambda:original(self.p)
        try:
            good=Handler();good.go()
        finally:m.read_private_recording_activity=original
        self.assertEqual(good.response_code,200)
        self.assertEqual(good.headers["Cache-Control"],"private, no-store")
        self.assertEqual(good.headers["X-Content-Type-Options"],"nosniff")
        d=json.loads(good.wfile.getvalue())
        self.assertEqual(d["total_recordings"],5)
        self.assertNotIn("private_person_name",d)
        self.assertNotIn("source_directory",d)
if __name__=="__main__":unittest.main(verbosity=2)
