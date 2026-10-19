#!/usr/bin/env python3
"""Mirror source-qualified legacy JPEG snapshots to the S9+ microSD, no deletion.

Reuses the deployed C720P MP4 importer's proven ADB, SHA-256, microSD reserve,
thermal and interrupted-transfer guards. An entirely independent 0600 JSON
snapshot manifest is written only after exact source/phone verification.
This does NOT retarget legacy Save/Delete/snapshot playback, so originals stay.
"""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import tempfile
import time

HERE=Path(__file__).resolve().parent
WEB=Path("/opt/homeassistant/config/www/frontyard-security-new")
SNAPS=WEB/"snaps"
EVENTS=WEB/"events.json"
STATE=Path("/home/jespern/c720p-home-hub/state")
VIDEO_MANIFEST=STATE/"c720p-s9-imported-v2.json"
OUTPUT=STATE/"c720p-s9-imported-snapshots-v1.json"
LOCK=STATE/".c720p-s9-import-v2.lock"
STAGE=HERE/"c720p_to_s9_verified_media_stage_v2.py"
SD="/storage/9C33-6BBD"
DEST=SD+"/Android/data/nl.kalenel.s9security/files/C720PMigrated/Snapshots"
VIDEO_NAME=re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]mp4\Z")
JPEG_NAME=re.compile(r"[A-Za-z0-9][A-Za-z0-9._-]{0,139}[.]jpe?g\Z",re.I)
HASH=re.compile(r"[0-9a-f]{64}\Z")
SCHEMA="c720p_s9_verified_snapshots_v1"
MAX_FILES=18
MAX_IMAGE_BYTES=2*1024**2
TOTAL_MAX_BYTES=18*1024**2
MIN_AGE_S=180
RESERVE_BYTES=15*1024**3

def stage_module():
    if STAGE.is_symlink() or not STAGE.is_file():
        raise RuntimeError("known_verified_media_importer_unavailable")
    spec=importlib.util.spec_from_file_location("c720p_verified_stage_v167",STAGE)
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    if (mod.SD!=SD or mod.RESERVE!=RESERVE_BYTES
        or mod.MAX_TEMP_C!=37.0 or mod.DEST+"/Snapshots"!=DEST):
        raise RuntimeError("verified_media_importer_contract_drift")
    # Only this freshly imported module changes. The scheduled MP4 mirror is
    # unaffected, and the SAME lock serializes both processes.
    mod.DEST=DEST
    return mod

def load_json(path,maxsize):
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("unsafe_private_source_manifest")
    s=path.stat()
    if not 20<s.st_size<=maxsize:
        raise RuntimeError("untrusted_private_manifest_size")
    return json.loads(path.read_bytes())

def video_sources():
    raw=load_json(VIDEO_MANIFEST,2000000)
    if raw.get("schema_version")!="c720p_s9_verified_import_v2":
        raise RuntimeError("unrecognized_verified_mp4_manifest")
    records=raw.get("records")
    if not isinstance(records,dict) or not 1<=len(records)<=5000:
        raise RuntimeError("invalid_verified_mp4_catalog")
    valid=set()
    for name,r in records.items():
        if (not VIDEO_NAME.fullmatch(name) or ".." in name
            or not isinstance(r,dict) or r.get("indexed") is not True
            or not HASH.fullmatch(str(r.get("sha256","")))
            or type(r.get("bytes")) is not int
            or r.get("sd_path")!=SD+"/Android/data/nl.kalenel.s9security/files/C720PMigrated/"+name):
            raise RuntimeError("unsafe_verified_mp4_manifest_record")
        valid.add(name)
    return valid

def event_rows():
    data=load_json(EVENTS,3000000)
    if isinstance(data,dict):
        data=next((data[key] for key in ("events","items","clips")
                   if isinstance(data.get(key),list)),None)
    if not isinstance(data,list):
        raise RuntimeError("unrecognized_legacy_event_index")
    return data

def candidates():
    if (WEB.is_symlink() or SNAPS.is_symlink() or not SNAPS.is_dir()
        or SNAPS.resolve().parent!=WEB.resolve()):
        raise RuntimeError("legacy_snap_folder_unknown_or_symlinked")
    imported=video_sources()
    result={}
    for e in event_rows():
        if not isinstance(e,dict):continue
        clip=e.get("clip") or e.get("clip_name")
        snap=e.get("snapshot")
        if not isinstance(clip,str) or not isinstance(snap,str):continue
        if not clip.startswith("clips/") or not snap.startswith("snaps/"):continue
        video=clip[6:]
        name=snap[6:]
        if (not VIDEO_NAME.fullmatch(video) or ".." in video
            or video not in imported or not JPEG_NAME.fullmatch(name)
            or ".." in name or "/" in name):continue
        p=SNAPS/name
        if p.is_symlink() or not p.is_file() or p.parent.resolve()!=SNAPS.resolve():
            continue
        st=p.stat()
        if (not 1000<=st.st_size<=MAX_IMAGE_BYTES
            or time.time()-st.st_mtime<MIN_AGE_S):continue
        # A JPEG that was truncated during recording cannot be a valid copy.
        with p.open("rb") as stream:
            start=stream.read(2)
            stream.seek(-2,2)
            end=stream.read(2)
        if start!=b"\xff\xd8" or end!=b"\xff\xd9":continue
        if name in result and result[name][1]!=video:
            raise RuntimeError("same_snapshot_reused_by_conflicting_video")
        result[name]=(p,video,st)
    if not 1<=len(result)<=MAX_FILES:
        raise RuntimeError("snapshot_inventory_missing_or_too_large")
    if sum(st.st_size for _,_,st in result.values())>TOTAL_MAX_BYTES:
        raise RuntimeError("snapshot_inventory_bytes_outside_bounds")
    return dict(sorted(result.items()))

