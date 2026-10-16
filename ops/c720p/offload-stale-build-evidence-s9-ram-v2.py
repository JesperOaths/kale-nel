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


# Explicitly retired signed-backup APKs only; do not move current releases.
BACKUP_ROOT = Path("/home/jespern/c720p-home-hub/backups")
HISTORICAL_APK_GENERATIONS = (
    "s9-continuous4k-v5", "s9-continuous4k-v6", "s9-onphone-prepend-v1",
    "s9-face-roi-movement-v1", "smooth-video", "s9-5s10s-v9",
    "s9-continuous4k-v4", "s9-preroll-v3", "s9-person-evidence-v31",
    "s9-prepended-v1c-one-time",
    # Retired V36-V39 review experiments; V40/V41/latest camera and its
    # immediate rollback are intentionally excluded.
    "s9-visual-attributes-v36",
    "s9-temporal-review-v37",
    "s9-detection-review-v38",
    "s9-detection-review-v39",
    "s9-face-roi-movement-v2",
    # Old confirmed inactive generations; current V40/V41 APKs remain local.
    "s9-unified-4k-person-v11",
    "s9-person-spatial-candidate",
    "s9-person-hybrid-v8",
    "s9-preroll-v9",
    "s9-diagnostic-preroll",
)
MAX_HISTORICAL_APK_BYTES = 290 * 1024**2
HISTORICAL_APK_AGE_SECONDS = 4 * 3600

def historical_apk_candidates():
    """Single-linked, old, conventionally named APKs only."""
    import re
    for generation in HISTORICAL_APK_GENERATIONS:
        root = BACKUP_ROOT / generation
        if root.is_symlink() or not root.is_dir():
            continue
        for source in sorted(root.rglob("*.apk")):
            try:
                relative = source.relative_to(root)
                if (source.is_symlink() or not source.is_file()
                    or any(not re.fullmatch(r"[A-Za-z0-9._-]{1,120}",part)
                           for part in relative.parts)
                    or any(p.is_symlink() for p in (source,*source.parents)
                           if p != BACKUP_ROOT.parent)):
                    continue
                st = source.stat()
                if st.st_nlink != 1:
                    continue
                if not 5 * 1024**2 <= st.st_size <= 55 * 1024**2:
                    continue
                if time.time() - st.st_mtime < HISTORICAL_APK_AGE_SECONDS:
                    continue
                yield root, source
            except OSError:
                continue

def sha_file(source):
    h = hashlib.sha256()
    with source.open("rb") as handle:
        for piece in iter(lambda:handle.read(1024*1024),b""):
            h.update(piece)
    return h.hexdigest()

def exact_file_stat(source):
    st = source.stat()
    return (st.st_dev,st.st_ino,st.st_size,st.st_nlink,
            st.st_mtime_ns,st.st_ctime_ns)


def phone_ready_with_recovery(attempts=5):
    """Give live Camera2 a few seconds to recover after network copying."""
    diagnostic = "unavailable"
    for i in range(attempts):
        try:
            okay, status = phone_ready()
            if okay:
                return True, status
            diagnostic = "unhealthy:mode=%s,temperature=%s,frame_age_ms=%s" % (
                status.get("mode"),status.get("temperature_c"),
                status.get("last_frame_age_ms"))
        except Exception as exc:
            diagnostic = type(exc).__name__
        if i < attempts-1:
            time.sleep(7)
    return False, {"diagnostic":diagnostic}


