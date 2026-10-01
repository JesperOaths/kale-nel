#!/usr/bin/env python3
"""v872: make Gmail OAuth token persistence atomic and recover zero-byte token files.

Designed for the C720P inbox-triage-agent runtime.
"""
from __future__ import annotations

import json
import os
import py_compile
import shutil
from datetime import datetime, timezone
from pathlib import Path

APP = Path("/opt/inbox-triage-agent")
TRIAGE = APP / "triage_agent.py"
TOKEN_DIR = APP / "data" / "tokens"

OLD = '''    path.write_text(creds.to_json(), encoding="utf-8")
    try:
        path.chmod(0o600)
    except Exception:
        pass
'''
NEW = '''    token_json = creds.to_json()
    tmp_path = path.with_suffix(path.suffix + ".tmp")
    with tmp_path.open("w", encoding="utf-8") as fh:
        fh.write(token_json)
        fh.flush()
        os.fsync(fh.fileno())
    try:
        tmp_path.chmod(0o600)
    except Exception:
        pass
    os.replace(tmp_path, path)
    try:
        path.chmod(0o600)
    except Exception:
        pass
'''


def valid_token(path: Path) -> bool:
    try:
        data = json.loads(path.read_text(encoding="utf-8"))
        return isinstance(data, dict) and bool(data.get("refresh_token"))
    except Exception:
        return False


def atomic_copy(src: Path, dst: Path) -> None:
    tmp = dst.with_suffix(dst.suffix + ".restore-tmp")
    shutil.copy2(src, tmp)
    tmp.chmod(0o600)
    os.replace(tmp, dst)
    dst.chmod(0o600)


def main() -> int:
    if not TRIAGE.exists():
        raise SystemExit(f"missing runtime: {TRIAGE}")

    source = TRIAGE.read_text(encoding="utf-8")
    if "tmp_path = path.with_suffix(path.suffix + ".tmp")" not in source:
        if OLD not in source:
            raise SystemExit("expected token write block not found")
        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        backup = TRIAGE.with_name(f"{TRIAGE.name}.pre-v872-{stamp}")
        backup.write_text(source, encoding="utf-8")
        TRIAGE.write_text(source.replace(OLD, NEW, 1), encoding="utf-8")
        print(f"PATCHED={TRIAGE}")
        print(f"BACKUP={backup}")
    else:
        print("PATCHED=already_atomic")

    py_compile.compile(str(TRIAGE), doraise=True)

    TOKEN_DIR.mkdir(parents=True, exist_ok=True)
    for live in sorted(TOKEN_DIR.glob("*.json")):
        if valid_token(live):
            live.chmod(0o600)
            print(f"TOKEN_OK={live.name}")
            continue

        candidates = sorted(
            (p for p in TOKEN_DIR.glob(live.name + ".pre-*") if valid_token(p)),
            key=lambda p: p.stat().st_mtime,
            reverse=True,
        )
        if not candidates:
            print(f"TOKEN_NEEDS_REAUTH={live.name}")
            continue

        stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        broken = live.with_name(f"{live.name}.broken-v872-{stamp}")
        if live.exists():
            shutil.copy2(live, broken)
        atomic_copy(candidates[0], live)
        print(f"TOKEN_RESTORED={live.name}")
        print(f"TOKEN_SOURCE={candidates[0].name}")

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
