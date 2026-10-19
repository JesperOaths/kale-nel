#!/usr/bin/env python3
"""Cool-window S9+ auxiliary playback proof across independent safe windows.

Runs at most one 1024-byte media Range GET per invocation, then defers.
Preserves the existing v1 exact HTTP/MP4 contract and release safety checks.
Only 0600 checkpoint JSON; never writes media or changes human approvals.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import tempfile
import s9_recovery_playback_smoke_v1 as v1

STATE=v1.STATE
LOCK=STATE/".s9-recovery-playback-smoke-v2.lock"
PARTIAL=STATE/"s9-recovery-playback-smoke-partial-v2.json"
SCHEMA="s9_aux_recovery_playback_smoke_partial_v2"
ROLES=("preroll","complete")
MAX_AGE_SECONDS=48*3600

def now():
    return dt.datetime.now(dt.timezone.utc)

def candidate_identity(role,row):
    return (hashlib.sha256(row["name"].encode()).hexdigest(),row["bytes"],role)

def validate_observation(observation,role,row):
    if not isinstance(observation,dict):
        return False
    name_hash,size,_=candidate_identity(role,row)
    return (observation.get("role")==role
        and observation.get("filename_sha256")==name_hash
        and type(observation.get("original_size_bytes")) is int
        and observation["original_size_bytes"]==size
        and observation.get("source") in ("adb-legacy","phone-microSD-range")
        and observation.get("range_status")==206
        and observation.get("range_length")==v1.SAMPLE_LENGTH
        and observation.get("content_range_matches") is True
        and observation.get("mp4_ftyp_detected") is True)

def read_partial(selected):
    if PARTIAL.is_symlink():
        raise ValueError("unsafe_partial_proof_symlink")
    if not PARTIAL.is_file():
        return {}
    stat=PARTIAL.stat()
    if stat.st_mode&0o077 or stat.st_size>12000:
        raise ValueError("unsafe_partial_proof_permissions_or_size")
    doc=json.loads(PARTIAL.read_text())
    if (doc.get("schema_version")!=SCHEMA or
        doc.get("video_files_modified") is not False or
        doc.get("manual_identity_modified") is not False or
        doc.get("full_video_decoded") is not False or
        not isinstance(doc.get("results"),dict)):
        raise ValueError("unexpected_partial_proof_schema")
    try:
        stamp=dt.datetime.fromisoformat(doc["verified_at_utc"])
    except (KeyError,ValueError,TypeError):
        return {}
    if (stamp.tzinfo is None or (now()-stamp).total_seconds()>MAX_AGE_SECONDS
            or (now()-stamp).total_seconds()< -300):
        return {}
    valid={}
    for role in ROLES:
        candidate=doc["results"].get(role)
        if validate_observation(candidate,role,selected[role]):
            valid[role]=candidate
    return valid

def write_partial(results):
    if PARTIAL.is_symlink():
        raise ValueError("unsafe_partial_proof_destination")
    doc={"schema_version":SCHEMA,"verified_at_utc":now().isoformat(),
         "results":results,"video_files_modified":False,
         "manual_identity_modified":False,"full_video_decoded":False}
    fd,tmp=tempfile.mkstemp(prefix=".s9-aux-partial-proof-",dir=STATE)
    try:
        with os.fdopen(fd,"w") as writer:
            os.fchmod(writer.fileno(),0o600)
            json.dump(doc,writer,separators=(",",":"),sort_keys=True)
            writer.write("\n")
            writer.flush()
            os.fsync(writer.fileno())
        os.replace(tmp,PARTIAL)
    finally:
        if os.path.exists(tmp):
            os.unlink(tmp)

def complete(results,before,after):
    return {"schema_version":"s9_aux_recovery_playback_smoke_v1",
        "verified_at_utc":now().isoformat(),
        "preroll_and_complete_verified":True,
        "results":results,
        "camera_temp_start_c":before["temperature_c"],
        "camera_temp_end_c":after["temperature_c"],
        "video_response_bytes_read":len(results)*v1.SAMPLE_LENGTH,
        "proof_window":"incremental_48h_with_independent_camera_health",
        "full_video_decoded":False,"person_identity_assigned":False,
        "video_files_modified":False,"original_archive_counts_modified":False}

def run(execute=False):
    STATE.mkdir(parents=True,exist_ok=True)
    if LOCK.is_symlink():
        raise ValueError("unsafe_s9_playback_lock")
    with LOCK.open("a+") as lock:
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print("S9_AUX_RANGE_V2_DEFERRED already_running")
            return "deferred"
        if v1.OUTPUT.is_symlink():
            raise ValueError("unsafe_final_proof")
        if v1.OUTPUT.is_file():
            doc=json.loads(v1.OUTPUT.read_text())
            if (doc.get("schema_version")=="s9_aux_recovery_playback_smoke_v1"
                and doc.get("preroll_and_complete_verified") is True
                and doc.get("video_files_modified") is False):
                print("S9_AUX_RANGE_V2_ALREADY_VERIFIED")
                return "verified"
        if not execute:
            print("S9_AUX_RANGE_V2_PLAN single_1024_byte_role_per_safe_window")
            return "plan"
        before=v1.check_camera()
        if before is None:
            print("S9_AUX_RANGE_V2_DEFERRED thermal_or_capture")
            return "deferred"
        if v1.busy_services():
            print("S9_AUX_RANGE_V2_DEFERRED competing_service")
            return "deferred"
        disk=os.statvfs("/")
        if disk.f_bavail*disk.f_frsize<v1.MIN_ROOT_BYTES:
            print("S9_AUX_RANGE_V2_DEFERRED root_disk")
            return "deferred"
        selected=v1.selected(v1.json_url(v1.BASE+"/new/api/s9-auxiliary-recovery"))
        previous=read_partial(selected)
        pending=next((role for role in ROLES if role not in previous),None)
        if pending is not None:
            if v1.check_camera() is None or v1.busy_services():
                print("S9_AUX_RANGE_V2_DEFERRED mid_preflight")
                return "deferred"
            result=v1.read_exact_range(pending,selected[pending])
            after=v1.check_camera()
            if after is None or v1.busy_services():
                print("S9_AUX_RANGE_V2_DEFERRED camera_or_service_changed")
                return "deferred"
            if not validate_observation(result,pending,selected[pending]):
                raise RuntimeError("unexpected_range_observation")
            previous[pending]=result
            write_partial(previous)
        if len(previous)!=len(ROLES):
            print("S9_AUX_RANGE_V2_ROLE_VERIFIED "+json.dumps({
                "verified_roles":sorted(previous),"remaining_roles":
                    [r for r in ROLES if r not in previous],
                "video_bytes_read_this_run":v1.SAMPLE_LENGTH if pending else 0,
                "camera_safe":True,"recordings_changed":False},sort_keys=True))
            return "partial"
        after=v1.check_camera()
        if after is None or v1.busy_services():
            print("S9_AUX_RANGE_V2_DEFERRED final_camera_or_service")
            return "deferred"
        v1.write_success(complete(previous,before,after))
        print("S9_AUX_RANGE_V2_BOTH_VERIFIED "+json.dumps({
            "roles":sorted(previous),"range_bytes_per_role":v1.SAMPLE_LENGTH,
            "camera_temp_c":after.get("temperature_c"),
            "video_files_modified":False,"manual_reviews_modified":False},sort_keys=True))
        return "verified"

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    ap.add_argument("--execute",action="store_true")
    args=ap.parse_args()
    run(args.execute)
