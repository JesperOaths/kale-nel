#!/usr/bin/env python3
"""R767 phone-only 4K startup-PTS regression audit, per independent date.

No pixels decoded, no original bytes downloaded, no people labels, no model
inference, no camera settings changed and no scheduled tasks created. Each
previously completed native 4K source is double-SHA-verified on the S9 by
R761 before/after reading encoded H264 sample timestamp metadata.

A passing steady-state 30 FPS NEVER turns a startup-gap whole-file failure
into a clean 30 FPS capture claim. A diagnostic run never proves a new
completed recording was captured concurrently with model inference.
"""
from __future__ import annotations
import argparse,datetime as dt,hashlib,json,re,secrets,subprocess,time
from zoneinfo import ZoneInfo
import s9_reid_capture_admission_v742 as guard
import r758_capture_day_leakage_audit as prior

PHONE="192.168.178.250:5555"
DEX="/data/local/tmp/s9_reid_r740/r766_start_sample_inspector.dex.jar"
DEX_SHA="5d81c6ec81d01b37b4fff6757c63c2114c0589d5e275eae31cf65af467a05914"
MARK="S9_NATIVE4K_EVENT_R761 "
ZONE=ZoneInfo("Europe/Amsterdam")

def need(ok,reason):
    if not ok:raise ValueError(reason)

def classify(d,nonce,source):
    need(type(d) is dict and d.get("schema")=="s9_r761_original_native4k_sample_timing_v1" and
         d.get("nonce")==nonce,"invalid_output_receipt")
    need(d.get("source_sha256_verified_on_s9")==source["sha"] and
         d.get("source_filename_sha256")==hashlib.sha256(source["name"].encode()).hexdigest() and
         d.get("original_source_bytes")==source["bytes"] and
         d.get("sha_checked_before_and_after_on_phone") is True,
         "wrong_source_revision_or_nonphysical_hash")
    need(d.get("codec")=="video/avc" and
         d.get("resolution_width")==3840 and
         d.get("resolution_height")==2160 and
         d.get("finished_native4k_event_proven") is True,
         "not_a_finished_native_4k_event")
    need(d.get("candidate_model_inference_concurrent_with_original_capture_proven") is False and
         d.get("original_video_modified") is False and
         d.get("identity_or_folder_labels_read") is False and
         d.get("photos_or_video_frames_decoded")==0 and
         d.get("people_folder_assignments")==0,
         "unsafe_false_concurrent_or_identity_claim")
    times=d.get("first_eight_video_sample_pts_us")
    flags=d.get("first_eight_video_sample_flags")
    sizes=d.get("first_eight_video_sample_sizes_bytes")
    need(type(times) is list and len(times)==8 and
         all(type(x) is int and x>=0 for x in times) and
         all(times[i]>times[i-1] for i in range(1,8)),
         "unreliable_first_eight_timestamps")
    need(type(flags) is list and len(flags)==8 and
         type(sizes) is list and len(sizes)==8 and
         all(type(x) is int and x>0 for x in sizes) and
         all(type(x) is int and x>=0 for x in flags) and
         (flags[0]&1)==1,
         "untrusted_first_keyframe_metadata")
    need(type(d.get("nonmonotonic_pts")) is int and d["nonmonotonic_pts"]==0,
         "nonmonotonic_complete_video_timestamps")
    need(type(d.get("steady_fps_after_first_ten_samples")) in (float,int) and
         type(d.get("average_encoded_sample_fps")) in (float,int) and
         type(d.get("intervals_over_100ms")) is int and
         type(d.get("steady_frame_gaps_over_100ms")) is int,
         "incomplete_encoded_4k_timing")
    first_ms=(times[1]-times[0])/1000.
    has_startup=first_ms>100.
    if has_startup:
        need(d.get("max_interval_sample_position")==0 and
             abs(d["max_sample_interval_ms"]-first_ms)<0.002 and
             d.get("strict_full_event_30fps_gap_check") is False and
             d.get("startup_gap_requires_separate_capture_fix") is True,
             "startup_gap_hidden_or_unattributed")
    clean=bool(d.get("strict_full_event_30fps_gap_check"))
    steady=bool(d.get("steady_event_30fps_gap_check"))
    need(not clean or not has_startup,"gap_recording_was_marked_gapfree")
    return {
        "date":source["date"],
        "first_interval_ms":round(first_ms,3),
        "first_sample_size_bytes":sizes[0],
        "first_sample_sync":True,
        "codec_profile":d.get("video_codec_profile"),
        "codec_level":d.get("video_codec_level"),
        "steady_fps":d["steady_fps_after_first_ten_samples"],
        "overall_fps":d["average_encoded_sample_fps"],
        "startup_gt100ms":has_startup,
        "full_file_gapfree":clean,
        "steady_30fps":steady,
        "interior_gaps_gt100ms":d["steady_frame_gaps_over_100ms"],
        "model_concurrent_with_original_capture_proven":False,
    }

