#!/usr/bin/env python3
"""Add native S9+ removable microSD free space to the live Security readout.

Surgical patch of the existing 8795 on-device read-only status reporter.
Never edits clips, history, identities, camera APK, or storage allocation.
Restart only the archive/status service, with original Python backup and
automatic rollback if catalog or native health checks fail.
"""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import py_compile
import stat
import subprocess
import tempfile
import time
import urllib.request

ROOT=Path("/home/jespern/c720p-home-hub/bin/s9_phone_garden_status.py")
BACKUP=Path("/home/jespern/c720p-home-hub/backups/s9-native-sd-health-v15")
UNIT="c720p-drive-security-archive.service"
ANCHOR='      "camera_mode":phone["mode"],"camera_temperature_c":phone.get("temperature_c"),'
NEW='      "sd_free_bytes":_sensor_value(phone.get("sd_free_bytes"),0,1000000000000000),'
def sha(data):return hashlib.sha256(data).hexdigest()
def get(url,timeout=6,limit=1500000):
    with urllib.request.urlopen(url,timeout=timeout) as r:
        if r.status!=200:raise RuntimeError("http_status_not_200")
        raw=r.read(limit+1)
    if len(raw)>limit:raise RuntimeError("oversize_json")
    doc=json.loads(raw)
    if not isinstance(doc,dict):raise RuntimeError("nonobject_json")
    return doc
def unit(*args,timeout=15):
    p=subprocess.run(["systemctl","--user",*args,UNIT],capture_output=True,text=True,timeout=timeout)
    if p.returncode:raise RuntimeError("archive_service_action_failed")
    return p.stdout.strip()
def install(path,data,attributes):
    fd,temp=tempfile.mkstemp(prefix=".s9-native-sd-v15-",suffix=".py",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as out:
            out.write(data);out.flush();os.fsync(out.fileno())
        os.chmod(temp,stat.S_IMODE(attributes.st_mode))
        try:os.chown(temp,attributes.st_uid,attributes.st_gid)
        except PermissionError:pass
        os.replace(temp,path)
    finally:
        if os.path.exists(temp):os.unlink(temp)
def check(expect_count,expect_sd):
    if unit("is-active")!="active":raise RuntimeError("archive_unit_inactive")
    report=get("http://127.0.0.1:8795/new/api/live-person-watch")
    forwarded=get("http://127.0.0.1:8794/new/api/live-person-watch")
    library=get("http://127.0.0.1:8795/new/api/saved")
    if report.get("ok") is not True or forwarded.get("ok") is not True:
        raise RuntimeError("native_watch_unavailable")
    if report.get("sd_free_bytes")!=expect_sd or forwarded.get("sd_free_bytes")!=expect_sd:
        raise RuntimeError("storage_measurement_not_forwarded")
    if library.get("archive_mode")!="S9-microSD-only" or not isinstance(library.get("events"),list):
        raise RuntimeError("saved_archive_contract")
    if len(library["events"])<expect_count:raise RuntimeError("archive_items_decreased")
    return report,len(library["events"])
def main():
    if ROOT.is_symlink() or not ROOT.is_file():raise RuntimeError("unexpected_status_module")
    if unit("is-active")!="active":raise RuntimeError("archive_not_running")
    original=ROOT.read_bytes()
    st=ROOT.stat()
    current=original.decode("utf-8")
    phone=get("http://127.0.0.1:18808/status",limit=150000)
    if phone.get("ok") is not True or phone.get("mode") not in ("watching","recording"):
        raise RuntimeError("native_camera_unhealthy")
    sd=phone.get("sd_free_bytes")
    if isinstance(sd,bool) or not isinstance(sd,(int,float)) or not 0<=sd<=1000000000000000:
        raise RuntimeError("native_microSD_measurement_missing")
    old=get("http://127.0.0.1:8795/new/api/saved")
    if old.get("archive_mode")!="S9-microSD-only" or not isinstance(old.get("events"),list):
        raise RuntimeError("archive_unhealthy_before")
    count=len(old["events"])
    if NEW in current:
        updated,n=check(count,sd)
        print("SECURITY_NATIVE_SD_HEALTH_V15_VERIFIED "+json.dumps({
            "already_installed":True,"free_bytes":updated.get("sd_free_bytes"),
            "clips":n,"service":"active","source_sha256":sha(original)}),flush=True)
        return
    if current.count(ANCHOR)!=1 or "def from_phone(" not in current or "def unavailable(" not in current:
        raise RuntimeError("status_source_contract_not_found")
    patched=current.replace(ANCHOR,ANCHOR+"\n"+NEW,1).encode()
    with tempfile.TemporaryDirectory(prefix="s9-status-compile-v15-") as tmp:
        p=Path(tmp)/"status.py"
        p.write_bytes(patched)
        py_compile.compile(str(p),doraise=True)
    BACKUP.mkdir(parents=True,exist_ok=True)
    os.chmod(BACKUP,0o700)
    copy=BACKUP/("status-before-"+dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")+".py")
    copy.write_bytes(original)
    os.chmod(copy,0o600)
    if copy.read_bytes()!=original:raise RuntimeError("backup_readback_failure")
    if ROOT.read_bytes()!=original:raise RuntimeError("concurrent_source_change")
    changed=False
    try:
        install(ROOT,patched,st)
        changed=True
        unit("restart")
        for _ in range(18):
            try:
                report,n=check(count,sd)
                print("SECURITY_NATIVE_SD_HEALTH_V15_VERIFIED "+json.dumps({
                    "already_installed":False,"free_bytes":report.get("sd_free_bytes"),
                    "camera_mode":report.get("camera_mode"),
                    "temperature_c":report.get("camera_temperature_c"),
                    "clips":n,"service":"active","rollback":str(copy),
                    "source_sha256":sha(patched),"camera_unchanged":True}),flush=True)
                return
            except Exception:
                time.sleep(1)
        raise RuntimeError("status_or_archive_verification_failed")
    except BaseException:
        if changed:
            try:
                install(ROOT,original,st)
                unit("restart")
                get("http://127.0.0.1:8795/new/api/saved",timeout=9)
                print("SECURITY_NATIVE_SD_HEALTH_V15_ROLLED_BACK",flush=True)
            except BaseException:
                print("SECURITY_NATIVE_SD_HEALTH_V15_MANUAL_REPAIR_REQUIRED",flush=True)
        raise
if __name__=="__main__":main()
