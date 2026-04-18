#!/usr/bin/env python3
from __future__ import annotations

import re
from pathlib import Path

TARGET_VERSION = "v578"
TARGET_FILES = [
    "index.html",
    "login.html",
    "request.html",
    "scorer.html",
    "leaderboard.html",
    "ladder.html",
    "profiles.html",
    "admin_claims.html",
    "pikken.html",
    "pikken_live.html",
    "pikken_stats.html",
    "paardenrace.html",
    "paardenrace_live.html",
    "paardenrace_stats.html",
    "beurs.html",
    "ballroom.html",
]

HIDE_WATERMARK_FILES = {
    "pikken.html",
    "pikken_live.html",
    "pikken_stats.html",
    "paardenrace.html",
    "paardenrace_live.html",
    "paardenrace_stats.html",
}

DIRECT_JS_VERSION_BUMPS = {
    "pikken.html": ["gejast-pikken.js"],
    "pikken_live.html": ["gejast-pikken.js"],
    "paardenrace.html": ["gejast-paardenrace.js"],
    "paardenrace_live.html": ["gejast-paardenrace.js"],
}

PAGE_VERSION_RE = re.compile(r"window\.GEJAST_PAGE_VERSION\s*=\s*['\"]v\d+['\"]\s*;")
CONFIG_SRC_RE = re.compile(r'(\bgejast-config\.js)\?v\d+', re.I)

def add_hide_watermark_attr(html: str) -> str:
    if 'data-hide-version-watermark="1"' in html or "data-hide-version-watermark='1'" in html:
        return html
    body_match = re.search(r"<body\b", html, flags=re.I)
    if body_match:
        insert_at = body_match.end()
        return html[:insert_at] + ' data-hide-version-watermark="1"' + html[insert_at:]
    html_match = re.search(r"<html\b", html, flags=re.I)
    if html_match:
        insert_at = html_match.end()
        return html[:insert_at] + ' data-hide-version-watermark="1"' + html[insert_at:]
    return html

def remove_hide_watermark_attr(html: str) -> str:
    html = re.sub(r'\sdata-hide-version-watermark=(["\'])1\1', '', html, flags=re.I)
    return html

def bump_direct_js_versions(html: str, scripts: list[str]) -> str:
    for name in scripts:
        html = re.sub(rf'(\b{re.escape(name)})\?v\d+', rf'\1?{TARGET_VERSION}', html, flags=re.I)
    return html

def patch_file(path: Path) -> bool:
    original = path.read_text(encoding="utf-8")
    updated = original

    if PAGE_VERSION_RE.search(updated):
        updated = PAGE_VERSION_RE.sub(f"window.GEJAST_PAGE_VERSION='{TARGET_VERSION}';", updated, count=1)

    updated = CONFIG_SRC_RE.sub(rf"\1?{TARGET_VERSION}", updated)

    if path.name in DIRECT_JS_VERSION_BUMPS:
        updated = bump_direct_js_versions(updated, DIRECT_JS_VERSION_BUMPS[path.name])

    if path.name in HIDE_WATERMARK_FILES:
        updated = add_hide_watermark_attr(updated)
    else:
        updated = remove_hide_watermark_attr(updated)

    if updated == original:
        return False

    path.write_text(updated, encoding="utf-8")
    return True

def main() -> None:
    repo_root = Path.cwd()
    changed: list[str] = []
    missing: list[str] = []

    for rel in TARGET_FILES:
        path = repo_root / rel
        if not path.exists():
            missing.append(rel)
            continue
        if patch_file(path):
            changed.append(rel)

    print("Target version:", TARGET_VERSION)
    print("Changed files:")
    for rel in changed:
        print(" -", rel)

    if missing:
        print("Missing files:")
        for rel in missing:
            print(" -", rel)

    if not changed:
        print("No files changed.")

if __name__ == "__main__":
    main()
