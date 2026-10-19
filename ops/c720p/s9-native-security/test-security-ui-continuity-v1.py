#!/usr/bin/env python3
"""Offline regressions for narrow current-live UI transformations."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HERE = Path(__file__).resolve().parent
sys.dont_write_bytecode = True
SPEC = importlib.util.spec_from_file_location("ui_continuity", HERE / "patch-security-ui-continuity-v1.py")
PATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(PATCH)
FIXTURES = HERE / "tests/fixtures/security-ui-continuity-v1"
TEMP_ROOT = os.environ.get("C720P_TEST_TMPDIR")


class ContinuityPatchTests(unittest.TestCase):
    def fixture(self, name):
        return (FIXTURES / name).read_text(encoding="utf-8")

    def test_idempotent_patches_preserve_unrelated_features_and_newlines(self):
        for name in PATCH.FILES:
            for newline in ("\n", "\r\n"):
                with self.subTest(name=name, newline=repr(newline)):
                    before = self.fixture(name).replace("\n", newline)
                    before = "/* CONCURRENT_FEATURE_KEEP */" + newline + before
                    after = PATCH.patch_asset(name, before)
                    self.assertNotEqual(before, after)
                    self.assertEqual(after, PATCH.patch_asset(name, after))
                    self.assertTrue(after.startswith("/* CONCURRENT_FEATURE_KEEP */" + newline))
                    if newline == "\r\n":
                        self.assertNotIn("\n", after.replace("\r\n", ""))

    def test_existing_mainline_face_fix_is_preserved(self):
        name = "security-people-v45.js"
        fixed = PATCH.patch_asset(name, self.fixture(name))
        self.assertEqual(fixed.count("const uniqueFaceCrops=new Set();"), 1)
        self.assertEqual(PATCH.patch_asset(name, fixed), fixed)

    def test_unknown_or_partial_source_fails_before_staging(self):
        with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as base:
            source, output = Path(base) / "source", Path(base) / "output"
            source.mkdir()
            for name in PATCH.FILES:
                content = self.fixture(name)
                if name == "security-review-v8.html":
                    content = content.replace("const relay=window.C720PSecureRelay;", "const relay=someNewResolver();", 1)
                (source / name).write_text(content, encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "unexpected_recovery_relay_contract"):
                PATCH.stage(source, output)
            self.assertFalse(output.exists())

    def test_cannot_stage_over_source_or_previous_stage(self):
        with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as base:
            source, output = Path(base) / "source", Path(base) / "output"
            source.mkdir()
            for name in PATCH.FILES:
                (source / name).write_text(self.fixture(name), encoding="utf-8")
            with self.assertRaisesRegex(ValueError, "separate_from_source"):
                PATCH.stage(source, source)
            with self.assertRaisesRegex(ValueError, "separate_from_source"):
                PATCH.stage(source, source / "child")
            before = {name: (source / name).read_bytes() for name in PATCH.FILES}
            manifest = PATCH.stage(source, output)
            self.assertTrue(all(info["changed"] for info in manifest["files"].values()))
            self.assertEqual(before, {name: (source / name).read_bytes() for name in PATCH.FILES})
            saved = json.loads((output / "ui-continuity-manifest.json").read_text())
            self.assertEqual(saved, manifest)
            with self.assertRaisesRegex(ValueError, "stage_output_already_exists"):
                PATCH.stage(source, output)

    def test_patched_runtime_behaviour_without_network_or_browser(self):
        with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as base:
            output = Path(base) / "stage"
            PATCH.stage(FIXTURES, output)
            result = subprocess.run(["node", str(HERE / "test-security-ui-continuity-runtime-v1.mjs"), str(output)],
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("SECURITY_UI_CONTINUITY_RUNTIME_PASS", result.stdout)


if __name__ == "__main__":
    unittest.main()
