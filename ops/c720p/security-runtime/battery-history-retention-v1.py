#!/usr/bin/env python3
"""Bound *only* the S9 battery-sampling JSONL: preserve recent samples and compressed predecessor.

Append authority stays with c720p-camera-android-power-save.sh, under its exclusive lock.
The active file is replaced atomically only after a complete compressed preimage is durable.
No camera, media, human-review, other log or service paths are eligible.
"""
import argparse
import gzip
import json
import os
from pathlib import Path
import stat
import tempfile

SOURCE = Path("/home/jespern/c720p-home-hub/state/camera-android-power-save.jsonl")
CAP = 8 * 1024**2
MAX_INPUT = 32 * 1024**2
MAX_ARCHIVE = 4 * 1024**2
KEEP = 2500


def compact(path=SOURCE, cap=CAP, keep=KEEP):
    if path.is_symlink() or not path.is_file():
        return "absent_or_unsafe"
    before = path.stat()
    if (not stat.S_ISREG(before.st_mode) or before.st_uid != os.getuid()
            or before.st_nlink != 1 or before.st_dev != Path("/").stat().st_dev):
        return "wrong_owner_or_mount"
    if before.st_size <= cap:
        return "in_bound"
    if before.st_size > MAX_INPUT:
        return "too_large_manual_review"
    prior = path.with_name(path.name + ".1.gz")
    if prior.is_symlink() or (prior.exists() and
            (not prior.is_file() or prior.stat().st_uid != os.getuid()
             or prior.stat().st_nlink != 1 or prior.stat().st_dev != before.st_dev)):
        return "unsafe_prior_archive"
    with path.open("rb") as f:
        original = f.read(MAX_INPUT + 1)
    if len(original) != before.st_size:
        return "concurrent_or_excessive_growth"
    # Existing readers parse JSONL and require the most recent 2500 lines.
    lines = original.splitlines(keepends=True)
    if len(lines) < keep + 1:
        return "insufficient_samples_to_trim"
    tail = b"".join(lines[-keep:])
    if len(tail) >= cap:
        return "recent_samples_exceed_cap"
    temps = []
    try:
        fd, temp_archive = tempfile.mkstemp(prefix=".battery-prior-", dir=path.parent)
        temps.append(temp_archive)
        os.fchmod(fd, 0o600)
        with os.fdopen(fd, "wb") as out:
            with gzip.GzipFile(fileobj=out, mode="wb", mtime=0) as gz:
                gz.write(original)
            out.flush()
            os.fsync(out.fileno())
        if os.stat(temp_archive).st_size > MAX_ARCHIVE:
            return "archive_exceeds_cap"
        with gzip.open(temp_archive, "rb") as inp:
            if inp.read() != original:
                return "archive_verify_failure"
        fd, temp_tail = tempfile.mkstemp(prefix=".battery-tail-", dir=path.parent)
        temps.append(temp_tail)
        os.fchmod(fd, before.st_mode & 0o777)
        with os.fdopen(fd, "wb") as out:
            out.write(tail)
            out.flush()
            os.fsync(out.fileno())
        fresh = path.stat()
        if (fresh.st_size, fresh.st_mtime_ns, fresh.st_ino) != (
                before.st_size, before.st_mtime_ns, before.st_ino):
            return "changed_during_compaction"
        # Caller holds writer's exclusive lock. This is never run on a live writer.
        os.replace(temp_archive, prior)
        temps.remove(temp_archive)
        os.replace(temp_tail, path)
        temps.remove(temp_tail)
        dfd = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(dfd)
        finally:
            os.close(dfd)
        return "compacted_with_verified_archive"
    finally:
        for name in temps:
            try:
                os.unlink(name)
            except FileNotFoundError:
                pass


if __name__ == "__main__":
    cli = argparse.ArgumentParser()
    cli.add_argument("--apply", action="store_true")
    a = cli.parse_args()
    print("BATTERY_RETENTION", json.dumps({
        "result": compact() if a.apply else "dry_run_no_mutation",
        "size": SOURCE.stat().st_size if SOURCE.exists() else None,
        "keep_recent_lines": KEEP,
        "max_active_bytes": CAP
    }, sort_keys=True))
