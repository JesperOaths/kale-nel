#!/usr/bin/env python3
"""Patch only the missing read-only S9 telemetry route in the LAN relay.

The on-device archive service at 127.0.0.1:8795 already exposes
/new/api/live-person-watch. The local browser uses 127.0.0.1:8794, whose
existing archive() reverse-proxy can safely relay one read-only JSON route.
Back up, deploy atomically, restart only the LAN relay, and rollback on error.
No recording, camera, on-phone APK, archive database or motion code changes.
"""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import time
import urllib.request

TARGET=Path("/home/jespern/c720p-home-hub/bin/c720p-lan-camera-relay.py")
BACKUPS=Path("/home/jespern/c720p-home-hub/backups/s9-lan-telemetry-v14")
UNIT="c720p-lan-camera-relay.service"
ANCHOR=("  m=re.fullmatch(r'/(new)/api/saved',path)\n"
        "  if m:return self.archive(m.group(1),'/api/saved',head)")
INSERT=("  # SECURITY_NATIVE_READONLY_TELEMETRY_V14 — existing JSON archive proxy, no writes\n"
        "  m=re.fullmatch(r'/(new)/api/live-person-watch',path)\n"
        "  if m:return self.archive(m.group(1),'/api/live-person-watch',head)\n")
MARKER="SECURITY_NATIVE_READONLY_TELEMETRY_V14"

def sha(blob):return hashlib.sha256(blob).hexdigest()
def probe(port,path,timeout=8):
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}{path}",timeout=timeout) as response:
            data=response.read(1800000)
            if response.status!=200:raise RuntimeError("unexpected_status")
            record=json.loads(data)
            if not isinstance(record,dict):raise RuntimeError("unexpected_payload")
            return record
    except Exception as error:
        raise RuntimeError(f"endpoint_{port}_{path.rsplit('/',1)[-1]}_{type(error).__name__}") from error

def run(*argv,timeout=18):
    p=subprocess.run(argv,stdout=subprocess.PIPE,stderr=subprocess.PIPE,timeout=timeout,text=True)
    if p.returncode:raise RuntimeError("service_action_failed")
    return p.stdout.strip()
def put(path,payload,owner):
    fd,temp=tempfile.mkstemp(prefix=".s9-telemetry-v14-",suffix=".py",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as handle:
            handle.write(payload);handle.flush();os.fsync(handle.fileno())
        os.chmod(temp,stat.S_IMODE(owner.st_mode))
        try:os.chown(temp,owner.st_uid,owner.st_gid)
        except PermissionError:pass
        os.replace(temp,path)
    finally:
        if os.path.exists(temp):os.unlink(temp)
def main():
    if TARGET.is_symlink() or not TARGET.is_file():
        raise RuntimeError("unexpected_local_relay_source")
    if run("systemctl","--user","is-active",UNIT)!="active":
        raise RuntimeError("lan_relay_not_active_before")
    original=TARGET.read_bytes()
    mode=TARGET.stat()
    before=probe(8794,"/new/api/saved")
    upstream=probe(8795,"/new/api/live-person-watch")
    if before.get("archive_mode")!="S9-microSD-only" or not isinstance(before.get("events"),list):
        raise RuntimeError("saved_archive_baseline_failed")
    if upstream.get("ok") is not True or upstream.get("camera_mode") not in ("watching","recording"):
        raise RuntimeError("upstream_native_camera_unhealthy")
    initial_count=len(before["events"])
    already=MARKER.encode() in original
    if already:
        restored=probe(8794,"/new/api/live-person-watch")
        if restored.get("ok") is not True:raise RuntimeError("route_present_but_unhealthy")
        print("SECURITY_NATIVE_LIVEWATCH_V14_VERIFIED "+json.dumps({
            "already_installed":True,"saved_clips":initial_count,
            "mode":restored.get("camera_mode"),"source_sha256":sha(original),
            "service":"active","camera_unchanged":True}),flush=True)
        return
    text=original.decode("utf-8")
    if text.count(ANCHOR)!=1 or "def archive(" not in text or "def go(" not in text:
        raise RuntimeError("unexpected_relay_route_contract")
    revised=text.replace(ANCHOR,INSERT+ANCHOR,1).encode("utf-8")
    with tempfile.NamedTemporaryFile(suffix=".py",prefix="v14-compile-",delete=True) as test:
        test.write(revised);test.flush()
        import py_compile
        py_compile.compile(test.name,doraise=True,cfile=test.name+".pyc")
        os.unlink(test.name+".pyc")
    # Preserve original bytes separately before attempting a service restart.
    BACKUPS.mkdir(parents=True,exist_ok=True)
    os.chmod(BACKUPS,0o700)
    archive=BACKUPS/("before-"+dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")+".py")
    archive.write_bytes(original)
    os.chmod(archive,0o600)
    if archive.read_bytes()!=original:raise RuntimeError("source_backup_not_verified")
    if TARGET.read_bytes()!=original:raise RuntimeError("concurrent_relay_update")
    changed=False
    try:
        put(TARGET,revised,mode)
        changed=True
        run("systemctl","--user","restart",UNIT)
        last=None
        for _ in range(16):
            try:
                ok=run("systemctl","--user","is-active",UNIT)=="active"
                saved=probe(8794,"/new/api/saved",3)
                watcher=probe(8794,"/new/api/live-person-watch",3)
                valid=(ok and saved.get("archive_mode")=="S9-microSD-only" and
                       isinstance(saved.get("events"),list) and
                       len(saved["events"])>=initial_count and
                       watcher.get("ok") is True and
                       watcher.get("camera_mode") in ("watching","recording"))
                if valid:
                    print("SECURITY_NATIVE_LIVEWATCH_V14_VERIFIED "+json.dumps({
                        "already_installed":False,"source_sha256":sha(revised),
                        "before_sha256":sha(original),"backup":str(archive),
                        "saved_clips":len(saved["events"]),
                        "mode":watcher.get("camera_mode"),
                        "sensor_fps":watcher.get("camera_sensor",{}).get("fps"),
                        "temperature_c":watcher.get("camera_temperature_c"),
                        "service":"active","camera_unchanged":True,
                        "archive_unchanged":True}),flush=True)
                    return
                last="contract_failed"
            except Exception as error:
                last=type(error).__name__
            time.sleep(1)
        raise RuntimeError("relay_post_restart_unhealthy_"+str(last))
    except BaseException:
        if changed:
            try:
                put(TARGET,original,mode)
                run("systemctl","--user","restart",UNIT)
                probe(8794,"/new/api/saved",5)
                print("SECURITY_NATIVE_LIVEWATCH_V14_ROLLED_BACK",flush=True)
            except BaseException:
                print("SECURITY_NATIVE_LIVEWATCH_V14_MANUAL_REPAIR_REQUIRED",flush=True)
        raise
if __name__=="__main__":main()
