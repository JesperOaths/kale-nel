#!/usr/bin/env python3
"""Safely add S9 HSV visual-search page + signed archive proxy on C720P.

Never modifies APK, MP4, camera, face model, existing security parent shell,
or video list. Source files are tied to a reviewed, immutable git SHA.
Use --apply only after preflight and backup. Roll back proxy and page on error.
"""
import argparse
import ast
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import time
import urllib.request
import urllib.error

HOME=Path("/home/jespern/c720p-home-hub")
ROOT=Path("/opt/homeassistant/config/www/frontyard-security-new")
TRACKS=ROOT/"security-tracks-v7.html"
NEW=ROOT/"security-hsv-search-v1.html"
PROXY=HOME/"bin/s9_sd_proxy_extension.py"
BACK=HOME/"backups/s9-hsv-search-v1"
BASE="https://raw.githubusercontent.com/JesperOaths/kale-nel/"
MARKER='  if path=="/new/api/appearance-search":'
ANCHOR='  if path=="/new/api/saved":'
LINK='<a id="s9-hsv-search-link" href="/local/frontyard-security-new/security-hsv-search-v1.html" style="color:#80dccc;font-weight:700;text-decoration:none">Visual Search →</a>'
INTRO='<header><h1>Tracks & clothing</h1>'

def fetch(ref,source,maximum):
    url=BASE+ref+"/"+source
    with urllib.request.urlopen(url,timeout=30) as response:
        blob=response.read(maximum+1)
    if not 100<len(blob)<=maximum:raise RuntimeError("source_size_invalid_"+source)
    return blob.decode("utf-8")

def current_archive():
    with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=15) as response:
        data=json.load(response)
    if data.get("archive_mode")!="S9-microSD-only" or not isinstance(data.get("events"),list):
        raise RuntimeError("archive_contract_invalid")
    return data

def patch(proxy,page,source_proxy):
    if proxy.count(ANCHOR)!=1:raise RuntimeError("unexpected_live_proxy")
    if source_proxy.count(MARKER)!=1 or source_proxy.count(ANCHOR)!=1:
        raise RuntimeError("source_route_unrecognised")
    query_block=source_proxy.split(MARKER,1)[1].split(ANCHOR,1)[0]
    if not(1500<len(query_block)<8000):raise RuntimeError("invalid_query_handler")
    route=MARKER+query_block
    if MARKER in proxy:
        # Idempotent, don't silently overwrite a different local variant.
        if route not in proxy:raise RuntimeError("existing_appearance_route_differs")
        new_proxy=proxy
    else:new_proxy=proxy.replace(ANCHOR,route+ANCHOR,1)
    ast.parse(new_proxy)
    if LINK in page:tracks=page
    else:
        # Live Security can use the updated "Recording review" design instead
        # of the old v7 "Tracks & clothing" header. Preserve either page.
        head=page.find("<header>")
        title=page.find("</h1>",head)
        if head<0 or title<0 or title-head>700:
            raise RuntimeError("unexpected_tracks_header")
        tracks=page[:title+5]+LINK+page[title+5:]
    return new_proxy,tracks

def atomic(target,text):
    fd,filename=tempfile.mkstemp(prefix=".s9-hsv-stage-",dir=target.parent)
    os.close(fd);temp=Path(filename)
    try:
        temp.write_text(text,encoding="utf-8")
        if target.exists():
            st=target.stat();os.chmod(temp,st.st_mode&0o777)
            try:os.chown(temp,st.st_uid,st.st_gid)
            except PermissionError:pass
        else:os.chmod(temp,0o644)
        os.replace(temp,target)
    finally:
        if temp.exists():temp.unlink()

def service():
    subprocess.run(["systemctl","--user","restart","c720p-drive-security-archive.service"],
                   check=True,capture_output=True,timeout=45)
    for _ in range(6):
        try:return current_archive()
        except Exception:time.sleep(2)
    raise RuntimeError("archive_not_healthy_after_restart")

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--ref",required=True)
    ap.add_argument("--apply",action="store_true")
    args=ap.parse_args()
    if not re.fullmatch(r"[0-9a-f]{40}",args.ref):
        raise RuntimeError("immutable_commit_required")
    sources="ops/c720p/s9-native-security/"
    template=fetch(args.ref,sources+"security-hsv-search-v1.html",90000)
    source_proxy=fetch(args.ref,"ops/c720p/s9-person-ml-v1/s9_sd_proxy_extension.py",60000)
    if "C720PSecureRelay" not in template or "/new/api/appearance-search" not in template:
        raise RuntimeError("unsigned_or_incomplete_search_page")
    for p in (TRACKS,PROXY):
        if not p.is_file() or p.is_symlink():raise RuntimeError("unsafe_or_missing_live_file_"+str(p))
    if NEW.is_symlink():raise RuntimeError("unsafe_search_page_symlink")
    live_proxy=PROXY.read_text()
    live_tracks=TRACKS.read_text()
    new_proxy,new_tracks=patch(live_proxy,live_tracks,source_proxy)
    if patch(new_proxy,new_tracks,source_proxy)!=(new_proxy,new_tracks):
        raise RuntimeError("non_idempotent_patch")
    before=current_archive()
    previous={row.get("clip_no") for row in before["events"]}
    print("HSV_UI_PREFLIGHT",json.dumps({"count":len(previous),
      "proxy_change":new_proxy!=live_proxy,"tracks_change":new_tracks!=live_tracks,
      "page_change":not NEW.exists() or NEW.read_text()!=template,
      "camera_changed":False}),flush=True)
    if not args.apply:return
    BACK.mkdir(parents=True,exist_ok=True)
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    folder=BACK/stamp;folder.mkdir(mode=0o700)
    originals={}
    updates={PROXY:new_proxy,TRACKS:new_tracks,NEW:template}
    for target in updates:
        if target.exists():
            original=folder/target.name
            shutil.copy2(target,original)
            os.chmod(original,0o600)
            originals[target]=original
        else:originals[target]=None
    changed=[]
    try:
        for target,value in updates.items():
            if target.is_file() and target.read_text()==value:continue
            atomic(target,value);changed.append(target)
        after=service()
        if not previous.issubset({row.get("clip_no") for row in after["events"]}):
            raise RuntimeError("existing_camera_clips_disappeared")
        # Validate search route is present without requiring phone upgrade.
        probe="/new/api/appearance-search?clip=motion_0000000000000.mp4&category=upper_clothing"
        try:
            with urllib.request.urlopen("http://127.0.0.1:8795"+probe,timeout=10):
                raise RuntimeError("unexpected_invalid_reference_success")
        except urllib.error.HTTPError as problem:
            if problem.code!=400:raise RuntimeError("appearance_route_not_active")
        if LINK not in TRACKS.read_text() or "C720PSecureRelay" not in NEW.read_text():
            raise RuntimeError("visual_search_ui_not_live")
        print("S9_HSV_UI_DEPLOY_VERIFIED",json.dumps({"live_clips":len(after["events"]),
          "backup":str(folder),"files_changed":[x.name for x in changed],
          "apk_changed":False,"original_mp4_changed":False}),flush=True)
    except Exception:
        for target in reversed(changed):
            original=originals[target]
            if original is None:target.unlink(missing_ok=True)
            else:atomic(target,original.read_text())
        try:service()
        except Exception:pass
        raise

if __name__=="__main__":main()
