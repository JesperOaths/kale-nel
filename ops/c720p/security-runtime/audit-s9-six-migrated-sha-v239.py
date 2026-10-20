#!/usr/bin/env python3
"""Bounded, READ-ONLY C720P->S9+ rehash of six imported original MP4s.

PHYSICAL WORK IS OPT-IN: --batch small|large checks at most three videos per
invocation; no argument is a preflight only. Existing Camera2 4K, human review
and all six legacy C720P MP4/JPEG originals MUST be preserved.

This uses the trusted private C720P import ledger and Android adb-shell
sha256sum, NOT a future isolated companion UID. It cannot authenticate a
production manifest, enable Save/Delete or authorize original retirement.
"""
import argparse
import fcntl
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import stat
import subprocess
import urllib.request

SERIAL="192.168.178.250:5555"
MODEL="SM-G965F"
MANIFEST=Path("/home/jespern/c720p-home-hub/state/c720p-s9-imported-v2.json")
ORIGINALS=Path("/opt/homeassistant/config/www/frontyard-security-new/clips")
LOCK=Path("/home/jespern/c720p-home-hub/state/s9-v3-archive-backfill.lock")
SD="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/C720PMigrated"
CAMERA="http://127.0.0.1:18808/status"
SCHEMA="c720p_s9_verified_import_v2"
COUNT=6
EXPECTED_BYTES=214181934
MIN_FREE=850*1024*1024
MAX_TEMP_C=35.0
NAME=re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}\.mp4\Z")
SHA=re.compile(r"[a-f0-9]{64}\Z")
MARK="S9_SIX_IMPORTED_SHA_AUDIT_V239 "

class Refusal(Exception):
    pass

def require(value,reason):
    if not value:
        raise Refusal(reason)

def read_import_provenance(path=MANIFEST,clips=ORIGINALS):
    st=path.lstat()
    require(stat.S_ISREG(st.st_mode) and not path.is_symlink()
        and not (stat.S_IMODE(st.st_mode)&0o077)
        and 50<st.st_size<2_000_000,"private_manifest_untrusted")
    doc=json.loads(path.read_text(encoding="utf-8"))
    records=doc.get("records")
    require(doc.get("schema_version")==SCHEMA
       and isinstance(records,dict) and len(records)==COUNT,
       "six_imports_missing_from_private_ledger")
    require(clips.is_dir() and not clips.is_symlink(),
            "canonical_originals_dir_missing")
    approved=[]
    for name,row in records.items():
        require(isinstance(name,str) and NAME.fullmatch(name)
          and ".." not in name and isinstance(row,dict)
          and row.get("sd_path")==SD+"/"+name
          and isinstance(row.get("sha256"),str)
          and SHA.fullmatch(row["sha256"])
          and type(row.get("bytes")) is int and 10000<=row["bytes"]<=900*1024*1024
          and row.get("indexed") is True,
          "untrusted_import_row")
        original=clips/name
        require(original.is_file() and not original.is_symlink()
             and original.stat().st_size==row["bytes"],
             "legacy_original_missing_or_wrong_length")
        approved.append((row["bytes"],name,row["sha256"],row["sd_path"]))
    require(sum(r[0] for r in approved)==EXPECTED_BYTES,
            "historical_six_total_changed")
    approved.sort()
    return approved

def health():
    try:
        with urllib.request.urlopen(CAMERA,timeout=8) as reply:
            require(reply.status==200,"native_camera_unreachable")
            raw=reply.read(65537)
        require(len(raw)<=65536,"native_camera_status_unbounded")
        doc=json.loads(raw)
    except (OSError,ValueError,TypeError) as error:
        raise Refusal("native_camera_unreachable") from None
    require(doc.get("ok") is True and doc.get("mode")=="watching"
        and doc.get("native_4k_enabled") is True
        and doc.get("continuous_4k_ready") is True
        and doc.get("continuous_4k_dropped_output_frames")==0
        and not doc.get("continuous_4k_error")
        and type(doc.get("continuous_4k_buffered_ms")) is int
        and doc["continuous_4k_buffered_ms"]>=6500,
        "native_4k_not_healthy")
    temp=doc.get("temperature_c")
    require(type(temp) in (int,float) and 0<temp<=MAX_TEMP_C,
        "native_camera_temperature_guard")
    require(not any(doc.get(field) is True for field in
       ("recording_active","recording_in_progress","face_backfill_queued",
        "appearance_backfill_queued","historical_import_queued")),
        "native_camera_recording_or_worker_busy")
    return float(temp)

