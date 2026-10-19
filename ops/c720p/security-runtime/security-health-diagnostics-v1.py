#!/usr/bin/env python3
"""Private, read-only Security S9/C720P service health summary.

Never writes camera, media, reviews, person dossiers, lighting or remote systems.
No S3 bedroom data. No secret or hostname appears in the resulting report.
Do not confuse warnings with automatically repaired conditions.
"""
import datetime as dt
import email.utils
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import time
import urllib.request

STATE=Path("/home/jespern/c720p-home-hub/state")
OUT=STATE/"security-health-diagnostics-v1.json"
PHONE_STATUS="http://127.0.0.1:18808/status"
CLOCK_URL="https://www.cloudflare.com/"
VERSION="c720p_s9_security_health_v1"

def safe_json(path,maximum=2_000_000):
    try:
        path=Path(path)
        if path.is_symlink() or not path.is_file() or not 2<path.stat().st_size<maximum:
            return None
        d=json.loads(path.read_bytes())
        return d if isinstance(d,dict) else None
    except (OSError,ValueError,TypeError):
        return None

def utc(value):
    try:
        value=dt.datetime.fromisoformat(value)
        return value if value.tzinfo else None
    except (TypeError,ValueError):
        return None

def ntp_state():
    try:
        p=subprocess.run(["timedatectl","show","-p","NTP","-p","NTPSynchronized","-p","CanNTP"],
                         capture_output=True,text=True,timeout=8)
        if p.returncode:return None
        return dict(line.split("=",1) for line in p.stdout.splitlines() if "=" in line)
    except (OSError,subprocess.TimeoutExpired):
        return None

def https_clock_offset():
    """Best-effort HTTPS Date remote-minus-hub estimate; no clock changes."""
    def parse_offset(value,start,finish):
        if not value or finish-start>6:return None
        try:
            date=email.utils.parsedate_to_datetime(value)
            if date is None or date.tzinfo is None:return None
            return round(date.timestamp()-(start+finish)/2,1)
        except (ValueError,TypeError,AttributeError):
            return None
    try:
        request=urllib.request.Request(CLOCK_URL,method="HEAD")
        start=time.time()
        with urllib.request.urlopen(request,timeout=7) as response:
            header=response.headers.get("Date")
        result=parse_offset(header,start,time.time())
        if result is not None:return result
    except (ValueError,OSError,TypeError,TimeoutError,AttributeError):
        pass
    # Some systems' Python TLS store or HTTP proxy refuses HEAD; the hub's
    # existing curl command succeeds and is independently bounded here.
    try:
        start=time.time()
        process=subprocess.run(["curl","-fILsS","--max-time","8",CLOCK_URL],
                               capture_output=True,text=True,timeout=10)
        finish=time.time()
        if process.returncode or len(process.stdout)>65536:return None
        dates=[line.split(":",1)[1].strip() for line in process.stdout.splitlines()
               if line.lower().startswith("date:")]
        return parse_offset(dates[-1],start,finish) if dates else None
    except (OSError,subprocess.TimeoutExpired):
        return None

def camera_status():
    try:
        with urllib.request.urlopen(PHONE_STATUS,timeout=7) as r:
            raw=r.read(200_001)
        if len(raw)>200_000:return None
        d=json.loads(raw)
        return d if isinstance(d,dict) else None
    except (OSError,TimeoutError,ValueError):
        return None

