#!/usr/bin/env python3
"""Stage every finalized C720P local Security MP4 onto S9+ microSD, fail closed.

No deletion/remapping. Durable 0600 inventory is written ONLY AFTER both source
and microSD SHA256/size match. Do not run while S9+ 4K camera is hot/unhealthy.
No private clip names, video bytes or hashes are printed to management logs.
"""
import argparse
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

WEB=Path("/opt/homeassistant/config/www/frontyard-security-new")
CLIPS=WEB/"clips"
EVENTS=WEB/"events.json"
STATE=Path("/home/jespern/c720p-home-hub/state")
MANIFEST=STATE/"c720p-s9-imported-v2.json"
LOCK=STATE/".c720p-s9-import-v2.lock"
SERIAL="192.168.178.250:5555"
MODEL="SM-G965F"
SD="/storage/9C33-6BBD"
DEST=SD+"/Android/data/nl.kalenel.s9security/files/C720PMigrated"
NAME=re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]mp4")
SCHEMA="c720p_s9_verified_import_v2"
RESERVE=15*1024**3
MAX_TEMP_C=37.0
MAX_BYTES=900*1024**2
MIN_AGE=180

def run(*args,timeout=25):
    p=subprocess.run(list(args),capture_output=True,text=True,timeout=timeout)
    if p.returncode:
        raise RuntimeError("remote_or_local_process_failed")
    return p.stdout.strip()

def adb(*args,timeout=30):
    return run("adb","-s",SERIAL,*args,timeout=timeout)

def connected():
    if adb("get-state")!="device":
        raise RuntimeError("s9_adb_unavailable")
    if adb("shell","getprop","ro.product.model").strip()!=MODEL:
        raise RuntimeError("phone_model_not_verified")
    mount=adb("shell","df","-k",SD).splitlines()
    rows=[line.split() for line in mount if SD in line.split()[-1:]]
    if not rows:raise RuntimeError("phone_microSD_not_mounted")
    return int(rows[-1][3])*1024

def camera_ready():
    with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=8) as r:
        d=json.load(r)
    t=d.get("temperature_c")
    return (d.get("mode")=="watching" and d.get("continuous_4k_ready") is True and
        d.get("continuous_4k_dropped_output_frames")==0 and
        type(t) in (float,int) and 0<t<MAX_TEMP_C)

def sha256_file(path):
    h=hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda:f.read(1048576),b""):
            h.update(chunk)
    return h.hexdigest()

def trusted_file(path):
    if path.is_symlink() or not path.is_file() or path.parent.resolve()!=CLIPS.resolve():
        return None
    if not NAME.fullmatch(path.name) or ".." in path.name:
        return None
    st=path.stat()
    if not 10000<=st.st_size<=MAX_BYTES or time.time()-st.st_mtime<MIN_AGE:
        return None
    return st

def candidates():
    if CLIPS.is_symlink() or not CLIPS.is_dir():
        raise RuntimeError("C720P_local_clip_folder_missing_or_unsafe")
    good=[]
    for path in CLIPS.iterdir():
        st=trusted_file(path)
        if st:good.append((path,st))
    return sorted(good,key=lambda item:item[0].name)

def indexed_names():
    if EVENTS.is_symlink() or not EVENTS.is_file():
        return set()
    doc=json.loads(EVENTS.read_text())
    if isinstance(doc,dict):
        doc=next((doc[x] for x in ("events","items","clips") if isinstance(doc.get(x),list)),[])
    if not isinstance(doc,list):return set()
    indexed=set()
    for event in doc:
        if not isinstance(event,dict):continue
        raw=event.get("clip") or event.get("clip_name")
        if not raw:continue
        name=Path(str(raw)).name
        if NAME.fullmatch(name) and ".." not in name:indexed.add(name)
    return indexed

def load():
    if MANIFEST.is_symlink():raise ValueError("symlinked_private_manifest")
    if not MANIFEST.is_file():
        return {"schema_version":SCHEMA,"records":{}}
    stat=MANIFEST.stat()
    if stat.st_mode&0o077 or stat.st_size>=2000000:
        raise ValueError("private_manifest_permissions_or_size")
    doc=json.loads(MANIFEST.read_text())
    if doc.get("schema_version")!=SCHEMA or not isinstance(doc.get("records"),dict):
        raise ValueError("unexpected_import_manifest")
    for name,entry in doc["records"].items():
        if (not NAME.fullmatch(name) or ".." in name or not isinstance(entry,dict) or
            entry.get("sd_path")!=DEST+"/"+name or
            not re.fullmatch(r"[0-9a-f]{64}",entry.get("sha256","")) or
            type(entry.get("bytes")) is not int or not 10000<=entry["bytes"]<=MAX_BYTES or
            type(entry.get("indexed")) is not bool):
            raise ValueError("untrusted_import_manifest_entry")
    return doc

def atomic_write(doc):
    STATE.mkdir(parents=True,exist_ok=True)
    fd,temp=tempfile.mkstemp(prefix=".c720p-s9-import-",dir=STATE)
    try:
        with os.fdopen(fd,"w",encoding="utf8") as out:
            os.fchmod(out.fileno(),0o600)
            json.dump(doc,out,sort_keys=True,separators=(",",":"))
            out.write("\n");out.flush();os.fsync(out.fileno())
        os.replace(temp,MANIFEST)
    finally:
        if os.path.exists(temp):os.unlink(temp)

