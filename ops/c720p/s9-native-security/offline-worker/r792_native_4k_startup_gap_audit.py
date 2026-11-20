#!/usr/bin/env python3
"""R792: distinguish 4K MediaRecorder start-of-stream gap from steady FPS loss.

Synthetic tests and read-only aggregate inspection. Never rewrites MP4,
fixes timestamps, interpolates pixels, changes production APK, parses faces,
or promotes original metadata to a person/identity recognition trial.
All ground-truth video checks must come from existing S9 R761/R785
source-SHA-before/after encoded MediaExtractor sample-time receipts.
"""
from __future__ import annotations
import argparse,collections,json,math,pathlib,re,statistics
from typing import Any

SCHEMA="s9_r792_phone_verified_first_4k_sample_timing_v1"
SOURCE_PATTERN=re.compile(r"^(?:motion|diagnostic_preroll)_[0-9]{13}[.]mp4$")
SHA=re.compile(r"^[a-f0-9]{64}$")
NOMINAL_STEP_MS=1000/30
MIN_STEADY_FPS=29.0
MAX_STEADY_FPS=31.0

def need(ok,code):
    if not ok:raise ValueError(code)

def finite(x):
    return type(x) in (int,float) and math.isfinite(x)

def classify(r):
    need(type(r) is dict,"receipt_not_an_object")
    need(r.get("schema")==SCHEMA,"unexpected_receipt_schema")
    need(type(r.get("source")) is str and
         SOURCE_PATTERN.fullmatch(r["source"]), "wrong_native_source_name")
    need(type(r.get("source_sha256")) is str and
         SHA.fullmatch(r["source_sha256"]), "invalid_original_sha")
    need(r.get("original_sha_verified_before_and_after_on_s9") is True,
         "source_integrity_not_proven")
    need(r.get("width")==3840 and r.get("height")==2160 and
         r.get("codec")=="video/avc", "not_a_4k_h264_capture")
    need(r.get("person_id_labels_read")==0 and
         r.get("decoded_frames")==0, "identity_data_or_image_decoding_disallowed")
    need(type(r.get("encoded_frame_count")) is int and
         r["encoded_frame_count"]>=200,"recording_sample_size_too_small")
    need(type(r.get("first_eight_pts_us")) is list and
         len(r["first_eight_pts_us"])==8 and
         all(type(v) is int and v>=0 for v in r["first_eight_pts_us"]),
         "missing_initial_encoded_pts")
    pts=r["first_eight_pts_us"]
    need(pts[0]==0 and all(pts[i]>pts[i-1] for i in range(1,8)),
         "not_monotonic_or_not_zero_based_initial_pts")
    gaps=[(pts[i]-pts[i-1])/1000 for i in range(1,8)]
    need(type(r.get("overall_intervals_over_100ms")) is int and
         type(r.get("steady_intervals_over_100ms")) is int and
         type(r.get("max_gap_position")) is int and
         r.get("nonmonotonic_pts")==0,
         "untrusted_interval_counts")
    need(finite(r.get("steady_fps")) and
         MIN_STEADY_FPS<=r["steady_fps"]<=MAX_STEADY_FPS,
         "steady_30fps_not_verified")
    need(r["steady_intervals_over_100ms"]==0 and
         all(24<=v<=42 for v in gaps[1:]),
         "later_stream_not_steady_at_30fps")
    need(r["max_gap_position"]==0 and
         r["overall_intervals_over_100ms"]==1 and
         gaps[0]>100 and
         abs(gaps[0]-r["largest_gap_ms"])<0.003 and
         r.get("strict_full_event30_pass") is False,
         "not_one_first_interval_only_gap")
    need(r.get("first_sample_is_keyframe") is True,
         "first_sample_keyframe_not_attested")
    # Gaps are encoded PTS, not direct evidence of sensor drops.
    equivalent_extra_periods=gaps[0]/NOMINAL_STEP_MS-1.0
    return {
        "source_type":("diagnostic" if
                       r["source"].startswith("diagnostic_") else "motion"),
        "recording_date":r.get("local_capture_date"),
        "first_encoded_interval_ms":round(gaps[0],3),
        "next_six_intervals_ms":[round(x,3) for x in gaps[1:]],
        "stable_encoded_fps":r["steady_fps"],
        "additional_nominal_33p3ms_intervals":
            round(equivalent_extra_periods,2),
        "actual_sensor_frames_dropped_demonstrated":False,
        "startup_transition_timing_unresolved":True,
        "strict_full_4k_30fps_pass":False,
        "source_sha_checked_twice":True
    }

