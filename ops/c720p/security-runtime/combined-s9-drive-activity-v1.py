#!/usr/bin/env python3
"""Private read-only Security activity: S9 microSD + verified NEW Drive clips.

Phone bins are computed directly on S9. Drive rows are metadata only:
the archive's naive timestamps are treated as local wall-clock times, NOT as
UTC instants or unique DST-offset-aware hours. No video, thumbnails, names,
face crops, person identity, or manual review data are copied into results.
"""
import collections
from datetime import datetime, timedelta, timezone
import json
import os
from pathlib import Path
import re
import tempfile

BASE=Path("/home/jespern/c720p-home-hub/state")
PHONE=BASE/"s9-standalone-archive-summary-v1.json"
DRIVE=BASE/"drive-security-archive.json"
RESULT=BASE/"security-s9-drive-activity-v1.json"
VERSION="security_s9_drive_activity_v1"
MAX_BYTES=16*1024*1024
MAX_STALENESS_SECONDS=600
DATE=re.compile(r"20\d{2}-\d{2}-\d{2}\Z")
PHONE_HOUR=re.compile(r"(20\d{2}-\d{2}-\d{2})T(0\d|1\d|2[0-3])([+-]\d{4})\Z")
LOCAL_STAMP=re.compile(r"20\d{2}-\d{2}-\d{2} (?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d\Z")

def read_object(path):
    if path.is_symlink() or not path.is_file() or not 2<path.stat().st_size<MAX_BYTES:
        raise ValueError("untrusted_source_path")
    item=json.loads(path.read_bytes())
    if not isinstance(item,dict):raise ValueError("source_not_object")
    return item

def day_of(time):
    if time.hour<6:time-=timedelta(days=1)
    return time.date().isoformat()

def build(phone,archive,at=None):
    at=at or datetime.now(timezone.utc)
    source_timestamp=datetime.fromisoformat(phone.get("generated_at_utc",""))
    if source_timestamp.tzinfo is None or not 0<=(at-source_timestamp).total_seconds()<=MAX_STALENESS_SECONDS:
        raise ValueError("phone_summary_stale_or_untrusted_time")
    if (phone.get("source")!="S9_native_microSD_sidecar_metadata" or
        phone.get("timezone")!="Europe/Amsterdam" or
        phone.get("operating_day_start_hour")!=6 or
        phone.get("read_only") is not True or
        phone.get("camera_4k_healthy_before_and_after") is not True or
        phone.get("video_bytes_transferred_to_hub") is not False or
        not re.fullmatch(r"[a-f0-9]{64}",str(phone.get("catalog_snapshot_id","")))):
        raise ValueError("unverified_phone_catalog")
    n=phone.get("recordings")
    hours=phone.get("hourly_recording_counts")
    days=phone.get("daily_recording_counts")
    if type(n) is not int or not 0<n<=2000 or not isinstance(hours,dict) or not isinstance(days,dict):
        raise ValueError("phone_summary_shape")
    s9_hour=collections.Counter()
    s9_day=collections.Counter()
    for key,count in hours.items():
        match=PHONE_HOUR.fullmatch(key)
        if not match or type(count) is not int or not 1<=count<=2000:
            raise ValueError("invalid_s9_hour_bucket")
        # Preserve hour-of-day wall-clock interpretation, not a fabricated
        # shared timezone offset for naive historical Drive timestamps.
        s9_hour[match.group(2)]+=count
    for key,count in days.items():
        if not DATE.fullmatch(key) or type(count) is not int or not 1<=count<=2000:
            raise ValueError("invalid_s9_operating_day")
        datetime.strptime(key,"%Y-%m-%d")
        s9_day[key]+=count
    if sum(s9_hour.values())!=n or sum(s9_day.values())!=n:
        raise ValueError("inconsistent_s9_bucket_totals")
    rows=archive.get("items")
    if not isinstance(rows,list) or len(rows)>10000:raise ValueError("invalid_drive_archive")
    drive_hour=collections.Counter()
    drive_day=collections.Counter()
    verified=0;unknown_time=0
    seen=set()
    for row in rows:
        if not isinstance(row,dict):continue
        if row.get("camera")!="new" or row.get("state")!="verified":continue
        name=row.get("remote_name")
        if not isinstance(name,str) or not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9._-]{4,180}[.]mp4",name):
            raise ValueError("untrusted_drive_source")
        if name in seen:raise ValueError("duplicate_drive_recording")
        seen.add(name);verified+=1
        stamp=row.get("timestamp")
        if not isinstance(stamp,str) or not LOCAL_STAMP.fullmatch(stamp):
            unknown_time+=1;continue
        try:recorded=datetime.strptime(stamp,"%Y-%m-%d %H:%M:%S")
        except ValueError:
            unknown_time+=1;continue
        drive_hour[f"{recorded.hour:02d}"]+=1
        drive_day[day_of(recorded)]+=1
    if sum(drive_day.values())+unknown_time!=verified or verified>2000:
        raise ValueError("inconsistent_drive_bucket_totals")
    each_day={k:{"s9_microSD":s9_day[k],"historical_drive":drive_day[k],
                 "combined":s9_day[k]+drive_day[k]}
              for k in sorted(set(s9_day)|set(drive_day))}
    each_hour={f"{h:02d}":{"s9_microSD":s9_hour[f"{h:02d}"],
                 "historical_drive":drive_hour[f"{h:02d}"],
                 "combined":s9_hour[f"{h:02d}"]+drive_hour[f"{h:02d}"]}
               for h in range(24)}
    return {
      "schema_version":VERSION,
      "generated_at_utc":at.isoformat(),
      "timezone":"Europe/Amsterdam",
      "operating_day_start_local":"06:00",
      "phone_snapshot_id":phone["catalog_snapshot_id"],
      "source_recordings":{"s9_microSD":n,"historical_drive_verified_new":verified},
      "total_recordings":n+verified,
      "historical_drive_timestamp_unknown":unknown_time,
      "operating_days":each_day,"local_wall_clock_hours":each_hour,
      "drive_timestamp_semantics":"archive_local_wall_clock_without_utc_offset",
      "dst_caveat":"Drive repeated-hour values cannot be uniquely offset-resolved",
      "measurement":"recording_occurrences_not_people_or_dwell_time",
      "media_decoded":False,"video_bytes_transferred":False,
      "drive_changed":False,"manual_reviews_changed":False,"s3_excluded":True
    }

def atomic(path,data):
    raw=(json.dumps(data,sort_keys=True,separators=(",",":"))+"\n").encode()
    if len(raw)>2*1024*1024 or path.is_symlink():raise ValueError("unsafe_report")
    path.parent.mkdir(parents=True,exist_ok=True)
    fd,tmp=tempfile.mkstemp(prefix=".s9-drive-activity-",dir=path.parent)
    try:
        with os.fdopen(fd,"wb") as f:
            f.write(raw);f.flush();os.fsync(f.fileno())
        os.chmod(tmp,0o600);os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)

def main():
    report=build(read_object(PHONE),read_object(DRIVE))
    atomic(RESULT,report)
    print("SECURITY_S9_DRIVE_ACTIVITY_V1 "+json.dumps({
        "total":report["total_recordings"],
        "s9":report["source_recordings"]["s9_microSD"],
        "drive":report["source_recordings"]["historical_drive_verified_new"],
        "drive_without_timestamp":report["historical_drive_timestamp_unknown"],
        "days":len(report["operating_days"]),
        "s3_excluded":True,"media_decoded":False
    },sort_keys=True),flush=True)

if __name__=="__main__":main()
