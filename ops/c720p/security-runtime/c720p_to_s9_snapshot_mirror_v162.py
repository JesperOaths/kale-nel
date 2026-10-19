#!/usr/bin/env python3
"""Fail-closed snapshot companion mirror for SHA-verified C720P MP4 imports.

Keeps *all* local JPEGs and MP4s intact. No index/Save/Delete mutations.
The existing MP4 mirror's flock serializes both phone-side transfer workers.
Private 0600 manifest is published only when every JPEG verifies on microSD.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import urllib.request

ROOT=Path("/opt/homeassistant/config/www/frontyard-security-new")
CLIPS=ROOT/"clips"
SNAPS=ROOT/"snaps"
EVENTS=ROOT/"events.json"
STATE=Path("/home/jespern/c720p-home-hub/state")
MP4_MANIFEST=STATE/"c720p-s9-imported-v2.json"
REPORT=STATE/"c720p-s9-snapshots-v162.json"
LOCK=STATE/".c720p-s9-import-v2.lock"
SERIAL="192.168.178.250:5555"
MODEL="SM-G965F"
SD="/storage/9C33-6BBD"
DEST=SD+"/Android/data/nl.kalenel.s9security/files/C720PMigratedSnapshots"
MP4_DEST=SD+"/Android/data/nl.kalenel.s9security/files/C720PMigrated"
SCHEMA="c720p_s9_snapshots_v162"
MP4_SCHEMA="c720p_s9_verified_import_v2"
MP4=re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]mp4\Z")
JPEG=re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]jpg\Z")
SHA=re.compile(r"[0-9a-f]{64}\Z")
MAX_JPEG=5_000_000
MAX_MP4=900*1024**2
MAX_ROWS=5000
RESERVE=15*1024**3

class Stop(Exception):
    """Only fixed safe codes; filenames and signed resources are never logged."""

def require(ok,reason):
    if not ok:raise Stop(reason)

def digest_bytes(data):
    return hashlib.sha256(data).hexdigest()

def private_doc(path,limit):
    require(not path.is_symlink() and path.is_file(),"private_file_unavailable")
    st=path.stat()
    require(0<st.st_size<=limit and stat.S_IMODE(st.st_mode)&0o077==0,
            "private_file_untrusted")
    return json.loads(path.read_bytes())

def mp4_inventory():
    doc=private_doc(MP4_MANIFEST,2_000_000)
    require(isinstance(doc,dict) and doc.get("schema_version")==MP4_SCHEMA
            and isinstance(doc.get("records"),dict),"mp4_manifest_untrusted")
    rows=doc["records"]
    require(1<=len(rows)<=MAX_ROWS,"mp4_manifest_count_untrusted")
    for name,row in rows.items():
        require(isinstance(name,str) and MP4.fullmatch(name) and ".." not in name
                and isinstance(row,dict) and row.get("sd_path")==MP4_DEST+"/"+name
                and isinstance(row.get("sha256"),str) and SHA.fullmatch(row["sha256"])
                and type(row.get("bytes")) is int
                and 10_000<=row["bytes"]<=MAX_MP4
                and row.get("indexed") is True,"mp4_manifest_entry_untrusted")
    return rows

def trusted_snapshot(raw):
    require(isinstance(raw,str) and len(Path(raw).parts)==2
            and Path(raw).parts[0]=="snaps" and JPEG.fullmatch(Path(raw).name)
            and ".." not in raw,"snapshot_path_untrusted")
    path=SNAPS/Path(raw).name
    require(not path.is_symlink() and path.is_file()
            and path.parent.resolve()==SNAPS.resolve(),"snapshot_not_regular")
    st=path.stat()
    require(1000<=st.st_size<=MAX_JPEG,"snapshot_size_untrusted")
    data=path.read_bytes()
    require(len(data)==st.st_size and data.startswith(b"\xff\xd8\xff")
            and data.endswith(b"\xff\xd9"),"snapshot_jpeg_untrusted")
    return path,st,digest_bytes(data)

def local_inventory():
    require(not SNAPS.is_symlink() and SNAPS.is_dir()
            and not CLIPS.is_symlink() and CLIPS.is_dir()
            and not EVENTS.is_symlink() and EVENTS.is_file(),"local_inventory_untrusted")
    m=mp4_inventory()
    doc=json.loads(EVENTS.read_bytes())
    if isinstance(doc,dict):
        doc=next((doc[k] for k in ("events","items","clips")
                  if isinstance(doc.get(k),list)),None)
    require(isinstance(doc,list),"events_schema_untrusted")
    rows={}
    seen_clips=set()
    for event in doc:
        if not isinstance(event,dict):continue
        clip=event.get("clip")
        if not isinstance(clip,str):continue
        parts=Path(clip).parts
        require(len(parts)==2 and parts[0]=="clips" and MP4.fullmatch(parts[1])
                and ".." not in clip,"legacy_clip_path_untrusted")
        name=parts[1]
        if name not in m:continue
        require(name not in seen_clips,"duplicate_legacy_clip")
        seen_clips.add(name)
        path,st,sha=trusted_snapshot(event.get("snapshot"))
        require(path.name not in rows,"duplicate_snapshot")
        rows[path.name]={
            "clip":name,"clip_sha256":m[name]["sha256"],"bytes":st.st_size,
            "sha256":sha,"sd_path":DEST+"/"+path.name,
        }
    require(len(seen_clips)==len(m) and len(rows)==len(m),
            "incomplete_legacy_snapshot_coverage")
    return rows

def existing_report():
    if not REPORT.exists() and not REPORT.is_symlink():return None
    doc=private_doc(REPORT,2_000_000)
    require(isinstance(doc,dict) and doc.get("schema_version")==SCHEMA
            and isinstance(doc.get("records"),dict),"old_snapshot_report_invalid")
    rows=doc["records"]
    require(1<=len(rows)<=MAX_ROWS,"old_snapshot_report_count")
    for name,row in rows.items():
        require(isinstance(name,str) and JPEG.fullmatch(name)
                and isinstance(row,dict) and row.get("sd_path")==DEST+"/"+name
                and isinstance(row.get("clip"),str) and MP4.fullmatch(row["clip"])
                and isinstance(row.get("clip_sha256"),str)
                and SHA.fullmatch(row["clip_sha256"])
                and isinstance(row.get("sha256"),str) and SHA.fullmatch(row["sha256"])
                and type(row.get("bytes")) is int
                and 1000<=row["bytes"]<=MAX_JPEG,"old_snapshot_report_entry")
    return rows

def adb(*args,timeout=30):
    p=subprocess.run(["adb","-s",SERIAL,*args],capture_output=True,text=True,
                     timeout=timeout)
    require(p.returncode==0 and not p.stderr.strip(),"s9_adb_transport_unavailable")
    return p.stdout.strip()

def phone_exists(path):
    p=subprocess.run(["adb","-s",SERIAL,"shell","test","-f",path],
                     capture_output=True,timeout=12)
    if p.returncode in (0,1) and p.stderr==b"":
        return p.returncode==0
    raise Stop("phone_presence_indeterminate")

def phone_matches(path,sha,size):
    if not phone_exists(path):return False
    require(adb("shell","stat","-c","%s",path)==str(size),
            "phone_size_does_not_match")
    fields=adb("shell","sha256sum",path).split()
    require(len(fields)==2 and SHA.fullmatch(fields[0].lower())
            and fields[1]==path,"phone_checksum_response_invalid")
    return fields[0].lower()==sha

def camera_ready():
    try:
        with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=9) as r:
            d=json.loads(r.read(90_001))
        t=d.get("temperature_c")
        return (d.get("ok") is True and d.get("mode")=="watching"
                and d.get("continuous_4k_ready") is True
                and d.get("continuous_4k_dropped_output_frames")==0
                and type(t) in (float,int) and 0<t<37.0)
    except (OSError,ValueError,TypeError):return False

def connected_free():
    require(adb("get-state")=="device","phone_unavailable")
    require(adb("shell","getprop","ro.product.model")==MODEL,"wrong_phone")
    lines=adb("shell","df","-k",SD).splitlines()
    rows=[line.split() for line in lines if line.split()[-1:]==[SD]]
    require(bool(rows) and rows[-1][3].isdigit(),"microSD_mount_unverified")
    return int(rows[-1][3])*1024

def atomic_report(rows):
    require(not REPORT.is_symlink(),"unsafe_report_path")
    fd,tmp=tempfile.mkstemp(prefix=".s9-snapshot-report-",dir=STATE)
    try:
        with os.fdopen(fd,"w",encoding="utf8") as f:
            os.fchmod(f.fileno(),0o600)
            json.dump({"schema_version":SCHEMA,"records":rows},f,
                      sort_keys=True,separators=(",",":"))
            f.write("\n");f.flush();os.fsync(f.fileno())
        os.replace(tmp,REPORT)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def promote_one(name,row):
    dest=row["sd_path"]
    if phone_matches(dest,row["sha256"],row["bytes"]):return "already_verified"
    require(not phone_exists(dest),"different_final_snapshot_preserved")
    partial=dest+".partial"
    require(camera_ready(),"camera_busy_or_hot")
    src=SNAPS/name
    before=src.stat()
    if phone_exists(partial):
        require(phone_matches(partial,row["sha256"],row["bytes"]),
                "different_partial_snapshot_preserved")
        status="resumed_verified_partial"
    else:
        adb("push",str(src),partial,timeout=95)
        require(phone_matches(partial,row["sha256"],row["bytes"]),
                "unverified_snapshot_transfer")
        status="copied_and_verified"
    now=src.stat()
    require(now.st_size==before.st_size and now.st_mtime_ns==before.st_mtime_ns
            and digest_bytes(src.read_bytes())==row["sha256"],
            "local_snapshot_changed_during_copy")
    require(camera_ready(),"camera_busy_before_snapshot_promotion")
    require(not phone_exists(dest),"snapshot_destination_raced")
    adb("shell","mv",partial,dest)
    require(phone_matches(dest,row["sha256"],row["bytes"]),
            "promoted_snapshot_hash_invalid")
    return status

def execute(action):
    require(not LOCK.is_symlink() and STATE.is_dir(),"unsafe_mirror_lock")
    with LOCK.open("a+") as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise Stop("shared_mirror_busy")
        rows=local_inventory()
        prior=existing_report()
        if prior is not None:
            require(prior==rows,"snapshot_report_source_drift")
        count=len(rows);total=sum(x["bytes"] for x in rows.values())
        counters={"snapshot_count":count,"snapshot_bytes":total,
                  "copied_now":0,"resumed_now":0,"verified_now":0,
                  "local_deleted":0,"mp4_modified":False,
                  "manual_reviews_modified":False,
                  "camera_apk_modified":False}
        if action=="preview":
            counters.update(state="preview",manifest_already_verified=prior is not None)
            return counters
        require(camera_ready(),"camera_busy_or_hot")
        require(connected_free()-total>=RESERVE,"microSD_reserve")
        if action=="verify":
            require(prior is not None,"no_published_snapshot_proof")
            for row in rows.values():
                require(phone_matches(row["sd_path"],row["sha256"],row["bytes"]),
                        "phone_snapshot_verification_failed")
                counters["verified_now"]+=1
        else:
            adb("shell","mkdir","-p",DEST)
            for name,row in sorted(rows.items()):
                require(camera_ready(),"camera_busy_or_hot")
                status=promote_one(name,row)
                counters["verified_now"]+=1
                if status=="copied_and_verified":counters["copied_now"]+=1
                if status=="resumed_verified_partial":counters["resumed_now"]+=1
            require(camera_ready(),"camera_busy_before_manifest")
            require(local_inventory()==rows,"snapshot_source_changed")
            atomic_report(rows)
        counters.update(state="verified",manifest_already_verified=True,
                        remote_free_bytes=connected_free())
        return counters

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    group=parser.add_mutually_exclusive_group()
    group.add_argument("--copy",action="store_true")
    group.add_argument("--verify",action="store_true")
    args=parser.parse_args()
    try:
        summary=execute("copy" if args.copy else "verify" if args.verify else "preview")
        print("C720P_S9_SNAPSHOT_MIRROR_V162 "+json.dumps(summary,sort_keys=True))
    except Stop as error:
        print("C720P_S9_SNAPSHOT_MIRROR_V162 "+json.dumps({
            "state":"deferred","reason":str(error),"local_deleted":0,
            "mp4_modified":False,"reviews_modified":False},sort_keys=True))
        raise SystemExit(2)
    except Exception:
        print("C720P_S9_SNAPSHOT_MIRROR_V162 "+json.dumps({
            "state":"error","reason":"unexpected_restricted_failure",
            "local_deleted":0,"mp4_modified":False,"reviews_modified":False},
            sort_keys=True))
        raise SystemExit(1)
