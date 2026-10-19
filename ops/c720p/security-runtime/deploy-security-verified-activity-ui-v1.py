#!/usr/bin/env python3
"""One-file, pinned, rollback-safe deployment of verified Security activity UI.

Never alters the camera, archive, person decisions, relay or other HA pages.
No writes are performed without the explicit --execute argument.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile
import urllib.request

ROOT = Path("/opt/homeassistant/config/www/frontyard-security-new")
TARGET = ROOT / "security-review-v8.html"
BACKUPS = Path("/home/jespern/c720p-home-hub/backups/security-verified-activity-v1")
LOCK = Path("/home/jespern/c720p-home-hub/state/.security-verified-activity-v1.lock")
SOURCE = ("https://raw.githubusercontent.com/JesperOaths/kale-nel/"
          "5d9d553c339c3904ee733998ba4ea6871d9b66f6/"
          "ops/c720p/s9-native-security/security-review-v8.html")
EXPECTED_OLD = "d8c713e8b4db3ad63f32381c263e01aa309a64f4"
EXPECTED_NEW = "3d53db930a8597a76a4a549bf418bad51f39a3c8"
LOCAL_URL = ("http://127.0.0.1:8123/local/frontyard-security-new/"
             "security-review-v8.html?mode=evidence&v=verified-activity-20261019")

def blob_sha(raw):
    return hashlib.sha1(b"blob " + str(len(raw)).encode("ascii") + bytes([0]) + raw).hexdigest()

def validate_document(raw):
    if not 50_000 < len(raw) < 110_000:
        raise ValueError("unexpected_security_page_size")
    text = raw.decode("utf-8")
    for required in ('gejast-auth-gate.js', 'C720PSecureRelay',
                     '/new/api/s9-manual-recording-links',
                     '/new/api/security-recording-activity',
                     'id="s9v8-review-script"',
                     'id="verifiedDayBars"',
                     "mode==='today'",
                     'v817 - Made by Bruis'):
        if required not in text:
            raise ValueError("missing_required_security_feature")
    if text.count('<script id="s9v8-review-script">') != 1:
        raise ValueError("duplicate_security_inline_script")

def write_atomic(path, data, mode=0o644):
    fd, name = tempfile.mkstemp(prefix=".verified-activity-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as output:
            os.fchmod(output.fileno(), mode)
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.replace(name, path)
    finally:
        if os.path.exists(name):
            os.unlink(name)

def guarded_replace(target, incoming, backups, *, readback=None):
    if target.is_symlink() or not target.is_file():
        raise ValueError("untrusted_live_page")
    before = target.read_bytes()
    current = blob_sha(before)
    if current == EXPECTED_NEW:
        return {"action": "already_installed", "backup": None, "blob": current}
    if current != EXPECTED_OLD:
        raise ValueError("live_security_source_drift; no_changes")
    if blob_sha(incoming) != EXPECTED_NEW:
        raise ValueError("downloaded_source_digest_mismatch")
    validate_document(incoming)
    mode = target.stat().st_mode & 0o777
    if mode & 0o022:
        raise ValueError("insecure_live_page_permissions")
    backups.mkdir(parents=True, exist_ok=True, mode=0o700)
    if backups.is_symlink():
        raise ValueError("unsafe_backup_directory")
    stamp = dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup = backups / ("security-review-v8-" + stamp + ".html")
    with backup.open("xb") as f:
        os.fchmod(f.fileno(), 0o600)
        f.write(before)
        f.flush()
        os.fsync(f.fileno())
    try:
        write_atomic(target, incoming, mode)
        if blob_sha(target.read_bytes()) != EXPECTED_NEW:
            raise RuntimeError("local_file_readback_digest_mismatch")
        if readback is not None and readback() != incoming:
            raise RuntimeError("home_assistant_http_readback_mismatch")
        return {"action": "installed_verified", "backup": str(backup),
                "blob": EXPECTED_NEW, "prior_blob": EXPECTED_OLD}
    except Exception:
        write_atomic(target, before, mode)
        if blob_sha(target.read_bytes()) != EXPECTED_OLD:
            raise RuntimeError("rollback_failed_urgent_attention")
        raise

def fetch_remote():
    with urllib.request.urlopen(SOURCE, timeout=35) as response:
        return response.read(110_001)

def fetch_live():
    with urllib.request.urlopen(LOCAL_URL, timeout=12) as response:
        if response.status != 200:
            raise RuntimeError("ha_http_readback_unavailable")
        return response.read(110_001)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true", help="explicitly allow one-file guarded deployment")
    args = parser.parse_args()
    if not args.execute:
        print("S9_VERIFIED_ACTIVITY_UI_PLAN " + json.dumps({
            "source": SOURCE, "target": str(TARGET), "base_blob": EXPECTED_OLD,
            "target_blob": EXPECTED_NEW, "writes": False}, sort_keys=True))
        return
    LOCK.parent.mkdir(parents=True, exist_ok=True)
    with LOCK.open("a+") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        incoming = fetch_remote()
        if blob_sha(incoming) != EXPECTED_NEW:
            raise RuntimeError("pinned_git_blob_unavailable")
        validate_document(incoming)
        # Check HA readback route before touching any live file.
        live_before = fetch_live()
        if blob_sha(live_before) not in (EXPECTED_OLD, EXPECTED_NEW):
            raise RuntimeError("ha_http_source_drift; no_changes")
        result = guarded_replace(TARGET, incoming, BACKUPS, readback=fetch_live)
        print("S9_VERIFIED_ACTIVITY_UI_DEPLOY " + json.dumps({
            **result, "camera_apk_modified": False, "original_mp4s_modified": False,
            "drive_archive_modified": False, "manual_person_decisions_modified": False,
            "other_html_pages_modified": False}, sort_keys=True))

if __name__ == "__main__":
    main()
