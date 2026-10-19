#!/usr/bin/env python3
"""Thermally gated, read-only evidence that both S9 auxiliary playback paths work.

Only loopback HTTP, 1024 response bytes per role and a private metadata report.
Never starts a camera, writes footage, changes approvals, or triggers retention.
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
import urllib.request

STATE=Path("/home/jespern/c720p-home-hub/state")
LOCK=STATE/".s9-recovery-playback-smoke-v1.lock"
OUTPUT=STATE/"s9-recovery-playback-smoke-v1.json"
BASE="http://127.0.0.1:8795"
CAMERA="http://127.0.0.1:18808/status"
MAX_TEMP_C=38.0
MIN_ROOT_BYTES=650*1024*1024
NAME=re.compile(r"motion_[0-9]{13}[.]mp4[.](?:preroll[.]mp4|complete[.]mp4)")
SAMPLE_LENGTH=1024
DEPENDENCIES=("c720p-s9-original-hash-ledger-v1.service",
              "c720p-s9-standalone-catalog.service",
              "c720p-s9-auxiliary-recovery-refresh-v1.service")

def json_url(url):
    with urllib.request.urlopen(url,timeout=9) as response:
        if response.status!=200:raise RuntimeError("http_metadata_unavailable")
        return json.load(response)

def check_camera():
    doc=json_url(CAMERA)
    t=doc.get("temperature_c")
    if not (doc.get("mode")=="watching" and
            doc.get("continuous_4k_ready") is True and
            doc.get("continuous_4k_dropped_output_frames")==0 and
            type(t) in (int,float) and 0<t<MAX_TEMP_C):
        return None
    return doc

def busy_services():
    for unit in DEPENDENCIES:
        result=subprocess.run(["systemctl","--user","is-active",unit],
            capture_output=True,text=True,timeout=8)
        if result.stdout.strip() in ("active","activating","reloading"):
            return True
    return False

def selected(doc):
    if (doc.get("ok") is not True or
        doc.get("schema_version")!="s9_auxiliary_recovery_metadata_v1" or
        doc.get("not_verified_original_recordings") is not True or
        doc.get("not_counted_in_archive_or_person_analytics") is not True or
        doc.get("no_human_identity_approval") is not True or
        doc.get("full_frame_decode_verified") is not False):
        raise ValueError("untrusted_recovery_report")
    rows=doc.get("files")
    if not isinstance(rows,list) or not 2<=len(rows)<=400 or doc.get("structural_candidates")!=len(rows):
        raise ValueError("unbounded_recovery_report")
    chosen={}
    for role in ("preroll","complete"):
        matches=[x for x in rows if isinstance(x,dict) and x.get("role")==role]
        matches.sort(key=lambda x:str(x.get("name")))
        if not matches:raise ValueError("missing_recovery_role")
        row=matches[len(matches)//2]
        if (not isinstance(row.get("name"),str) or not NAME.fullmatch(row["name"]) or
            not row["name"].endswith("."+role+".mp4") or
            type(row.get("bytes")) is not int or not 10000<=row["bytes"]<=32000000):
            raise ValueError("invalid_recovery_media")
        chosen[role]=row
    return chosen

def read_exact_range(role,row):
    request=urllib.request.Request(
        BASE+"/new/saved/recovery/clip/"+row["name"],
        headers={"Range":f"bytes=0-{SAMPLE_LENGTH-1}","Accept":"video/mp4"},
        method="GET")
    with urllib.request.urlopen(request,timeout=18) as reply:
        expected=f"bytes 0-{SAMPLE_LENGTH-1}/{row['bytes']}"
        if (reply.status!=206 or reply.headers.get("Content-Range")!=expected or
            reply.headers.get("Content-Length")!=str(SAMPLE_LENGTH) or
            "video/mp4" not in reply.headers.get("Content-Type","") or
            "no-store" not in reply.headers.get("Cache-Control","")):
            raise ValueError("incorrect_playback_range_headers")
        source=reply.headers.get("X-S9-Media-Source")
        if source not in ("adb-legacy","phone-microSD-range"):
            raise ValueError("untrusted_playback_source")
        data=reply.read(SAMPLE_LENGTH+1)
    if len(data)!=SAMPLE_LENGTH or data[4:8]!=b"ftyp":
        raise ValueError("invalid_or_non_mp4_range")
    return {"role":role,"source":source,"range_status":206,
            "range_length":SAMPLE_LENGTH,"content_range_matches":True,
            "mp4_ftyp_detected":True,
            "filename_sha256":hashlib.sha256(row["name"].encode()).hexdigest(),
            "original_size_bytes":row["bytes"]}

def write_success(doc):
    if OUTPUT.is_symlink():raise ValueError("unsafe_playback_result")
    fd,temp=tempfile.mkstemp(prefix=".s9-range-proof-",dir=STATE)
    try:
        with os.fdopen(fd,"w",encoding="utf8") as out:
            os.fchmod(out.fileno(),0o600)
            json.dump(doc,out,sort_keys=True,separators=(",",":"))
            out.write("\n");out.flush();os.fsync(out.fileno())
        os.replace(temp,OUTPUT)
    finally:
        if os.path.exists(temp):os.unlink(temp)

def run(execute=False):
    STATE.mkdir(parents=True,exist_ok=True)
    if LOCK.is_symlink():raise ValueError("unsafe_lock")
    with LOCK.open("a+",encoding="utf8") as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print("S9_AUX_RANGE_SMOKE_DEFERRED already_running");return "deferred"
        if OUTPUT.is_file() and not OUTPUT.is_symlink():
            previous=json.loads(OUTPUT.read_text())
            if (previous.get("schema_version")=="s9_aux_recovery_playback_smoke_v1" and
                previous.get("preroll_and_complete_verified") is True and
                previous.get("video_files_modified") is False):
                print("S9_AUX_RANGE_SMOKE_ALREADY_VERIFIED");return "verified"
        if not execute:
            print("S9_AUX_RANGE_SMOKE_PLAN two_1KB_phone_http_ranges_no_file_changes");return "plan"
        before=check_camera()
        if before is None:
            print("S9_AUX_RANGE_SMOKE_DEFERRED thermal_or_capture");return "deferred"
        if busy_services():
            print("S9_AUX_RANGE_SMOKE_DEFERRED integrity_or_catalog_busy");return "deferred"
        stat=os.statvfs("/")
        if stat.f_bavail*stat.f_frsize<MIN_ROOT_BYTES:
            print("S9_AUX_RANGE_SMOKE_DEFERRED root_disk");return "deferred"
        rows=selected(json_url(BASE+"/new/api/s9-auxiliary-recovery"))
        observations={}
        for role in ("preroll","complete"):
            if check_camera() is None or busy_services():
                print("S9_AUX_RANGE_SMOKE_DEFERRED mid_batch");return "deferred"
            observations[role]=read_exact_range(role,rows[role])
        after=check_camera()
        if after is None:raise RuntimeError("camera_changed_after_range")
        record={"schema_version":"s9_aux_recovery_playback_smoke_v1",
          "verified_at_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
          "preroll_and_complete_verified":True,
          "results":observations,"camera_temp_start_c":before["temperature_c"],
          "camera_temp_end_c":after["temperature_c"],
          "video_response_bytes_read":2*SAMPLE_LENGTH,
          "full_video_decoded":False,"person_identity_assigned":False,
          "video_files_modified":False,"original_archive_counts_modified":False}
        write_success(record)
        print("S9_AUX_RANGE_SMOKE_VERIFIED "+json.dumps({
            "roles":{k:{"status":v["range_status"],"bytes":v["range_length"],
                        "source":v["source"],"mp4_ftyp":v["mp4_ftyp_detected"]}
                     for k,v in observations.items()},
            "camera_temp_before_c":before["temperature_c"],
            "camera_temp_after_c":after["temperature_c"],
            "total_bytes_read":record["video_response_bytes_read"],
            "media_modified":False,"manual_identity_modified":False},sort_keys=True))
        return "verified"

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--execute",action="store_true")
    args=parser.parse_args()
    run(args.execute)
