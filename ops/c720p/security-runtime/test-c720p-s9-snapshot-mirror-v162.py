#!/usr/bin/env python3
"""Offline evidence that snapshot migration never changes original C720P media."""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

HERE=Path(__file__).resolve().parent
PATH=HERE/"c720p_to_s9_snapshot_mirror_v162.py"
spec=importlib.util.spec_from_file_location("snap_v162",PATH)
m=importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

CLIP="motion_1792000010000.mp4"
JPEG="motion_1792000010000.jpg"
FRAME=b"\xff\xd8\xff"+b"r"*1200+b"\xff\xd9"

class Tests(unittest.TestCase):
    def setup_paths(self,tmp):
        base=Path(tmp)
        root=base/"www";root.mkdir()
        snaps=root/"snaps";snaps.mkdir()
        clips=root/"clips";clips.mkdir()
        state=base/"state";state.mkdir()
        jpg=snaps/JPEG
        jpg.write_bytes(FRAME)
        (root/"events.json").write_text(json.dumps([{
            "clip":"clips/"+CLIP,"snapshot":"snaps/"+JPEG,"saved":False}]))
        mp4_manifest=state/"c720p-s9-imported-v2.json"
        mp4_manifest.write_text(json.dumps({
          "schema_version":m.MP4_SCHEMA,
          "records":{CLIP:{"bytes":12000,"sha256":"a"*64,
            "sd_path":m.MP4_DEST+"/"+CLIP,"indexed":True}}}))
        mp4_manifest.chmod(0o600)
        patches=patch.multiple(m,ROOT=root,SNAPS=snaps,CLIPS=clips,
          EVENTS=root/"events.json",STATE=state,
          MP4_MANIFEST=mp4_manifest,REPORT=state/"snap-manifest.json",
          LOCK=state/"mirror.lock")
        return patches,jpg

    def test_preview_is_readonly_without_phone_access(self):
        with tempfile.TemporaryDirectory() as tmp:
            paths,jpg=self.setup_paths(tmp)
            original=jpg.read_bytes()
            with paths,patch.object(m,"adb") as adb,patch.object(m,"camera_ready") as health:
                result=m.execute("preview")
                self.assertEqual(result["snapshot_count"],1)
                self.assertEqual(result["snapshot_bytes"],len(original))
                self.assertEqual(result["state"],"preview")
                self.assertEqual(result["local_deleted"],0)
                self.assertFalse(m.REPORT.exists())
                adb.assert_not_called()
                health.assert_not_called()
            self.assertEqual(jpg.read_bytes(),original)

    def test_invalid_manifest_or_local_symlink_is_refused(self):
        with tempfile.TemporaryDirectory() as tmp:
            paths,jpg=self.setup_paths(tmp)
            with paths:
                jpg.unlink()
                jpg.symlink_to(m.EVENTS)
                with self.assertRaisesRegex(m.Stop,"snapshot_not_regular"):
                    m.local_inventory()
                jpg.unlink()
                jpg.write_bytes(FRAME)
                m.MP4_MANIFEST.chmod(0o644)
                with self.assertRaisesRegex(m.Stop,"private_file_untrusted"):
                    m.local_inventory()

    def test_existing_partial_never_overwritten(self):
        with tempfile.TemporaryDirectory() as tmp:
            paths,jpg=self.setup_paths(tmp)
            with paths,patch.object(m,"phone_matches",side_effect=[False,False]),patch.object(
              m,"phone_exists",side_effect=[False,True]),patch.object(
              m,"camera_ready",return_value=True),patch.object(m,"adb") as adb:
                row=m.local_inventory()[JPEG]
                with self.assertRaisesRegex(m.Stop,"different_partial_snapshot_preserved"):
                    m.promote_one(JPEG,row)
                adb.assert_not_called()
                self.assertEqual(jpg.read_bytes(),FRAME)

    def test_healthy_single_copy_proves_sha_then_promotes(self):
        with tempfile.TemporaryDirectory() as tmp:
            paths,jpg=self.setup_paths(tmp)
            with paths,patch.object(m,"phone_matches",side_effect=[False,True,True]) as verified,patch.object(
              m,"phone_exists",side_effect=[False,False,False]) as exists,patch.object(
              m,"camera_ready",return_value=True),patch.object(m,"adb") as adb:
                row=m.local_inventory()[JPEG]
                self.assertEqual(m.promote_one(JPEG,row),"copied_and_verified")
                self.assertEqual(exists.call_count,3)
                self.assertEqual(verified.call_count,3)
                self.assertEqual([call.args[0:2] for call in adb.call_args_list],
                                 [("push",str(jpg)),("shell","mv")])
                self.assertEqual(jpg.read_bytes(),FRAME)

    def test_unknown_presence_is_not_absence(self):
        for code,err in ((255,b"device offline"),(1,b"permission denied"),
                         (0,b"unexpected stderr"),(127,b"missing shell")):
            with self.subTest(code=code),patch.object(
              m.subprocess,"run",return_value=SimpleNamespace(
                returncode=code,stderr=err)):
                with self.assertRaisesRegex(m.Stop,"phone_presence_indeterminate"):
                    m.phone_exists(m.DEST+"/snap.jpg")
        with patch.object(m.subprocess,"run",return_value=SimpleNamespace(
                returncode=1,stderr=b"")):
            self.assertFalse(m.phone_exists(m.DEST+"/snap.jpg"))

    def test_manifest_is_private_and_defers_for_changed_source(self):
        with tempfile.TemporaryDirectory() as tmp:
            paths,jpg=self.setup_paths(tmp)
            with paths:
                rows=m.local_inventory()
                m.atomic_report(rows)
                self.assertEqual(m.existing_report(),rows)
                self.assertEqual(m.REPORT.stat().st_mode & 0o077,0)
                jpg.write_bytes(FRAME+b"extra")
                with self.assertRaisesRegex(m.Stop,"snapshot_jpeg_untrusted"):
                    m.execute("preview")

    def test_verify_refuses_missing_published_proof_without_writes(self):
        with tempfile.TemporaryDirectory() as tmp:
            paths,jpg=self.setup_paths(tmp)
            with paths,patch.object(m,"camera_ready",return_value=True),patch.object(
              m,"connected_free",return_value=90*1024**3),patch.object(m,"adb") as adb:
                with self.assertRaisesRegex(m.Stop,"no_published_snapshot_proof"):
                    m.execute("verify")
                adb.assert_not_called()

    def test_exactly_one_lock_and_no_recording_or_review_mutations(self):
        text=PATH.read_text()
        for forbidden in ("pm install","am force-stop","review_decide",
                          "auto_assign_person","delete_original",
                          "os.remove(CLIPS","os.remove(SNAPS",
                          "unlink(path","unlink(src","shutil.rmtree"):
            self.assertNotIn(forbidden,text)
        self.assertIn("fcntl.LOCK_EX|fcntl.LOCK_NB",text)
        self.assertIn("MAX_JPEG=5_000_000",text)
        self.assertIn("camera_ready()",text)
        self.assertIn("sha256sum",text)
        self.assertIn('group.add_argument("--copy"',text)
        self.assertIn('group.add_argument("--verify"',text)

if __name__=="__main__":
    unittest.main(verbosity=2)
