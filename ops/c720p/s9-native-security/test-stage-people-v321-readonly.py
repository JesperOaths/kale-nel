#!/usr/bin/env python3
"""No-network regression: private HA preview URLs retain their HTTP scheme."""
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

ROOT = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location(
    "readonly_v321_stage", ROOT / "stage-people-v321-readonly.py")
STAGE = importlib.util.module_from_spec(SPEC)
sys.modules[SPEC.name] = STAGE
SPEC.loader.exec_module(STAGE)


class FakeResponse:
    status = 200

    def __init__(self, payload):
        self.payload = payload

    def __enter__(self):
        return self

    def __exit__(self, *args):
        return False

    def read(self, limit):
        return self.payload[:limit]


class ReadonlyStageHttpTest(unittest.TestCase):
    def test_verified_route_is_valid_http_not_pathlib(self):
        self.assertIsInstance(STAGE.BASE, str)
        info = urlsplit(STAGE.BASE)
        self.assertEqual(info.scheme, "http")
        self.assertEqual(info.netloc, "127.0.0.1:8123")
        self.assertEqual(info.path, "/local/frontyard-security-new")

    def test_http_acceptance_uses_exact_html_and_js_bytes(self):
        blobs = {
            "security-people-v51.html": b"expected html",
            "security-people-v321.js": b"expected JS",
        }
        seen = []

        def fetch(url, *, timeout):
            seen.append(url)
            self.assertTrue(url.startswith("http://127.0.0.1:8123/"))
            self.assertEqual(timeout, 12)
            filename = url.split("/")[-1].split("?")[0]
            return FakeResponse(blobs[filename])

        with patch.object(STAGE.urllib.request, "urlopen", side_effect=fetch):
            STAGE.verify_served(blobs, "1" * 40)
        self.assertEqual(len(seen), 2)
        self.assertTrue(all("?v=" + "1" * 12 in url for url in seen))

    def test_mismatched_served_bytes_fail_closed(self):
        def fetch(url, *, timeout):
            return FakeResponse(b"wrong bytes")
        with patch.object(STAGE.urllib.request, "urlopen", side_effect=fetch):
            with self.assertRaisesRegex(RuntimeError, "content_mismatch"):
                STAGE.verify_served({"security-people-v51.html": b"correct bytes"},
                                    "a" * 40)


if __name__ == "__main__":
    unittest.main(verbosity=2)
