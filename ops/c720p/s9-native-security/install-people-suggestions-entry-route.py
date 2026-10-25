#!/usr/bin/env python3
"""Guarded, local-only People entry redirect. Never modifies version-pinned v50.

The live Security Hub historically opens untracked security-people-v33.html,
which previously redirected to the unrelated legacy v50 clothing page.
"""
from pathlib import Path
import hashlib
import os
import tempfile

PAGE = "security-people-v33.html"
TARGET = "security-people-v52.html?v=vector-only-suggestions-20261025"
BASE = Path("/opt/homeassistant/config/www/frontyard-security-new")
LEGACY_SHA256 = "dd62c5001fbfd4fb4d971905b8d1b726ae676959"

def build_page():
    return (
        '<!doctype html><html lang="en"><head><meta charset="utf-8">'
        '<meta name="robots" content="noindex,nofollow">'
        '<meta http-equiv="Cache-Control" content="no-store">'
        '<meta http-equiv="refresh" content="0;url=' + TARGET + '">'
        '<title>Opening People &amp; faces</title></head><body>'
        '<p>Opening <a href="' + TARGET + '">People &amp; faces</a>...</p>'
        '<script>location.replace("' + TARGET + '")</script></body></html>'
    ).encode("utf-8")

def install(root=BASE):
    entry = Path(root) / PAGE
    if entry.is_symlink() or not entry.is_file():
        raise ValueError("People entry alias is missing or unsafe")
    new = build_page()
    old = entry.read_bytes()
    before = hashlib.sha256(old).hexdigest()
    after = hashlib.sha256(new).hexdigest()
    if before not in (LEGACY_SHA256, after):
        raise ValueError("People entry alias changed; refusing overwrite")
    if before == after:
        return "already-current"
    target = Path(root) / "security-people-v52.html"
    if target.is_symlink() or not target.is_file() or b'data-pane="suggestions"' not in target.read_bytes():
        raise ValueError("Vector Suggestions page is not installed")
    # Separate retained rollback copy; no legacy v50 modifications.
    backup = entry.with_name(PAGE + ".before-vector-redirect")
    if backup.exists():
        if backup.read_bytes() != old:
            raise ValueError("Existing redirect backup differs")
    else:
        fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "wb") as stream:
            stream.write(old); stream.flush(); os.fsync(stream.fileno())
    fd, temp = tempfile.mkstemp(dir=entry.parent, prefix=".people-route-")
    try:
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, "wb") as stream:
            stream.write(new); stream.flush(); os.fsync(stream.fileno())
        os.replace(temp, entry)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    if entry.read_bytes() != new:
        raise ValueError("People route deployment verification failed")
    return "redirect-installed"

if __name__ == "__main__":
    print(install())
