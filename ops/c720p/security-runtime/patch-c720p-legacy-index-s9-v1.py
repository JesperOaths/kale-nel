#!/usr/bin/env python3
"""Prepare durable, source-preserving S9+ playback in legacy generated C720P index.

Patch both generator and current HTML (same insertion) using verified backups.
No service restart, recording/delete operation, Save control or event edits.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import tempfile

SOURCE=Path("/home/jespern/c720p-security-camera-new/c720p-frontyard-security-new.py")
INDEX=Path("/opt/homeassistant/config/www/frontyard-security-new/index.html")
LIVE_JS=INDEX.parent/"c720p-migrated-index-playback-v1.js"
BACKUP=Path("/home/jespern/c720p-home-hub/backups/c720p-legacy-index-s9-playback-v1")
TITLE="<title>Camera Security</title>"
INJECT="<script defer src='c720p-migrated-index-playback-v1.js'></script>"
MARKER="c720p-migrated-index-playback-v1.js"

def digest(data):return hashlib.sha256(data).hexdigest()

def replacement(s):
    if MARKER in s:raise ValueError("already_patched")
    if s.count(TITLE)!=1:raise ValueError("legacy_source_title_drift")
    return s.replace(TITLE,TITLE+INJECT)

def preview(generator,index,js):
    if any(p.is_symlink() for p in (SOURCE,INDEX,LIVE_JS)):
        raise ValueError("symlink_live_target")
    if SOURCE.read_bytes()!=generator or INDEX.read_bytes()!=index:
        raise ValueError("source_changed_while_staging")
    if LIVE_JS.exists() and LIVE_JS.read_bytes()!=js:
        raise ValueError("existing_script_mismatch")
    source=generator.decode("utf8");page=index.decode("utf8")
    if not all(x in source for x in ("def write_html(events):","save_index(events", "src='{e['clip']}'","(ROOT / 'index.html').write_text(html)")):
        raise ValueError("original_camera_index_generator_modified")
    if not all(x in page for x in ("saveClip(","src='clips/")):
        raise ValueError("original_legacy_index_missing")
    new_source=replacement(source)
    new_index=replacement(page)
    compile(new_source,str(SOURCE),"exec")
    return new_source.encode(),new_index.encode()

def atomic(path,raw):
    fd,tmp=tempfile.mkstemp(prefix=".c720p-index-s9-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as file:
            os.fchmod(file.fileno(),path.stat().st_mode&0o777 if path.exists() else 0o644)
            file.write(raw);file.flush();os.fsync(file.fileno())
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def apply(js):
    if SOURCE.is_symlink() or INDEX.is_symlink() or LIVE_JS.is_symlink():
        raise ValueError("symlink_media_index")
    generator=SOURCE.read_bytes();index=INDEX.read_bytes()
    next_source,next_index=preview(generator,index,js)
    BACKUP.mkdir(parents=True,exist_ok=True,mode=0o700)
    for p,old in ((SOURCE,generator),(INDEX,index)):
        b=BACKUP/(digest(old)[:20]+"-"+p.name)
        if not b.exists():
            with b.open("xb") as f:
                os.fchmod(f.fileno(),0o600)
                f.write(old);f.flush();os.fsync(f.fileno())
        elif b.read_bytes()!=old:raise ValueError("existing_backup_conflict")
    installed=[]
    try:
        if not LIVE_JS.exists():
            atomic(LIVE_JS,js);installed.append((LIVE_JS,None))
        atomic(SOURCE,next_source);installed.append((SOURCE,generator))
        atomic(INDEX,next_index);installed.append((INDEX,index))
        if SOURCE.read_bytes()!=next_source or INDEX.read_bytes()!=next_index:
            raise RuntimeError("index_source_readback_failed")
    except Exception:
        for p,old in reversed(installed):
            if old is None and p.is_file():p.unlink()
            elif old is not None:atomic(p,old)
        raise
    return generator,index,next_source,next_index

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--apply",action="store_true")
    parser.add_argument("--script",type=Path,required=True)
    args=parser.parse_args()
    js=args.script.read_bytes()
    if len(js)>15000 or b"c720p_s9_verified_import_v2" not in js or b"C720PSecureRelay" not in js:
        raise ValueError("unexpected_migrated_video_js")
    if args.apply:
        before,old_index,after,new_index=apply(js)
    else:
        before=SOURCE.read_bytes();old_index=INDEX.read_bytes()
        after,new_index=preview(before,old_index,js)
    print("C720P_LEGACY_INDEX_AUTH_S9_BRIDGE "+json.dumps({
      "applied":args.apply,"source_before_sha256":digest(before),
      "source_after_sha256":digest(after),"index_after_sha256":digest(new_index),
      "legacy_save_controls_preserved":True,"live_camera_service_restarted":False,
      "source_backup_written":args.apply,"all_video_files_unchanged":True,
      "manual_reviews_unchanged":True,"source_restart_needed_for_persistence":True},sort_keys=True))
if __name__=="__main__":main()
