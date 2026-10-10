#!/usr/bin/env python3
"""Install the S9 anonymous-tracks catalog, authenticated API and HTML with rollback.

Runs only on the C720P, against an already immutable-staged and checked release.
Never modifies the phone, camera settings, original MP4s, thumbnails or Drive.
The APK is upgraded separately by safe-night-guard-upgrade.py.
"""
import argparse
import datetime
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import time
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
LIVE_BIN=HOME/"bin"
ROOT=Path("/opt/homeassistant/config/www/frontyard-security-new")
PAGE=ROOT/"clips.html"
INDEX=ROOT/"s9-phone-events.json"
CAT=LIVE_BIN/"c720p-s9-local-sd-catalog.py"
PROXY=LIVE_BIN/"s9_sd_proxy_extension.py"
ARCHIVE=LIVE_BIN/"c720p-drive-security-archive.py"
BACKUP_ROOT=HOME/"backups/s9-anonymous-index"
STYLE='id="s9-anonymous-clips-style-v1"'
SCRIPT='id="s9-anonymous-clips-script-v1"'
FACE_SCRIPT='id="s9-face-review-script-v1"'

def run(command,seconds=45):
    return subprocess.run(command,check=True,capture_output=True,text=True,timeout=seconds)

def current_api():
    with urllib.request.urlopen("http://127.0.0.1:8795/health.json",timeout=9) as res:
        if res.status!=200:raise RuntimeError("archive_service_unhealthy")
    with urllib.request.urlopen("http://127.0.0.1:8795/new/api/saved",timeout=20) as res:
        data=json.load(res)
    if data.get("archive_mode")!="S9-microSD-only" or not isinstance(data.get("events"),list):
        raise RuntimeError("local_sd_archive_contract_missing")
    return data

