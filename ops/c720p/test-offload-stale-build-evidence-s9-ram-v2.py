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

    def test_historical_backup_guards_reject_hardlinks_and_young_files(self):
        from unittest.mock import patch
        import time
        with tempfile.TemporaryDirectory() as tmp:
            backups = Path(tmp) / "backups"
            old = backups / "s9-preroll-v3"
            old.mkdir(parents=True)
            apk = old / "old-camera.apk"
            with apk.open("wb") as stream:
                stream.truncate(7 * 1024**2)
            with patch.object(module, "BACKUP_ROOT", backups), patch.object(
                module, "HISTORICAL_APK_GENERATIONS", ("s9-preroll-v3",)):
                self.assertEqual(list(module.historical_apk_candidates()), [])
                past = time.time() - 12 * 3600
                os.utime(apk, (past,past))
                self.assertEqual(len(list(module.historical_apk_candidates())), 1)
                clone = old / "linked-copy.apk"
                os.link(apk,clone)
                self.assertEqual(list(module.historical_apk_candidates()), [])
                clone.unlink()
                self.assertEqual(len(list(module.historical_apk_candidates())), 1)
                fake = old / "symlinked.apk"
                fake.symlink_to(apk)
                self.assertEqual(len(list(module.historical_apk_candidates())), 1)

    def test_old_apks_are_hashed_and_manifested_before_unlinking(self):
        body = SOURCE.read_text()
        start = body.index("def offload_historical_apk(")
        end = body.index("\ndef main():", start)
        impl = body[start:end]
        self.assertLess(impl.index("if remote_hash(final) != checksum:"),
                        impl.index("source.unlink()"))
        self.assertLess(impl.index("os.fsync(out.fileno())"),
                        impl.index("source.unlink()"))
        self.assertIn("phone_ready_with_recovery()", impl)
        self.assertIn("stat().st_nlink != 1", impl)
        self.assertIn("s9-visual-attributes-v36",module.HISTORICAL_APK_GENERATIONS)
        self.assertIn("s9-temporal-review-v37",module.HISTORICAL_APK_GENERATIONS)
        self.assertNotIn("s9-night-detection-v41",module.HISTORICAL_APK_GENERATIONS)
        self.assertIn("identical_to_installed_camera",impl)

    def test_old_build_guard_requires_inactive_old_regular_files(self):
        from unittest.mock import patch
        import time
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)/"build"
            b=root/"s9-detector-benchmark"
            b.mkdir(parents=True)
            sample=b/"benchmark.tmp"
            with sample.open("wb") as out:
                out.truncate(3*1024**2)
            old=time.time()-7*3600
            os.utime(b,(old,old))
            with patch.object(module,"BUILD_ROOT",root), patch.object(
                module,"HISTORIC_BUILDS",("s9-detector-benchmark",)), patch.object(
                module,"referenced_by_process",return_value=False):
                self.assertIsNotNone(module.validated_old_build(b))
                link=b/"badlink"
                link.symlink_to("/etc/passwd")
                self.assertIsNone(module.validated_old_build(b))
                link.unlink()
                os.utime(b,(time.time(),time.time()))
                self.assertIsNone(module.validated_old_build(b))

    def test_old_build_offload_verifies_remote_then_records_before_removal(self):
        text=SOURCE.read_text()
        start=text.index("def offload_old_build(")
        end=text.index("\ndef main():",start)
        body=text[start:end]
        self.assertLess(body.index("remote_hash(final) != checksum"),
                        body.index("shutil.rmtree(folder)"))
        self.assertLess(body.index("os.fsync(writer.fileno())"),
                        body.index("shutil.rmtree(folder)"))
        self.assertIn("phone_ready_with_recovery()",body)
        self.assertNotIn("s9-native-security",module.HISTORIC_BUILDS)
        self.assertIn("s9-unified-4k-person-v11",module.HISTORIC_BUILDS)
        self.assertNotIn("s9-face-recall-v26",module.HISTORIC_BUILDS)
        self.assertNotIn("s9-visual-attributes-v36",module.HISTORIC_BUILDS)

if __name__ == "__main__":
    unittest.main(verbosity=2)
