#!/usr/bin/env python3
"""Slow, private reconciliation of S9 original-video digests.

One phone-side SHA-256 comparison per invocation, never transfers MP4/JPEG
bytes to C720P, never deletes/quarantines anything or changes manual reviews.
A failed camera/phone call only defers. The old index and status are retained.
"""
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import re
import tempfile
import urllib.error
import urllib.parse
import urllib.request

try:
    import phone_archive_catalog_v1 as catalog
except ImportError:
    from pathlib import Path as _Path
    import sys as _sys
    _sys.path.insert(0,str(_Path(__file__).resolve().parent))
    import phone_archive_catalog_v1 as catalog

STATE=Path("/home/jespern/c720p-home-hub/state/s9-original-integrity-v1.json")
ENDPOINT="http://127.0.0.1:18808/archive/integrity?clip="
VERSION="s9_sha256_archive_reconcile_v1"
NAME=re.compile(r"motion_[0-9]{13}[.]mp4\Z")
DIGEST=re.compile(r"[a-f0-9]{64}\Z")
RETENTION_SECONDS=7*24*60*60
MAX_RESULTS=2000

def now():
    return dt.datetime.now(dt.timezone.utc)

def _state(path):
    try:
        if path.is_symlink() or path.stat().st_size>2*1024*1024:
            raise ValueError("unsafe_or_oversized_state")
        data=json.loads(path.read_bytes())
        if data.get("schema_version")!=VERSION or not isinstance(data.get("checks"),dict):
            raise ValueError("state_version")
        checks=data["checks"]
        if len(checks)>MAX_RESULTS or any(not NAME.fullmatch(k) for k in checks):
            raise ValueError("state_invalid_keys")
        return data
    except FileNotFoundError:
        return {"schema_version":VERSION,"checks":{}}

def _write(path,value):
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.is_symlink():raise ValueError("state_symlink")
    raw=(json.dumps(value,sort_keys=True,separators=(",",":"))+"\n").encode()
    if len(raw)>2*1024*1024:raise ValueError("state_too_large")
    fd,name=tempfile.mkstemp(prefix=".s9-integrity-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as out:
            out.write(raw);out.flush();os.fsync(out.fileno())
        os.chmod(name,0o600);os.replace(name,path)
    finally:
        if os.path.exists(name):os.unlink(name)

def select_one(snapshot,checks,at):
    """Never classify missing entries as deleted and never overwrite review data."""
    eligible=[]
    for name,entry in snapshot["records"].items():
        if not NAME.fullmatch(name):continue
        old=checks.get(name,{})
        if old.get("catalog_version")==entry["version"] and old.get("checked_at_utc"):
            try:
                last=dt.datetime.fromisoformat(old["checked_at_utc"])
                if last.tzinfo and (at-last).total_seconds()<RETENTION_SECONDS:
                    continue
            except (ValueError,TypeError):pass
        eligible.append((old.get("checked_at_utc") or "",name,entry))
    if not eligible:return None
    eligible.sort(key=lambda x:(x[0],x[1]))
    return eligible[0][1],eligible[0][2]

def inspect(name,entry):
    if not NAME.fullmatch(name) or not isinstance(entry,dict):raise ValueError("invalid_source")
    query=ENDPOINT+urllib.parse.quote(name,safe="")
    try:
        with urllib.request.urlopen(query,timeout=135) as response:
            raw=response.read(8192+1)
        if len(raw)>8192:raise ValueError("integrity_response_too_large")
        result=json.loads(raw)
    except (urllib.error.URLError,TimeoutError) as problem:
        raise catalog.Unavailable("phone_integrity_deferred") from problem
    if (not isinstance(result,dict) or result.get("ok") is not True
        or result.get("schema_version")!="s9_original_sha256_readonly_v1"
        or result.get("clip")!=name or type(result.get("checked_bytes")) is not int
        or result["checked_bytes"]!=entry["bytes"]
        or type(result.get("sha256_matches_verified_manifest")) is not bool
        or result.get("source")!="S9_microSD_original_4k"
        or result.get("read_only") is not True
        or result.get("video_copied_to_hub") is not False
        or result.get("media_deleted_or_quarantined") is not False
        or result.get("manual_review_modified") is not False):
        raise ValueError("untrusted_integrity_report")
    matched=result["sha256_matches_verified_manifest"]
    if result.get("result")!=("digest_match" if matched else "digest_mismatch_needs_manual_investigation"):
        raise ValueError("inconsistent_integrity_result")
    return matched

def run_once(path=STATE):
    path=Path(path)
    path.parent.mkdir(parents=True,exist_ok=True)
    with path.with_suffix(".lock").open("a+") as guard:
        try:fcntl.flock(guard,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print("S9_ORIGINAL_INTEGRITY_DEFER_LOCKED",flush=True);return "deferred"
        previous=_state(path)
        try:snapshot=catalog.load_catalog()
        except (catalog.Unavailable,BlockingIOError) as problem:
            print("S9_ORIGINAL_INTEGRITY_DEFER_PHONE",type(problem).__name__,flush=True)
            return "deferred"
        if not snapshot["records"]:
            print("S9_ORIGINAL_INTEGRITY_NO_VERIFIED_PHONE_RECORDINGS",flush=True)
            return "deferred"
        chosen=select_one(snapshot,previous["checks"],now())
        if chosen is None:
            print("S9_ORIGINAL_INTEGRITY_FRESH",len(snapshot["records"]),flush=True)
            return "fresh"
        name,entry=chosen
        try:matched=inspect(name,entry)
        except (catalog.Unavailable,ValueError,urllib.error.HTTPError) as problem:
            # Camera busy, disconnected or inconsistent reply; preserve checks.
            print("S9_ORIGINAL_INTEGRITY_DEFER_RECHECK",type(problem).__name__,flush=True)
            return "deferred"
        checks=dict(previous["checks"])
        if len(checks)>=MAX_RESULTS and name not in checks:
            raise RuntimeError("integrity_state_full_no_results_discarded")
        checks[name]={"catalog_version":entry["version"],
                      "verified_sha256_matches":matched,
                      "checked_at_utc":now().isoformat()}
        next_data={"schema_version":VERSION,"checks":checks,
                   "catalog_snapshot_id":snapshot["snapshot_id"],
                   "last_check_utc":now().isoformat(),
                   "checked_count":sum(bool(x.get("verified_sha256_matches")) for x in checks.values()),
                   "mismatch_count":sum(x.get("verified_sha256_matches") is False for x in checks.values()),
                   "recordings_in_snapshot":len(snapshot["records"]),
                   "no_recordings_removed":True,"no_manual_reviews_changed":True,
                   "no_video_bytes_copied_to_hub":True}
        _write(path,next_data)
        print("S9_ORIGINAL_INTEGRITY_CHECK",json.dumps({"status":"match" if matched else "mismatch_for_manual_investigation",
            "checked_count":next_data["checked_count"],
            "mismatch_count":next_data["mismatch_count"],
            "total":len(snapshot["records"])}),flush=True)
        return "matched" if matched else "mismatch"

if __name__=="__main__":
    run_once()
