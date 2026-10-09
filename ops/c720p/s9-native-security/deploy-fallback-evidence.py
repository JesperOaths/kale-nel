#!/usr/bin/env python3
"""Rollback-protected S9 Security JPEG fallback catalog + authenticated UI deployment.
Run on C720P with a staged directory containing exact same-revision sources.
Never touches the S9 APK, IP Webcam, cloud upload, or original microSD files.
"""
import argparse
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request
import datetime

LIVE_BIN=Path("/home/jespern/c720p-home-hub/bin")
PAGE=Path("/opt/homeassistant/config/www/frontyard-security-new/clips.html")
CAT=LIVE_BIN/"c720p-s9-local-sd-catalog.py"
PROXY=LIVE_BIN/"s9_sd_proxy_extension.py"
BACK_ROOT=Path("/home/jespern/c720p-home-hub/backups/s9-fallback-preview")
ARCHIVE=LIVE_BIN/"c720p-drive-security-archive.py"
MARKER='id="s9-fallback-gallery-v1"'

def check_http():
    with urllib.request.urlopen("http://127.0.0.1:8795/health.json",timeout=9) as r:
        assert r.status==200
    with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=12) as r:
        data=json.load(r)
    if data.get("archive_mode")!="S9-microSD-only":raise RuntimeError("archive_not_sd_only")
    if not isinstance(data.get("events"),list):raise RuntimeError("archive_events_missing")
    return data

def run(args, timeout=200):
    return subprocess.run(args,check=True,capture_output=True,text=True,timeout=timeout)

def replace(source,target):
    target.parent.mkdir(parents=True,exist_ok=True)
    temp=target.with_name(target.name+".s9evidence-stage")
    shutil.copy2(source,temp)
    os.replace(temp,target)

def main():
    ap=argparse.ArgumentParser()
    ap.add_argument("--staging",type=Path,required=True)
    args=ap.parse_args()
    stage=args.staging.resolve()
    mapping={
      CAT:stage/"s9-person-ml-v1/local-sd-catalog.py",
      PROXY:stage/"s9-person-ml-v1/s9_sd_proxy_extension.py",
    }
    patcher=stage/"s9-native-security/patch-fallback-preview-ui.py"
    tests=stage/"s9-native-security/test-fallback-evidence.py"
    for p in [CAT,PROXY,PAGE,ARCHIVE]:
        if not p.is_file():raise RuntimeError("missing_production_file:"+str(p))
    for p in list(mapping.values())+[patcher,tests]:
        if not p.is_file():raise RuntimeError("staged_source_missing:"+str(p))
    if "s9_sd_proxy_extension.install_local_sd(H)" not in ARCHIVE.read_text():
        raise RuntimeError("secure_archive_extension_not_installed")
    for p in list(mapping.values())+[patcher,tests]:
        run([sys.executable,"-m","py_compile",str(p)],timeout=15)
    # Tests run from a staging tree containing the exact matching files.
    checks=run([sys.executable,str(tests)],timeout=25)
    print("STAGED_SOURCE_TESTS",checks.stdout[-700:].strip(),flush=True)
    old=check_http()
    old_count=len(old["events"])
    spec=importlib.util.spec_from_file_location("s9_preview_patcher",patcher)
    mod=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    old_html=PAGE.read_text()
    new_html=mod.patch_text(old_html)
    if MARKER not in new_html or "C720PSecureRelay" not in new_html:
        raise RuntimeError("security_gallery_incomplete")
    now=datetime.datetime.now().strftime("%Y%m%d-%H%M%S")
    backup=BACK_ROOT/now
    backup.mkdir(parents=True,exist_ok=False)
    originals={}
    targets=list(mapping.keys())+[PAGE]
    for i,target in enumerate(targets):
        dest=backup/f"{i}-{target.name}"
        shutil.copy2(target,dest)
        originals[target]=dest
    print("ROLLBACK_BACKUP",str(backup),flush=True)
    replaced=[]
    try:
        for live,source in mapping.items():
            replace(source,live)
            replaced.append(live)
        if new_html!=old_html:
            tmp=PAGE.with_name(PAGE.name+".s9evidence-stage")
            tmp.write_text(new_html)
            tmp.chmod(PAGE.stat().st_mode & 0o777)
            os.replace(tmp,PAGE)
            replaced.append(PAGE)
        refreshed=run(["systemctl","--user","start","c720p-s9-local-sd-catalog.service"],timeout=185)
        print("CATALOG_REFRESH",refreshed.stdout[-500:].strip(),flush=True)
        run(["systemctl","--user","restart","c720p-drive-security-archive.service"],timeout=40)
        for attempt in range(6):
            try:
                updated=check_http()
                break
            except Exception:
                if attempt==5:raise
                time.sleep(2)
        if len(updated["events"])<old_count:
            raise RuntimeError("existing_video_event_count_dropped")
        previews=updated.get("fallback_previews")
        if not isinstance(previews,list):raise RuntimeError("fallback_index_missing")
        if not all(x.get("kind")=="preview_only_motion_evidence" and
                   x.get("person_status")=="not_evaluated" for x in previews):
            raise RuntimeError("preview_confused_with_person_or_video")
        if MARKER not in PAGE.read_text():raise RuntimeError("html_gallery_not_active")
        print("S9_PREVIEW_EVIDENCE_DEPLOY_PASS",
              json.dumps({"existing_videos":len(updated["events"]),
                         "preview_stills":len(previews),
                         "camera_changes":0,"cloud_uploads":False,
                         "backup":str(backup)}),flush=True)
    except Exception as error:
        print("S9_PREVIEW_EVIDENCE_ROLLBACK",repr(error),flush=True)
        for target in reversed(replaced):
            try:replace(originals[target],target)
            except Exception as e:print("RESTORE_ERROR",target,repr(e),flush=True)
        try:run(["systemctl","--user","restart","c720p-drive-security-archive.service"],timeout=40)
        except Exception as e:print("PROXY_RESTART_ERROR",repr(e),flush=True)
        raise

if __name__=="__main__":main()
