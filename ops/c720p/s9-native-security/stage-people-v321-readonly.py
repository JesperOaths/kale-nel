#!/usr/bin/env python3
"""Stage V51/V321 static People review as an isolated preview, never activate it.

Only creates NEW versioned HTML/JS files, leaving protected V50/V320 sources,
camera services, relays, decisions, and original videos untouched. Does not
enable the authenticated folder API or synthesize a media-open attestor.
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import tempfile
import urllib.request

REPO="JesperOaths/kale-nel"
PREFIX="ops/c720p/s9-native-security/"
WWW=Path("/opt/homeassistant/config/www/frontyard-security-new")
# HTTP origin must remain a URL string: pathlib.Path collapses "http://".
BASE="http://127.0.0.1:8123/local/frontyard-security-new"
PROTECTED={
    "security-people-v50.html": "002decab2e21774cae7352bd7f87b10d78c0dbc3c7b469a2b139e2e805c64aa1",
    "security-people-v320.js": "7ed25925a7785cf4267b0f0ff8234b3b5ce40b21f07d899d9e9057b8baf8e1b7",
}
NEW=("security-people-v51.html","security-people-v321.js")
SOURCES=("security-people-v51.html","security-people-v321.js")
REF=re.compile(r"[0-9a-f]{40}\Z")

def sha(data: bytes)->str:return hashlib.sha256(data).hexdigest()

def verify_protected():
    for file,expected in PROTECTED.items():
        p=WWW/file
        if p.is_symlink() or not p.is_file() or sha(p.read_bytes())!=expected:
            raise RuntimeError("protected_live_people_asset_changed_"+file)

def fetch_source(ref,file):
    url=f"https://raw.githubusercontent.com/{REPO}/{ref}/{PREFIX}{file}"
    req=urllib.request.Request(url,headers={"User-Agent":"c720p-versioned-people-acceptance/1"})
    with urllib.request.urlopen(req,timeout=18) as resp:
        if resp.status!=200:raise RuntimeError("trusted_source_http_failed")
        body=resp.read(200000)
    if not 10_000<len(body)<160_000:raise RuntimeError("trusted_source_invalid_size")
    return body

def check_sources(blobs):
    js=blobs["security-people-v321.js"].decode("utf-8")
    html=blobs["security-people-v51.html"].decode("utf-8")
    checks=(
      "function renderVerifiedFolderSuggestions()",
      "typeof signed?.openAndAttest==='function'",
      "host.hidden=!available",
      "hook.openAndAttest(row,()=>startVideo(clip))",
      "assignmentKey(x)===row.source_qualified_clip_id",
      "human_review_required", # present elsewhere on page; no identity assertion
    )
    if any(part not in js for part in checks):
        raise RuntimeError("review_bridge_missing_safety_gate")
    if (html.count('id="folderRankedCards"')!=1
        or html.count("security-people-v321.js?v=")!=1
        or html.count("folder-suggestion-cards-v1.js?v=")!=1
        or "security-people-v320.js?v=" in html):
        raise RuntimeError("preview_document_not_independently_versioned")
    if html.index("folder-suggestion-cards-v1.js?v=")>html.index("security-people-v321.js?v="):
        raise RuntimeError("preview_script_order_incorrect")

def atom_new(path,body):
    if path.exists() or path.is_symlink():
        if path.is_file() and not path.is_symlink() and path.read_bytes()==body:
            return False
        raise RuntimeError("versioned_preview_path_already_occupied_"+path.name)
    fd,temp=tempfile.mkstemp(dir=WWW,prefix=".versioned-people-")
    try:
        with os.fdopen(fd,"wb") as handle:
            handle.write(body);handle.flush();os.fsync(handle.fileno())
        os.chmod(temp,0o644)
        # Hard link fails atomically if another task created the destination.
        os.link(temp,path)
        return True
    finally:
        os.unlink(temp)

def verify_served(blobs,ref):
    for file,body in blobs.items():
        u=f"{BASE}/{file}?v={ref[:12]}"
        try:
            with urllib.request.urlopen(u,timeout=12) as response:
                actual=response.read(len(body)+1)
                if response.status!=200:raise RuntimeError("homeassistant_static_http_not_200")
        except Exception as error:
            raise RuntimeError("preview_not_served_"+file) from error
        if sha(actual)!=sha(body):
            raise RuntimeError("homeassistant_static_content_mismatch_"+file)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--ref",required=True,help="40-char immutable merged commit SHA")
    ap.add_argument("--apply",action="store_true",help="create two new preview assets")
    args=ap.parse_args()
    if not REF.fullmatch(args.ref):raise ValueError("Immutable source commit required")
    if not WWW.is_dir() or WWW.is_symlink():
        raise RuntimeError("unsafe_ha_static_directory")
    verify_protected()
    blobs={name:fetch_source(args.ref,name) for name in SOURCES}
    check_sources(blobs)
    for name,body in blobs.items():
        p=WWW/name
        if p.exists() or p.is_symlink():
            if p.is_symlink() or not p.is_file() or p.read_bytes()!=body:
                raise RuntimeError("preview_collision_"+name)
    report={"schema":"versioned_people_preview_v321","ref":args.ref,
        "stage_requested":args.apply,"assets":{name:sha(body) for name,body in blobs.items()},
        "protected_live_sha256":dict(PROTECTED),"active_ui_changed":False,
        "camera_changed":False,"recordings_changed":False,"reviews_changed":False,
        "folder_review_api_activated":False}
    print("V321_STAGE_PREFLIGHT "+json.dumps(report,sort_keys=True),flush=True)
    if not args.apply:return
    created=[]
    try:
        for name in NEW:
            if atom_new(WWW/name,blobs[name]):created.append(name)
        verify_protected()
        verify_served(blobs,args.ref)
        report.update({"staged":True,"served_sha256":report["assets"],
                       "created":created,
                       "preview_url":"/local/frontyard-security-new/security-people-v51.html"})
        print("V321_READONLY_PREVIEW_VERIFIED "+json.dumps(report,sort_keys=True),flush=True)
    except BaseException:
        for name in reversed(created):
            target=WWW/name
            if target.is_file() and not target.is_symlink() and target.read_bytes()==blobs[name]:
                target.unlink()
        print("V321_STAGE_ROLLED_BACK_OR_UNCHANGED",flush=True)
        raise

if __name__=="__main__":
    main()