def adb(command,timeout=25):
    try:
        response=subprocess.run(["adb","-s",SERIAL,*command],
            capture_output=True,text=True,timeout=timeout,check=False)
    except (OSError,subprocess.TimeoutExpired):
        raise Refusal("bounded_phone_read_failed") from None
    require(response.returncode==0 and len(response.stdout)<=1600
       and len(response.stderr)<=1600,
       "bounded_phone_read_failed")
    return response.stdout.strip()

def phone_digest(path):
    require(isinstance(path,str) and path.startswith(SD+"/")
         and NAME.fullmatch(path.rsplit("/",1)[-1]),"phone_digest_path_unsafe")
    output=adb(("shell","sha256sum "+shlex.quote(path)),timeout=85).split()
    require(len(output)==2 and SHA.fullmatch(output[0])
         and output[1]==path,"phone_digest_output_invalid")
    return output[0]

def audited_batch(rows,batch,checking_health=health,checking_adb=adb,
                  hashing=phone_digest):
    require(batch in ("small","large"),"unapproved_batch")
    selected=rows[:3] if batch=="small" else rows[3:]
    require(len(selected)==3,"batch_requires_exactly_three_imports")
    max_temp=checking_health()
    require(checking_adb(("shell","getprop ro.product.model"),12)==MODEL,
            "incorrect_s9_phone")
    pid=checking_adb(("shell","pidof nl.kalenel.s9security"),12)
    require(bool(re.fullmatch(r"\d+(?:\s+\d+)*",pid)),
            "native_camera_process_untrusted")
    verified=0
    read_bytes=0
    for size,name,expected,path in selected:
        max_temp=max(max_temp,checking_health())
        require(hashing(path)==expected,
               "micro_sd_sha_differs_from_private_import_provenance")
        verified+=1
        read_bytes+=size
        max_temp=max(max_temp,checking_health())
    require(checking_adb(("shell","pidof nl.kalenel.s9security"),12)==pid,
            "native_camera_pid_changed")
    return {"phone_sha256_verified":verified,"phone_bytes_read":read_bytes,
            "max_camera_temp_c":max_temp,"camera_pid_unchanged":True,
            "camera_output_drops_after":0}

def execute(batch):
    require(batch in ("none","small","large"),"invalid_requested_batch")
    require(shutil.disk_usage("/").free>=MIN_FREE,
            "hub_root_reserve_below_850_mib")
    require(LOCK.is_file() and not LOCK.is_symlink(),
            "shared_camera_worker_lock_missing")
    rows=read_import_provenance()
    preflight={"manifest_imports":len(rows),
       "total_import_bytes":sum(row[0] for row in rows),
       "all_six_c720p_originals_preserved":True}
    if batch=="none":
        return {**preflight,"status":"local_provenance_preflight_only",
                "phone_sha256_verified":0,"phone_bytes_read":0}
    with LOCK.open("r") as lock:
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            raise Refusal("other_s9_background_worker_holds_lock") from None
        stats=audited_batch(rows,batch)
    return {**preflight,**stats,"status":"phone_sha256_three_verified"}

def main():
    parser=argparse.ArgumentParser(description="S9 read-only original integrity")
    parser.add_argument("--batch",choices=("none","small","large"),default="none")
    args=parser.parse_args()
    result={"batch":args.batch,"status":"refused","read_only":True,
       "camera_apk_modified":False,"original_media_modified":False,
       "review_decisions_modified":False,"legacy_originals_deleted":0,
       "remote_save_delete_enabled":False}
    try:
        result.update(execute(args.batch))
    except Exception as error:
        allowed={"invalid_requested_batch","hub_root_reserve_below_850_mib",
         "shared_camera_worker_lock_missing","private_manifest_untrusted",
         "six_imports_missing_from_private_ledger",
         "canonical_originals_dir_missing","untrusted_import_row",
         "legacy_original_missing_or_wrong_length","historical_six_total_changed",
         "other_s9_background_worker_holds_lock","unapproved_batch",
         "batch_requires_exactly_three_imports","native_camera_unreachable",
         "native_camera_status_unbounded","native_4k_not_healthy",
         "native_camera_temperature_guard",
         "native_camera_recording_or_worker_busy",
         "bounded_phone_read_failed","phone_digest_path_unsafe",
         "phone_digest_output_invalid","micro_sd_sha_differs_from_private_import_provenance",
         "incorrect_s9_phone","native_camera_process_untrusted",
         "native_camera_pid_changed"}
        result["reason"]=str(error) if str(error) in allowed \
                         else "bounded_read_only_audit_unavailable"
    print(MARK+json.dumps(result,sort_keys=True,separators=(",",":")),flush=True)
    if result["status"]=="refused":
        raise SystemExit(1)

if __name__=="__main__":
    main()
