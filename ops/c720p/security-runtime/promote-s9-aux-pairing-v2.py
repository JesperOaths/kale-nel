#!/usr/bin/env python3
"""Guarded persistent S9 auxiliary-pairing catalog promotion.

Only replaces the hub's standalone metadata adapter and adds a higher-priority
systemd drop-in for the already staged isolated DEX. Preserves Camera2 APK,
original videos, human reviews, archive relay, other units and retention rules.
"""
import argparse
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import subprocess
import tempfile
import time
import urllib.request

HOME=Path("/home/jespern/c720p-home-hub")
BIN=HOME/"bin/s9_standalone_phone_catalog_v1.py"
STATE=HOME/"state"
CATALOG=STATE/"s9-standalone-archive-catalog-v1.json"
SUMMARY=STATE/"s9-standalone-archive-summary-v1.json"
DEX=HOME/"build/s9-aux-pairing-2d1be711-20261019/dex/classes.dex"
DROPIN=Path("/home/jespern/.config/systemd/user/c720p-s9-standalone-catalog.service.d/zz-auxiliary-pairing-v2.conf")
EXISTING_DROPIN=DROPIN.with_name("auxiliary-inventory-v1.conf")
BACKUPS=HOME/"backups/s9-aux-pairing-v2"
LOCK=STATE/".s9-aux-pairing-v2-promotion.lock"
BASE="c720p-s9-standalone-catalog"
TIMER=BASE+".timer"
SERVICE=BASE+".service"
OLD_SCRIPT_BLOB="2f2b20e47f058802286143639131b709d9a7e9ad"
NEW_SCRIPT_BLOB="b8605b74600751b2640224662f760cce56dae0c8"
DEX_SHA256="f3916621cf2fd3dbc6eb95675e4f890d1172adf47915bd9f174bed26c113518f"
EXISTING_DROPIN_SHA256="5623676832c3d7012176a9cb06cfd8db34a75cd62162c5de81197e53f0556f65"
SOURCE=("https://raw.githubusercontent.com/JesperOaths/kale-nel/"
        "2d1be711a7db4716a4a2f9381bef9fddc49c9b6b/"
        "ops/c720p/security-runtime/s9_standalone_phone_catalog_v1.py")
DROPIN_TEXT=("[Service]\nExecStart=\nExecStart=/usr/bin/python3 "
             +str(BIN)+" --dex "+str(DEX)+" --dex-sha256 "+DEX_SHA256+" --apply\n").encode()

def blob(data):
    return hashlib.sha1(b"blob "+str(len(data)).encode()+bytes([0])+data).hexdigest()

def safe_read(p,limit=16_000_000):
    if p.is_symlink() or not p.is_file() or not 0<p.stat().st_size<=limit:
        raise ValueError("unsafe_source_file_"+p.name)
    return p.read_bytes()

def atomic(p,content,mode):
    p.parent.mkdir(parents=True,exist_ok=True)
    fd,name=tempfile.mkstemp(prefix=".aux-pairing-",dir=p.parent)
    try:
        with os.fdopen(fd,"wb") as f:
            os.fchmod(f.fileno(),mode)
            f.write(content);f.flush();os.fsync(f.fileno())
        os.replace(name,p)
    finally:
        if os.path.exists(name):os.unlink(name)

def system(*args,timeout=30):
    return subprocess.run(["systemctl","--user",*args],
                          capture_output=True,text=True,timeout=timeout,check=True)

def active(unit):
    return subprocess.run(["systemctl","--user","is-active","--quiet",unit],
                          capture_output=True).returncode==0

def camera():
    with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=8) as r:
        value=json.load(r)
    if not isinstance(value,dict) or value.get("ok") is not True or \
       value.get("mode") not in ("watching","recording") or \
       value.get("native_4k_enabled") is not True or \
       value.get("continuous_4k_ready") is not True or \
       value.get("continuous_4k_dropped_output_frames")!=0:
        raise RuntimeError("camera_capture_health_gate")
    return value

def validate_summary(b,previous_names):
    d=json.loads(b)
    x=d.get("auxiliary_mp4_inventory")
    required=("preroll_with_verified_primary","preroll_with_raw_unverified_primary",
              "preroll_without_any_primary",
              "completed_companion_with_verified_primary",
              "completed_companion_with_raw_unverified_primary",
              "completed_companion_without_any_primary",
              "partial_companion_with_verified_primary",
              "partial_companion_with_raw_unverified_primary",
              "partial_companion_without_any_primary")
    if not isinstance(x,dict) or not all(type(x.get(k)) is int and x[k]>=0 for k in required):
        raise RuntimeError("three_way_auxiliary_classification_missing")
    if (x.get("no_media_quarantined_or_deleted") is not True or
        x.get("auxiliary_pairing_is_filename_presence_only_not_media_integrity") is not True or
        sum(x[k] for k in required[:3])!=x.get("preroll_segments") or
        sum(x[k] for k in required[3:6])!=x.get("completed_companion_mp4_files") or
        sum(x[k] for k in required[6:])!=x.get("partial_completion_mp4_files")):
        raise RuntimeError("auxiliary_reconciliation_or_protection_failure")
    if d.get("recordings",0)<len(previous_names):
        raise RuntimeError("new_catalog_shrunk")
    return d,x

