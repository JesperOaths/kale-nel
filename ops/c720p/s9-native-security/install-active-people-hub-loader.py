#!/usr/bin/env python3
"""Guarded cache-bust for the deployed untracked Security Hub HTML loader.

The hub UI uses security-hub-v30.html -> security-hub-v31.js -> People v53.
Replace only the loader's script source with versioned v32; no Task9 or camera changes.
"""
from pathlib import Path
import hashlib
import os
import tempfile

ROOT = Path('/opt/homeassistant/config/www/frontyard-security-new')
OLD = 'security-hub-v31.js?v=appearance-evidence-v2-20261025'
NEW = 'security-hub-v32.js?v=suggestions-active-v53-20261025'
EXPECTED_ORIGINAL_SHA256 = '2ee9fb95f85c701cd86a475cb18eec2db0e6cc329269e646f28c09af1ac2397e'

def install(root=ROOT):
    root = Path(root)
    entry = root / 'security-hub-v30.html'
    page = root / 'security-people-v53.html'
    script = root / 'security-hub-v32.js'
    for item in (entry, page, script):
        if item.is_symlink() or not item.is_file():
            raise ValueError('Required current Security Hub component unavailable')
    if 'data-pane="suggestions"' not in page.read_text():
        raise ValueError('Active People v53 Suggestions tab is missing')
    if 'security-people-v53.html?v=suggestions-active-v53-20261025&' not in script.read_text():
        raise ValueError('Versioned hub script has an unverified People destination')
    original = entry.read_bytes()
    digest = hashlib.sha256(original).hexdigest()
    if original.count(NEW.encode()) == 1 and original.count(OLD.encode()) == 0:
        return 'already-current'
    if digest != EXPECTED_ORIGINAL_SHA256 or original.count(OLD.encode()) != 1:
        raise ValueError('Live hub loader changed: not safe to rewrite')
    changed = original.replace(OLD.encode(), NEW.encode())
    backup = entry.with_suffix('.html.before-active-suggestions')
    fd = os.open(backup, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'wb') as out:
        out.write(original)
        out.flush()
        os.fsync(out.fileno())
    fd, tmp = tempfile.mkstemp(dir=root, prefix='.hub-loader-')
    try:
        os.fchmod(fd, 0o644)
        with os.fdopen(fd, 'wb') as out:
            out.write(changed)
            out.flush()
            os.fsync(out.fileno())
        os.replace(tmp, entry)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)
    if entry.read_bytes() != changed:
        raise ValueError('Live hub loader failed verification')
    return 'loader-updated'

if __name__ == '__main__':
    print(install())
