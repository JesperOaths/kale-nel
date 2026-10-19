#!/usr/bin/env python3
"""Low-duty, heat-gated private refresh of S9 auxiliary recovery evidence.

Never changes media, Camera2 APK, verified original archive counts, identity
decisions, retention or quarantine. Refresh only the private 0600 JSON report
with a bounded standalone Android MediaExtractor scan.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess

import s9_auxiliary_media_probe_v1 as scanlib

BASE=Path("/home/jespern/c720p-home-hub")
DEX=BASE/"build/s9-aux-media-readonly-v1/dex/classes.dex"
DEX_SHA="97e869bc8574e81a91800de556deae268a3373c1a2c442aa2ccad71220227213"
STATE=BASE/"state"
REPORT=STATE/"s9-auxiliary-structural-probe-v1.json"
LOCK=STATE/".s9-auxiliary-low-duty-refresh.lock"
MIN_AGE=36*3600
MAX_TEMP_C=37.0
MIN_ROOT_AVAILABLE=650*1024*1024

def age_seconds(report=REPORT,now=None):
    if not report.exists():return None
    if report.is_symlink() or not report.is_file() or report.stat().st_size>900000:
        raise ValueError("unsafe_existing_recovery_report")
    data=json.loads(report.read_bytes())
    if data.get("schema_version")!="s9_auxiliary_structural_report_v1":
        raise ValueError("unrecognized_recovery_report")
    stamp=dt.datetime.fromisoformat(data["generated_at_utc"])
    if stamp.tzinfo is None:raise ValueError("missing_recovery_timestamp_timezone")
    age=((now or dt.datetime.now(dt.timezone.utc))-stamp).total_seconds()
    if age < -300:raise ValueError("untrusted_recovery_clock")
    return age

def check_other_jobs():
    for name in ("c720p-s9-original-hash-ledger-v1.service",
                 "c720p-s9-standalone-catalog.service"):
        result=subprocess.run(["systemctl","--user","is-active",name],
                   capture_output=True,text=True,timeout=8)
        if result.stdout.strip() in ("active","activating"):
            raise RuntimeError("competing_s9_integrity_or_catalog_job")

def run(*,execute=False):
    STATE.mkdir(parents=True,exist_ok=True)
    if LOCK.is_symlink():raise RuntimeError("unsafe_lock_path")
    with LOCK.open("a+",encoding="utf8") as fd:
        try:fcntl.flock(fd,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print("S9_AUX_RECOVERY_REFRESH_DEFERRED already_running")
            return "deferred"
        previous_age=age_seconds()
        if previous_age is not None and previous_age<MIN_AGE:
            print("S9_AUX_RECOVERY_REFRESH_FRESH "+str(round(previous_age)))
            return "fresh"
        if not execute:
            print("S9_AUX_RECOVERY_REFRESH_PLAN read_only_phone_scan private_report_only")
            return "plan"
        status=scanlib.camera()
        temperature=status.get("temperature_c")
        if type(temperature) not in (float,int) or not 0<=temperature<MAX_TEMP_C:
            print("S9_AUX_RECOVERY_REFRESH_DEFERRED thermal")
            return "deferred"
        if os.statvfs("/").f_bavail*os.statvfs("/").f_frsize<MIN_ROOT_AVAILABLE:
            print("S9_AUX_RECOVERY_REFRESH_DEFERRED low_root_space")
            return "deferred"
        check_other_jobs()
        if DEX.is_symlink() or not DEX.is_file() or hashlib.sha256(DEX.read_bytes()).hexdigest()!=DEX_SHA:
            raise ValueError("missing_pinned_isolated_phone_worker")
        report=scanlib.scan(DEX,DEX_SHA,save=True)
        if report["total_unpaired"]!=sum(x["checked"] for x in report["by_role"].values()):
            raise ValueError("postscan_auxiliary_reconciliation")
        if report["originals_modified"] is not False or report["manual_person_reviews_modified"] is not False:
            raise ValueError("postscan_preservation_contract")
        print("S9_AUX_RECOVERY_REFRESH_VERIFIED "+json.dumps({
            "checked":report["total_unpaired"],"by_role":report["by_role"],
            "camera_temperature_c_before":temperature,
            "media_modified":False,"human_decisions_modified":False,
            "source_video_transferred_to_hub":False},sort_keys=True))
        return "done"

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--execute",action="store_true",help="allow rewriting only private structural report JSON")
    args=parser.parse_args()
    run(execute=args.execute)
