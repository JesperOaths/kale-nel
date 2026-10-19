#!/usr/bin/env python3
"""Guarded replacement of legacy smooth-video interceptor with MJPEG-only bridge.

Default mode is read-only preflight. --apply makes byte-for-byte backups and
atomically replaces only the two script assets and two cache-busting references.
Original media, person reviews, camera capture and Home Assistant internals
remain unchanged. A failing readback restores every modified web asset.
"""
import argparse
import datetime
import hashlib
import json
import os
import re
import shutil
import stat
import subprocess
import tempfile
import urllib.request
from pathlib import Path

BASE=Path("/opt/homeassistant/config/www")
ROOT=BASE/"frontyard-security-new"
SCRIPTS=(BASE/"security-video-playback.js",ROOT/"security-video-playback-v30.js")
PAGES=(BASE/"c720p-surveillance.html",ROOT/"security-hub-v30.html")
BACKUP=Path("/home/jespern/c720p-home-hub/backups/security-mjpeg-only-v1")
SOURCE="ops/c720p/security-runtime/security-live-mjpeg-only-v1.js"
MARK="SECURITY_LIVE_MJPEG_ONLY_V1_20261019"
VERSION=re.compile(r"(security-video-playback(?:-v30)?[.]js)(?:[?]v=[A-Za-z0-9_.-]+)?")
NEVER=("playback=prepare","playback=hub","30 fps","ffmpeg","MediaSource")

def digest(payload):
    return hashlib.sha256(payload).hexdigest()

def download(ref):
    uri="https://raw.githubusercontent.com/JesperOaths/kale-nel/"+ref+"/"+SOURCE
    with urllib.request.urlopen(uri,timeout=35) as response:
        body=response.read(150001)
    if not 3000<len(body)<150000 or b"SECURITY_LIVE_MJPEG_ONLY_V1" not in body:
        raise RuntimeError("invalid_pinned_live_only_script")
    for needle in NEVER:
        if needle.encode() in body:raise RuntimeError("legacy_transcode_reference_in_live_script")
    return body

def source_archive():
    with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=20) as response:
        raw=response.read(4000001)
    if len(raw)>4000000:raise RuntimeError("catalog_response_exceeds_limit")
    doc=json.loads(raw)
    if doc.get("archive_mode")!="S9-microSD-only":raise RuntimeError("unexpected_catalog")
    events=doc.get("events") or []
    names={r.get("clip_no") for r in events if isinstance(r,dict)}
    if len(names)<100 or len(names)!=len(events):raise RuntimeError("source_archive_unhealthy")
    return names

def atom(path,raw,st):
    fd,tmp=tempfile.mkstemp(prefix=".security-live-only-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as out:
            out.write(raw);out.flush();os.fsync(out.fileno())
        os.chmod(tmp,stat.S_IMODE(st.st_mode))
        try:os.chown(tmp,st.st_uid,st.st_gid)
        except PermissionError:pass
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--ref",required=True,help="Immutable 40-character commit SHA")
    ap.add_argument("--apply",action="store_true")
    args=ap.parse_args()
    if not re.fullmatch(r"[a-f0-9]{40}",args.ref):
        raise RuntimeError("pinned_immutable_sha_required")
    before=source_archive()
    fresh=download(args.ref)
    sources={}
    old={}
    statuses={}
    for path in (*SCRIPTS,*PAGES):
        if not path.is_file() or path.is_symlink():
            raise RuntimeError("required_ha_asset_missing_or_symlink_"+path.name)
        old[path]=path.read_bytes()
        statuses[path]=path.stat()
    for path in SCRIPTS:
        if (b"C720PSecurityVideo" not in old[path] and
            b"SECURITY_LIVE_MJPEG_ONLY_V1" not in old[path]):
            raise RuntimeError("unexpected_legacy_script_"+path.name)
        sources[path]=fresh
    refs={}
    for page in PAGES:
        current=old[page].decode("utf-8")
        matches=VERSION.findall(current)
        if len(matches)!=1:raise RuntimeError("unexpected_script_reference_"+page.name)
        updated=VERSION.sub(lambda m:m.group(1)+"?v="+MARK,current,count=1)
        if len(updated)>300000:raise RuntimeError("unbounded_markup")
        sources[page]=updated.encode("utf-8")
        refs[page.name]=matches[0]
    if shutil.which("node"):
        with tempfile.NamedTemporaryFile("wb",suffix=".js") as js:
            js.write(fresh);js.flush()
            subprocess.run(["node","--check",js.name],timeout=15,check=True)
    if not args.apply:
        print("SECURITY_LIVE_ONLY_PREFLIGHT "+json.dumps({
            "originals":len(before),"asset_names":[x.name for x in sources],
            "source_sha256":digest(fresh),"dry_run":True,
            "camera_touched":False,"reviews_touched":False},sort_keys=True),flush=True)
        return
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    folder=BACKUP/stamp
    folder.mkdir(parents=True,mode=0o700,exist_ok=False)
    for path,payload in old.items():
        out=folder/path.relative_to(BASE)
        out.parent.mkdir(parents=True,exist_ok=True)
        out.write_bytes(payload);os.chmod(out,0o600)
        if digest(out.read_bytes())!=digest(payload):
            raise RuntimeError("backup_integrity_failure")
    changed=[]
    try:
        for path,payload in sources.items():
            if path.read_bytes()!=old[path]:
                raise RuntimeError("concurrent_web_asset_update_"+path.name)
            atom(path,payload,statuses[path]);changed.append(path)
        for path,expected in sources.items():
            uri="http://127.0.0.1:8123/local/"+path.relative_to(BASE).as_posix()+"?v="+MARK
            with urllib.request.urlopen(uri,timeout=20) as result:
                served=result.read(350001)
            if digest(served)!=digest(expected):
                raise RuntimeError("ha_served_hash_mismatch_"+path.name)
        after=source_archive()
        if not before.issubset(after):
            raise RuntimeError("original_archive_inventory_regressed")
        print("SECURITY_LIVE_MJPEG_ONLY_DEPLOY_VERIFIED "+json.dumps({
            "source_ref":args.ref,"source_sha256":digest(fresh),
            "originals_preserved":len(before),"new_archive_count":len(after),
            "served_assets_verified":len(sources),"rollback":str(folder),
            "smooth_copy_ui_disabled":True,"backend_removed":False,
            "live_playback_needs_browser_acceptance":True,
            "camera_changed":False,"review_decisions_changed":False},sort_keys=True),flush=True)
    except BaseException:
        for path in reversed(changed):
            try:atom(path,old[path],statuses[path])
            except Exception as problem:
                print("SECURITY_LIVE_ONLY_ROLLBACK_ERROR",path.name,str(problem)[:140],flush=True)
        raise

if __name__=="__main__":main()