def promote(execute):
    incoming=urllib.request.urlopen(SOURCE,timeout=30).read(250_000)
    if blob(incoming)!=NEW_SCRIPT_BLOB:
        raise RuntimeError("pinned_adapter_source_hash_mismatch")
    compile(incoming,str(BIN),"exec")
    installed=safe_read(BIN,250_000)
    if blob(installed) not in (OLD_SCRIPT_BLOB,NEW_SCRIPT_BLOB):
        raise RuntimeError("concurrent_adapter_change")
    if hashlib.sha256(safe_read(DEX,1_000_000)).hexdigest()!=DEX_SHA256:
        raise RuntimeError("compiled_isolated_worker_digest_mismatch")
    if hashlib.sha256(safe_read(EXISTING_DROPIN,10_000)).hexdigest()!=EXISTING_DROPIN_SHA256:
        raise RuntimeError("underlying_unit_changed")
    if DROPIN.is_symlink():
        raise RuntimeError("unsafe_new_dropin")
    if DROPIN.exists() and safe_read(DROPIN,10_000)!=DROPIN_TEXT:
        raise RuntimeError("conflicting_higher_priority_override")
    was_active=active(TIMER)
    before=camera()
    old_catalog=safe_read(CATALOG)
    old_summary=safe_read(SUMMARY)
    previous_names=set(json.loads(old_catalog).get("records",{}))
    if not previous_names:
        raise RuntimeError("empty_original_catalog")
    if blob(installed)==NEW_SCRIPT_BLOB and DROPIN.exists():
        d,x=validate_summary(old_summary,previous_names)
        return {"action":"already_active","originals":d["recordings"],
                "unpaired_prerolls":x["preroll_without_any_primary"],
                "camera_before_c":before.get("temperature_c")}
    if not was_active:
        raise RuntimeError("catalog_timer_not_active")
    if not execute:
        return {"action":"preflight_only","originals":len(previous_names),
                "pending_script":NEW_SCRIPT_BLOB,"worker_digest":DEX_SHA256}
    stamp=dt.datetime.now(dt.timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
    backup=BACKUPS/stamp
    backup.mkdir(parents=True,mode=0o700,exist_ok=False)
    for name,raw in (("adapter-before.py",installed),
                     ("catalog-before.json",old_catalog),
                     ("summary-before.json",old_summary)):
        atomic(backup/name,raw,0o600)
    if DROPIN.exists():
        raise RuntimeError("promotion_dropin_exists_before_activation")
    changed=False
    old_mode=BIN.stat().st_mode&0o777
    try:
        system("stop",TIMER)
        end=time.monotonic()+130
        while active(SERVICE):
            if time.monotonic()>end:
                raise RuntimeError("previous_catalog_service_busy")
            time.sleep(1)
        if safe_read(BIN)!=installed or hashlib.sha256(safe_read(EXISTING_DROPIN,10_000)).hexdigest()!=EXISTING_DROPIN_SHA256:
            raise RuntimeError("source_changed_after_timer_pause")
        # Mark rollback scope before the first write: a second atomic step
        # can fail after the adapter was already replaced.
        changed=True
        atomic(BIN,incoming,old_mode)
        if DROPIN.exists():
            raise RuntimeError("concurrent_service_dropin_creation")
        atomic(DROPIN,DROPIN_TEXT,0o644)
        system("daemon-reload")
        system("start",SERVICE,timeout=165)
        after=camera()
        updated_catalog=json.loads(safe_read(CATALOG))
        if not previous_names.issubset(set(updated_catalog.get("records",{}))):
            raise RuntimeError("verified_original_missing_post_promote")
        result,aux=validate_summary(safe_read(SUMMARY),previous_names)
        if blob(safe_read(BIN,250_000))!=NEW_SCRIPT_BLOB or safe_read(DROPIN)!=DROPIN_TEXT:
            raise RuntimeError("adapter_or_unit_readback_mismatch")
        return {"action":"persistent_promotion_verified",
                "verified_originals":result["recordings"],
                "unpaired_prerolls":aux["preroll_without_any_primary"],
                "raw_unverified_prerolls":aux["preroll_with_raw_unverified_primary"],
                "completed_without_original":aux["completed_companion_without_any_primary"],
                "partials_without_original":aux["partial_companion_without_any_primary"],
                "camera_before_c":before.get("temperature_c"),
                "camera_after_c":after.get("temperature_c"),
                "camera_dropped_frames":after["continuous_4k_dropped_output_frames"],
                "backup":str(backup),"media_changed":False,
                "manual_reviews_changed":False,"camera_apk_changed":False}
    except BaseException:
        if changed:
            atomic(BIN,installed,old_mode)
            DROPIN.unlink(missing_ok=True)
            atomic(CATALOG,old_catalog,0o600)
            atomic(SUMMARY,old_summary,0o600)
            system("daemon-reload")
            print("S9_AUX_PAIRING_V2_ROLLED_BACK",flush=True)
        raise
    finally:
        if was_active:
            system("start",TIMER)

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--execute",action="store_true")
    opts=p.parse_args()
    LOCK.parent.mkdir(parents=True,exist_ok=True)
    with LOCK.open("a+") as guard:
        fcntl.flock(guard,fcntl.LOCK_EX|fcntl.LOCK_NB)
        d=promote(opts.execute)
        print("S9_AUX_PAIRING_V2_PERSISTENCE "+json.dumps(d,sort_keys=True),flush=True)

if __name__=="__main__":main()
