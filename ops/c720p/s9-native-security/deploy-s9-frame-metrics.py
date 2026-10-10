#!/usr/bin/env python3
"""Guarded S9+ Security analytics release for C720P. Originals and Camera2 untouched.

Dry-run by default. --apply installs only Python metadata/API and HTML widgets
from an immutable GitHub commit after tests, health checks and local backups.
"""
import argparse
import datetime
import fcntl
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request

ROOT=Path("/home/jespern/c720p-home-hub")
WEB=Path("/opt/homeassistant/config/www/frontyard-security-new")
BIN=ROOT/"bin"
PAGE=WEB/"clips.html"
INDEX=WEB/"s9-phone-events.json"
BACKUPS=ROOT/"backups/s9-frame-metrics"
STAGES=ROOT/"build/s9-frame-metrics-stage"
BASE_URL="https://raw.githubusercontent.com/JesperOaths/kale-nel/"
REVISION=re.compile(r"[a-f0-9]{40}\Z")
FILES={
    "s9-person-ml-v1/local-sd-catalog.py":BIN/"c720p-s9-local-sd-catalog.py",
    "s9-person-ml-v1/s9_sd_proxy_extension.py":BIN/"s9_sd_proxy_extension.py",
    "s9-person-ml-v1/s9_drive_visitor_review.py":BIN/"s9_drive_visitor_review.py",
}
EXTRA=(
    "s9-native-security/patch-anonymous-tracks-ui.py",
    "s9-native-security/patch-drive-visitor-review-ui.py",
    "s9-native-security/test-anonymous-index-ui.py",
    "s9-native-security/test-drive-visitor-review.py",
    "s9-native-security/s9_appearance_review.py",
    "s9-native-security/drive-person-batch-catalog.py",
    "s9-person-ml-v1/s9_human_thumbnail_review.py",
    "s9-person-ml-v1/s9_native_camera_controls.py",
    "s9-native-security/patch-s9-saved-video-orientation.py",
    "s9-native-security/test-s9-saved-video-orientation.py",
)

def run(args, timeout=60):
    return subprocess.run(args,check=True,text=True,capture_output=True,timeout=timeout).stdout

def api(route, timeout=12):
    with urllib.request.urlopen("http://127.0.0.1:8795"+route,timeout=timeout) as response:
        if response.status!=200:raise RuntimeError("api_response_not_200:"+route)
        return json.load(response)

def camera():
    with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=9) as response:
        d=json.load(response)
    if not d.get("ok") or d.get("mode") not in ("watching","recording"):
        raise RuntimeError("native_camera_unhealthy")
    return d

def read_state():
    videos=api("/new/api/saved")
    hist=api("/new/api/drive-person-review")
    if videos.get("archive_mode")!="S9-microSD-only":
        raise RuntimeError("wrong_archive_contract")
    if not videos.get("events") or not hist.get("ok"):
        raise RuntimeError("source_catalog_unavailable")
    camera()
    return videos,hist

def fetch(ref,relative,dest):
    url=BASE_URL+ref+"/ops/c720p/"+relative
    req=urllib.request.Request(url,headers={"User-Agent":"C720P-S9-frame-metrics-pinned/1"})
    with urllib.request.urlopen(req,timeout=32) as response:
        data=response.read(400001)
    if not 100<len(data)<=400000:raise RuntimeError("source_size_out_of_bounds:"+relative)
    dest.parent.mkdir(parents=True,exist_ok=True)
    if dest.exists() and dest.read_bytes()!=data:
        raise RuntimeError("immutable_stage_mismatch:"+relative)
    if not dest.exists():
        dest.write_bytes(data)
        os.chmod(dest,0o600)
    return hashlib.sha256(data).hexdigest()

def load(path,name):
    spec=importlib.util.spec_from_file_location(name,path)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def atomic_file(path,data):
    mode=path.stat().st_mode & 0o777
    tmp=path.with_name(path.name+".s9frames-stage")
    if tmp.exists():raise RuntimeError("staging_conflict:"+path.name)
    with tmp.open("xb") as f:
        f.write(data)
        f.flush()
        os.fsync(f.fileno())
    os.chmod(tmp,mode)
    os.replace(tmp,path)

