#!/usr/bin/env python3
"""Read-only post-upgrade timing evidence from VERIFIED newly saved 4K clips.

No video decoding or transfers, no face/people data exported. Monotonic
capture timings + validated MP4 durations provide *structural* timing proof,
not visual frame accuracy or proof of exactly when the person moved.
"""
import collections
import datetime as dt
import fcntl
import json
import os
from pathlib import Path
import statistics
import tempfile

BASE=Path("/home/jespern/c720p-home-hub")
STATE=BASE/"state"
ROLLOUT=STATE/"s9-native-seven-second-rollout-v1.json"
CATALOG=STATE/"s9-standalone-archive-catalog-v1.json"
OUT=STATE/"s9-7s-native-saved-timing-proof-v1.json"
LOCK=STATE/".s9-7s-native-saved-timing-proof.lock"
SCHEMA="s9_native_saved_prefix_quiet_hold_proof_v1"
MIN_SAMPLES=3
MIN_PREFIX_MS=6700
MIN_TAIL_MS=10000
MAX_TAIL_MS=15000

def verified_new_rollout(path=ROLLOUT):
    if not path.is_file() or path.is_symlink():return False
    d=json.loads(path.read_text())
    return (d.get("schema_version")=="s9_native_7s_cool_rollout_v1" and
            d.get("state")=="done" and d.get("installed") is True and
            d.get("candidate_sha256")==
                "37091d542b8708db26f520a67af8a4edbb687c80d2b24c01d87bf1a2d8b5d059")

def sample(manifest):
    if not isinstance(manifest,dict):return None
    if manifest.get("capture_segment_end_reason")!="quiet_end":return None
    if manifest.get("capture_segment_configured_quiet_hold_ms")!=10000:return None
    if manifest.get("width")!=3840 or manifest.get("height")!=2160:return None
    d=manifest.get("duration_ms")
    start=manifest.get("capture_segment_start_elapsed_ms")
    end=manifest.get("capture_segment_stop_elapsed_ms")
    age=manifest.get("capture_segment_last_accepted_motion_age_at_stop_ms")
    if (any(type(x) is not int for x in (d,start,end,age)) or
        not 14000<=d<=180000 or not 0<=start<end or
        not 5000<=end-start<=180000 or not 0<=age<=60000):
        return None
    prefix=d-(end-start)
    if not -1500<=prefix<=12000:return None
    return {"estimated_saved_prefix_ms":prefix,"age_since_last_accepted_motion_ms":age,
            "saved_mp4_duration_ms":d,"capture_segment_elapsed_ms":end-start,
            "quiet_end":True,"source":"verified_original_4k_sidecar"}

def assess(catalog):
    records=catalog.get("records")
    if catalog.get("schema_version")!="s9-standalone-archive-catalog-v1" or not isinstance(records,dict):
        raise ValueError("unrecognized_catalog_schema")
    eligible=[]
    for name,record in sorted(records.items(),reverse=True):
        if not (isinstance(name,str) and name.startswith("motion_") and name.endswith(".mp4")
                and len(name)==24 and isinstance(record,dict)):
            continue
        m=record.get("manifest")
        row=sample(m)
        if row is not None:eligible.append(row)
        if len(eligible)>=24:break
    subset=eligible[:12]
    if not subset:return {"ok":True,"complete":False,"eligible_count":0}
    prefixes=[x["estimated_saved_prefix_ms"] for x in subset]
    ages=[x["age_since_last_accepted_motion_ms"] for x in subset]
    med=statistics.median(prefixes)
    count_good=sum(x>=MIN_PREFIX_MS for x in prefixes)
    count_tail=sum(MIN_TAIL_MS<=x<=MAX_TAIL_MS for x in ages)
    return {"ok":True,"complete":len(subset)>=MIN_SAMPLES
            and count_good>=MIN_SAMPLES and count_tail>=MIN_SAMPLES
            and med>=MIN_PREFIX_MS,
      "eligible_count":len(subset),
      "estimated_prefix_median_ms":round(med),
      "estimated_prefix_min_ms":min(prefixes),
      "estimated_prefix_max_ms":max(prefixes),
      "prefix_at_least_6700ms":count_good,
      "quiet_tail_10_to_15_seconds":count_tail,
      "age_since_motion_median_ms":round(statistics.median(ages)),
      "full_frame_decode_verified":False,
      "not_a_claim_of_motion_pixel_ground_truth":True}

def atomic(payload):
    if OUT.is_symlink():raise ValueError("unsafe_timing_proof_target")
    fd,tmp=tempfile.mkstemp(prefix=".s9-7s-timing-",dir=STATE)
    try:
        with os.fdopen(fd,"w",encoding="utf8") as out:
            os.fchmod(out.fileno(),0o600)
            json.dump(payload,out,sort_keys=True,separators=(",",":"))
            out.write("\n");out.flush();os.fsync(out.fileno())
        os.replace(tmp,OUT)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
def main():
    STATE.mkdir(parents=True,exist_ok=True)
    if LOCK.is_symlink():raise ValueError("unsafe_proof_lock")
    with LOCK.open("a+") as lock:
        try:fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            print("S9_SAVED_TIMING_PROOF_DEFERRED concurrent");return
        if OUT.is_file():
            prior=json.loads(OUT.read_text())
            if prior.get("schema_version")==SCHEMA and prior.get("complete") is True:
                print("S9_SAVED_TIMING_PROOF_ALREADY_COMPLETE");return
        if not verified_new_rollout():
            print("S9_SAVED_TIMING_PROOF_DEFERRED new_camera_not_yet_installed");return
        if CATALOG.is_symlink() or not CATALOG.is_file() or CATALOG.stat().st_size>5000000:
            print("S9_SAVED_TIMING_PROOF_DEFERRED catalog_unavailable");return
        stats=assess(json.loads(CATALOG.read_text()))
        stats.update({"schema_version":SCHEMA,
            "checked_at_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
            "records_read_only":True,"no_video_bytes_read":True,
            "originals_modified":False,"person_reviews_modified":False,
            "threshold_saved_prefix_ms":MIN_PREFIX_MS,
            "threshold_quiet_hold_ms":MIN_TAIL_MS})
        atomic(stats)
        print("S9_SAVED_TIMING_PROOF "+json.dumps(stats,sort_keys=True))
if __name__=="__main__":main()