def phone_path_exists(path,kind="-e"):
    """Do not interpret an ADB transport error as an absent S9+ file.

    Android shell test normally exits 0 for present or 1 for missing, both
    without stderr. Lost transport, permission errors and malformed results
    are unknown state: never push, rename or overwrite in that condition.
    """
    if kind not in ("-e","-f"):
        raise RuntimeError("invalid_phone_path_test")
    response=subprocess.run(["adb","-s",SERIAL,"shell","test",kind,path],
                            capture_output=True,timeout=12)
    if (response.returncode==0 or response.returncode==1) and response.stderr==b"":
        return response.returncode==0
    raise RuntimeError("phone_path_existence_indeterminate")


def phone_file_matches(dest,digest,length):
    # SHA and byte length must agree; an unavailable phone is not absence.
    if not phone_path_exists(dest,"-f"):
        return False
    size=adb("shell","stat","-c","%s",dest)
    if size!=str(length):return False
    fields=adb("shell","sha256sum",dest).split()
    if (len(fields)!=2 or not re.fullmatch(r"[0-9a-fA-F]{64}",fields[0])
        or fields[1]!=dest):
        raise RuntimeError("phone_checksum_response_indeterminate")
    return fields[0].lower()==digest

def copy_one(path,stat,digest):
    dest=DEST+"/"+path.name
    if phone_file_matches(dest,digest,stat.st_size):
        return "already_verified"
    if phone_path_exists(dest):
        raise RuntimeError("nonmatching_destination_collision_preserved")
    partial=dest+".partial"
    partial_exists=phone_path_exists(partial)
    if not camera_ready():
        raise RuntimeError("camera_became_unhealthy_or_hot")

    # Interrupted ADB copies may already be complete. NEVER delete or overwrite
    # an existing phone-side partial: prove exact source size and SHA256 first.
    if partial_exists:
        if not phone_file_matches(partial,digest,stat.st_size):
            raise RuntimeError("preexisting_partial_not_matching_preserved")
        result="verified_partial_promoted"
    else:
        adb("push",str(path),partial,timeout=350)
        if not phone_file_matches(partial,digest,stat.st_size):
            raise RuntimeError("partial_copy_did_not_verify")
        result="copied_and_verified"

    # Require a stable, unchanged source and healthy recorder even AFTER the
    # transfer/phone-side SHA calculation before final rename.
    if path.stat().st_size!=stat.st_size or path.stat().st_mtime_ns!=stat.st_mtime_ns:
        raise RuntimeError("source_changed_during_copy")
    if sha256_file(path)!=digest:
        raise RuntimeError("source_digest_changed_during_copy")
    if not camera_ready():
        raise RuntimeError("camera_became_unhealthy_before_promotion")
    if phone_path_exists(dest):
        raise RuntimeError("destination_appeared_during_copy_preserved")
    adb("shell","mv",partial,dest)
    if not phone_file_matches(dest,digest,stat.st_size):
        raise RuntimeError("final_phone_hash_did_not_verify")
    return result

def execute(action):
    STATE.mkdir(parents=True,exist_ok=True)
    if LOCK.is_symlink():raise RuntimeError("unsafe_import_lock")
    with LOCK.open("a+") as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print(json.dumps({"state":"deferred","reason":"import_busy"}));return
        old=load()
        found=candidates()
        idx=indexed_names()
        summary={"state":"preview" if action=="preview" else "deferred",
                 "local_finalized":len(found),
                 "indexed":sum(x.name in idx for x,_ in found),
                 "unindexed":sum(x.name not in idx for x,_ in found),
                 "candidate_bytes":sum(st.st_size for _,st in found),
                 "previously_imported":len(old["records"]),
                 "verified_now":0,"copied_now":0,"resumed_now":0,
                 "local_deleted":0,"all_local_recordings_preserved":True,
                 "playback_remapping_required":True}
        if action=="preview":
            print(json.dumps(summary,sort_keys=True));return
        if not camera_ready():
            summary.update(state="deferred",reason="camera_temperature_or_4k")
            print(json.dumps(summary,sort_keys=True));return
        free=connected()
        if free-sum(st.st_size for _,st in found)<RESERVE:
            summary.update(state="deferred",reason="microSD_reserve")
            print(json.dumps(summary,sort_keys=True));return
        adb("shell","mkdir","-p",DEST)
        for path,stat in found:
            if not camera_ready():
                summary.update(state="deferred",reason="camera_temperature_or_4k_mid_copy")
                break
            digest=sha256_file(path)
            prior=old["records"].get(path.name)
            if prior and (prior["sha256"]!=digest or prior["bytes"]!=stat.st_size):
                summary.update(state="stopped",reason="previous_import_conflict")
                break
            if action=="verify":
                ok=phone_file_matches(DEST+"/"+path.name,digest,stat.st_size)
                if not ok:
                    summary.update(state="stopped",reason="previous_import_not_verified")
                    break
                status="already_verified"
            else:
                try:status=copy_one(path,stat,digest)
                except RuntimeError as exc:
                    summary.update(state="stopped",reason=str(exc))
                    break
            old["records"][path.name]={"sha256":digest,"bytes":stat.st_size,
                                       "sd_path":DEST+"/"+path.name,
                                       "indexed":path.name in idx}
            atomic_write(old)
            summary["verified_now"]+=1
            if status=="copied_and_verified":summary["copied_now"]+=1
            if status=="verified_partial_promoted":summary["resumed_now"]+=1
        else:
            summary["state"]="verified"
        summary["manifest_entries"]=len(old["records"])
        summary["verified_bytes"]=sum(x["bytes"] for x in old["records"].values())
        summary["sd_free_after"]=connected()
        print(json.dumps(summary,sort_keys=True))

if __name__=="__main__":
    ap=argparse.ArgumentParser()
    group=ap.add_mutually_exclusive_group()
    group.add_argument("--copy",action="store_true")
    group.add_argument("--verify",action="store_true")
    args=ap.parse_args()
    execute("copy" if args.copy else "verify" if args.verify else "preview")
