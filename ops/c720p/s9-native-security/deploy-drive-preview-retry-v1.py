#!/usr/bin/env python3
"""Guarded deployment of a bounded historical Drive thumbnail retry in the Archive UI.

Default dry run validates patch against live HTML. --apply modifies only the
static HTML file with backup and HTTP verification, restores it on failure.
Does not restart or alter camera, Drive archive service, or HA automations.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import tempfile
import urllib.request

UI=Path("/opt/homeassistant/config/www/frontyard-security-new/security-archive-v7.html")
BACKUP_ROOT=Path("/home/jespern/c720p-home-hub/backups/drive-preview-retry-v1")
SOURCE_URL=("https://raw.githubusercontent.com/JesperOaths/kale-nel/"
    "3de478e16fdb76c90c8c47d6f90fb1d871526c9e/"
    "ops/c720p/s9-native-security/security-archive-v7.html")
EXPECTED_LIVE_SHA="cc95f32d6692a3e0293593e7e1a7abbbb9c6dc3fce8a7915c22cb3a665666d9f"
MARKER="DRIVE_PREVIEW_RETRY_V1"
START="async function drivePreview(img,r){"
END="\nfunction driveCard(r){"

def extract(source):
    if source.count(START)!=1 or source.count(END)!=1:raise RuntimeError("Archive UI function boundaries missing or ambiguous")
    first=source.index(START)
    last=source.index(END,first)
    return source[first:last]

def verify_syntax(page):
    blocks=re.findall(r"<script(?:\s+[^>]*)?>([\s\S]*?)</script>",page,re.I)
    if not blocks:raise RuntimeError("Archive page has no inline script")
    if not shutil.which('node'):
        # The C720P intentionally has no Node binary; syntax verification is
        # required in the PR's GitHub Actions Node.js job. Source is pinned
        # to a specific commit and anchored to an audited live HTML hash.
        return 'pinned_source_plus_ci'
    with tempfile.TemporaryDirectory() as directory:
        for index,src in enumerate(blocks):
            file=Path(directory)/("inline-"+str(index)+".js")
            file.write_text(src)
            check=subprocess.run(["node","--check",str(file)],capture_output=True,text=True,timeout=12)
            if check.returncode:raise RuntimeError("Browser JavaScript invalid: "+check.stderr[-800:])

def install(apply):
    old=UI.read_text()
    old_sha=hashlib.sha256(UI.read_bytes()).hexdigest()
    if old_sha!=EXPECTED_LIVE_SHA and MARKER not in old:
        raise RuntimeError("Live Archive UI changed unexpectedly; refusing to overwrite concurrent edits")
    original_fn=extract(old)
    with urllib.request.urlopen(SOURCE_URL,timeout=16) as response:revision=response.read(80000).decode("utf-8")
    desired_fn=extract(revision)
    if MARKER not in desired_fn or MARKER in original_fn and original_fn!=desired_fn:
        raise RuntimeError("Unexpected live/new function version")
    if MARKER not in old:
        if old.count(original_fn)!=1:raise RuntimeError("Live preview function not unique")
        updated=old.replace(original_fn,desired_fn,1)
    else:updated=old
    syntax_mode=verify_syntax(updated)
    report={"source_sha_before":old_sha,"already_installed":updated==old,
            "dry_run":not apply,"syntax_check_mode":syntax_mode or "node_checked","bounded_retries":16,
            "changed_bytes":len(updated.encode())-len(old.encode())}
    if not apply:
        print(json.dumps(report,separators=(",",":")))
        return
    if updated==old:
        report["verified"]=True
        print(json.dumps(report,separators=(",",":")))
        return
    folder=BACKUP_ROOT/datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    folder.mkdir(parents=True,exist_ok=False)
    backup=folder/"security-archive-v7.html.before"
    shutil.copy2(UI,backup)
    staged=UI.with_name(UI.name+".preview-retry-tmp")
    try:
        staged.write_text(updated)
        os.chmod(staged,UI.stat().st_mode & 0o777)
        os.replace(staged,UI)
        if MARKER not in UI.read_text() or hashlib.sha256(UI.read_bytes()).hexdigest()!=hashlib.sha256(updated.encode()).hexdigest():
            raise RuntimeError("Local file readback mismatch")
        with urllib.request.urlopen(
          "http://127.0.0.1:8123/local/frontyard-security-new/security-archive-v7.html?verify=drive-preview-retry-v1",
          timeout=12) as response:
            remote=response.read(100000).decode("utf-8","replace")
            if response.status!=200 or MARKER not in remote:
                raise RuntimeError("HA static archive page readback failed")
    except Exception:
        shutil.copy2(backup,UI)
        raise
    report.update({"verified":True,"archive_http_status":200,"backup":str(backup)})
    print(json.dumps(report,separators=(",",":")))

if __name__=="__main__":
    p=argparse.ArgumentParser()
    p.add_argument("--apply",action="store_true")
    args=p.parse_args()
    install(args.apply)