def evaluate(*,now,root_free_bytes,root_total_bytes,phone,catalog,activity,ledger,ntp,skew_seconds):
    if now.tzinfo is None:raise ValueError("aware_clock_required")
    issues=[]
    def warn(code,severity):
        issues.append({"code":code,"severity":severity})
    camera_ok=isinstance(phone,dict) and phone.get("ok") is True and \
        phone.get("native_4k_enabled") is True and \
        phone.get("continuous_4k_ready") is True and \
        phone.get("continuous_4k_dropped_output_frames")==0 and \
        phone.get("mode") in ("watching","recording")
    if not camera_ok:warn("s9_capture_not_confirmed_healthy","critical")
    if root_free_bytes<2*1024**3 or root_free_bytes/max(root_total_bytes,1)<0.10:
        warn("c720p_root_space_low","warning")
    if ntp is None or ntp.get("NTPSynchronized")!="yes":
        warn("c720p_ntp_unsynchronized","warning")
    if skew_seconds is None:warn("external_clock_offset_unknown","info")
    elif abs(skew_seconds)>30:warn("c720p_clock_offset_exceeds_30_seconds","warning")
    src_ok=isinstance(catalog,dict) and catalog.get("source")=="S9_native_microSD_sidecar_metadata" and catalog.get("read_only") is True
    cat_count=catalog.get("recordings") if src_ok else None
    cat_time=utc(catalog.get("generated_at_utc")) if src_ok else None
    age=(now-cat_time).total_seconds() if cat_time else None
    if not src_ok or type(cat_count) is not int or cat_count<1 or age is None or not -180<=age<=600:
        warn("s9_catalog_unavailable_or_stale","warning")
    source=activity.get("source_recordings") if isinstance(activity,dict) else None
    active_total=activity.get("total_recordings") if isinstance(activity,dict) else None
    activity_ok=(isinstance(source,dict) and type(active_total) is int
       and type(source.get("s9_microSD")) is int
       and type(source.get("historical_drive_verified_new")) is int
       and active_total==source["s9_microSD"]+source["historical_drive_verified_new"]
       and activity.get("media_decoded") is False and activity.get("s3_excluded") is True)
    if not activity_ok:warn("s9_drive_activity_unavailable","warning")
    if activity_ok and type(cat_count) is int and source["s9_microSD"]!=cat_count:
        warn("combined_activity_catalog_count_mismatch","warning")
    checks=ledger.get("checks") if isinstance(ledger,dict) else None
    if not isinstance(checks,dict):warn("original_integrity_ledger_unavailable","warning")
    covered=sum(isinstance(x,dict) and x.get("original_sha256_matches") is True for x in checks.values()) if isinstance(checks,dict) else 0
    mismatches=sum(isinstance(x,dict) and x.get("original_sha256_matches") is False for x in checks.values()) if isinstance(checks,dict) else 0
    if mismatches:warn("original_sha256_mismatches_require_review","critical")
    elif type(cat_count) is int and covered<cat_count:
        warn("original_integrity_audit_incomplete","info")
    companion=(catalog or {}).get("auxiliary_mp4_inventory") if src_ok else None
    orphan=companion.get("preroll_without_verified_primary") if isinstance(companion,dict) else None
    if type(orphan) is int and orphan>0:warn("unpaired_preroll_evidence_pending_classification","info")
    severity="critical" if any(x["severity"]=="critical" for x in issues) else "warning" if any(x["severity"]=="warning" for x in issues) else "healthy"
    return {
      "schema_version":VERSION,"generated_at_utc":now.isoformat(),
      "overall_status":severity,
      "checks":{"s9_native_4k_capture_healthy":camera_ok,
         "root_available_bytes":root_free_bytes,
         "root_total_bytes":root_total_bytes,
         "ntp_synchronized":(ntp or {}).get("NTPSynchronized")=="yes",
         "external_clock_minus_hub_seconds":skew_seconds,
         "s9_catalog_recordings":cat_count if type(cat_count) is int else None,
         "s9_catalog_age_seconds":round(age) if age is not None else None,
         "combined_verified_recording_count":active_total if activity_ok else None,
         "original_digest_matches":covered,
         "original_digest_mismatches":mismatches,
         "unpaired_preroll_segments":orphan if type(orphan) is int else None,
         "original_integrity_coverage_complete":type(cat_count) is int and covered==cat_count and mismatches==0},
      "issues":issues,
      "s3_included":False,
      "originals_modified":False,"manual_reviews_modified":False,
      "automations_modified":False,"clock_changed":False,"data_uses_existing_local_metadata_only":True
    }

def atomic_write(path,report):
    path.parent.mkdir(parents=True,exist_ok=True)
    if path.is_symlink():raise ValueError("unsafe_health_output_symlink")
    raw=(json.dumps(report,sort_keys=True,separators=(",",":"))+"\n").encode()
    if len(raw)>16_384:raise ValueError("unbounded_health_report")
    fd,tmp=tempfile.mkstemp(prefix=".security-health-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as output:
            output.write(raw);output.flush();os.fsync(output.fileno())
        os.chmod(tmp,0o600);os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def main():
    disk=shutil.disk_usage("/")
    result=evaluate(
       now=dt.datetime.now(dt.timezone.utc),
       root_free_bytes=disk.free,root_total_bytes=disk.total,
       phone=camera_status(),
       catalog=safe_json(STATE/"s9-standalone-archive-summary-v1.json"),
       activity=safe_json(STATE/"security-s9-drive-activity-v1.json"),
       ledger=safe_json(STATE/"s9-original-hash-ledger-v1.json"),
       ntp=ntp_state(),skew_seconds=https_clock_offset())
    atomic_write(OUT,result)
    print("SECURITY_HEALTH_DIAGNOSTICS_V1 "+json.dumps({
       "status":result["overall_status"],
       "issues":[x["code"] for x in result["issues"]],
       "capture_healthy":result["checks"]["s9_native_4k_capture_healthy"],
       "root_available_bytes":result["checks"]["root_available_bytes"],
       "original_digest_matches":result["checks"]["original_digest_matches"],
       "recordings":result["checks"]["s9_catalog_recordings"]},sort_keys=True))

if __name__=="__main__":main()