def existing():
    if OUTPUT.is_symlink():raise RuntimeError("untrusted_existing_snapshot_manifest")
    if not OUTPUT.exists():
        return {"schema_version":SCHEMA,"records":{}}
    p=OUTPUT.stat()
    if p.st_mode & 0o077 or p.st_size>500000:
        raise RuntimeError("insecure_snapshot_manifest_permissions_or_size")
    data=load_json(OUTPUT,500000)
    if data.get("schema_version")!=SCHEMA or not isinstance(data.get("records"),dict):
        raise RuntimeError("unknown_snapshot_manifest_schema")
    for name,entry in data["records"].items():
        if (not JPEG_NAME.fullmatch(name) or ".." in name or not isinstance(entry,dict)
            or entry.get("sd_path")!=DEST+"/"+name
            or not VIDEO_NAME.fullmatch(str(entry.get("linked_video","")))
            or not HASH.fullmatch(str(entry.get("sha256","")))
            or type(entry.get("bytes")) is not int
            or not 1000<=entry["bytes"]<=MAX_IMAGE_BYTES):
            raise RuntimeError("untrusted_snapshot_manifest_entry")
    return data

def save(doc):
    STATE.mkdir(parents=True,exist_ok=True)
    fd,temp=tempfile.mkstemp(prefix=".c720p-s9-snaps-",dir=STATE)
    try:
        with os.fdopen(fd,"w") as stream:
            os.fchmod(stream.fileno(),0o600)
            json.dump(doc,stream,sort_keys=True,separators=(",",":"))
            stream.write("\n")
            stream.flush();os.fsync(stream.fileno())
        os.replace(temp,OUTPUT)
    finally:
        if os.path.exists(temp):os.unlink(temp)

def execute(mode):
    if LOCK.is_symlink():raise RuntimeError("unsafe_shared_mirror_lock")
    STATE.mkdir(parents=True,exist_ok=True)
    with LOCK.open("a+") as handle:
        try:fcntl.flock(handle,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print("C720P_S9_SNAPSHOT_V167_DEFERRED "+
                json.dumps({"reason":"mp4_mirror_or_snapshot_worker_busy",
                            "copied":0,"originals_modified":False}))
            return
        mod=stage_module()
        snapshots=candidates()
        recorded=existing()
        state={"source_snapshots":len(snapshots),
               "source_bytes":sum(st.st_size for _,_,st in snapshots.values()),
               "existing_manifest_rows":len(recorded["records"]),
               "copied_now":0,"already_verified":0,"resumed_now":0,
               "originals_modified":False,"manual_reviews_modified":False,
               "camera_apk_modified":False,"local_snapshots_deleted":False,
               "mp4s_deleted":False,"ready_for_local_snapshot_retirement":False}
        if mode=="preview":
            print("C720P_S9_SNAPSHOT_V167_PREFLIGHT "+
                  json.dumps(state,sort_keys=True))
            return
        if not mod.camera_ready():
            print("C720P_S9_SNAPSHOT_V167_DEFERRED "+json.dumps({
                "reason":"camera_not_cool_4k","executed":False,
                "originals_modified":False},sort_keys=True))
            return
        free=mod.connected()
        if free-state["source_bytes"]<RESERVE_BYTES:
            print("C720P_S9_SNAPSHOT_V167_DEFERRED "+json.dumps({
                "reason":"microSD_reserve","executed":False,
                "originals_modified":False},sort_keys=True))
            return
        if mode=="copy":mod.adb("shell","mkdir","-p",DEST)
        for name,(path,video,st) in snapshots.items():
            if not mod.camera_ready():
                raise RuntimeError("camera_health_lost_during_jpeg_migration")
            digest=mod.sha256_file(path)
            prior=recorded["records"].get(name)
            if prior and (prior["sha256"]!=digest or prior["bytes"]!=st.st_size
                          or prior["linked_video"]!=video):
                raise RuntimeError("snapshot_source_version_or_mapping_changed")
            remote=DEST+"/"+name
            if mode=="verify":
                if not mod.phone_file_matches(remote,digest,st.st_size):
                    raise RuntimeError("previous_verified_snapshot_missing_or_corrupted")
                status="already_verified"
            else:
                status=mod.copy_one(path,st,digest)
            recorded["records"][name]={
                "sha256":digest,"bytes":st.st_size,
                "linked_video":video,"sd_path":remote}
            save(recorded)
            state["already_verified"]+=status=="already_verified"
            state["resumed_now"]+=status=="verified_partial_promoted"
            state["copied_now"]+=status=="copied_and_verified"
        if not mod.camera_ready():
            raise RuntimeError("camera_health_lost_after_verified_jpeg_migration")
        if len(recorded["records"])!=len(snapshots):
            raise RuntimeError("snapshot_manifest_parity_not_verified")
        state.update({"manifest_rows":len(recorded["records"]),
                      "all_source_sha256_verified_on_s9":True,
                      "sd_free_after_bytes":mod.connected()})
        print("C720P_S9_SNAPSHOT_V167_VERIFIED "+json.dumps(state,sort_keys=True))

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    group=parser.add_mutually_exclusive_group()
    group.add_argument("--copy",action="store_true")
    group.add_argument("--verify",action="store_true")
    args=parser.parse_args()
    execute("copy" if args.copy else "verify" if args.verify else "preview")
