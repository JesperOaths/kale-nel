#!/usr/bin/env python3
"""Conservative C720P hub text-log reclamation. No recordings, backups or configs.

Preview by default; --apply only changes explicitly listed user-owned text logs.
Retains a complete ~1 MiB recent tail of each eligible log and does not move
or unlink the file, preserving writers that hold file descriptors.
"""
import argparse
import json
import os
from pathlib import Path
import shutil
import stat
import time

ROOT=Path("/home/jespern/c720p-home-hub/logs")
NAMES=(
 "dns-watchdog.log","agent-self-watchdog.log","home-live-contract-guard.log",
 "kiosk-health-watchdog.log","phone-modet-cleanup.log",
 "camera-android-power-save.log","person-highlight-detect.log",
 "camera-battery-notifier.log","security-posture.log",
)
MAX_BYTES=1400000
KEEP_BYTES=650000
FLOOR_FREE=350000000

def candidates(root=ROOT):
    result=[]
    for name in NAMES:
        p=root/name
        try:
            meta=p.lstat()
            if not stat.S_ISREG(meta.st_mode) or p.is_symlink():continue
            if meta.st_uid!=os.getuid():continue
            if meta.st_size<=MAX_BYTES:continue
            result.append((p,meta.st_size))
        except FileNotFoundError:continue
    return result

def compact(path,expected_size):
    with path.open("r+b",buffering=0) as fd:
        before=os.fstat(fd.fileno())
        if before.st_size!=expected_size or not stat.S_ISREG(before.st_mode) or before.st_nlink<1:
            return {"path":path.name,"status":"concurrent_change_skipped"}
        fd.seek(max(0,before.st_size-KEEP_BYTES))
        tail=fd.read(KEEP_BYTES)
        # A line-oriented remainder avoids presenting a cut message as real
        # output. Always preserve at least half the most recent bytes.
        nl=tail.find(b"\n")
        if 0<=nl<len(tail)//2:tail=tail[nl+1:]
        fd.seek(0)
        fd.write(tail)
        fd.truncate()
        fd.flush()
    return {"path":path.name,"status":"compacted","old_bytes":expected_size,
            "kept_bytes":len(tail),"reclaimed_bytes":expected_size-len(tail)}

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--apply",action="store_true")
    args=p.parse_args()
    start=shutil.disk_usage("/").free
    items=candidates()
    report={"version":"C720P_SAFE_TEXT_LOG_COMPACTION_V1",
            "mode":"apply" if args.apply else "preview",
            "before_free_mb":round(start/1e6,2),
            "candidates":[{"name":p.name,"bytes":sz} for p,sz in items],
            "results":[],"media_modified":False,"backup_modified":False}
    if args.apply:
        for path,size in items:
            try:report["results"].append(compact(path,size))
            except OSError as e:report["results"].append({"path":path.name,"status":"failed_"+type(e).__name__})
    report["after_free_mb"]=round(shutil.disk_usage("/").free/1e6,2)
    report["reclaimed_mb"]=round((shutil.disk_usage("/").free-start)/1e6,2)
    print(json.dumps(report,separators=(",",":")))
if __name__=="__main__":main()
