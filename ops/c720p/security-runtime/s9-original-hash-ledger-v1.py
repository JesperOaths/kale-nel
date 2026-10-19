#!/usr/bin/env python3
"""Low-duty original MP4 SHA-256 comparison performed ON the S9+.

Never copies video, mutates review decisions, deletes/quarantines source media
or competes with recording. One verified original per invocation, and a phone
loopback capture/thermal gate interrupts the digest when the camera is busy.
"""
import datetime as dt
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile

import phone_archive_catalog_v1 as catalog

STATE=Path("/home/jespern/c720p-home-hub/state/s9-original-hash-ledger-v1.json")
DEX=Path("/home/jespern/c720p-home-hub/build/s9-original-hash-217c83770150/dex/classes.dex")
EXPECTED_DEX_SHA="750e69cb56b1885032ddfeec6f8903b3d3dd3d7460ecdeee10a25bf2a11417ec"
PHONE="192.168.178.250:5555"
REMOTE_DEX="/data/local/tmp/c720p-s9-original-audit-217c8377.dex"
FOLDER="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
MARK="S9_STANDALONE_ORIGINAL_SHA256 "
VERSION="s9-original-hash-ledger-v1"
MAX_ITEMS=2000
RECHECK=7*86400

class Deferred(RuntimeError):
    pass

def read_state(path):
    try:
        if path.is_symlink() or not 2<path.stat().st_size<1024*1024:
            raise Deferred("unsafe_existing_integrity_state")
        data=json.loads(path.read_bytes())
        if data.get("schema_version")!=VERSION or not isinstance(data.get("checks"),dict):
            raise Deferred("unsupported_integrity_ledger_version")
        rows=data["checks"]
        if len(rows)>MAX_ITEMS or any(not catalog.NAME.fullmatch(k) for k in rows):
            raise Deferred("invalid_integrity_ledger_names")
        return data
    except FileNotFoundError:
        return {"schema_version":VERSION,"checks":{}}

def choose(snapshot,previous,now):
    available=[]
    for name,entry in snapshot.get("records",{}).items():
        if not catalog.NAME.fullmatch(name):continue
        version=entry.get("version")
        if not isinstance(version,str) or not re.fullmatch(r"[a-f0-9]{64}",version):
            raise Deferred("unexpected_catalog_version")
        old=previous.get(name,{})
        t=old.get("checked_epoch",0)
        if old.get("catalog_version")==version and type(t) in (int,float) and 0<=now-t<RECHECK:
            continue
        available.append((t if isinstance(t,(int,float)) else 0,name,entry))
    if not available:return None
    available.sort(key=lambda item:(item[0],item[1]))
    return available[0][1],available[0][2]

def phone_audit(name,entry,dex=DEX):
    if not catalog.NAME.fullmatch(name):
        raise Deferred("untrusted_integrity_filename")
    if dex.is_symlink() or not dex.is_file() or not 1000<dex.stat().st_size<1000000:
        raise Deferred("invalid_integrity_worker")
    if hashlib.sha256(dex.read_bytes()).hexdigest()!=EXPECTED_DEX_SHA:
        raise Deferred("integrity_worker_digest_mismatch")
    pushed=subprocess.run(["adb","-s",PHONE,"push",str(dex),REMOTE_DEX],
                          capture_output=True,timeout=30)
    if pushed.returncode:raise Deferred("phone_copy_unavailable")
    script="CLASSPATH="+REMOTE_DEX+" app_process /system/bin nl.kalenel.s9security.PhoneArchiveIntegrityCli "+FOLDER+" "+name
    output=subprocess.run(["adb","-s",PHONE,"shell",script],
                          capture_output=True,timeout=125)
    if output.returncode:raise Deferred("phone_capture_priority_or_hash_unavailable")
    return validate_phone_reply(output.stdout,name,entry)

def validate_phone_reply(raw,name,entry):
    if len(raw)>8192:raise Deferred("unbounded_integrity_reply")
    lines=[s[len(MARK):] for s in raw.decode("UTF-8").splitlines() if s.startswith(MARK)]
    if len(lines)!=1:raise Deferred("missing_integrity_reply")
    data=json.loads(lines[0])
    matched=data.get("sha256_matches_verified_manifest")
    if (data.get("ok") is not True or data.get("schema_version")!="s9_original_sha256_readonly_v1"
        or data.get("clip")!=name or type(matched) is not bool
        or type(data.get("checked_bytes")) is not int or data["checked_bytes"]!=entry["bytes"]
        or data.get("source")!="S9_microSD_original_4k"
        or data.get("read_only") is not True or data.get("video_copied_to_hub") is not False
        or data.get("media_deleted_or_quarantined") is not False
        or data.get("manual_review_modified") is not False
        or data.get("result")!=("digest_match" if matched else "digest_mismatch_needs_manual_investigation")):
        raise Deferred("untrusted_integrity_reply")
    return matched


def save_state(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.is_symlink():raise Deferred("integrity_state_symlink")
    raw=(json.dumps(value,sort_keys=True,separators=(",",":"))+"\n").encode()
    if len(raw)>1024*1024:raise Deferred("integrity_ledger_full")
    fd,tmp=tempfile.mkstemp(prefix=".s9-original-digest-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as stream:
            stream.write(raw);stream.flush();os.fsync(stream.fileno())
        os.chmod(tmp,0o600);os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def run(state=STATE,now=None):
    state=Path(state)
    state.parent.mkdir(parents=True,exist_ok=True)
    with state.with_suffix(".lock").open("a+") as guard:
        try:fcntl.flock(guard,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print("S9_ORIGINAL_DIGEST_DEFERRED locked");return "deferred"
        ledger=read_state(state)
        try:snapshot=catalog.load_catalog()
        except (catalog.Unavailable,ValueError,OSError) as error:
            print("S9_ORIGINAL_DIGEST_DEFERRED catalog",type(error).__name__);return "deferred"
        moment=(now or dt.datetime.now(dt.timezone.utc)).timestamp()
        pick=choose(snapshot,ledger["checks"],moment)
        if pick is None:
            print("S9_ORIGINAL_DIGEST_UP_TO_DATE",len(snapshot["records"]));return "fresh"
        name,entry=pick
        try:matched=phone_audit(name,entry)
        except (Deferred,subprocess.TimeoutExpired,ValueError,OSError) as error:
            print("S9_ORIGINAL_DIGEST_DEFERRED phone",type(error).__name__);return "deferred"
        checks=dict(ledger["checks"])
        if name not in checks and len(checks)>=MAX_ITEMS:raise Deferred("integrity_ledger_full")
        checks[name]={"catalog_version":entry["version"],"checked_epoch":moment,
                      "original_sha256_matches":matched}
        report={"schema_version":VERSION,"checks":checks,"last_check_utc":
                dt.datetime.fromtimestamp(moment,dt.timezone.utc).isoformat(),
                "checked_matching":sum(x.get("original_sha256_matches") is True for x in checks.values()),
                "mismatches_needing_review":sum(x.get("original_sha256_matches") is False for x in checks.values()),
                "phone_catalog_recordings":len(snapshot["records"]),
                "originals_modified":False,"review_decisions_modified":False,
                "videos_transferred_to_hub":False,"automatic_quarantine":False}
        save_state(state,report)
        print("S9_ORIGINAL_DIGEST_RECORDED",json.dumps({
          "matched":matched,"checked_matching":report["checked_matching"],
          "mismatches_needing_review":report["mismatches_needing_review"],
          "catalog_recordings":len(snapshot["records"])}))
        return "match" if matched else "mismatch"

if __name__=="__main__":
    run()
