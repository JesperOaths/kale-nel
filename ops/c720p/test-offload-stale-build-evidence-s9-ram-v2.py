#!/usr/bin/env python3
"""Non-destructive regression tests for the RAM-staged S9 microSD offload."""
import importlib.util
import os
from pathlib import Path
import tempfile
import tarfile
import unittest

SOURCE = Path(__file__).with_name("offload-stale-build-evidence-s9-ram-v2.py")
spec = importlib.util.spec_from_file_location("offload_ram_v2", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class SafeArchiveTests(unittest.TestCase):
    def test_archive_preserves_symlink_without_copying_target(self):
        with tempfile.TemporaryDirectory() as root:
            src = Path(root) / "sample"
            src.mkdir()
            (src / "a.txt").write_text("good")
            (src / "external").symlink_to("/etc/passwd")
            with tempfile.TemporaryDirectory() as td:
                out = Path(td) / "evidence.tar"
                digest = module.make_archive(src, out)
                self.assertEqual(len(digest), 64)
                with tarfile.open(out) as tf:
                    self.assertTrue(tf.getmember("sample/external").issym())
                    self.assertEqual(tf.getmember("sample/external").linkname, "/etc/passwd")
                    self.assertEqual(tf.getmember("sample/a.txt").size, 4)
            rows, size = module.snapshot(src)
            self.assertEqual(size, 4)
            self.assertEqual(len(rows), 2)

    def test_absent_source_returns_without_any_phone_calls(self):
        source = Path("/tmp/nonexistent_s9_rare_20261014")
        self.assertEqual(module.transfer(source)["skipped"], "missing_or_wrong_root")

    def test_require_explicit_execute_and_checksum_before_delete(self):
        body = SOURCE.read_text()
        self.assertIn('parser.add_argument("--execute", action="store_true")', body)
        self.assertLess(body.index("if remote_hash(final) != checksum:"), body.index("shutil.rmtree(source)"))
        self.assertIn("snapshot(source)[0] != before", body)
        self.assertIn('dir="/dev/shm"', body)
        for unsafe in ("adb(\"install\"", "systemctl stop", "docker system prune", "/new/api/sd/delete"):
            self.assertNotIn(unsafe, body)

if __name__ == "__main__":
    unittest.main(verbosity=2)
