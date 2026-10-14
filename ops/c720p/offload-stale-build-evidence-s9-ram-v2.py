#!/usr/bin/env python3
"""RAM-staged, SHA-256 verified offload of stale C720P build evidence to S9 microSD.

This does NOT change camera software, recordings, models, services, or live streams.
The original directory is removed only after the remote final tar passes checksum
verification and an unchanged-source recheck. Symlinks are archived as links, never
dereferenced. Files are staged only on tmpfs, not the nearly-full C720P root disk.
"""
import argparse
import hashlib
import json
import os
import shutil
import stat
import subprocess
import tarfile
import tempfile
import time
import urllib.request
from pathlib import Path

PHONE = "192.168.178.250:5555"
DEST = "/storage/9C33-6BBD/c720p-offloaded-build-evidence-20261014"
SOURCES = (
    Path("/tmp/s9-v31-benchmark-cache-backup"),
    Path("/tmp/s9-joined-preroll-v1"),
)
MIN_AGE = 4 * 3600
MIN_BYTES = 35 * 1024**2
MAX_BYTES = 500 * 1024**2
MIN_RAM = 750 * 1024**2
MIN_SD = 45 * 1024**3

def run(*argv, timeout=80):
    p = subprocess.run(argv, capture_output=True, text=True, timeout=timeout)
    if p.returncode:
        raise RuntimeError("subprocess_failed: " + argv[0] + ": " + p.stderr[-220:])
    return p.stdout.strip()

def adb(*args, timeout=80):
    return run("adb", "-s", PHONE, *args, timeout=timeout)

def remote_hash(path):
    return adb("shell", "sha256sum", path, timeout=120).split()[0]

def remote_exists(path):
    return subprocess.run(
        ["adb", "-s", PHONE, "shell", "test", "-e", path],
        capture_output=True, timeout=15
    ).returncode == 0

def camera():
    with urllib.request.urlopen("http://127.0.0.1:18808/status", timeout=8) as r:
        return json.load(r)

def phone_ready():
    s = camera()
    okay = (s.get("ok") is True
            and s.get("mode") == "watching"
            and s.get("garden_person_gate_ready") is True
            and int(s.get("last_frame_age_ms") or 999999) < 2000
            and float(s.get("temperature_c") or 999) <= 42.0
            and int(s.get("sd_free_bytes") or 0) > MIN_SD)
    return okay, s

def mem_available():
    for line in Path("/proc/meminfo").read_text().splitlines():
        if line.startswith("MemAvailable:"):
            return int(line.split()[1]) * 1024
    return 0

def referenced_by_process(path):
    target = str(path)
    for entry in Path("/proc").iterdir():
        if not entry.name.isdecimal():
            continue
        try:
            if target.encode() in (entry / "cmdline").read_bytes()[:16000]:
                return True
            cwd = (entry / "cwd").resolve()
            if cwd == path or path in cwd.parents:
                return True
        except (OSError, PermissionError):
            continue
    return False

def snapshot(path):
    """Fingerprint the source tree without following symlinks."""
    rows = []
    total = 0
    for root, directories, files in os.walk(path, followlinks=False):
        for name in sorted(directories + files):
            p = Path(root) / name
            st = p.lstat()
            mode = stat.S_IFMT(st.st_mode)
            if mode not in (stat.S_IFREG, stat.S_IFDIR, stat.S_IFLNK):
                raise RuntimeError("unexpected_file_type")
            if stat.S_ISREG(st.st_mode):
                total += st.st_size
            rows.append((str(p.relative_to(path)), mode, st.st_size, st.st_mtime_ns,
                         os.readlink(p) if stat.S_ISLNK(st.st_mode) else ""))
    return tuple(sorted(rows)), total

def make_archive(source, staging):
    with tarfile.open(staging, "w", dereference=False) as tar:
        tar.add(source, arcname=source.name, recursive=True)
    with tarfile.open(staging, "r") as tar:
        members = tar.getmembers()
        if not members or members[0].name != source.name:
            raise RuntimeError("archive_inventory_mismatch")
        if any(n.name.startswith("/") or ".." in Path(n.name).parts for n in members):
            raise RuntimeError("unsafe_tar_entry")
    h = hashlib.sha256()
    with open(staging, "rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            h.update(block)
    return h.hexdigest()

def transfer(source):
    if not source.exists() or source.is_symlink() or source.parent != Path("/tmp"):
        return {"source":str(source), "skipped":"missing_or_wrong_root"}
    if time.time() - source.stat().st_mtime < MIN_AGE:
        return {"source":str(source), "skipped":"not_stale"}
    if referenced_by_process(source):
        return {"source":str(source), "skipped":"active_process_reference"}
    before, size = snapshot(source)
    if not MIN_BYTES <= size <= MAX_BYTES:
        return {"source":str(source), "skipped":"size_out_of_bounds", "bytes":size}
    if mem_available() < MIN_RAM or shutil.disk_usage("/dev/shm").free < size + 90 * 1024**2:
        return {"source":str(source), "skipped":"insufficient_tmpfs_or_memory"}
    ready, status = phone_ready()
    if not ready:
        return {"source":str(source), "skipped":"camera_not_idle_healthy",
                "mode":status.get("mode"), "temperature_c":status.get("temperature_c")}
    final = DEST + "/" + source.name + ".tar"
    part = final + ".part"
    with tempfile.TemporaryDirectory(prefix="s9-evidence-", dir="/dev/shm") as tmp:
        staging = str(Path(tmp) / "archive.tar")
        checksum = make_archive(source, staging)
        if snapshot(source)[0] != before or referenced_by_process(source):
            raise RuntimeError("source_changed_during_archive")
        ready, status = phone_ready()
        if not ready:
            return {"source":str(source), "skipped":"camera_became_busy",
                    "mode":status.get("mode")}
        if remote_exists(final):
            if remote_hash(final) != checksum:
                raise RuntimeError("existing_remote_archive_conflicts")
        else:
            adb("shell", "mkdir", "-p", DEST, timeout=25)
            adb("push", staging, part, timeout=320)
            if remote_hash(part) != checksum:
                raise RuntimeError("staged_phone_archive_checksum_mismatch")
            adb("shell", "mv", part, final, timeout=25)
        if remote_hash(final) != checksum:
            raise RuntimeError("final_phone_archive_checksum_mismatch")
        if snapshot(source)[0] != before or referenced_by_process(source):
            raise RuntimeError("source_changed_after_transfer")
        shutil.rmtree(source)
        return {"source":str(source), "result":"verified_microSD_offload",
                "uncompressed_source_bytes":size,
                "archive_bytes":os.stat(staging).st_size,
                "sha256":checksum, "remote":final}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--execute", action="store_true")
    opts = parser.parse_args()
    report = {"camera_apk_modified":False, "recordings_deleted":False,
              "models_deleted":False, "services_modified":False, "results":[]}
    report["free_before"] = shutil.disk_usage("/").free
    if not opts.execute:
        print("S9_RAM_OFFLOAD_DRY_RUN " + json.dumps(report))
        return
    for source in SOURCES:
        try:
            result = transfer(source)
            report["results"].append(result)
            if result.get("skipped") in ("camera_not_idle_healthy", "camera_became_busy"):
                break
        except Exception as exc:
            report["results"].append({"source":str(source), "error":str(exc)[:220]})
            break
    report["free_after"] = shutil.disk_usage("/").free
    report["net_free_change"] = report["free_after"] - report["free_before"]
    print("S9_RAM_OFFLOAD_RESULT " + json.dumps(report, sort_keys=True), flush=True)

if __name__ == "__main__":
    main()
