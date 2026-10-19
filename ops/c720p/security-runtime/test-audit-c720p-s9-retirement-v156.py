#!/usr/bin/env python3
"""Offline regression tests: never infer deletion clearance from playable clips."""
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import unittest

HERE=Path(__file__).resolve().parent
P=HERE/"audit-c720p-s9-retirement-v156.py"
spec=importlib.util.spec_from_file_location("retirement_v156",P)
m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)

def record(name="motion_1792000010000.mp4",size=12000,indexed=True):
    return {name:{"bytes":size,"sha256":"a"*64,"sd_path":m.SD+"/"+name,
                  "indexed":indexed}}

def source():
    return "\n".join((
        "def save_index(events, replace=False):pass",
        "c720p-migrated-index-playback-v1.js",
        "if parsed.path == '/save':",
        "  e['saved'] = True",
        "  save_index(events)",
        "if parsed.path == '/delete':",
        "  (ROOT / rel).unlink()",
        "  save_index(keep, replace=True)",
        "if parsed.path == '/live.mjpg':",
        "  pass",
    ))

class Tests(unittest.TestCase):
    def test_old_save_delete_are_explicitly_identified(self):
        result=m.legacy_actions(source())
        self.assertTrue(result["save_writes_local_index"])
        self.assertTrue(result["delete_unlinks_local_files"])
        self.assertTrue(result["source_generator_bridge"])
        with self.assertRaisesRegex(RuntimeError,"legacy_action_boundaries_unknown"):
            m.legacy_actions("arbitrary source")

    def test_manifest_is_private_and_schema_qualified(self):
        with tempfile.TemporaryDirectory() as directory:
            p=Path(directory)/"manifest.json"
            original=record()
            p.write_text(json.dumps({"schema_version":m.SCHEMA,"records":original}))
            p.chmod(0o600)
            self.assertEqual(m.manifest_rows(p),original)
            p.chmod(0o644)
            with self.assertRaisesRegex(RuntimeError,"private_manifest_permissions_unsafe"):
                m.manifest_rows(p)
            p.chmod(0o600)
            row=next(iter(original.values()))
            row["sd_path"]="/arbitrary/unsafe-location.mp4"
            p.write_text(json.dumps({"schema_version":m.SCHEMA,"records":original}))
            with self.assertRaisesRegex(RuntimeError,"unsafe_migration_manifest_entry"):
                m.manifest_rows(p)

    def test_symlinked_local_video_must_fail_closed(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory)
            clips=root/"clips";clips.mkdir()
            file=root/"video";file.write_bytes(b"0"*12_000)
            (clips/"motion_1792000010000.mp4").symlink_to(file)
            with self.assertRaisesRegex(RuntimeError,"unsafe_local_clip"):
                m.local_inventory(clips)
            (clips/"motion_1792000010000.mp4").unlink()
            local=clips/"motion_1792000010000.mp4"
            local.write_bytes(b"0"*12_000)
            self.assertEqual(m.local_inventory(clips),{local.name:12000})

    def test_all_six_playable_still_do_not_authorize_deletion(self):
        names=[f"motion_{1792000010000+i*1000}.mp4" for i in range(6)]
        rows={}
        for name in names:rows.update(record(name,size=12_000))
        local={name:12_000 for name in names}
        result=m.assess(rows,local,m.legacy_actions(source()),
          generator_sha="a"*64,bridges=True,guard=True,camera=True)
        self.assertEqual(result["local_manifest_overlap_count"],6)
        self.assertEqual(result["matching_size_count"],6)
        self.assertEqual(result["manifest_bytes"],72_000)
        self.assertTrue(result["delete_unlinks_local_files"])
        self.assertFalse(result["eligible_for_local_removal"])
        self.assertTrue(result["retention_required"])
        self.assertIn("legacy_save_delete_retirement_not_approved",result["blockers"])
        self.assertIn("remote_save_delete_and_fallback_retirement_unverified",
                      result["blockers"])
        self.assertNotIn("motion_",json.dumps(result))

    def test_missing_or_unindexed_clip_blocks(self):
        rows=record(indexed=False)
        old=m.legacy_actions(source())
        result=m.assess(rows,{},old,generator_sha="b"*64,
                        bridges=False,guard=False,camera=False)
        self.assertEqual(result["state"],"blocked")
        self.assertFalse(result["eligible_for_local_removal"])
        for reason in ("unindexed_migrated_recording",
                       "local_import_inventory_or_size_mismatch",
                       "generated_index_or_watcher_unverified",
                       "native_4k_health_unverified"):
            self.assertIn(reason,result["blockers"])

    def test_only_readonly_capabilities_exist(self):
        src=P.read_text()
        for forbidden in ("os.unlink(", "shutil.rmtree", "os.remove(",
                          "adb push", "adb shell rm", "pm install",
                          "auto_assign_person", "delete_originals"):
            self.assertNotIn(forbidden,src)
        self.assertEqual(m.APPROVED_RETIREMENT_GENERATOR_SHA256,frozenset())
        self.assertIn('"eligible_for_local_removal": False',src)
        self.assertIn('"retention_required": True',src)
        self.assertIn('"read_only": True',src)

if __name__=="__main__":
    unittest.main(verbosity=2)