def install(ref,apply):
    stage=STAGES/ref
    print("FRAME_METRICS_RELEASE",ref,flush=True)
    hashes={}
    for relative in tuple(FILES)+EXTRA:
        hashes[relative]=fetch(ref,relative,stage/relative)
        if relative.endswith(".py"):
            run([sys.executable,"-m","py_compile",str(stage/relative)],15)
    env={**os.environ,"PYTHONPATH":str(stage/"s9-native-security")}
    for name in ("test-anonymous-index-ui.py","test-drive-visitor-review.py",
                 "test-s9-saved-video-orientation.py"):
        test=stage/"s9-native-security"/name
        result=subprocess.run([sys.executable,str(test)],env=env,capture_output=True,text=True,timeout=45)
        if result.returncode:raise RuntimeError(name+" failed: "+result.stderr[-900:])
        print("STAGED_TEST_PASS",name,flush=True)
    before,history=read_state()
    old_names={r.get("clip_no") for r in before["events"]}
    old_fallback=len(before.get("fallback_previews",[]))
    old_processed=int(history.get("processed") or 0)
    page_before=PAGE.read_text(encoding="utf-8")
    if "c720p-s9-phone-clips-ui-v1" not in page_before:
        raise RuntimeError("unexpected_security_page")
    visitor=load(stage/"s9-native-security/patch-drive-visitor-review-ui.py","s9_visitor_metrics")
    anon=load(stage/"s9-native-security/patch-anonymous-tracks-ui.py","s9_native_metrics")
    orientation=load(stage/"s9-native-security/patch-s9-saved-video-orientation.py","s9_orientation")
    page_new=orientation.patch(anon.patch_text(visitor.patch(page_before)))
    if page_new!=orientation.patch(anon.patch_text(visitor.patch(page_new))):
        raise RuntimeError("ui_patches_not_idempotent")
    if "s9-video-orientation-script-v1" not in page_new:
        raise RuntimeError("orientation_controls_missing")
    if "person_presence_percent" not in page_new:
        raise RuntimeError("new_analytics_widget_missing")
    print("PREFLIGHT",json.dumps({"indexed_videos":len(old_names),
        "historic_processed":old_processed,"html_upgrade":page_new!=page_before,
        "source_hashes":hashes}),flush=True)
    if not apply:
        print("DRY_RUN_NO_PRODUCTION_CHANGES",flush=True)
        return
    if camera().get("mode")!="watching":
        raise RuntimeError("camera_not_in_nonrecording_window")
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup=BACKUPS/stamp
    backup.mkdir(parents=True,exist_ok=False)
    paths=[*FILES.values(),PAGE,INDEX]
    original={}
    for i,path in enumerate(paths):
        if not path.is_file():raise RuntimeError("required_live_path_missing:"+path.name)
        target=backup/(str(i)+"-"+path.name)
        shutil.copy2(path,target)
        os.chmod(target,0o600)
        original[path]=target
    print("ROLLBACK_BACKUP",str(backup),flush=True)
    changed=[]
    try:
        if PAGE.read_text(encoding="utf-8")!=page_before:
            raise RuntimeError("concurrent_security_page_update")
        for relative,dest in FILES.items():
            atomic_file(dest,(stage/relative).read_bytes())
            changed.append(dest)
        if page_new!=page_before:
            atomic_file(PAGE,page_new.encode("utf-8"))
            changed.append(PAGE)
        changed.append(INDEX)
        run(["systemctl","--user","start","c720p-s9-local-sd-catalog.service"],260)
        run(["systemctl","--user","restart","c720p-drive-security-archive.service"],65)
        fresh=None
        for retry in range(7):
            try:
                fresh,historical=read_state()
                break
            except Exception:
                if retry==6:raise
                time.sleep(2)
        new_names={r.get("clip_no") for r in fresh["events"]}
        if not old_names.issubset(new_names):
            raise RuntimeError("previous_saved_clips_missing")
        if len(fresh.get("fallback_previews",[]))<old_fallback:
            raise RuntimeError("previous_fallback_evidence_missing")
        if int(historical.get("processed") or 0)<old_processed:
            raise RuntimeError("historical_classification_regressed")
        if PAGE.read_text()!=page_new:
            raise RuntimeError("security_html_changed_after_deployment")
        if not any(e.get("person_presence_percent") is not None
                   for e in fresh["events"] if str(e.get("clip_no","")).startswith("motion_")):
            raise RuntimeError("native_sampled_metrics_not_visible")
        if not any(e.get("person_presence_percent") is not None
                   for e in historical.get("clips",[])):
            raise RuntimeError("drive_sampled_metrics_not_visible")
        candidate=next((r["clip_no"] for r in fresh["events"] if
                        str(r.get("clip_no","")).startswith("motion_")),None)
        if candidate is None:raise RuntimeError("native_mp4_unavailable")
        req=urllib.request.Request("http://127.0.0.1:8795/new/saved/clip/"+candidate,
                                   headers={"Range":"bytes=0-1023"})
        with urllib.request.urlopen(req,timeout=22) as response:
            if response.status!=206 or len(response.read())!=1024:
                raise RuntimeError("mp4_range_playback_regressed")
        print("S9_FRAME_METRICS_LIVE_PASS",json.dumps({
            "reference":ref,"videos":len(fresh["events"]),
            "historic_processed":historical.get("processed"),
            "sampled_rate_exposed":True,"http_range":"206",
            "rollback":str(backup),"phone_apk_modified":False,
            "video_files_modified":False}),flush=True)
    except Exception as error:
        print("FRAME_METRICS_ROLLBACK",type(error).__name__,str(error)[:300],flush=True)
        for path in reversed(changed):
            if path in original:
                try:atomic_file(path,original[path].read_bytes())
                except Exception as failure:
                    print("ROLLBACK_RESTORE_FAILED",path.name,type(failure).__name__,flush=True)
        try:run(["systemctl","--user","restart","c720p-drive-security-archive.service"],65)
        except Exception as failure:print("ROLLBACK_RESTART_FAILED",type(failure).__name__,flush=True)
        raise

if __name__=="__main__":
    parser=argparse.ArgumentParser()
    parser.add_argument("--ref",required=True)
    parser.add_argument("--apply",action="store_true")
    args=parser.parse_args()
    if not REVISION.fullmatch(args.ref):parser.error("full immutable 40-char SHA required")
    lock=ROOT/"state/s9-frame-metrics-deploy.lock"
    with lock.open("a+") as fh:
        try:fcntl.flock(fh,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:raise RuntimeError("security_metrics_deployment_already_running")
        install(args.ref,args.apply)