def choose(catalog,ledger,max_days):
    best={}
    for name,entry in catalog.get("records",{}).items():
        if not prior.CLIP.fullmatch(name):continue
        manifest=entry.get("manifest",{})
        proof=ledger.get("checks",{}).get(name,{})
        size=entry.get("bytes")
        duration=manifest.get("duration_ms")
        if not (manifest.get("width")==3840 and
                manifest.get("height")==2160 and
                type(duration) is int and 5000<duration<65000 and
                type(size) is int and 10_000_000<size<160_000_000 and
                proof.get("original_sha256_matches") is True and
                proof.get("catalog_version")==entry.get("version") and
                prior.metadata.sha_valid(manifest.get("sha256"))):
            continue
        day=dt.datetime.fromtimestamp(int(name[7:20])/1000,ZONE).date().isoformat()
        if day not in best or name>best[day]["name"]:
            best[day]={"name":name,"sha":manifest["sha256"],
                       "bytes":size,"date":day}
    need(len(best)>=max_days,"not_enough_independent_recording_dates")
    return [best[day] for day in sorted(best,reverse=True)[:max_days]]

def self_test():
    source={"name":"motion_1794991337339.mp4","sha":"a"*64,
            "bytes":40_000_000,"date":"2026-11-18"}
    def base(times):
        return {"schema":"s9_r761_original_native4k_sample_timing_v1",
            "nonce":"b"*32,
            "source_sha256_verified_on_s9":source["sha"],
            "source_filename_sha256":hashlib.sha256(source["name"].encode()).hexdigest(),
            "original_source_bytes":source["bytes"],
            "sha_checked_before_and_after_on_phone":True,
            "codec":"video/avc","resolution_width":3840,"resolution_height":2160,
            "finished_native4k_event_proven":True,
            "candidate_model_inference_concurrent_with_original_capture_proven":False,
            "original_video_modified":False,"identity_or_folder_labels_read":False,
            "photos_or_video_frames_decoded":0,"people_folder_assignments":0,
            "first_eight_video_sample_pts_us":times,
            "first_eight_video_sample_flags":[1]+[0]*7,
            "first_eight_video_sample_sizes_bytes":[200000]+[90000]*7,
            "nonmonotonic_pts":0,"steady_fps_after_first_ten_samples":30.015,
            "average_encoded_sample_fps":29.70,
            "intervals_over_100ms":1,"steady_frame_gaps_over_100ms":0,
            "max_interval_sample_position":0,
            "max_sample_interval_ms":127.377,
            "startup_gap_requires_separate_capture_fix":True,
            "strict_full_event_30fps_gap_check":False,
            "steady_event_30fps_gap_check":True}
    good=base([0,127377,160688,194011,227322,260644,293955,327277])
    row=classify(good,"b"*32,source)
    need(row["startup_gt100ms"] is True and
         row["full_file_gapfree"] is False and row["steady_30fps"] is True,
         "startup_gap_not_classified")
    count=0
    bad_cases=(
        ("nonce","c"*32,"invalid_output_receipt"),
        ("original_source_bytes",1234,"wrong_source_revision_or_nonphysical_hash"),
        ("candidate_model_inference_concurrent_with_original_capture_proven",True,"unsafe_false_concurrent_or_identity_claim"),
        ("people_folder_assignments",1,"unsafe_false_concurrent_or_identity_claim"),
        ("first_eight_video_sample_flags",[0]*8,"untrusted_first_keyframe_metadata"),
        ("first_eight_video_sample_pts_us",[0]*8,"unreliable_first_eight_timestamps"),
        ("strict_full_event_30fps_gap_check",True,"startup_gap_hidden_or_unattributed"),
        ("max_interval_sample_position",3,"startup_gap_hidden_or_unattributed"),
        ("nonmonotonic_pts",1,"nonmonotonic_complete_video_timestamps")
    )
    for key,value,why in bad_cases:
        changed={**good,key:value}
        try:classify(changed,"b"*32,source)
        except ValueError as e:need(why in str(e),"wrong_refusal_reason")
        else:raise AssertionError("untrusted_4k_attestation_accepted_"+key)
        count+=1
    print(json.dumps({"status":"R767_NATIVE4K_STARTUP_REGRESSION_TESTS_PASS",
        "adversarial_cases_rejected":count,
        "person_identity_automatic_filing_enabled":False},sort_keys=True))

