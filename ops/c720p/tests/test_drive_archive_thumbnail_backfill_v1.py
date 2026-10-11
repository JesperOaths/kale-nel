#!/usr/bin/env python3
"""Pure, offline regression checks for the historical Drive archive preview cache."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

SRC=Path(__file__).resolve().parents[1]/"drive_archive_thumbnail_backfill_v1.py"
spec=importlib.util.spec_from_file_location("drive_archive_thumbs",SRC)
module=importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class DriveArchiveThumbsTests(unittest.TestCase):
    def test_archive_patch_compiles_and_is_idempotent(self):
        original="""import pathlib
class ArchiveHandler:
 def go(self,cam,n):
  f=pathlib.Path('/tmp/example');root=f.parent
  if root in f.parents and f.is_file():self.local_file(f,'image/jpeg');return
  self.remote_snapshot(cam,n);return
"""
        modified=module.backend_with_tmpfs(original)
        self.assertIn("C720P_DRIVE_RAM_THUMB_V1",modified)
        self.assertEqual(modified,module.backend_with_tmpfs(modified))
        compile(modified,"archive_source","exec")

    def test_only_verified_new_camera_rows_and_safe_names(self):
        with tempfile.TemporaryDirectory() as directory:
            idx=Path(directory)/"index.json"
            idx.write_text(json.dumps({"items":[
                {"camera":"new","state":"verified","snapshot_name":"S1.jpg","remote_name":"V1.mp4","timestamp":"2026-10-12"},
                {"camera":"new","state":"deleted","snapshot_name":"S2.jpg","remote_name":"V2.mp4","timestamp":"2026-10-12"},
                {"camera":"s3","state":"verified","snapshot_name":"S3.jpg","remote_name":"V3.mp4","timestamp":"2026-10-12"},
                {"camera":"new","state":"verified","snapshot_name":"../bad.jpg","remote_name":"V4.mp4","timestamp":"2026-10-12"},
                {"camera":"new","state":"verified","snapshot_name":"S5.jpg","remote_name":"../bad.mp4","timestamp":"2026-10-12"}
            ]}))
            old=module.INDEX
            try:
                module.INDEX=idx
                rows=module.verified_rows()
                self.assertEqual(len(rows),1)
                self.assertEqual(rows[0]["snapshot_name"],"S1.jpg")
            finally:module.INDEX=old

    def test_cached_jpeg_signature_and_safe_threshold(self):
        with tempfile.TemporaryDirectory() as directory:
            jpg=Path(directory)/"image.jpg"
            jpg.write_bytes(b"\xff\xd8"+b"x"*3000)
            self.assertTrue(module.valid(jpg))
            jpg.write_bytes(b"<html>"+b"x"*3000)
            self.assertFalse(module.valid(jpg))

    def test_tmpfs_without_original_video_modifications(self):
        src=SRC.read_text()
        self.assertIn('CACHE=Path("/tmp/c720p-drive-archive-thumbs-new")',src)
        self.assertIn("MAX_VIDEO_BYTES=85*1024*1024",src)
        self.assertIn("tmpfs_reserve_below_300mb",src)
        self.assertIn('"--drive-root-folder-id"',src)
        self.assertNotIn('"deletefile"',src)
        self.assertNotIn('"moveto"',src)
        self.assertIn('original_drive_media_modified":False',src)

    def test_guarded_service_cutover_and_recovery(self):
        src=SRC.read_text()
        self.assertIn('sample_url="http://127.0.0.1:8794/new/saved/snap/"',src)
        self.assertIn("backend_with_tmpfs(original_backend)",src)
        self.assertIn("originals[path]=path.read_bytes()",src)
        self.assertIn('["systemctl","--user","restart","c720p-drive-security-archive.service"]',src)
        self.assertIn("TimeoutStartSec=9min",src)

if __name__=="__main__":unittest.main()
