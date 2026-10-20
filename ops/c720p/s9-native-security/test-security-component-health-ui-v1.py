#!/usr/bin/env python3
"""Pure append/preservation and real-browser-script contract tests; no network."""
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
spec = importlib.util.spec_from_file_location("component_health_ui", HERE / "patch-security-component-health-ui-v1.py")
p = importlib.util.module_from_spec(spec)
spec.loader.exec_module(p)
TEMP_ROOT = os.environ.get("C720P_TEST_TMPDIR")
# Exact public syntax anchors only, not a live-page snapshot or runtime data.
BASELINE = "\n".join(p.ANCHORS) + "\n/* Other independently owned feature KEEP */\n"


class ComponentHealthUiTests(unittest.TestCase):
    def test_append_preserves_exact_original_bytes_and_is_idempotent(self):
        for newline in ("\n", "\r\n"):
            for ending in ("", newline):
                before = BASELINE.replace("\n", newline).rstrip("\r\n") + ending
                after = p.patch_asset(p.FILES[0], before)
                self.assertTrue(after.startswith(before))
                self.assertEqual(after, p.patch_asset(p.FILES[0], after))
                self.assertEqual(after.count(p.MARKER), 1)
                if newline == "\r\n":
                    self.assertNotIn("\n", after.replace("\r\n", ""))

    def test_unknown_partial_or_foreign_own_patch_is_rejected(self):
        for before in ("unrelated", p.MARKER + "\n" + BASELINE, BASELINE + "\n" + p.SCRIPT.replace("60000", "30000"), BASELINE + BASELINE):
            with self.subTest(before=before[:40]), self.assertRaises(ValueError):
                p.patch_asset(p.FILES[0], before)
        with self.assertRaises(ValueError):
            p.patch_asset("security-people-v45.js", BASELINE)

    def test_stage_is_separate_preserves_source_and_refuses_overwrite(self):
        with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as folder:
            source = Path(folder) / "source"
            source.mkdir()
            asset = source / p.FILES[0]
            asset.write_bytes(BASELINE.encode())
            for target in (source, source / "nested", source.parent):
                with self.assertRaises(ValueError):
                    p.stage(source, target)
            output = Path(folder) / "stage"
            manifest = p.stage(source, output)
            self.assertEqual(asset.read_bytes(), BASELINE.encode())
            self.assertTrue(manifest["files"][p.FILES[0]]["changed"])
            self.assertEqual(manifest, json.loads((output / "component-health-ui-manifest.json").read_text()))
            with self.assertRaises(ValueError):
                p.stage(source, output)

    def test_unknown_source_does_not_write_an_output(self):
        with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as folder:
            source = Path(folder) / "source"
            source.mkdir()
            (source / p.FILES[0]).write_text("unknown concurrent hub", encoding="utf-8")
            output = Path(folder) / "stage"
            with self.assertRaises(ValueError):
                p.stage(source, output)
            self.assertFalse(output.exists())

    def test_real_js_visibility_pacing_contract_validation_and_coverage(self):
        with tempfile.TemporaryDirectory(dir=TEMP_ROOT) as folder:
            script = Path(folder) / "component-health.js"
            script.write_text(p.SCRIPT, encoding="utf-8")
            result = subprocess.run([os.environ.get("C720P_TEST_NODE", "node"), str(HERE / "test-security-component-health-ui-runtime-v1.mjs"), str(script)], capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("SECURITY_COMPONENT_HEALTH_UI_RUNTIME_PASS", result.stdout)


if __name__ == "__main__":
    unittest.main(verbosity=2)
