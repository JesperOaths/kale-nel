#!/usr/bin/env python3
"""Guarded live Home Assistant surveillance entry-page update.

This root /local/c720p-surveillance.html is referenced by the ACTIVE Lovelace
c720p_hub dashboard, rather than the dormant security-hub-v30.html loader.
Only the versioned JS source changes; no Home Assistant storage, Task9,
camera original, or review database is touched.
"""
from pathlib import Path
import hashlib
import os
import tempfile

ROOT = Path('/opt/homeassistant/config/www')
PAGE = 'c720p-surveillance.html'
OLD = 'security-hub-v31.js?v=private-pipeline-safe-status-v31-20261021'
NEW = 'security-hub-v33.js?v=runtime-nav-20261025b'
EXPECTED_SHA256 = 'e657b15e6ab291add40619f48f1bbc78f9db6e3301f8e3cb0d83ec1b4f8d59dd'

def install(root=ROOT):
    root = Path(root)
    entry = root / PAGE
    page = root / 'frontyard-security-new/security-people-v53.html'
    hub = root / 'frontyard-security-new/security-hub-v33.js'
    guard = root / 'frontyard-security-new/people-suggestions-dom-guard-v1.js'
    for item in (entry, page, hub, guard):
        if item.is_symlink() or not item.is_file():
            raise ValueError('Required surveillance UI source missing or unsafe')
    html = page.read_text()
    if 'people-suggestions-dom-guard-v1.js?v=runtime-nav-20261025b' not in html or 'data-pane="suggestions"' not in html:
        raise ValueError('New v53 page lacks Suggestions navigation injection')
    if 'security-people-v53.html?v=runtime-nav-20261025b&' not in hub.read_text():
        raise ValueError('New hub script points to wrong People page')
    before = entry.read_bytes()
    if before.count(NEW.encode()) == 1 and OLD.encode() not in before:
        return 'already-installed'
    if hashlib.sha256(before).hexdigest() != EXPECTED_SHA256 or before.count(OLD.encode()) != 1:
        raise ValueError('Active surveillance entry has changed: refusing overwrite')
    after = before.replace(OLD.encode(), NEW.encode())
    backup = entry.with_name(PAGE + '.before-vector-dom-nav')
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as saved:
        saved.write(before)
        saved.flush()
        os.fsync(saved.fileno())
    fd, temp = tempfile.mkstemp(dir=root, prefix='.c720p-surveillance-')
    try:
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, 'wb') as out:
            out.write(after)
            out.flush()
            os.fsync(out.fileno())
        os.replace(temp, entry)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)
    if entry.read_bytes() != after:
        raise ValueError('New root surveillance page failed byte verification')
    return 'root-entry-updated'

if __name__ == '__main__':
    print(install())
