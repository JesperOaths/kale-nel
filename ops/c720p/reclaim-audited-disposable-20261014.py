#!/usr/bin/env python3
"""Conservative reclaim of reproducible, inactive C720P build/test artifacts.

Default is dry-run; --apply removes only explicit allowlisted paths. Never
touch recordings, thumbnails, configs, active models, rollback APKs, Docker,
Home Assistant, voice containers, browser profiles, or phone microSD.
"""
import argparse
import json
import os
import shutil
import stat
import subprocess
import time
import urllib.request
from pathlib import Path

TMP = Path("/tmp")
BUILD = Path("/home/jespern/c720p-home-hub/build")
CACHE = Path("/home/jespern/.cache")
# Specific historical non-production staging and disposable build inputs.
DIRECTORIES = {
    TMP / "people-v33-runtime": (8, 350),
    TMP / "people-v35-models": (8, 85),
    TMP / "s9-complete-signed-cache-v1": (8, 85),
    TMP / "s9-preroll-ffmpegkit-819": (24, 85),
    TMP / "s9-smooth-release-20261011": (24, 85),
    TMP / "s9-edge-ml-libs": (48, 65),
    TMP / "s9-v31-source": (24, 65),
    TMP / "s9-person-ml-v1": (48, 65),
    BUILD / "s9-5s10s-v10": (4, 60),
    BUILD / "s9-continuous4k-v6": (4, 60),
    CACHE / "selenium": (24, 80),
}
# Redundant temporary APK readbacks. The original live phone APK and rollback
# release copies are NOT in /tmp and are never addressed by this script.
FILES = {
    TMP / "s9-installed-real-apk-20261014.apk": (6, 40),
    TMP / "s9-audit-20261014-installed-current.apk": (6, 40),
}
EXPECTED_PARENTS = {TMP, BUILD, CACHE}
MAX_TOTAL = 800 * 1024 * 1024

def health():
    with urllib.request.urlopen("http://127.0.0.1:18808/status", timeout=8) as response:
        s = json.load(response)
    if not (s.get("ok") is True and s.get("mode") == "watching"
            and s.get("garden_person_gate_backend") == "gpu"
            and s.get("continuous_4k_ready") is True
            and int(s.get("last_frame_age_ms",999999)) < 2000):
        raise RuntimeError("phone_camera_not_healthy_watching_gpu_4k")
    return {"camera":"watching", "gpu":True, "4k":True, "temperature_c":s.get("temperature_c")}

def process_paths():
    """Snapshot references; an unreadable proc entry is ignored, not invented."""
    paths = []
    for pid in Path("/proc").iterdir():
        if not pid.name.isdecimal():continue
        try:
            raw = (pid/"cmdline").read_bytes()[:16000]
            paths.append(raw.decode("utf-8","replace").replace("\\0"," "))
            for name in ("cwd","exe"):
                try:paths.append(os.readlink(pid/name))
                except OSError:pass
            fd = pid/"fd"
            try:
                for handle in fd.iterdir():
                    try:paths.append(os.readlink(handle))
                    except OSError:pass
            except OSError:pass
        except OSError:continue
    return paths

def size_and_newest(root):
    base = root.lstat()
    size = 0
    newest = base.st_mtime
    if stat.S_ISREG(base.st_mode):
        return base.st_blocks * 512, newest
    for parent, dirs, files in os.walk(root, followlinks=False):
        # Never inspect a different mounted filesystem or traverse symlink dirs.
        for name in list(dirs):
            p = Path(parent)/name
            st = p.lstat()
            if st.st_dev != base.st_dev:raise RuntimeError("foreign_mount")
            if stat.S_ISLNK(st.st_mode):dirs.remove(name)
            newest = max(newest,st.st_mtime)
        for name in files:
            st=(Path(parent)/name).lstat()
            if st.st_dev != base.st_dev:raise RuntimeError("foreign_mount")
            size += st.st_blocks*512
            newest=max(newest, st.st_mtime)
            if size > MAX_TOTAL:raise RuntimeError("unexpected_total")
    return size, newest

def allowed(path, roots):
    if path not in roots:return False
    if path.parent not in EXPECTED_PARENTS:return False
    if path.is_symlink() or not path.exists():return False
    if path.parent.is_symlink():return False
    return path.resolve() == path

def audit(path, age_hours, cap_mb, process_refs):
    if not allowed(path, DIRECTORIES if path in DIRECTORIES else FILES):
        return {"path":str(path),"status":"absent_or_not_allowed"}
    try:
        size, newest = size_and_newest(path)
        if not 0 < size <= cap_mb*1024*1024:
            return {"path":str(path),"status":"outside_expected_size","bytes":size}
        age=(time.time()-newest)/3600
        if age < age_hours:
            return {"path":str(path),"status":"recently_modified","hours":round(age,1)}
        if any(str(path) in item for item in process_refs):
            return {"path":str(path),"status":"process_reference"}
        if not os.access(path.parent, os.W_OK):
            return {"path":str(path),"status":"not_writable"}
        return {"path":str(path),"status":"eligible","bytes":size,"age_hours":round(age,1)}
    except (OSError,RuntimeError,ValueError) as exc:
        return {"path":str(path),"status":"audit_error","error":type(exc).__name__}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--apply",action="store_true")
    args=p.parse_args()
    before=shutil.disk_usage("/").free
    report={"mode":"apply" if args.apply else "preview",
            "free_before_bytes":before,"recordings_deleted":False,
            "backups_deleted":False,"camera_changed":False,"services_changed":False,
            "entries":[]}
    try:report["phone"]=health()
    except Exception as err:
        report["status"]="camera_preflight_failed"
        report["error"]=type(err).__name__
        print("C720P_AUDITED_DISPOSABLE_RECLAIM "+json.dumps(report,sort_keys=True),flush=True)
        return
    refs=process_paths()
    total=0
    for path,(min_hours,max_mb) in [*DIRECTORIES.items(),*FILES.items()]:
        candidate=audit(path,min_hours,max_mb,refs)
        if candidate["status"]=="eligible":
            proposed=int(candidate["bytes"])
            if total + proposed > MAX_TOTAL:
                candidate["status"]="aggregate_limit"
            elif args.apply:
                # Recheck age, location and process references immediately.
                double=audit(path,min_hours,max_mb,process_paths())
                if double.get("status")!="eligible" or double.get("bytes")!=proposed:
                    candidate["status"]="recheck_not_eligible"
                else:
                    try:
                        if path in FILES:path.unlink()
                        else:shutil.rmtree(path)
                        candidate["status"]="removed"
                        total += proposed
                    except OSError as err:
                        candidate["status"]="remove_failed"
                        candidate["error"]=type(err).__name__
            else: total += proposed
        report["entries"].append(candidate)
    report["eligible_or_removed_bytes"]=total
    report["free_after_bytes"]=shutil.disk_usage("/").free
    report["free_delta_bytes"]=report["free_after_bytes"]-before
    try:report["phone_after"]=health()
    except Exception as err:report["phone_after"]={"status":"verification_failed","error":type(err).__name__}
    report["status"]="finished"
    print("C720P_AUDITED_DISPOSABLE_RECLAIM "+json.dumps(report,sort_keys=True),flush=True)

if __name__=="__main__":main()
