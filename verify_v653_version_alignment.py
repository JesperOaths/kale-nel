#!/usr/bin/env python3
"""Post-patch verifier for GEJAST / Kale Nel v653 frontend version alignment."""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

TARGET_VERSION_NUM = 653
TARGET_VERSION = f"v{TARGET_VERSION_NUM}"
TEXT_EXTENSIONS = {".html", ".js", ".css", ".mjs"}
EXCLUDED_DIRS = {".git", "node_modules", "dist", "build", ".next", ".cache", "coverage", "vendor"}
ASSET_EXTENSIONS = (".js", ".css", ".mjs", ".html")

PATTERNS = {
    "stale_page_version": re.compile(r"window\.GEJAST_PAGE_VERSION\s*=\s*['\"]v(?!653\b)\d+['\"]", re.I),
    "stale_config_version": re.compile(r"VERSION\s*:\s*['\"]v(?!653\b)\d+['\"]", re.I),
    "stale_watermark": re.compile(r"v(?!653\b)\d+\s*(?:·|&middot;|\.|-|—)?\s*Made by Bruis", re.I),
    "stale_release_display": re.compile(r"id=[\'\"]releaseVersion[\'\"][^>]{0,220}>v(?!653\b)\d+", re.I),
}


def excluded(path: Path) -> bool:
    return bool(set(path.parts) & EXCLUDED_DIRS)


def read(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        return None


def looks_like_local_asset_prefix(prefix: str) -> bool:
    tail = prefix.rstrip()[-140:]
    lower = tail.lower()
    if not lower.endswith(ASSET_EXTENSIONS):
        return False
    start = max(tail.rfind(q) for q in ['"', "'", "(", " ", "=", ","])
    candidate = tail[start + 1:].strip()
    if not candidate.lower().endswith(ASSET_EXTENSIONS):
        return False
    return not ("://" in candidate or candidate.startswith("//"))


def count_stale_local_asset_refs(text: str) -> int:
    count = 0
    i = 0
    while True:
        j = text.find("?v", i)
        if j == -1:
            return count
        k = j + 2
        while k < len(text) and text[k].isdigit():
            k += 1
        if k > j + 2 and text[j + 2:k] != str(TARGET_VERSION_NUM) and looks_like_local_asset_prefix(text[max(0, j - 160):j]):
            count += 1
        i = max(k, j + 2)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    findings = []

    version_file = root / "VERSION"
    version_ok = version_file.exists() and version_file.read_text(encoding="utf-8", errors="ignore").strip() == str(TARGET_VERSION_NUM)
    if not version_ok:
        findings.append({"path": "VERSION", "kind": "version_file_not_653"})

    scanned = 0
    for path in sorted(root.rglob("*")):
        if not path.is_file() or excluded(path) or path.suffix.lower() not in TEXT_EXTENSIONS:
            continue
        scanned += 1
        text = read(path)
        if text is None:
            continue
        rel = str(path.relative_to(root))
        for kind, pattern in PATTERNS.items():
            count = len(pattern.findall(text))
            if count:
                findings.append({"path": rel, "kind": kind, "count": count})
        asset_count = count_stale_local_asset_refs(text)
        if asset_count:
            findings.append({"path": rel, "kind": "stale_local_asset_cache_ref", "count": asset_count})

    report = {"target_version": TARGET_VERSION, "version_file_ok": version_ok, "scanned_frontend_files": scanned, "finding_count": len(findings), "findings": findings, "ok": version_ok and not findings}
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if report["ok"] else 2


if __name__ == "__main__":
    raise SystemExit(main())