def summarize(rows):
    need(type(rows) is list and 3<=len(rows)<=16,
         "physical_replay_receipt_rows_not_bounded")
    keys=set()
    safe=[]
    for row in rows:
        entry=classify(row)
        need(row["source_sha256"] not in keys,
             "source_digest_repeated_as_independent_sample")
        keys.add(row["source_sha256"])
        safe.append(entry)
    days={x["recording_date"] for x in safe}
    need(None not in days and len(days)>=2,
         "cross_day_startup_claim_requires_independent_days")
    first=[x["first_encoded_interval_ms"] for x in safe]
    return {
        "schema":"s9_r792_4k_startup_gap_physical_aggregate_v1",
        "status":"PERSISTENT_FIRST_ENCODED_INTERVAL_GAP_NOT_STEADY_FPS_FAILURE",
        "independent_original_sha_count":len(keys),
        "distinct_capture_days":len(days),
        "first_gap_min_ms":min(first),
        "first_gap_max_ms":max(first),
        "first_gap_median_ms":statistics.median(first),
        "all_cases_steady_30fps":True,
        "all_cases_first_interval_only":True,
        "h264_encoder_startup_is_proven_root_cause":False,
        "source_4k_30fps_gap_free":False,
        "actual_sensor_frames_dropped_demonstrated":False,
        "legacy_recorder_reordered_or_restarted":False,
        "production_camera_changed":False,
        "original_videos_changed_or_deleted":0,
        "real_person_embeddings_or_labels_read":0,
        "automated_people_folder_filing_authorized":False,
    }

def private_audit(path):
    need(path.is_file() and not path.is_symlink() and
         1000<=path.stat().st_size<=40000 and
         path.stat().st_mode&0o077==0,
         "private_receipt_not_protected_or_missing")
    rows=json.loads(path.read_text(encoding="utf-8"))
    return summarize(rows)

def fake(source,day,first_us,sha_digit="a"):
    step=33333
    pts=[0,first_us]+[first_us+step*i for i in range(1,7)]
    return {
        "schema":SCHEMA,"source":source,
        "source_sha256":sha_digit*64,
        "original_sha_verified_before_and_after_on_s9":True,
        "width":3840,"height":2160,"codec":"video/avc",
        "encoded_frame_count":264,"first_eight_pts_us":pts,
        "overall_intervals_over_100ms":1,"steady_intervals_over_100ms":0,
        "max_gap_position":0,"nonmonotonic_pts":0,
        "steady_fps":30.015,"largest_gap_ms":first_us/1000,
        "strict_full_event30_pass":False,
        "first_sample_is_keyframe":True,"person_id_labels_read":0,
        "decoded_frames":0,"local_capture_date":day
    }

def self_test():
    from copy import deepcopy
    a=fake("motion_1794991337339.mp4","2026-11-18",176522,"a")
    b=fake("motion_1795108992688.mp4","2026-11-19",125233,"b")
    c=fake("motion_1795111776348.mp4","2026-11-19",127377,"c")
    d=fake("diagnostic_preroll_1795146172753.mp4","2026-11-20",
           178277,"d")
    result=summarize([a,b,c,d])
    need(result["first_gap_median_ms"]==151.9495 and
         result["first_gap_min_ms"]==125.233 and
         result["first_gap_max_ms"]==178.277 and
         result["distinct_capture_days"]==3 and
         result["h264_encoder_startup_is_proven_root_cause"] is False,
         "synthetic_observed_gap_fixture_regression")
    negatives=0
    changes=(
        ("source","PeopleFolder_1234.mp4"),
        ("source_sha256","xx"),
        ("width",640),("codec","video/hevc"),
        ("person_id_labels_read",1),("decoded_frames",1),
        ("first_sample_is_keyframe",False),
        ("max_gap_position",100),
        ("overall_intervals_over_100ms",2),
        ("steady_intervals_over_100ms",1),
        ("strict_full_event30_pass",True),
        ("steady_fps",10),
        ("nonmonotonic_pts",1),
        ("original_sha_verified_before_and_after_on_s9",False)
    )
    for key,value in changes:
        row=deepcopy(a);row[key]=value
        try:classify(row)
        except (ValueError,KeyError):negatives+=1
        else:raise AssertionError("unsafe_startup_case_accepted_"+key)
    row=deepcopy(a);row["first_eight_pts_us"][2]=600000
    try:classify(row)
    except ValueError:negatives+=1
    else:raise AssertionError("steady_gap_hidden")
    row=deepcopy(a);row["first_eight_pts_us"][1]=0
    try:classify(row)
    except ValueError:negatives+=1
    else:raise AssertionError("timestamp_discontinuity_hidden")
    try:summarize([a,a,b,d])
    except ValueError:negatives+=1
    else:raise AssertionError("duplicate_source_claimed_independent")
    need(negatives==17,"negative_test_count_mismatch")
    print(json.dumps({"status":"R792_4K_FIRST_ENCODED_INTERVAL_CLASSIFIER_SYNTHETIC_PASS",
        "negative_cases":negatives,"physical_observation_fixture_count":4,
        "example_gap_min_ms":result["first_gap_min_ms"],
        "example_gap_max_ms":result["first_gap_max_ms"],
        "root_cause_proven":False,"real_media_accessed":False,
        "automatic_people_filing_authorized":False},sort_keys=True))

def main():
    p=argparse.ArgumentParser()
    m=p.add_mutually_exclusive_group(required=True)
    m.add_argument("--self-test",action="store_true")
    m.add_argument("--audit-private",type=pathlib.Path)
    a=p.parse_args()
    if a.self_test:self_test()
    else:print(json.dumps(private_audit(a.audit_private),sort_keys=True))

if __name__=="__main__":main()
