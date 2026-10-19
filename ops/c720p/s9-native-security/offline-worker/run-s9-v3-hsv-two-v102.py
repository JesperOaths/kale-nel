#!/usr/bin/env python3
"""Process at most two missing *private* S9 HSV32 sidecars.

Never changes Camera2, originals, approved identities or ranking indices.
Existing V40 crops are verified against their SHA-256 before private temporary
use, and are never fabricated or counted as identified people.
"""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sys

ROOT=Path(__file__).resolve().parent
STATE=Path("/home/jespern/c720p-home-hub/state")
LOCK=STATE/"s9-v3-archive-backfill.lock"
MARK="S9_V3_HSV32_TWO_VERIFIED "
REJECT="S9_V3_HSV32_TWO_BLOCKED "
MAX_C=42.0
INITIAL_MAX_C=41.5
MIN_DISK=850*1024*1024

def helper(name,alias):
    path=ROOT/name
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("unsafe_pinned_helper")
    spec=importlib.util.spec_from_file_location(alias,path)
    obj=importlib.util.module_from_spec(spec)
    sys.modules[alias]=obj
    spec.loader.exec_module(obj)
    return obj

def temperature(h):
    value=h.adb("shell","dumpsys battery",timeout=20).stdout
    match=re.search(r"temperature:\s*(\d+)",value)
    if match is None:raise RuntimeError("missing_phone_thermal_reading")
    return int(match.group(1))/10

def camera_pid(h):
    pid=h.adb("shell","pidof nl.kalenel.s9security",timeout=20).stdout.strip()
    if not re.fullmatch(r"[0-9 ]+",pid):
        raise RuntimeError("camera_pid_missing")
    return pid

def exists(h,path):
    resp=h.adb("shell","test -s "+path,timeout=17,required=False)
    if resp.returncode==0:return True
    if resp.returncode==1 and not resp.stderr.strip():return False
    raise RuntimeError("phone_transport_untrusted")

def validated_missing(h,rows):
    selected=[]
    for item in rows:
        key=item.get("key")
        sha=item.get("crop_sha256")
        if not isinstance(key,str) or not re.fullmatch(r"[a-f0-9]{64}",key):
            raise RuntimeError("invalid_source_qualified_key")
        if not isinstance(sha,str) or not re.fullmatch(r"[a-f0-9]{64}",sha):
            raise RuntimeError("invalid_crop_digest")
        path=h.ROOT+"/features/"+key+"-hsv-v2.json"
        if not exists(h,path):selected.append(item)
    return selected

def run(h,ctrl):
    if shutil.disk_usage("/").free<MIN_DISK:
        raise RuntimeError("hub_free_disk_guard")
    if LOCK.is_symlink() or not LOCK.parent.is_dir():
        raise RuntimeError("unsafe_lock_path")
    fd=os.open(LOCK,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"rb") as locked:
        fcntl.flock(locked,fcntl.LOCK_EX|fcntl.LOCK_NB)
        pid=camera_pid(h)
        before_temp=temperature(h)
        if before_temp>INITIAL_MAX_C:raise RuntimeError("phone_warm_before_batch")
        approved=ctrl.approved_names()
        originals=set(ctrl.primary_events())
        rows=h.inventory(include_unreviewed=True)
        if not 58<=len(rows)<=400:
            raise RuntimeError("reference_cohort_outside_bound")
        missing=validated_missing(h,rows)
        selected=missing[:2]
        # Do not touch images or sidecars until each source-derived 512D
        # embedding passed the verified model SHA, crop SHA and L2 checks.
        for row in selected:h.safe_visual(row["key"],row["crop_sha256"])
        completed=0
        observed_max=before_temp
        for row in selected:
            t=temperature(h)
            observed_max=max(observed_max,t)
            if t>INITIAL_MAX_C:raise RuntimeError("phone_warm_before_descriptor")
            if camera_pid(h)!=pid:raise RuntimeError("camera_pid_changed")
            if h.v2_histogram(row)!="verified_histogram_and_osnet":
                raise RuntimeError("phone_histogram_unverified")
            after=temperature(h)
            observed_max=max(observed_max,after)
            if after>MAX_C:raise RuntimeError("phone_thermal_post_limit")
            if camera_pid(h)!=pid:raise RuntimeError("camera_pid_changed")
            # Independently reread each newly written sidecar, not just the
            # Java worker's write marker.
            if h.v2_histogram(row)!="verified_histogram_and_osnet":
                raise RuntimeError("phone_histogram_readback_failed")
            completed+=1
        if not originals.issubset(set(ctrl.primary_events())):
            raise RuntimeError("original_catalog_regressed")
        if approved!=ctrl.approved_names():raise RuntimeError("manual_reviews_changed")
        if camera_pid(h)!=pid:raise RuntimeError("camera_pid_changed")
        remaining=len(validated_missing(h,rows))
        if remaining!=len(missing)-completed:
            raise RuntimeError("unexpected_hsv_source_delta")
        return {
            "verified_crops":len(rows),"missing_before":len(missing),
            "new_verified_histograms":completed,"missing_after":remaining,
            "phone_max_temp_c":observed_max,"phone_pid_unchanged":True,
            "originals_unchanged":True,"manual_reviews_unchanged":True,
            "camera_apk_changed":False,"rankings_modified":False,
            "automatic_people_assigned":0,"private_identifiers_disclosed":False}

def main():
    h=helper("backfill-s9-hsv32-uniform-v2.py","s9_v3_hsv_guarded")
    ctrl=helper("backfill-s9-original-roi-osnet-temporal-v2.py","s9_v3_temporal_guarded")
    result=run(h,ctrl)
    print(MARK+json.dumps(result,sort_keys=True),flush=True)

if __name__=="__main__":
    try:main()
    except Exception:
        # Clip names, persons, sidecar paths and raw phone stderr must never
        # enter public CI logs. Partially completed sidecars are append-only
        # and independently valid; the next run is safely resumable.
        print(REJECT+json.dumps({"private_output_suppressed":True,
             "originals_not_intentionally_written":True,
             "existing_reviews_not_intentionally_written":True}),flush=True)
        raise SystemExit(2)
