#!/usr/bin/env python3
"""Guarded C720P activation for separate V3 read-only Security appearance route.

Source-pinned and confined to the existing local archive metadata proxy.
Requires local archive preflight. Leaves S9 recorder, MP4s, review assignments,
v1/v2 model indices, and already-working routes untouched. Reversible.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import shutil
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
PROXY=HOME/"bin/s9_sd_proxy_extension.py"
MODULE=HOME/"bin/s9_multivector_appearance_api_v3.py"
STATE=HOME/"state/s9-multivector-v3-active.json"
BACK=HOME/"backups/s9-appearance-v3-api"
HOST="http://127.0.0.1:8795"
SERVICE="c720p-drive-security-archive.service"
SOURCE="https://raw.githubusercontent.com/JesperOaths/kale-nel/31acac83f463e384f7c50b910310631c241ca308/ops/c720p/s9-person-ml-v1/s9_multivector_appearance_api_v3.py"
BLOB="74522a1f1b476e1010cae8be2b78d89d38603abf"
HOOK=" s9_multivector_appearance_api.install(H)\n"
ADD=HOOK+" import s9_multivector_appearance_api_v3\n s9_multivector_appearance_api_v3.install(H)\n"

def github_blob_sha(raw):
    return hashlib.sha1(b"blob "+str(len(raw)).encode()+b"\0"+raw).hexdigest()

def fetch(url,limit=6000000):
    with urllib.request.urlopen(url,timeout=24) as r:
        if r.status!=200:raise RuntimeError("Pinned source/archive API failed")
        content=r.read(limit+1)
    if len(content)>limit:raise RuntimeError("Source exceeds bounded read")
    return content

def request(path,limit=3000000):
    url=HOST+path
    try:
        with urllib.request.urlopen(url,timeout=24) as r:
            code=r.status;content=r.read(limit+1)
    except urllib.error.HTTPError as e:
        code=e.code;content=e.read(limit+1)
    if len(content)>limit:raise RuntimeError("Unexpected live API response size")
    try:doc=json.loads(content)
    except (TypeError,ValueError) as e:raise RuntimeError("Live route did not return JSON") from e
    return code,doc

def command(*args):
    p=subprocess.run(args,capture_output=True,text=True,timeout=70)
    if p.returncode:
        raise RuntimeError("Guarded service command "+args[0]+": "+p.stderr[-220:])
    return p.stdout.strip()

def snapshot_catalogs():
    sd_code,sd=request("/new/api/saved")
    drive_code,drive=request("/new/api/drive-saved")
    if (sd_code!=200 or drive_code!=200
        or sd.get("ok") is not True or drive.get("ok") is not True):
        raise RuntimeError("Live SD / historical Drive metadata API degraded")
    sd_names={x.get("clip_no") for x in sd.get("events",[])
              if isinstance(x,dict) and isinstance(x.get("clip_no"),str)}
    drive_names={str(x.get("remote_name") or x.get("clip_no")) for x in drive.get("events",[])
                 if isinstance(x,dict)}
    if len(sd_names)<175 or len(drive_names)<94:
        raise RuntimeError("Existing S9/Drive recording catalog incomplete")
    return sd_names,drive_names

def atomic(path,data,metadata):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,name=tempfile.mkstemp(prefix=".v3-security-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as writer:
            writer.write(data);writer.flush();os.fsync(writer.fileno())
        os.chmod(name,stat.S_IMODE(metadata.st_mode) if metadata else 0o600)
        if metadata:
            try:os.chown(name,metadata.st_uid,metadata.st_gid)
            except PermissionError:pass
        os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)

def accept(sample):
    code,invalid=request("/new/api/appearance-multivector-v3?clip=invalid.mp4",30000)
    if code!=400 or invalid.get("error")!="invalid_clip":
        raise RuntimeError("V3 routing was not installed or rejected malformed input incorrectly")
    if sample is None:
        # If the first V3 snapshot has not run, a valid clip must fail closed.
        code,data=request("/new/api/appearance-multivector-v3?clip=motion_1800000000000.mp4",30000)
        if (code!=503 or data.get("error")!="v3_appearance_index_not_ready"):
            raise RuntimeError("V3 no-snapshot state not fail-closed")
        return "route_available_waiting_for_verified_v3"
    path="/new/api/appearance-multivector-v3?clip="+urllib.parse.quote(sample,safe="")
    code,data=request(path,250000)
    if (code!=200 or data.get("ok") is not True
        or data.get("ranking_schema")!="s9_appearance_rankings_v3"
        or data.get("appearance_only") is not True
        or data.get("identity_probability") is not False
        or data.get("automatic_person_assignments")!=0
        or data.get("human_review_required") is not True
        or data.get("coverage",{}).get("real_person_crops",0)<58):
        raise RuntimeError("Live authenticated V3 source/score acceptance failed")
    return "verified_v3_rankings_live"

def sample_from_verified_pointer():
    if not STATE.exists():return None
    if STATE.is_symlink():raise RuntimeError("Unsafe active V3 pointer")
    pointer=json.loads(STATE.read_text())
    corpus=pointer.get("corpus_id")
    if (not isinstance(corpus,str) or len(corpus)!=16
        or any(c not in "0123456789abcdef" for c in corpus)):
        raise RuntimeError("Malformed active V3 corpus ID")
    map_file=HOME/"state"/("s9-multivector-crop-map-v3-"+corpus+".json")
    if map_file.is_symlink() or not map_file.is_file():
        raise RuntimeError("V3 active source map missing")
    raw=map_file.read_bytes()
    if hashlib.sha256(raw).hexdigest()!=pointer.get("map_sha256"):
        raise RuntimeError("Active V3 map checksum invalid")
    doc=json.loads(raw)
    rows=doc.get("rows")
    if not isinstance(rows,list) or len(rows)<58:
        raise RuntimeError("Active V3 archive references incomplete")
    clip=rows[0].get("clip") if isinstance(rows[0],dict) else None
    if not isinstance(clip,str) or not clip.startswith("motion_") or not clip.endswith(".mp4"):
        raise RuntimeError("Invalid active V3 sample name")
    return clip

def main():
    arg=argparse.ArgumentParser()
    arg.add_argument("--apply",action="store_true")
    opts=arg.parse_args()
    if shutil.disk_usage(HOME).free<40*1024*1024:
        raise RuntimeError("C720P disk reserve inadequate for safe rollback")
    if any(path.is_symlink() for path in (PROXY,MODULE,STATE)):
        raise RuntimeError("Unsafe Security service or module symlink")
    if not PROXY.is_file():
        raise RuntimeError("Verified S9 archive metadata proxy missing")
    if command("systemctl","--user","is-active",SERVICE)!="active":
        raise RuntimeError("Existing Security metadata service not healthy")
    source=fetch(SOURCE,150000)
    if github_blob_sha(source)!=BLOB:
        raise RuntimeError("Git-pinned appearance V3 API source SHA mismatch")
    if (b'appearance-multivector-v3' not in source or
        b'untrusted_v3_active_snapshot' not in source or
        b'identity_probability' not in source):
        raise RuntimeError("Pinned V3 module contract incomplete")
    before_sd,before_drive=snapshot_catalogs()
    previous=PROXY.read_bytes();proxy_meta=PROXY.stat()
    old_module=MODULE.read_bytes() if MODULE.exists() else None
    module_meta=MODULE.stat() if MODULE.exists() else None
    txt=previous.decode("utf-8")
    if ADD in txt:patched=previous
    elif txt.count(HOOK)==1:patched=txt.replace(HOOK,ADD,1).encode()
    else:raise RuntimeError("Exact prior V1/V2 archive handler hook missing")
    sample=sample_from_verified_pointer()
    print("S9_V3_READONLY_API_DEPLOY_PREFLIGHT "+json.dumps({
        "s9_originals":len(before_sd),
        "drive_originals":len(before_drive),
        "pinned_module_blob":BLOB,
        "module_change_required":old_module!=source,
        "proxy_hook_change_required":patched!=previous,
        "has_active_verified_v3_pointer":sample is not None,
        "camera_apk_modified":False,
        "review_decisions_modified":False}),flush=True)
    if not opts.apply:return
    now=datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup=BACK/now
    backup.mkdir(mode=0o700,parents=True,exist_ok=False)
    for name,data in (("proxy.original",previous),("module.original",old_module)):
        if data is None:continue
        with (backup/name).open("xb") as f:
            f.write(data);f.flush();os.fsync(f.fileno())
        os.chmod(backup/name,0o600)
    touched=[]
    try:
        if PROXY.read_bytes()!=previous or (MODULE.read_bytes() if MODULE.exists() else None)!=old_module:
            raise RuntimeError("Concurrent archive proxy update detected")
        if old_module!=source:
            atomic(MODULE,source,module_meta);touched.append("module")
        if patched!=previous:
            atomic(PROXY,patched,proxy_meta);touched.append("proxy")
        command("python3","-m","py_compile",str(PROXY),str(MODULE))
        if touched:
            command("systemctl","--user","restart",SERVICE)
        status=None
        for _ in range(15):
            try:status=accept(sample);break
            except Exception:time.sleep(1)
        if status is None:raise RuntimeError("Read-only V3 postrestart acceptance failed")
        after_sd,after_drive=snapshot_catalogs()
        if not before_sd.issubset(after_sd) or not before_drive.issubset(after_drive):
            raise RuntimeError("Existing historical or current recordings disappeared")
        if PROXY.read_bytes()!=patched or MODULE.read_bytes()!=source:
            raise RuntimeError("Live V3 hook unexpectedly changed")
        print("S9_V3_READONLY_API_DEPLOY_VERIFIED "+json.dumps({
            "status":status,"sd_originals":len(after_sd),
            "drive_originals":len(after_drive),"backup":str(backup),
            "v1_v2_routes_replaced":False,
            "camera_apk_modified":False,
            "videos_or_reviews_modified":False}),flush=True)
    except BaseException:
        if "proxy" in touched:atomic(PROXY,previous,proxy_meta)
        if "module" in touched:
            if old_module is None:MODULE.unlink(missing_ok=True)
            else:atomic(MODULE,old_module,module_meta)
        if touched:
            try:command("systemctl","--user","restart",SERVICE)
            except Exception:print("S9_V3_ROLLBACK_RESTART_MANUAL_CHECK_REQUIRED",flush=True)
        print("S9_V3_READONLY_API_DEPLOY_ROLLED_BACK",flush=True)
        raise

if __name__=="__main__":main()
