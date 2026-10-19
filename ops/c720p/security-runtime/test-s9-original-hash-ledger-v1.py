#!/usr/bin/env python3
"""Synthetic phone-camera-priority, immutable-evidence and provenance tests."""
import datetime as dt
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

spec=importlib.util.spec_from_file_location("s9_integrity",Path(__file__).with_name("s9-original-hash-ledger-v1.py"))
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NAME="motion_1792000000000.mp4"
ROW={"name":NAME,"bytes":35145179,"version":"a"*64}
SNAPSHOT={"schema_version":"s9_phone_archive_catalog_v1","snapshot_id":"b"*64,"records":{NAME:ROW}}
AT=dt.datetime(2026,10,19,3,0,tzinfo=dt.timezone.utc)
def reply(matched=True):
    return {"ok":True,"schema_version":"s9_original_sha256_readonly_v1",
      "clip":NAME,"checked_bytes":35145179,
      "sha256_matches_verified_manifest":matched,
      "source":"S9_microSD_original_4k","read_only":True,
      "video_copied_to_hub":False,"media_deleted_or_quarantined":False,
      "manual_review_modified":False,
      "result":"digest_match" if matched else "digest_mismatch_needs_manual_investigation"}
def encoded(x):return (m.MARK+json.dumps(x)).encode()

class Tests(unittest.TestCase):
 def setUp(self):
    self.tmp=tempfile.TemporaryDirectory();self.addCleanup(self.tmp.cleanup)
    self.p=Path(self.tmp.name)/"private-ledger.json"
 def test_first_matching_check_written_privately_and_recent_version_skipped(self):
    with patch.object(m.catalog,"load_catalog",return_value=SNAPSHOT),\
         patch.object(m,"phone_audit",return_value=True) as auditor:
        self.assertEqual(m.run(self.p,AT),"match")
        self.assertEqual(m.run(self.p,AT),"fresh")
        auditor.assert_called_once()
    data=json.loads(self.p.read_text())
    self.assertEqual(data["checked_matching"],1)
    self.assertEqual(data["mismatches_needing_review"],0)
    self.assertEqual(self.p.stat().st_mode&0o777,0o600)
    self.assertFalse(data["automatic_quarantine"])
    self.assertFalse(data["originals_modified"])
    self.assertFalse(data["videos_transferred_to_hub"])
 def test_mismatch_is_stored_for_manual_review_not_quarantined(self):
    with patch.object(m.catalog,"load_catalog",return_value=SNAPSHOT),\
         patch.object(m,"phone_audit",return_value=False):
        self.assertEqual(m.run(self.p,AT),"mismatch")
    result=json.loads(self.p.read_text())
    self.assertEqual(result["mismatches_needing_review"],1)
    self.assertFalse(result["automatic_quarantine"])
    self.assertFalse(result["review_decisions_modified"])
 def test_offline_camera_preserves_last_good_ledger(self):
    with patch.object(m.catalog,"load_catalog",return_value=SNAPSHOT),\
         patch.object(m,"phone_audit",return_value=True):
        m.run(self.p,AT)
    old=self.p.read_bytes()
    with patch.object(m.catalog,"load_catalog",side_effect=m.catalog.Unavailable("offline")):
        self.assertEqual(m.run(self.p,AT),"deferred")
    self.assertEqual(self.p.read_bytes(),old)
 def test_source_version_change_must_be_rehashed(self):
    with patch.object(m.catalog,"load_catalog",return_value=SNAPSHOT),\
         patch.object(m,"phone_audit",return_value=True):
        m.run(self.p,AT)
    changed={"records":{NAME:{**ROW,"version":"f"*64}}}
    with patch.object(m.catalog,"load_catalog",return_value=changed),\
         patch.object(m,"phone_audit",return_value=False) as audit:
        self.assertEqual(m.run(self.p,AT),"mismatch")
        audit.assert_called_once()
    self.assertEqual(json.loads(self.p.read_text())["mismatches_needing_review"],1)
 def test_rejects_fabricated_metadata_and_preserves_ledger(self):
    for change in (
        {"clip":"../unsafe.mp4"},
        {"checked_bytes":20000},
        {"sha256_matches_verified_manifest":"true"},
        {"video_copied_to_hub":True},
        {"manual_review_modified":True},
        {"result":"digest_match","sha256_matches_verified_manifest":False},
        {"schema_version":"unknown"}):
        data=reply();data.update(change)
        with self.subTest(change=change),self.assertRaises(m.Deferred):
            m.validate_phone_reply(encoded(data),NAME,ROW)
    self.assertFalse(self.p.exists())
 def test_failed_phone_worker_never_erases_previous_result(self):
    with patch.object(m.catalog,"load_catalog",return_value=SNAPSHOT),\
         patch.object(m,"phone_audit",return_value=True):
        m.run(self.p,AT)
    old=self.p.read_bytes()
    newer=AT+dt.timedelta(days=8)
    with patch.object(m.catalog,"load_catalog",return_value=SNAPSHOT),\
         patch.object(m,"phone_audit",side_effect=m.Deferred("busy")):
        self.assertEqual(m.run(self.p,newer),"deferred")
    self.assertEqual(self.p.read_bytes(),old)
if __name__=="__main__":unittest.main(verbosity=2)
