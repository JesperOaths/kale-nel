#!/usr/bin/env python3
"""Bounded S9-side auxiliary MP4 sample test; publishes private metadata only.

This does NOT decode video, create review decisions or move anything from microSD.
One isolated Android app_process reads up to two compressed packets per file.
No recording content is returned to the hub, only private structural metadata.
"""
import argparse
import collections
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.request

SERIAL="192.168.178.250:5555"
REMOTE="/data/local/tmp/c720p-s9-aux-media-readonly-v1.dex"
STATE=Path("/home/jespern/c720p-home-hub/state")
OUTPUT=STATE/"s9-auxiliary-structural-probe-v1.json"
CATALOG=STATE/"s9-standalone-archive-summary-v1.json"
MARKER="S9_AUXILIARY_MEDIA_PROBE "
SCHEMA="s9_auxiliary_media_probe_v1"
MAX_CANDIDATES=700
BATCH=12
CLIP=re.compile(r"motion_[0-9]{13}[.]mp4[.](?:preroll[.]mp4|complete[.]mp4|complete[.]partial[.]mp4)")

def camera():
    with urllib.request.urlopen("http://127.0.0.1:18808/status",timeout=9) as reply:
        value=json.load(reply)
    if not (value.get("ok") is True and value.get("mode")=="watching" and
        value.get("continuous_4k_ready") is True and
        value.get("continuous_4k_dropped_output_frames")==0 and
        0<float(value.get("temperature_c") or 100)<43):
        raise RuntimeError("capture_not_healthy_or_too_warm")
    return value

def adb(*args,timeout=70):
    p=subprocess.run(["adb","-s",SERIAL,*args],capture_output=True,text=True,timeout=timeout)
    if p.returncode:raise RuntimeError("s9_adb_command_failed:"+str(args[0])+":"+p.stderr[-130:])
    return p.stdout

def parse(raw,offset,total=None):
    found=[line.split(MARKER,1)[1] for line in raw.splitlines() if MARKER in line]
    if len(found)!=1:raise ValueError("missing_exact_phone_report")
    r=json.loads(found[0])
    if (r.get("schema_version")!=SCHEMA or r.get("offset")!=offset or
        r.get("batch_size")!=BATCH or
        r.get("files_modified") is not False or r.get("manual_reviews_modified") is not False or
        r.get("video_decoded") is not False or
        r.get("no_recording_bytes_transferred_to_hub") is not True):
        raise ValueError("untrusted_phone_result")
    count=r.get("total_unpaired_auxiliary_files")
    if type(count) is not int or not 1<=count<=MAX_CANDIDATES:
        raise ValueError("unbounded_candidate_count")
    if total is not None and count!=total:raise ValueError("source_changed_during_scan")
    rows=r.get("rows")
    if not isinstance(rows,list) or len(rows)!=min(BATCH,max(0,count-offset)):
        raise ValueError("unexpected_batch_rows")
    allowed={"compressed_video_samples_read","no_video_samples","no_video_track",
        "extractor_unavailable_or_incomplete","size_outside_probe_limits",
        "possibly_active_or_untrusted_mtime","untrusted_video_format"}
    for row in rows:
        if not isinstance(row,dict) or not isinstance(row.get("name"),str) or
          not CLIP.fullmatch(row["name"]) or row.get("role") not in ("preroll","complete","partial") or
          row.get("read_only") is not True or row.get("status") not in allowed or
          type(row.get("bytes")) is not int or row["bytes"]<0:
            raise ValueError("untrusted_file_row")
        name=row["name"]
        expected="preroll" if name.endswith(".preroll.mp4") else "partial" if name.endswith(".complete.partial.mp4") else "complete"
        if row["role"]!=expected:raise ValueError("role_mismatch")
    return count,rows

def catalog_expected():
    d=json.loads(CATALOG.read_text())
    a=d.get("auxiliary_mp4_inventory") or {}
    keys=("preroll_without_any_primary","completed_companion_without_any_primary",
        "partial_companion_without_any_primary")
    vals=[a.get(key) for key in keys]
    if any(type(x) is not int or x<0 for x in vals):
        raise ValueError("catalog_missing_three_way_pairing")
    return sum(vals), d.get("catalog_snapshot_id"),d.get("recordings")

