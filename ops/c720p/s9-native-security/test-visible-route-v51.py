#!/usr/bin/env python3
"""Offline guard test for the real C720P Security route upgrade."""
from pathlib import Path
import contextlib
import importlib.util
import io
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[3]
DEPLOY = ROOT / "ops/c720p/s9-native-security/deploy-people-v45.py"
spec = importlib.util.spec_from_file_location("people_route_installer", DEPLOY)
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

def check(alias, expected_success=True):
    with tempfile.TemporaryDirectory() as directory:
        folder = Path(directory)
        mod.DEST = {key: folder / (key + ".html") for key in
                    ("html", "js", "tracks", "shell", "alias", "hub", "entry")}
        for key in ("html", "js", "tracks"):
            source = ROOT / mod.ORIG[key]
            mod.DEST[key].write_bytes(source.read_bytes())
        # The actual outer Home Assistant page may be a lightweight wrapper.
        # Requiring historical inline root scripts here caused V50 deployment failure.
        mod.DEST["shell"].write_text('<!doctype html><html><body>HA shell</body></html>')
        mod.DEST["hub"].write_text(
            "/* s9-people-v45-real-route */\n"
            "const tabs=[['faces','People & faces','◎',"
            "'security-people-v45.html?v=s9pf-v49-folder-first-20261018&'],"
            "['tracks','Tracks & movement','◇',"
            "'security-tracks-v7.html?v=route-v50-20261018&']];")
        mod.DEST["entry"].write_text(
            "/* s9-people-v45-real-route */\n"
            '<script src="security-hub-v30.js?v=people-faces-v50-route-correction-20261018"></script>')
        mod.DEST["alias"].write_text(alias)
        mod.archive = lambda: {"motion_1792000000000.mp4"}
        mod.get = lambda url, limit=220000: (
            (ROOT / ("ops/" + url.split("/ops/", 1)[1])).read_bytes())
        saved_args = sys.argv
        sys.argv = [str(DEPLOY), "--ref", "a" * 40, "--dry-run"]
        result = io.StringIO()
        try:
            with contextlib.redirect_stdout(result):
                try:
                    mod.main()
                    outcome = True
                except RuntimeError:
                    outcome = False
        finally:
            sys.argv = saved_args
        assert outcome is expected_success, result.getvalue()
        if expected_success:
            assert "S9_PEOPLE_V45_LIVE_ROUTE_DRY_RUN_PASS" in result.getvalue()
            assert '"shell"' in result.getvalue()
            assert '"alias"' in result.getvalue()

check('<html><body>Review candidate recordings</body></html>')
check('<html><body><script>location.replace("/local/frontyard-security-new/security-people-v45.html?v=route-v50-20261018")</script></body></html>')
check('<html><body>Unexpected custom UI</body></html>', False)
print("SECURITY_VISIBLE_ROUTE_V51_DRY_RUN_TEST_PASS")