def replace(src,target):
    temp=target.with_name(target.name+".s9-anon-stage")
    shutil.copy2(src,temp)
    os.replace(temp,target)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--staging",required=True,type=Path,
                        help="Complete immutable staging directory from stage-verified-deployment.py")
    args=parser.parse_args()
    stage=args.staging.resolve()
    sources={
        CAT:stage/"s9-person-ml-v1/local-sd-catalog.py",
        PROXY:stage/"s9-person-ml-v1/s9_sd_proxy_extension.py",
    }
    patch_file=stage/"s9-native-security/patch-anonymous-tracks-ui.py"
    tests=stage/"s9-native-security/test-anonymous-index-ui.py"
    face_patch=stage/"s9-native-security/patch-s9-face-review-ui.py"
    face_tests=stage/"s9-native-security/test-s9-face-review.py"
    if len(stage.name)!=40 or any(c not in "0123456789abcdef" for c in stage.name):
        raise RuntimeError("immutable_sha_named_stage_required")
    stamps=[HOME/"build/s9-native-security/.source-commit",
            HOME/"build/s9-native-security/.compiled-commit",
            HOME/"build/s9-native-security/s9-native-security.apk.source-commit"]
    if any(not f.is_file() or f.read_text().strip()!=stage.name for f in stamps):
        raise RuntimeError("stage_and_signed_camera_build_revision_mismatch")
    for path in [CAT,PROXY,ARCHIVE,PAGE]+list(sources.values())+[patch_file,tests,face_patch,face_tests]:
        if not path.is_file():raise RuntimeError("required_file_missing:"+str(path))
    if "s9_sd_proxy_extension.install_local_sd(H)" not in ARCHIVE.read_text():
        raise RuntimeError("expected_auth_archive_extension_missing")
    for path in list(sources.values())+[patch_file,tests,face_patch,face_tests]:
        run([sys.executable,"-m","py_compile",str(path)],15)
    checks=run([sys.executable,str(tests)],30)
    print("ANONYMOUS_STAGING_TESTS",checks.stderr.strip()[-900:],flush=True)
    run([sys.executable,str(face_tests)],30)
    spec=importlib.util.spec_from_file_location("anon_panel",patch_file)
    patcher=importlib.util.module_from_spec(spec);spec.loader.exec_module(patcher)
    old_html=PAGE.read_text()
    updated_html=patcher.patch_text(old_html)
    face_spec=importlib.util.spec_from_file_location("s9_face_ui",face_patch)
    face_mod=importlib.util.module_from_spec(face_spec);face_spec.loader.exec_module(face_mod)
    updated_html=face_mod.patch_text(updated_html)
    if face_mod.patch_text(updated_html)!=updated_html or FACE_SCRIPT not in updated_html:
        raise RuntimeError("face_review_ui_patch_failed")
    if not (STYLE in updated_html and SCRIPT in updated_html):
        raise RuntimeError("anonymous_panel_not_in_updated_html")
    if patcher.patch_text(updated_html)!=updated_html:
        raise RuntimeError("anonymous_panel_non_idempotent")
    old=current_api()
    old_names={x.get("clip_no") for x in old["events"]}
    old_stills=len(old.get("fallback_previews",[]))
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup=BACKUP_ROOT/stamp
    backup.mkdir(parents=True,exist_ok=False)
    originals={}
    for index,target in enumerate([CAT,PROXY,PAGE,INDEX]):
        original=backup/(str(index)+"-"+target.name)
        if target.is_file():
            shutil.copy2(target,original)
            originals[target]=original
        else:originals[target]=None
    print("ROLLBACK_BACKUP",str(backup),flush=True)
    replaced=[]
    try:
        for target,source in sources.items():
            replace(source,target);replaced.append(target)
        if updated_html!=old_html:
            stage_html=PAGE.with_suffix(".html.s9-anon-stage")
            stage_html.write_text(updated_html)
            os.chmod(stage_html,PAGE.stat().st_mode&0o777)
            os.replace(stage_html,PAGE)
            replaced.append(PAGE)
        # Indexed event descriptions only: the original video bytes never leave microSD.
        replaced.append(INDEX)
        run(["systemctl","--user","start","c720p-s9-local-sd-catalog.service"],260)
        run(["systemctl","--user","restart","c720p-drive-security-archive.service"],45)
        for index in range(6):
            try:
                now=current_api()
                break
            except Exception:
                if index==5:raise
                time.sleep(2)
        names={x.get("clip_no") for x in now["events"]}
        if not old_names.issubset(names):raise RuntimeError("existing_video_disappeared")
        if len(now.get("fallback_previews",[]))<old_stills:
            raise RuntimeError("existing_fallback_stills_disappeared")
        if not (STYLE in PAGE.read_text() and SCRIPT in PAGE.read_text() and FACE_SCRIPT in PAGE.read_text()):
            raise RuntimeError("security_ui_not_live")
        for rec in now["events"]:
            if rec.get("clip_no","").startswith("motion_"):
                if rec.get("anonymous_id_scope")!="clip_only_never_across_recordings":
                    raise RuntimeError("new_archive_api_not_exposing_scope")
        print("S9_ANONYMOUS_SECURITY_INDEX_DEPLOY_PASS",
              json.dumps({"videos":len(now["events"]),"fallback_stills":len(now.get("fallback_previews",[])),
                          "rollback_backup":str(backup),"camera_apk_changed":False,
                          "original_video_files_changed":False},sort_keys=True),flush=True)
    except Exception as error:
        print("S9_ANONYMOUS_INDEX_ROLLBACK",type(error).__name__,str(error),flush=True)
        for target in reversed(replaced):
            original=originals.get(target)
            try:
                if original is not None:replace(original,target)
                elif target.is_file():target.unlink()
            except Exception as issue:print("RESTORE_FAILED",str(target),repr(issue),flush=True)
        try:run(["systemctl","--user","restart","c720p-drive-security-archive.service"],45)
        except Exception as issue:print("ARCHIVE_RESTART_FAILED",repr(issue),flush=True)
        raise

if __name__=="__main__":
    main()