def write_atomic(payload):
    STATE.mkdir(parents=True,exist_ok=True)
    if OUTPUT.is_symlink():raise RuntimeError("unsafe_existing_report")
    fd,temp=tempfile.mkstemp(prefix=".s9-aux-probe-",dir=STATE)
    try:
        with os.fdopen(fd,"w",encoding="utf8") as f:
            os.fchmod(f.fileno(),0o600)
            json.dump(payload,f,sort_keys=True,separators=(",",":"))
            f.write("\n")
            f.flush();os.fsync(f.fileno())
        os.replace(temp,OUTPUT)
    finally:
        if os.path.exists(temp):os.unlink(temp)

def scan(dex,sha256,save):
    if dex.is_symlink() or not dex.is_file() or not re.fullmatch(r"[0-9a-f]{64}",sha256):
        raise ValueError("untrusted_dex")
    if hashlib.sha256(dex.read_bytes()).hexdigest()!=sha256:
        raise ValueError("dex_integrity_mismatch")
    expected,snapshot,originals=catalog_expected()
    before=camera()
    rows=[]
    total=None
    start=time.monotonic()
    adb("push",str(dex),REMOTE,timeout=45)
    try:
        for offset in range(0,MAX_CANDIDATES,BATCH):
            camera()
            raw=adb("shell","CLASSPATH="+REMOTE+
                " app_process /system/bin nl.kalenel.s9security.AuxiliaryMediaProbe "+
                str(offset)+" "+str(BATCH),timeout=80)
            count,page=parse(raw,offset,total)
            if total is None:
                total=count
                if total!=expected:raise ValueError("catalog_candidate_total_disagreement")
            rows.extend(page)
            if len(rows)>=total:break
            time.sleep(0.5)
        else:raise RuntimeError("candidate_scan_exhausted")
        if len(rows)!=total or len({r["name"] for r in rows})!=total:
            raise ValueError("duplicate_or_missing_rows")
        final_expected,final_snapshot,final_originals=catalog_expected()
        if final_expected!=expected or final_originals<originals:
            raise ValueError("catalog_shrank_or_companions_changed")
        after=camera()
        by_role={}
        for role in ("preroll","complete","partial"):
            subset=[r for r in rows if r["role"]==role]
            by_role[role]={"checked":len(subset),"statuses":dict(collections.Counter(
                r["status"] for r in subset))}
        report={"schema_version":"s9_auxiliary_structural_report_v1",
          "generated_at_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
          "catalog_originals_before":originals,"catalog_originals_after":final_originals,
          "catalog_snapshot_before":snapshot,"catalog_snapshot_after":final_snapshot,
          "total_unpaired":total,"by_role":by_role,
          "rows":rows,"camera_temp_before_c":before.get("temperature_c"),
          "camera_temp_after_c":after.get("temperature_c"),
          "elapsed_seconds":round(time.monotonic()-start,2),
          "video_decoded":False,"video_bytes_transferred_to_hub":False,
          "camera_apk_modified":False,"originals_modified":False,
          "manual_person_reviews_modified":False,
          "structural_packets_are_not_full_decode_proof":True}
        if save:write_atomic(report)
        print("S9_AUXILIARY_STRUCTURAL_AUDIT "+json.dumps({
          k:report[k] for k in ("total_unpaired","by_role","elapsed_seconds",
            "catalog_originals_before","catalog_originals_after",
            "camera_temp_before_c","camera_temp_after_c","video_bytes_transferred_to_hub",
            "originals_modified","manual_person_reviews_modified")},sort_keys=True))
        return report
    finally:
        try:adb("shell","rm","-f",REMOTE,timeout=12)
        except Exception:pass

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--dex",type=Path,required=True)
    p.add_argument("--sha256",required=True)
    p.add_argument("--save-report",action="store_true",help="Only writes private metadata JSON")
    a=p.parse_args()
    scan(a.dex,a.sha256,a.save_report)
if __name__=="__main__":main()