def run(days):
    now=time.time()
    catalog=prior.load_json(prior.CATALOG,now,prior.MAX_CATALOG_AGE_SEC)
    summary=prior.load_json(prior.SUMMARY,now,prior.MAX_CATALOG_AGE_SEC)
    ledger=prior.load_json(prior.LEDGER)
    need(summary.get("catalog_snapshot_id")==catalog.get("snapshot_id") and
         summary.get("camera_4k_healthy_before_and_after") is True,
         "camera_source_catalog_not_verified")
    sha=subprocess.run(["adb","-s",PHONE,"shell","sha256sum",DEX],
                       capture_output=True,text=True,check=True,timeout=10)
    need(sha.stdout.split()[0]==DEX_SHA,"untrusted_phone_startup_inspector")
    items=choose(catalog,ledger,days)
    records=[]
    for source in items:
        before=guard.camera_status();pb=guard.phone_status()
        need(not guard.inspect_camera(before) and
             not guard.inspect_phone(pb),"capture_priority_requires_abort")
        nonce=secrets.token_hex(16)
        cmd=(f"CLASSPATH={DEX} nice -n 15 /system/bin/app_process "
             f"/system/bin nl.kalenel.s9offline.S9OriginalNative4KEventTimingV761 "
             f"--verified-native4k-original {source['name']} "
             f"{source['sha']} {source['bytes']} {nonce}")
        try:
            p=subprocess.run(["adb","-s",PHONE,"shell",cmd],
                             capture_output=True,text=True,check=True,timeout=23)
            lines=[x[len(MARK):] for x in p.stdout.splitlines()
                   if x.startswith(MARK)]
            need(len(lines)==1,"missing_phone_native4k_receipt")
            record=classify(json.loads(lines[0]),nonce,source)
            after=guard.camera_status();pa=guard.phone_status()
            need(not guard.inspect_camera(after) and not guard.inspect_phone(pa) and
                 pa["recorder_pid"]==pb["recorder_pid"] and
                 after["preroll_dropped_frames"]==before["preroll_dropped_frames"] and
                 after["sensor_capture_result_frames"]>
                     before["sensor_capture_result_frames"],
                 "camera_continuity_during_archive_inspection_lost")
        except (ValueError,subprocess.TimeoutExpired,subprocess.CalledProcessError) as err:
            print(json.dumps({"status":"R767_ABORTED_CAMERA_OR_EVIDENCE_UNSAFE",
                "completed_dates":len(records),
                "reason":str(err)[:160],
                "source_sha_or_video_exported":False,
                "automatic_filing_authorized":False}))
            return
        records.append(record)
        print("R767_DAY_EVIDENCE "+json.dumps(record,sort_keys=True),flush=True)
    print(json.dumps({
        "status":"R767_PHYSICAL_ARCHIVE_DATE_SAMPLE_COMPLETE",
        "days_checked":len(records),
        "startup_gaps_over_100ms":sum(x["startup_gt100ms"] for x in records),
        "gapfree_startup_days":sum(not x["startup_gt100ms"] for x in records),
        "all_steady_30fps":all(x["steady_30fps"] for x in records),
        "interior_gap_count_over_100ms":sum(x["interior_gaps_gt100ms"] for x in records),
        "all_originals_sha_reverified_twice_on_s9":True,
        "source_media_copied":0,
        "person_labels_read":0,
        "concurrent_model_load_event_test_complete":False,
        "automatic_people_filing_authorized":False
    },sort_keys=True))

def main():
    p=argparse.ArgumentParser()
    group=p.add_mutually_exclusive_group(required=True)
    group.add_argument("--self-test",action="store_true")
    group.add_argument("--audit",action="store_true")
    p.add_argument("--max-days",type=int,default=7)
    a=p.parse_args()
    need(type(a.max_days) is int and 1<=a.max_days<=14,
         "bounded_days_required")
    if a.self_test:self_test()
    else:run(a.max_days)

if __name__=="__main__":
    main()
