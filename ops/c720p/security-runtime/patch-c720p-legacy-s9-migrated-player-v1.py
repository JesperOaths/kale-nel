#!/usr/bin/env python3
"""Add authenticated S9+ playback fallback to legacy C720P clips list.

Source only, --apply explicitly required; preserves legacy local route, Save,
Delete, thumbnails and person review logic. Never removes media files.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile

PAGE=Path("/opt/homeassistant/config/www/frontyard-security-new/clips.html")
BACKUPS=Path("/home/jespern/c720p-home-hub/backups/c720p-legacy-s9-playback-v1")
MARKER="C720P_MIGRATED_S9_LEGACY_PLAYER_V1"
ANCHOR="const path=String(current.clip).split('/').map(encodeURIComponent).join('/');\n   const url=BASE+path;\n   blobClipNo=current.clip_no;"
REPLACE="""const path=String(current.clip).split('/').map(encodeURIComponent).join('/');
 // C720P_MIGRATED_S9_LEGACY_PLAYER_V1: old local player first checks S9+
 // without losing the local fallback while legacy clips are still retained.
 let url=BASE+path,rangeOrigin='range-local';
 const requested=String(current.clip).split('/').pop();
 const requestGeneration=generation;
 if(window.C720PSecureRelay?.fetch&&window.C720PSecureRelay?.url&&
    /^[A-Za-z0-9][A-Za-z0-9._-]{0,139}\\.mp4$/.test(requested)&&!requested.includes('..')){
   try{
    const response=await C720PSecureRelay.fetch('/new/api/c720p-migrated-clips',{cache:'no-store'});
    if(response.ok){
     const proof=await response.json();
     if(proof.ok===true&&proof.schema_version==='c720p_s9_verified_import_v2'&&
        proof.not_s9_original_recordings===true&&proof.not_person_assignments===true&&
        Array.isArray(proof.files)&&proof.files.length<=5000&&
        proof.files.some(f=>f&&f.name===requested&&Number.isSafeInteger(f.bytes)&&f.bytes>=10000)){
       url=await C720PSecureRelay.url('/new/saved/c720p-migrated/clip/'+encodeURIComponent(requested));
       rangeOrigin='s9-microSD-migrated';
     }
    }
   }catch(_){/* local file remains available during cutover */}
 }
 if(requestGeneration!==generation)return;
 blobClipNo=current.clip_no;"""
VERSION_ANCHOR="mode:'range-local',src:url"
VERSION_REPLACE="mode:rangeOrigin,src:url"

def sha(raw):return hashlib.sha256(raw).hexdigest()

def patch(raw):
    if MARKER in raw:
        raise ValueError("already_patched")
    if raw.count(ANCHOR)!=1 or raw.count(VERSION_ANCHOR)!=1:
        raise ValueError("legacy_player_source_drift")
    if "async function prepareBlob(play)" not in raw or "function releaseBlob()" not in raw:
        raise ValueError("legacy_player_required_functions_missing")
    result=raw.replace(ANCHOR,REPLACE).replace(VERSION_ANCHOR,VERSION_REPLACE)
    if result.count(MARKER)!=1:
        raise ValueError("source_marker_count")
    if not all(t in result for t in ("async function playPhone(", "Save", "delete", "events.json")):
        raise ValueError("legacy_features_missing")
    return result

def atomic_write(path,data):
    fd,tmp=tempfile.mkstemp(prefix=".c720p-s9-legacy-player-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as out:
            os.fchmod(out.fileno(),path.stat().st_mode&0o777)
            out.write(data);out.flush();os.fsync(out.fileno())
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--apply",action="store_true")
    args=p.parse_args()
    if PAGE.is_symlink() or not PAGE.is_file():
        raise RuntimeError("untrusted_legacy_player")
    previous=PAGE.read_bytes()
    updated=patch(previous.decode("utf8")).encode()
    if args.apply:
        BACKUPS.mkdir(parents=True,exist_ok=True,mode=0o700)
        backup=BACKUPS/(sha(previous)[:18]+".html")
        if not backup.exists():
            with backup.open("xb") as out:
                os.fchmod(out.fileno(),0o600)
                out.write(previous);out.flush();os.fsync(out.fileno())
        elif backup.read_bytes()!=previous:
            raise RuntimeError("backup_content_mismatch")
        atomic_write(PAGE,updated)
        if sha(PAGE.read_bytes())!=sha(updated):
            atomic_write(PAGE,previous)
            raise RuntimeError("HTML_readback_mismatch_rolled_back")
    print("C720P_MIGRATED_LEGACY_PLAYER "+json.dumps({
        "applied":args.apply,"source_sha256":sha(previous),"patched_sha256":sha(updated),
        "legacy_local_backup":args.apply,"existing_player_preserved":True,
        "new_S9_authenticated_fallback":True,"original_videos_modified":False,
        "manual_reviews_modified":False},sort_keys=True))
if __name__=="__main__":main()
