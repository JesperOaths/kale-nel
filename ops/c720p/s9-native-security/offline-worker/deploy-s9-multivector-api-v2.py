#!/usr/bin/env python3
"""Guarded separate authenticated S9 appearance V2 route, never v1 replacement.

Source-pinned module installed in C720P's existing archive proxy, routing
only GET /new/api/appearance-multivector-v2. The proxy's old API, folder
operations and all human reviews remain unchanged. Atomic backups/rollback.
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
import urllib.parse
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
PROXY=HOME/"bin/s9_sd_proxy_extension.py"
MODULE=HOME/"bin/s9_multivector_appearance_api_v2.py"
MAP=HOME/"state/s9-multivector-crop-map-v2.json"
BACK=HOME/"backups/s9-uniform-appearance-api-v2"
MODEL="ee5717ad7a90cf0c915afa1fb6a5399b966562c5d42aa6f4a0c6c84a5349e47d"
SRC="https://raw.githubusercontent.com/JesperOaths/kale-nel/620b9163640ecb659745df7e0df951bb16346b3b/ops/c720p/s9-person-ml-v1/s9_multivector_appearance_api_v2.py"
HOOK=" s9_multivector_appearance_api.install(H)\n"
NEW=HOOK+" import s9_multivector_appearance_api_v2\n s9_multivector_appearance_api_v2.install(H)\n"
URL="http://127.0.0.1:8795"


def fetch(url,max_bytes=6000000):
    with urllib.request.urlopen(url,timeout=28) as r:
        if r.status!=200:raise RuntimeError("Required source unavailable")
        data=r.read(max_bytes+1)
    if len(data)>max_bytes:raise RuntimeError("Source exceeded response limit")
    return data


def cmd(*args):
    p=subprocess.run(args,capture_output=True,text=True,timeout=70)
    if p.returncode:
        raise RuntimeError("Service action failed "+args[0]+": "+p.stderr[-160:])
    return p.stdout.strip()


def atomic(path,content,meta):
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix=".appearance-v2-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as f:
            f.write(content);f.flush();os.fsync(f.fileno())
        os.chmod(tmp,stat.S_IMODE(meta.st_mode) if meta else 0o600)
        if meta:
            try:os.chown(tmp,meta.st_uid,meta.st_gid)
            except PermissionError:pass
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)


def snapshots():
    sd=json.loads(fetch(URL+"/new/api/saved"))
    drive=json.loads(fetch(URL+"/new/api/drive-saved"))
    names={x.get("clip_no") for x in sd.get("events",[])
           if isinstance(x,dict) and isinstance(x.get("clip_no"),str)}
    saved={str(x.get("remote_name") or x.get("clip_no")) for x in drive.get("events",[])
           if isinstance(x,dict)}
    if len(names)<175 or len(saved)<94:
        raise RuntimeError("Existing primary S9/Drive catalogs incomplete")
    return names,saved


def validate_map():
    if MAP.is_symlink() or not MAP.is_file() or MAP.stat().st_size>180000:
        raise RuntimeError("Private v2 map missing")
    doc=json.loads(MAP.read_text())
    if (doc.get("schema")!="s9_multivector_source_map_v2"
        or doc.get("visual_model_sha256")!=MODEL
        or doc.get("color_histogram_schema")!="s9_uniform_upper_torso_hsv32_v2"
        or doc.get("people_assigned_automatically")!=0
        or len(doc.get("rows",[]))!=57):
        raise RuntimeError("Uniform v2 map integrity invalid")
    from collections import Counter
    groups=Counter(r.get("cohort") for r in doc["rows"])
    if groups!={"approved_new":6,"v40":51}:
        raise RuntimeError("Missing new and historical crop references")
    clips={r["clip"] for r in doc["rows"] if r.get("source")=="s9_sd"}
    if len(clips)<2:raise RuntimeError("No independent originals")
    return sorted(clips)


def audit(clip):
    route="/new/api/appearance-multivector-v2?clip="+urllib.parse.quote(clip,safe="")
    doc=json.loads(fetch(URL+route,250000))
    if (doc.get("ok") is not True or
        doc.get("ranking_schema")!="s9_appearance_rankings_v2" or
        doc.get("color_histogram_schema")!="s9_uniform_upper_torso_hsv32_v2"
        or doc.get("model_sha256")!=MODEL
        or doc.get("appearance_only") is not True
        or doc.get("verified_same_person") is not False
        or doc.get("identity_probability") is not False
        or doc.get("automatic_person_assignments")!=0
        or doc.get("human_review_required") is not True
        or doc.get("coverage",{}).get("real_person_crops")!=57
        or not isinstance(doc.get("results"),list)
        or not doc["results"]):
        raise RuntimeError("Live authenticated uniform v2 score unavailable")
    for hit in doc["results"]:
        if hit.get("method")!="visual_75_color_25":
            raise RuntimeError("Unsupported structural alignment asserted")
    return len(doc["results"])


def main():
    p=argparse.ArgumentParser()
    p.add_argument("--apply",action="store_true")
    args=p.parse_args()
    if shutil.disk_usage(HOME).free<40*1024*1024:
        raise RuntimeError("C720P safe free-disk threshold not met")
    if any(x.is_symlink() for x in (PROXY,MODULE,MAP)):
        raise RuntimeError("Unsafe symlink in private API")
    if not PROXY.is_file():raise RuntimeError("Current archive proxy missing")
    source=fetch(SRC,120000)
    if (b's9_appearance_rankings_v2' not in source or
        b's9_uniform_upper_torso_hsv32_v2' not in source or
        b'verified_same_person' not in source):
        raise RuntimeError("Source-pinned module contract failed")
    clips=validate_map()
    sd,drive=snapshots()
    if not set(clips).issubset(sd):
        raise RuntimeError("V2 source keys not backed by saved original")
    previous=PROXY.read_bytes();proxy_meta=PROXY.stat()
    prior_module=MODULE.read_bytes() if MODULE.exists() else None
    module_meta=MODULE.stat() if MODULE.exists() else None
    txt=previous.decode("utf-8")
    if NEW in txt:
        patched=previous
    elif txt.count(HOOK)==1:
        patched=txt.replace(HOOK,NEW,1).encode()
    else:raise RuntimeError("Old source-qualified API hook missing or mutated")
    print("S9_UNIFORM_MULTIVECTOR_API_V2_PREFLIGHT "+
          json.dumps({"real_crops":57,"source_qualified_originals":len(clips),
             "source_sha256":hashlib.sha256(source).hexdigest(),
             "existing_primary_sd":len(sd),"existing_drive":len(drive),
             "proxy_edit_required":patched!=previous,
             "original_reviews_modified":False,"camera_apk_modified":False}),flush=True)
    if not args.apply:return
    backup=BACK/datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup.mkdir(mode=0o700,parents=True,exist_ok=False)
    for name,value in (("proxy.original",previous),("module.original",prior_module)):
        if value is None:continue
        path=backup/name
        with path.open("xb") as f:
            f.write(value);f.flush();os.fsync(f.fileno())
        os.chmod(path,0o600)
    touched=[]
    try:
        if PROXY.read_bytes()!=previous:raise RuntimeError("Concurrent proxy edit")
        if prior_module!=source:
            atomic(MODULE,source,module_meta);touched.append("module")
        if previous!=patched:
            atomic(PROXY,patched,proxy_meta);touched.append("proxy")
        cmd("python3","-m","py_compile",str(MODULE),str(PROXY))
        cmd("systemctl","--user","restart","c720p-drive-security-archive.service")
        ready=None
        for _ in range(15):
            try:ready=audit(clips[0]);break
            except Exception:time.sleep(1)
        if ready is None:raise RuntimeError("New read-only route unavailable")
        after_sd,after_drive=snapshots()
        if not sd.issubset(after_sd) or not drive.issubset(after_drive):
            raise RuntimeError("Previously indexed SD/Drive originals disappeared")
        if PROXY.read_bytes()!=patched or MODULE.read_bytes()!=source:
            raise RuntimeError("Live API files diverged from pinned source")
        print("S9_UNIFORM_MULTIVECTOR_API_V2_LIVE_VERIFIED "+
              json.dumps({"crop_coverage":57,"first_reference_matches":ready,
                          "sd_originals_after":len(after_sd),
                          "drive_originals_after":len(after_drive),
                          "backup":str(backup),
                          "v1_api_overwritten":False,
                          "video_or_review_data_changed":False,
                          "camera_apk_modified":False}),flush=True)
    except BaseException:
        if "proxy" in touched:atomic(PROXY,previous,proxy_meta)
        if "module" in touched:
            if prior_module is None:MODULE.unlink(missing_ok=True)
            else:atomic(MODULE,prior_module,module_meta)
        try:cmd("systemctl","--user","restart","c720p-drive-security-archive.service")
        except Exception:print("S9_UNIFORM_V2_ROLLBACK_MANUAL_RESTART_NEEDED",flush=True)
        print("S9_UNIFORM_V2_API_ROLLED_BACK",flush=True)
        raise


if __name__=="__main__":main()