def offload_historical_apk(root,source):
    if (root.parent != BACKUP_ROOT or root.name not in HISTORICAL_APK_GENERATIONS
        or not source.is_file() or source.is_symlink() or source.stat().st_nlink != 1
        or time.time()-source.stat().st_mtime < HISTORICAL_APK_AGE_SECONDS):
        return {"source":str(source),"skipped":"not_eligible"}
    if referenced_by_process(source) or referenced_by_process(root):
        return {"source":str(source),"skipped":"process_reference"}
    before = exact_file_stat(source)
    checksum = sha_file(source)
    # Never offload the byte-identical APK currently installed on the S9+.
    packages = adb("shell", "pm", "path", "nl.kalenel.s9security", timeout=24)
    installed = [x.partition(":")[2].strip() for x in packages.splitlines()
                 if x.startswith("package:") and x.endswith("base.apk")]
    if len(installed) != 1:
        return {"source":str(source),"skipped":"installed_camera_path_unverifiable"}
    active = remote_hash(installed[0])
    if active == checksum:
        return {"source":str(source),"skipped":"identical_to_installed_camera"}
    rel = source.relative_to(root).as_posix()
    final = DEST+"/historical-apks/"+root.name+"/"+rel
    part = final+".part"
    healthy,status = phone_ready_with_recovery()
    if not healthy:
        return {"source":str(source),"skipped":"phone_health_precheck",
                "health":status.get("diagnostic")}
    adb("shell","mkdir","-p",final.rsplit("/",1)[0],timeout=30)
    if remote_exists(final):
        if remote_hash(final) != checksum:
            raise RuntimeError("remote_archive_conflicts")
    else:
        adb("push",str(source),part,timeout=280)
        if remote_hash(part) != checksum:
            raise RuntimeError("staged_apk_checksum_mismatch")
        adb("shell","mv",part,final,timeout=30)
    if remote_hash(final) != checksum:
        raise RuntimeError("final_apk_checksum_mismatch")
    if (exact_file_stat(source) != before or sha_file(source) != checksum
        or referenced_by_process(source) or referenced_by_process(root)):
        raise RuntimeError("local_apk_changed_during_transfer")
    healthy,status = phone_ready_with_recovery()
    if not healthy:
        raise RuntimeError("phone_health_lost_after_transfer:"+str(status.get("diagnostic")))
    # Durable recovery manifest stored on hub before removing only this file.
    manifest = Path("/home/jespern/c720p-home-hub/reports/s9-archived-apks-20261014.jsonl")
    manifest.parent.mkdir(parents=True,exist_ok=True)
    if manifest.is_symlink():
        raise RuntimeError("manifest_is_symlink")
    with manifest.open("a",encoding="utf-8") as out:
        out.write(json.dumps({"source":str(source),"remote":final,
                "sha256":checksum,"bytes":before[2]})+"\n")
        out.flush()
        os.fsync(out.fileno())
    source.unlink()
    return {"source":str(source),"result":"verified_microSD_offload",
            "bytes":before[2],"sha256":checksum,"remote":final}


# Old reproducible Android experiment output. The live native-security
# source, active detector, and current visual-attributes release are excluded.
HISTORIC_BUILDS = (
    # Retired V11 build artifact only; V26 installed camera and rollback excluded.
    "s9-unified-4k-person-v11",
    "s9-5s10s-v9", "s9-5s10s-v10", "s9-garden-hybrid-v8",
    "s9-face-model-evaluation", "s9-person-ml-v1",
    "s9-frame-metrics-stage", "s9-detector-benchmark",
)
BUILD_ROOT = Path("/home/jespern/c720p-home-hub/build")
MAX_OFFLOAD_BUILD = 90 * 1024**2
BUILD_MIN_AGE_SECONDS = 4 * 3600
MAX_BUILD_TOTAL = 190 * 1024**2

def validated_old_build(folder):
    if (folder.parent != BUILD_ROOT or folder.name not in HISTORIC_BUILDS
        or not folder.is_dir() or folder.is_symlink()
        or time.time()-folder.stat().st_mtime < BUILD_MIN_AGE_SECONDS
        or referenced_by_process(folder)):
        return None
    base_device = folder.stat().st_dev
    for top, dirs, files in os.walk(folder,followlinks=False):
        for name in dirs + files:
            entry=Path(top)/name
            st=entry.lstat()
            if st.st_dev != base_device or not (stat.S_ISREG(st.st_mode)
                                                or stat.S_ISDIR(st.st_mode)):
                return None
    before, size = snapshot(folder)
    if not 2 * 1024**2 <= size <= MAX_OFFLOAD_BUILD:
        return None
    return before, size

