#!/usr/bin/env python3
"""Run the read-only S9 standalone SD catalog without modifying Camera2 APK.

The hub only receives bounded verified sidecar JSON, never video/frame bytes.
One process per tick; when the phone, 4K capture, or archive changes mid-scan,
do NOT overwrite last known-good state. No review or retention mutation.
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
import tempfile
import time
import urllib.request

import phone_archive_catalog_v1 as schema

SERIAL="192.168.178.250:5555"
ARCHIVE="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
STATE=Path("/home/jespern/c720p-home-hub/state")
MAX_BYTES=16*1024*1024
MARKER="S9_PHONE_ARCHIVE_CLI "
EXPECTED_SCHEMA="s9_native_archive_cli_v1"
REMOTE="/data/local/tmp/c720p-s9-metadata-cli.dex"

def camera():
    with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=8) as r:
        d=json.load(r)
    if (d.get("ok") is not True or d.get("continuous_4k_ready") is not True
        or d.get("native_4k_enabled") is not True
        or d.get("continuous_4k_dropped_output_frames")!=0
        or d.get("mode") not in ("watching","recording")):
        raise RuntimeError("live_4k_capture_not_healthy")
    return d

def hub_names():
    with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=12) as r:
        d=json.load(r)
    if not isinstance(d.get("events"),list) or not d.get("events"):
        raise RuntimeError("hub_archive_unavailable")
    items=[]
    for record in d["events"]:
        n=record.get("clip_no") if isinstance(record,dict) else None
        if isinstance(n,str) and schema.NAME.fullmatch(n):items.append(n)
    if len(items)!=len(set(items)) or len(items)>2000:
        raise ValueError("hub_originals_duplicate_or_too_many")
    return set(items)

def atomic(target,value):
    raw=(json.dumps(value,separators=(",",":"),sort_keys=True)+"\n").encode()
    if len(raw)>MAX_BYTES:raise ValueError("standalone_metadata_too_large")
    target.parent.mkdir(parents=True,exist_ok=True)
    if target.is_symlink():raise ValueError("standalone_state_symlink")
    fd,tmp=tempfile.mkstemp(prefix=".s9-cli-",dir=target.parent)
    try:
        with os.fdopen(fd,"wb") as out:
            out.write(raw);out.flush();os.fsync(out.fileno())
        os.chmod(tmp,0o600);os.replace(tmp,target)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def parse(raw):
    if len(raw)>MAX_BYTES:raise ValueError("standalone_output_unbounded")
    lines=[x[len(MARKER):] for x in raw.decode("UTF-8").splitlines() if x.startswith(MARKER)]
    if len(lines)!=1:raise ValueError("standalone_cli_marker_missing_or_duplicated")
    d=json.loads(lines[0])
    if (d.get("ok") is not True or d.get("schema_version")!=EXPECTED_SCHEMA
        or d.get("source")!="S9_android_app_process"
        or d.get("metadata_only") is not True or d.get("read_only") is not True
        or d.get("camera_apk_modified") is not False
        or d.get("video_decode_performed") is not False
        or not schema.DIGEST.fullmatch(str(d.get("snapshot_id","")))):
        raise ValueError("standalone_cli_provenance")
    rows=d.get("records")
    if not isinstance(rows,list) or len(rows)>2000 or len(rows)!=d.get("total_records"):
        raise ValueError("standalone_record_count")
    records={}
    for row in rows:
        key,val=schema._record(row)
        if key in records:raise ValueError("standalone_duplicate_record")
        records[key]=val
    s=d.get("summary")
    if (not isinstance(s,dict) or s.get("source")!="S9_native_microSD_sidecar_metadata"
        or s.get("timezone")!="Europe/Amsterdam" or s.get("operating_day_start_hour")!=6
        or s.get("read_only") is not True or s.get("originals_sha256_rechecked") is not False
        or s.get("counts_are_recordings_not_distinct_people") is not True):
        raise ValueError("standalone_summary_untrusted")
    for key,patt in (("hourly_recording_counts",r"20[0-9]{2}-[0-9]{2}-[0-9]{2}T(?:[01][0-9]|2[0-3])[+-][0-9]{4}"),
                     ("daily_recording_counts",r"20[0-9]{2}-[0-9]{2}-[0-9]{2}")):
        bins=s.get(key)
        if not isinstance(bins,dict) or len(bins)>2000 or any(
                not re.fullmatch(patt,str(k)) or type(v) is not int or not 1<=v<=2000
                for k,v in bins.items()) or sum(bins.values())!=len(records):
            raise ValueError("standalone_time_bucket_mismatch")
    for key in ("recordings","sidecar_claimed_video_bytes","thumbnail_present_count",
                "person_candidate_recording_count","sd_usable_bytes","sd_total_bytes"):
        if type(s.get(key)) is not int or s[key]<0:raise ValueError("standalone_invalid_summary_metric")
    if (s["recordings"]!=len(records) or s["thumbnail_present_count"]>len(records)
        or s["person_candidate_recording_count"]>len(records)
        or s["sd_usable_bytes"]>s["sd_total_bytes"]
        or s["sidecar_claimed_video_bytes"]!=sum(x["bytes"] for x in records.values())):
        raise ValueError("standalone_summary_inconsistent")
    return {"schema_version":schema.VERSION,"snapshot_id":d["snapshot_id"],"records":records},s

def adb(*args,timeout=25):
    p=subprocess.run(["adb","-s",SERIAL,*args],capture_output=True,timeout=timeout)
    if p.returncode:raise RuntimeError("s9_adb_failed_"+str(p.returncode))
    return p.stdout

def scan(dex,dex_sha):
    if not dex.is_file() or dex.is_symlink() or not re.fullmatch(r"[a-f0-9]{64}",dex_sha):
        raise ValueError("untrusted_compiled_cli_dex")
    if hashlib.sha256(dex.read_bytes()).hexdigest()!=dex_sha or not 1000<dex.stat().st_size<1000000:
        raise ValueError("compiled_cli_digest_mismatch")
    adb("push",str(dex),REMOTE,timeout=30)
    try:
        script="CLASSPATH="+REMOTE+" app_process /system/bin nl.kalenel.s9security.PhoneArchiveCli "+ARCHIVE
        raw=adb("shell",script,timeout=95)
        return parse(raw)
    finally:
        try:adb("shell","rm","-f",REMOTE,timeout=14)
        except RuntimeError:pass

def run(dex,dex_sha,apply=False,state=STATE):
    state=Path(state);state.mkdir(parents=True,exist_ok=True)
    with (state/"s9-standalone-catalog.lock").open("a+") as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print("S9_STANDALONE_CATALOG_DEFERRED_LOCK");return False
        before=camera();live_before=hub_names()
        start=time.monotonic()
        catalog,summary=scan(Path(dex),dex_sha)
        live_after=hub_names();after=camera()
        found=set(catalog["records"])
        if found!=live_before or found!=live_after:
            raise RuntimeError("standalone_catalog_not_equal_to_live_archive")
        summary["catalog_snapshot_id"]=catalog["snapshot_id"]
        summary["generated_at_utc"]=dt.datetime.now(dt.timezone.utc).isoformat()
        summary["video_bytes_transferred_to_hub"]=False
        summary["camera_4k_healthy_before_and_after"]=True
        summary["microSD_scan_wall_seconds"]=round(time.monotonic()-start,3)
        summary["camera_temperature_before_c"]=before.get("temperature_c")
        summary["camera_temperature_after_c"]=after.get("temperature_c")
        if apply:
            atomic(state/"s9-standalone-archive-catalog-v1.json",catalog)
            atomic(state/"s9-standalone-archive-summary-v1.json",summary)
        print("S9_STANDALONE_ARCHIVE_PARITY "+json.dumps({
            "verified_phone":len(found),"hub_recordings":len(live_after),
            "hour_buckets":len(summary["hourly_recording_counts"]),
            "day_buckets":len(summary["daily_recording_counts"]),
            "scan_seconds":summary["microSD_scan_wall_seconds"],
            "root_originals_modified":False,"camera_apk_changed":False,
            "private_metadata_persisted":bool(apply)},sort_keys=True))
        return True

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--dex",type=Path,required=True)
    parser.add_argument("--dex-sha256",required=True)
    parser.add_argument("--apply",action="store_true")
    opts=parser.parse_args()
    run(opts.dex,opts.dex_sha256,opts.apply)
