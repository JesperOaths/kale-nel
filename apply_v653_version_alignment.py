#!/usr/bin/env python3
"""
GEJAST / Kale Nel v653 version-alignment repair script.
Run from the root of the kale-nel repository checkout.
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path
from typing import Callable

TARGET_VERSION_NUM = 653
TARGET_VERSION = f"v{TARGET_VERSION_NUM}"
WATERMARK = f"{TARGET_VERSION} · Made by Bruis"

TEXT_EXTENSIONS = {".html", ".js", ".css", ".mjs", ".json", ".txt", ".md", ".sh"}
EXCLUDED_DIRS = {".git", "node_modules", "dist", "build", ".next", ".cache", "coverage", "vendor"}
EXCLUDED_SUFFIXES = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".ico", ".pdf", ".zip", ".woff", ".woff2", ".ttf", ".otf", ".eot", ".mp4", ".mov", ".mp3"}
ASSET_EXTENSIONS = (".js", ".css", ".mjs", ".html")

Replacement = tuple[str, str | Callable[[re.Match[str]], str]]


def is_under_excluded_dir(path: Path) -> bool:
    return bool(set(path.parts) & EXCLUDED_DIRS)


def should_scan(path: Path) -> bool:
    if not path.is_file() or is_under_excluded_dir(path):
        return False
    if path.name == "VERSION":
        return True
    suffix = path.suffix.lower()
    return suffix not in EXCLUDED_SUFFIXES and suffix in TEXT_EXTENSIONS


def read_text(path: Path) -> str | None:
    try:
        return path.read_text(encoding="utf-8")
    except UnicodeDecodeError:
        try:
            return path.read_text(encoding="utf-8-sig")
        except UnicodeDecodeError:
            return None


def looks_like_local_asset_prefix(prefix: str) -> bool:
    trimmed = prefix.rstrip()
    if not trimmed:
        return False
    # Only inspect the tail since filenames can appear in quoted attrs or strings.
    tail = trimmed[-140:]
    lower = tail.lower()
    if not lower.endswith(ASSET_EXTENSIONS):
        return False
    # Find the start of the candidate asset string.
    start = max(tail.rfind(q) for q in ['"', "'", "(", " ", "=", ","])
    candidate = tail[start + 1:].strip()
    if not candidate.lower().endswith(ASSET_EXTENSIONS):
        return False
    # Avoid remote URLs; this patch should only touch local project cache busters.
    if "://" in candidate or candidate.startswith("//"):
        return False
    return True


def replace_local_asset_cache_versions(text: str) -> tuple[str, int]:
    out: list[str] = []
    i = 0
    count = 0
    n = len(text)
    while i < n:
        j = text.find("?v", i)
        if j == -1:
            out.append(text[i:])
            break
        k = j + 2
        while k < n and text[k].isdigit():
            k += 1
        if k == j + 2:
            out.append(text[i:k])
            i = k
            continue
        if looks_like_local_asset_prefix(text[max(0, j - 160):j]):
            out.append(text[i:j])
            out.append(f"?v{TARGET_VERSION_NUM}")
            count += 1
        else:
            out.append(text[i:k])
        i = k
    return "".join(out), count


def replacements_for(path: Path) -> list[Replacement]:
    return [
        (r"(window\.GEJAST_PAGE_VERSION\s*=\s*['\"])v\d+(['\"])", rf"\1{TARGET_VERSION}\2"),
        (r"(VERSION\s*:\s*['\"])v\d+(['\"])", rf"\1{TARGET_VERSION}\2"),
        (r"v\d+\s*(?:·|&middot;|\.|-|—)?\s*Made by Bruis", WATERMARK),
        (r"(<[^>]{0,220}id=[\'\"]releaseVersion[\'\"][^>]{0,220}>)v\d+(</[^>]+>)", rf"\1{TARGET_VERSION}\2"),
    ]


def apply_replacements(text: str, path: Path) -> tuple[str, int, list[str]]:
    total = 0
    details: list[str] = []
    for pattern, replacement in replacements_for(path):
        text, count = re.subn(pattern, replacement, text, flags=re.IGNORECASE)
        if count:
            total += count
            details.append(f"{pattern} => {count}")
    text, asset_count = replace_local_asset_cache_versions(text)
    if asset_count:
        total += asset_count
        details.append(f"local asset ?v### cache refs => {asset_count}")
    return text, total, details


def scan(root: Path, dry_run: bool) -> dict:
    changed: list[dict] = []
    scanned = 0

    version_path = root / "VERSION"
    if version_path.exists():
        old = read_text(version_path)
        if old is not None and old.strip() != str(TARGET_VERSION_NUM):
            changed.append({"path": "VERSION", "replacements": 1, "details": [f"{old.strip()} -> {TARGET_VERSION_NUM}"]})
            if not dry_run:
                version_path.write_text(f"{TARGET_VERSION_NUM}\n", encoding="utf-8")
    else:
        changed.append({"path": "VERSION", "replacements": 1, "details": ["created"]})
        if not dry_run:
            version_path.write_text(f"{TARGET_VERSION_NUM}\n", encoding="utf-8")

    for path in sorted(root.rglob("*")):
        if path.name == "VERSION" or not should_scan(path):
            continue
        scanned += 1
        text = read_text(path)
        if text is None:
            continue
        new_text, count, details = apply_replacements(text, path)
        if count and new_text != text:
            rel = str(path.relative_to(root))
            changed.append({"path": rel, "replacements": count, "details": details})
            if not dry_run:
                path.write_text(new_text, encoding="utf-8")

    return {"target_version": TARGET_VERSION, "dry_run": dry_run, "scanned_text_files": scanned, "changed_files": changed, "changed_file_count": len(changed)}


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--root", default=".")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--report", default="v653_version_alignment_report.json")
    args = parser.parse_args()
    root = Path(args.root).resolve()
    report = scan(root, args.dry_run)
    print(json.dumps(report, indent=2, ensure_ascii=False))
    if not args.dry_run:
        (root / args.report).write_text(json.dumps(report, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
