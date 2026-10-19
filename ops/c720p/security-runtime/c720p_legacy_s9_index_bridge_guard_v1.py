#!/usr/bin/env python3
"""Reattach the authenticated S9+ playback bridge after legacy index regeneration.

Older running C720P camera process may render index.html with its pre-update
in-memory template. Keep the original Save control, event rows, thumbnails and
local MP4 URLs intact. Do not restart the camera or delete media.
"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile
import time

INDEX=Path("/opt/homeassistant/config/www/frontyard-security-new/index.html")
STATE=Path("/home/jespern/c720p-home-hub/state")
LOCK=STATE/".c720p-legacy-s9-index-bridge.lock"
BRIDGE=INDEX.parent/"c720p-migrated-index-playback-v1.js"
SCRIPT="<script defer src='c720p-migrated-index-playback-v1.js'></script>"
MARKER="c720p-migrated-index-playback-v1.js"
ANCHOR="<title>Camera Security</title>"
MAX_HTML=1024*1024
MIN_HTML=500
EXPECTED_BRIDGE_SHA256="8246223af7abb26aece0ac6cbf8b84bd698a2600c790e33ad0d7be22a9414ae2"

def digest(blob):return hashlib.sha256(blob).hexdigest()

def new_html(old):
    if len(old)<MIN_HTML or len(old)>MAX_HTML:raise ValueError("unbounded_index")
    html=old.decode("utf8")
    if MARKER in html:
        if html.count(SCRIPT)!=1:raise ValueError("untrusted_existing_bridge")
        return None
    if html.count(ANCHOR)!=1 or "saveClip(" not in html or "clips/" not in html:
        raise ValueError("unexpected_camera_index_template")
    return html.replace(ANCHOR,ANCHOR+SCRIPT,1).encode("utf8")

def snapshot():
    if INDEX.is_symlink() or not INDEX.is_file():raise ValueError("unsafe_index_path")
    st=INDEX.stat()
    if not stat.S_ISREG(st.st_mode) or st.st_nlink!=1 or st.st_size>MAX_HTML:
        raise ValueError("unsafe_index_metadata")
    first=INDEX.read_bytes()
    time.sleep(0.12)
    again=INDEX.read_bytes()
    latest=INDEX.stat()
    if (first!=again or st.st_ino!=latest.st_ino or
        st.st_mtime_ns!=latest.st_mtime_ns or st.st_size!=latest.st_size):
        return None,None
    return first,latest

def apply():
    STATE.mkdir(parents=True,exist_ok=True)
    if LOCK.is_symlink():raise ValueError("unsafe_index_lock")
    with LOCK.open("a+") as lk:
        os.fchmod(lk.fileno(),0o600)
        try:fcntl.flock(lk,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print("C720P_LEGACY_INDEX_BRIDGE_DEFERRED existing_worker");return "deferred"
        if BRIDGE.is_symlink() or not BRIDGE.is_file() or digest(BRIDGE.read_bytes())!=EXPECTED_BRIDGE_SHA256:
            print("C720P_LEGACY_INDEX_BRIDGE_DEFERRED signed_script_drift");return "deferred"
        data,st=snapshot()
        if data is None:
            print("C720P_LEGACY_INDEX_BRIDGE_DEFERRED regenerating");return "deferred"
        revised=new_html(data)
        if revised is None:
            print("C720P_LEGACY_INDEX_BRIDGE_ALREADY_PRESENT");return "present"
        # Do not overwrite a page the camera has regenerated since we read it.
        if (INDEX.is_symlink() or INDEX.stat().st_mtime_ns!=st.st_mtime_ns
            or INDEX.read_bytes()!=data):
            print("C720P_LEGACY_INDEX_BRIDGE_DEFERRED page_changed");return "deferred"
        fd,tmp=tempfile.mkstemp(prefix=".c720p-migrated-index-",dir=INDEX.parent)
        try:
            with os.fdopen(fd,"wb") as out:
                os.fchmod(out.fileno(),stat.S_IMODE(st.st_mode))
                out.write(revised);out.flush();os.fsync(out.fileno())
            # Recheck immediately before committing an atomic replacement.
            now=INDEX.stat()
            if (INDEX.is_symlink() or now.st_ino!=st.st_ino or
                now.st_mtime_ns!=st.st_mtime_ns or INDEX.read_bytes()!=data):
                print("C720P_LEGACY_INDEX_BRIDGE_DEFERRED latest_source_changed")
                return "deferred"
            os.replace(tmp,INDEX)
            if INDEX.read_bytes()!=revised:
                raise RuntimeError("index_bridge_readback_failed")
        finally:
            if os.path.exists(tmp):os.unlink(tmp)
        print("C720P_LEGACY_INDEX_BRIDGE_REATTACHED "+json.dumps({
            "generator_restarted":False,"saved_events_changed":False,
            "original_videos_changed":False,"manual_identity_review_changed":False,
            "html_sha256":digest(revised),"bridge_present":True},sort_keys=True))
        return "attached"

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--apply",action="store_true")
    options=parser.parse_args()
    if options.apply:
        apply()
    else:
        data,st=snapshot()
        print("C720P_LEGACY_INDEX_BRIDGE_PREVIEW "+json.dumps({
            "index_stable":data is not None,
            "bridge_present":bool(data and MARKER.encode() in data),
            "would_patch":bool(data and MARKER.encode() not in data
                         and new_html(data) is not None),
            "no_changes":True},sort_keys=True))

if __name__=="__main__":main()