def offload_old_build(folder):
    saved = validated_old_build(folder)
    if saved is None:
        return {"source":str(folder),"skipped":"not_stale_safe_build"}
    before,size = saved
    if (mem_available() < MIN_RAM
        or shutil.disk_usage("/dev/shm").free < size + 90*1024**2):
        return {"source":str(folder),"skipped":"insufficient_tmpfs_or_memory"}
    with tempfile.TemporaryDirectory(prefix="c720p-archival-",dir="/dev/shm") as d:
        archive=Path(d)/"old-build.tar"
        checksum=make_archive(folder,str(archive))
        if snapshot(folder)[0] != before or referenced_by_process(folder):
            raise RuntimeError("build_changed_before_transfer")
        healthy,status=phone_ready_with_recovery()
        if not healthy:
            return {"source":str(folder),"skipped":"phone_unhealthy_before_build",
                    "diagnostic":status.get("diagnostic")}
        final=DEST+"/historical-builds/"+folder.name+".tar"
        part=final+".part"
        adb("shell","mkdir","-p",final.rsplit("/",1)[0],timeout=30)
        if remote_exists(final):
            if remote_hash(final) != checksum:
                raise RuntimeError("existing_build_archive_checksum_conflict")
        else:
            adb("push",str(archive),part,timeout=320)
            if remote_hash(part) != checksum:
                raise RuntimeError("staged_build_archive_hash_mismatch")
            adb("shell","mv",part,final,timeout=30)
        if remote_hash(final) != checksum:
            raise RuntimeError("final_build_archive_hash_mismatch")
        if snapshot(folder)[0] != before or referenced_by_process(folder):
            raise RuntimeError("build_changed_after_transfer")
        healthy,status=phone_ready_with_recovery()
        if not healthy:
            raise RuntimeError("phone_unhealthy_after_build_transfer:"+str(
                status.get("diagnostic")))
        manifest=Path("/home/jespern/c720p-home-hub/reports/s9-archived-builds-20261014.jsonl")
        manifest.parent.mkdir(parents=True,exist_ok=True)
        if manifest.is_symlink():
            raise RuntimeError("build_manifest_is_symlink")
        with manifest.open("a",encoding="utf-8") as writer:
            writer.write(json.dumps({"source":str(folder),"remote":final,
                     "sha256":checksum,"source_bytes":size})+"\n")
            writer.flush()
            os.fsync(writer.fileno())
        shutil.rmtree(folder)
        return {"source":str(folder),"result":"verified_microSD_build_offload",
                "bytes":size,"sha256":checksum,"remote":final}


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
    report["historic_apk_results"] = []
    archived_bytes = 0
    for root, source in historical_apk_candidates():
        if archived_bytes + source.stat().st_size > MAX_HISTORICAL_APK_BYTES:
            report["historic_apk_results"].append(
                {"source":str(source),"skipped":"aggregate_limit"})
            continue
        try:
            result = offload_historical_apk(root,source)
            report["historic_apk_results"].append(result)
            if result.get("result")=="verified_microSD_offload":
                archived_bytes += result["bytes"]
            if result.get("skipped")=="phone_health_precheck":
                break
        except Exception as exc:
            report["historic_apk_results"].append(
                {"source":str(source),"error":str(exc)[:180]})
            break
    report["historic_apk_bytes_verified"] = archived_bytes
    report["historic_build_results"] = []
    build_total=0
    for name in HISTORIC_BUILDS:
        folder=BUILD_ROOT/name
        if not folder.exists():
            continue
        try:
            saved=validated_old_build(folder)
            if saved is None:
                report["historic_build_results"].append(
                    {"source":str(folder),"skipped":"in_use_or_not_stale"})
                continue
            if build_total+saved[1] > MAX_BUILD_TOTAL:
                report["historic_build_results"].append(
                    {"source":str(folder),"skipped":"aggregate_limit"})
                continue
            result=offload_old_build(folder)
            report["historic_build_results"].append(result)
            if result.get("result")=="verified_microSD_build_offload":
                build_total+=result["bytes"]
            if "phone_unhealthy" in str(result.get("skipped","")):
                break
        except Exception as exc:
            report["historic_build_results"].append(
                {"source":str(folder),"error":str(exc)[:180]})
            break
    report["historic_build_bytes_verified"] = build_total
    report["free_after"] = shutil.disk_usage("/").free
    report["net_free_change"] = report["free_after"] - report["free_before"]
    print("S9_RAM_OFFLOAD_RESULT " + json.dumps(report, sort_keys=True), flush=True)

if __name__ == "__main__":
    main()
