#!/usr/bin/env python3
"""Safely forward sanitized 06:00 S9+/Drive counts via existing Security 8794 auth.

Installs only the exact GET route. No user media, manual decisions, camera APK,
person identities, automatic assignments, NTP or HA lighting are touched.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import py_compile
import re
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

TARGET=Path("/home/jespern/c720p-home-hub/bin/c720p-lan-camera-relay.py")
BACK=Path("/home/jespern/c720p-home-hub/backups/security-activity-auth-relay-v1")
SERVICE="c720p-lan-camera-relay.service"
MARK="SECURITY_ACTIVITY_AUTHENTICATED_0600_V1"
ANCHOR=("  m=re.fullmatch(r'/(new)/api/saved',path)\n"
        "  if m:return self.archive(m.group(1),'/api/saved',head)")
ADD=(
 "  # "+MARK+" exact metadata-only GET under existing authorized() check\n"
 "  m=re.fullmatch(r'/(new)/api/security-recording-activity',path)\n"
 "  if m:\n"
 "   if head:return self.empty(405)\n"
 "   return self.archive(m.group(1),'/api/security-recording-activity',False)\n"
)

def patched(source):
    if MARK in source:return source,False
    if source.count(ANCHOR)!=1:raise RuntimeError("signed_archive_route_anchor_changed")
    at=source.index(ANCHOR)
    guarded=source[:at]
    if "if not self.authorized()" not in guarded:
        raise RuntimeError("no_existing_authorization_guard")
    code=source.replace(ANCHOR,ADD+ANCHOR,1)
    compile(code,str(TARGET),"exec")
    return code,True

def service(action):
    r=subprocess.run(["systemctl","--user",action,SERVICE],
      capture_output=True,text=True,timeout=30)
    if r.returncode:raise RuntimeError("security_relay_"+action+"_failed")
    return r.stdout.strip()

def fetch(port,path,limit=3_500_000):
    with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}",timeout=16) as response:
        if response.status!=200:raise RuntimeError("route_unavailable")
        blob=response.read(limit+1)
        if len(blob)>limit:raise RuntimeError("unbounded_route")
        return json.loads(blob)

def camera():
    status=fetch(18808,"/status",200_000)
    if (status.get("ok") is not True or
        status.get("continuous_4k_ready") is not True or
        status.get("continuous_4k_dropped_output_frames")!=0):
        raise RuntimeError("capture_health_not_confirmed")
    return True

def wait_relay_ready(seconds=24):
    """Allow Python to rebind 8794 after systemd restart, but not hide route bugs."""
    deadline=time.monotonic()+seconds
    while time.monotonic()<deadline:
        try:
            if service("is-active")=="active":
                with urllib.request.urlopen("http://127.0.0.1:8794/new/api/saved",timeout=3) as response:
                    if response.status==200:return
        except (RuntimeError,urllib.error.URLError,TimeoutError,OSError):
            pass
        time.sleep(0.5)
    raise RuntimeError("security_relay_not_listening_after_restart")

def health():
    upstream=fetch(8795,"/new/api/security-recording-activity")
    downstream=fetch(8794,"/new/api/security-recording-activity")
    if (upstream!=downstream or upstream.get("ok") is not True or
        upstream.get("s3_included") is not False or
        upstream.get("media_decoded") is not False or
        upstream.get("video_bytes_transferred") is not False or
        not isinstance(upstream.get("operating_days"),dict)):
        raise RuntimeError("activity_relay_source_parity_failed")
    # Preserve the existing archive API, not just this added route.
    sd_old=fetch(8795,"/new/api/saved")
    sd_live=fetch(8794,"/new/api/saved")
    up={x.get("clip_no") for x in sd_old.get("events",[]) if isinstance(x,dict)}
    live={x.get("clip_no") for x in sd_live.get("events",[]) if isinstance(x,dict)}
    if not up or up!=live:raise RuntimeError("existing_recordings_regressed")
    if service("is-active")!="active":raise RuntimeError("authenticated_relay_not_active")
    camera()
    return {"total_recordings":upstream["total_recordings"],
      "sources":upstream["source_recordings"],"operating_days":len(upstream["operating_days"]),
      "original_clips":len(up),"s3_excluded":True,"media_modified":False}

def atomic(path,body,meta):
    if path.is_symlink():raise RuntimeError("unsafe_relay_symlink")
    fd,name=tempfile.mkstemp(prefix=".security-activity-route-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as out:
            out.write(body);out.flush();os.fsync(out.fileno())
        os.chmod(name,stat.S_IMODE(meta.st_mode))
        try:os.chown(name,meta.st_uid,meta.st_gid)
        except PermissionError:pass
        os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)

def main():
    ap=argparse.ArgumentParser();ap.add_argument("--apply",action="store_true")
    args=ap.parse_args()
    if TARGET.is_symlink() or not TARGET.is_file():
        raise RuntimeError("security_relay_missing")
    if service("is-active")!="active":raise RuntimeError("relay_inactive_preflight")
    camera()
    upstream=fetch(8795,"/new/api/security-recording-activity")
    if upstream.get("ok") is not True:raise RuntimeError("upstream_activity_unhealthy")
    prior=TARGET.read_bytes();meta=TARGET.stat()
    if len(prior)>600_000:raise RuntimeError("relay_script_too_large")
    new,changed=patched(prior.decode("utf-8"))
    if not changed:
        outcome=health()
        print("SECURITY_ACTIVITY_RELAY_ALREADY_ACTIVE",json.dumps(outcome,sort_keys=True))
        return
    if not args.apply:
        print("SECURITY_ACTIVITY_RELAY_PREFLIGHT",
              json.dumps({"can_apply":True,"original_sha256":hashlib.sha256(prior).hexdigest(),
               "upstream_recordings":upstream["total_recordings"],"media_changes":False},sort_keys=True))
        return
    BACK.mkdir(parents=True,exist_ok=True)
    stamp=dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    backup=BACK/(stamp+"-"+hashlib.sha256(prior).hexdigest()[:12]+".py")
    if backup.exists():raise RuntimeError("backup_collision")
    fd,backup_temp=tempfile.mkstemp(prefix=".original-",dir=BACK)
    try:
        with os.fdopen(fd,"wb") as f:
            f.write(prior);f.flush();os.fsync(f.fileno())
        os.chmod(backup_temp,0o600)
        os.replace(backup_temp,backup)
    finally:
        if os.path.exists(backup_temp):os.unlink(backup_temp)
    try:
        atomic(TARGET,new.encode("utf-8"),meta)
        service("restart")
        wait_relay_ready()
        result=health()
    except Exception:
        atomic(TARGET,prior,meta)
        service("restart")
        wait_relay_ready()
        raise
    print("SECURITY_ACTIVITY_AUTH_RELAY_DEPLOY_VERIFIED",
        json.dumps({**result,"backup":str(backup),"camera_apk_changed":False,
             "manual_reviews_modified":False},sort_keys=True))

if __name__=="__main__":main()
