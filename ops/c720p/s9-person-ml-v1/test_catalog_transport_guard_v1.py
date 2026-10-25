#!/usr/bin/env python3
"""Offline regressions for ADB transport and fail-closed catalog publication."""
import ast
import importlib.util
import pathlib
import types
import unittest
import tempfile
import json
from unittest import mock

HERE = pathlib.Path(__file__).resolve().parent
SOURCE = HERE / "local-sd-catalog.py"

def load_catalog():
    spec = importlib.util.spec_from_file_location("s9_catalog_transport_inert", SOURCE)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def completed(code=0, stdout=b"", stderr=b""):
    return types.SimpleNamespace(returncode=code, stdout=stdout, stderr=stderr)

class TransportTests(unittest.TestCase):
    def test_one_reconnect_then_success(self):
        m = load_catalog()
        responses = [
            completed(1, stderr=b"adb: device '192.168.178.250:5555' not found"),
            completed(0, stdout=b"connected"),
            completed(0, stdout=b"12345"),
        ]
        calls = []
        def run(args, **kwargs):
            calls.append(list(args))
            return responses.pop(0)
        with mock.patch.object(m.subprocess, "run", side_effect=run):
            self.assertEqual(m.adb("shell", "stat", "-c", "%s", "/missing"), b"12345")
            self.assertEqual(calls[1], ["adb", "connect", m.ADDR])
            with self.assertRaisesRegex(OSError, "phone_adb_transport_unavailable"):
                responses.append(completed(1, stderr=b"device offline"))
                m.adb("shell", "stat", "-c", "%s", "/missing")
            self.assertEqual(sum(x[:2] == ["adb", "connect"] for x in calls), 1)

    def test_missing_remote_file_is_not_a_transport_problem(self):
        m = load_catalog()
        calls = []
        def run(args, **kwargs):
            calls.append(list(args))
            return completed(1, stderr=b"cat: file: No such file or directory")
        with mock.patch.object(m.subprocess, "run", side_effect=run):
            with self.assertRaisesRegex(OSError, "phone_remote_asset_missing"):
                m.adb("exec-out", "cat", "/not-present")
            self.assertEqual(len(calls), 1)

    def test_post_reconnect_missing_file_is_still_missing(self):
        m = load_catalog()
        seq = [completed(1, stderr=b"device offline"),
               completed(0, stdout=b"connected"),
               completed(1, stderr=b"No such file or directory")]
        with mock.patch.object(m.subprocess, "run", side_effect=lambda *a, **kw: seq.pop(0)):
            with self.assertRaisesRegex(OSError, "phone_remote_asset_missing"):
                m.adb("exec-out", "cat", "/not-present")
        self.assertFalse(seq)

    def test_original_continuity_is_not_relaxed(self):
        m = load_catalog()
        old = {"motion_1791643920305.mp4": {"name": "motion_1791643920305.mp4"}}
        with self.assertRaisesRegex(RuntimeError, "incomplete_catalog_refresh_preserve_index"):
            m.verify_catalog_continuity(old, [], set(), set(old), True, None)
        m.verify_catalog_continuity(old, [], set(), set(), True, None)

    def test_preview_error_branch_retains_old_index(self):
        tree = ast.parse(SOURCE.read_text())
        build = next(n for n in tree.body if isinstance(n, ast.FunctionDef) and n.name == "build_catalog")
        branches = [n for n in ast.walk(build)
                    if isinstance(n, ast.If) and isinstance(n.test, ast.Name)
                    and n.test.id == "preview_failures"]
        self.assertEqual(len(branches), 1)
        writes_on_success = [
            x for node in branches[0].orelse for x in ast.walk(node)
            if isinstance(x, ast.Call) and isinstance(x.func, ast.Attribute)
            and x.func.attr == "replace"
        ]
        self.assertEqual(len(writes_on_success), 1)
        writes_on_failure = [
            x for node in branches[0].body for x in ast.walk(node)
            if isinstance(x, ast.Call) and isinstance(x.func, ast.Attribute)
            and x.func.attr == "replace"
        ]
        self.assertFalse(writes_on_failure)

    def test_partial_preview_refresh_preserves_prior_file(self):
        m = load_catalog()
        with tempfile.TemporaryDirectory(prefix="s9-catalog-inert-") as td:
            root = pathlib.Path(td)
            m.ROOT = root
            m.PRIVATE_FALLBACK = root / "private_fallback.json"
            m.phone_catalog = None
            m.PRIVATE_FALLBACK.write_bytes(b"KNOWN_GOOD_PREVIEW_INDEX\n")
            name = "preview_motion_1791643920305.jpg"
            def remote_read(*args):
                if args[:2] == ("shell", "ls"):
                    return (name + "\n").encode()
                raise OSError("phone_adb_transport_unavailable")
            m.adb = remote_read
            with mock.patch.object(m.subprocess, "run",
                    return_value=completed(0, stdout=b"device")):
                m.build_catalog()
            self.assertEqual(m.PRIVATE_FALLBACK.read_bytes(),
                             b"KNOWN_GOOD_PREVIEW_INDEX\n")
            output = json.loads((root / "s9-phone-events.json").read_text())
            self.assertEqual(output["total_phone_files"], 0)
            self.assertIn("preview_refresh_incomplete_preserved_prior:1",
                          output["errors"])

if __name__ == "__main__":
    unittest.main()
