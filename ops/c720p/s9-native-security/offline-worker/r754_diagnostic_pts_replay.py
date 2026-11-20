#!/usr/bin/env python3
"""R754 bounded diagnostic PTS/pixel replay contract and phone smoke test.

Runs *only* the fixed owner-created diagnostic source in R753. No identity
labels, arbitrary motion originals, person crops or embedding comparisons.
A matching diagnostic result cannot authorize person PTS, training or filing.

--self-test performs pure synthetic tests, needs no connected phone.
--phone-verify checks the camera admission / exact phone DEX SHA, then
executes two 2-second and one 4-second diagnostic seeks, comparing output
frame PTS and in-memory crop digests. Never schedules a recurring task.
"""
from __future__ import annotations
import argparse
import json
import math
import re
import subprocess
import sys
import time
from pathlib import Path

PHONE = "192.168.178.250:5555"
ROOT = "/data/local/tmp/s9_reid_r740"
DEX = ROOT + "/r753_actual_pts.dex.jar"
EXPECTED_DEX_SHA = "9a4c938d0408fe622a7af458fa23b6f11a638b9433fce7bbba4caf9be361132e"
EXPECTED_SOURCE_SHA = "04975e917bbb0671aef54e94e382141abd0f77fadb221f4122ef5e8bd1da9de2"
EXPECTED_SOURCE_SIZE = 40366251
PRODUCER = "MEDIACODEC_BUFFERINFO_PRESENTATIONTIMEUS_V410"
PREFIX = "S9_DIAGNOSTIC_ACTUAL_PTS_V753 "
HEXA = re.compile(r"[a-f0-9]{64}\Z")
REQUESTS = (2000, 2000, 4000)
ROI = (1810,950,1938,1206)

def require(value,reason):
    if not value:
        raise ValueError(reason)

def sha(value):
    return isinstance(value,str) and HEXA.fullmatch(value) is not None

def validate_receipt(r,request_ms):
    require(type(r) is dict,"receipt_not_object")
    require(r.get("schema")=="s9_r753_pinned_diagnostic_actual_decoded_crop_pts_v1",
            "unexpected_receipt_schema")
    require(r.get("result")=="DIAGNOSTIC_ACTUAL_DECODER_PTS_AND_PIXEL_SHA_VERIFIED",
            "unexpected_diagnostic_result")
    require(r.get("source_sha256")==EXPECTED_SOURCE_SHA and
            r.get("source_bytes")==EXPECTED_SOURCE_SIZE,
            "source_revision_mismatch")
    require(type(r.get("requested_seek_ms")) is int and
            r["requested_seek_ms"]==request_ms,
            "requested_offset_mismatch")
    pts=r.get("physical_output_frame_pts_us")
    require(type(pts) is int and
            request_ms*1000-1000<=pts<=request_ms*1000+500000,
            "decoded_output_pts_invalid")
    require(r.get("physical_pts_producer")==PRODUCER,
            "not_actual_decoder_pts_producer")
    for key in ("frame_time_not_inferred_from_requested_seek",
                "original_source_revision_verified_twice_on_phone",
                "source_is_diagnostic_recording_only"):
        require(r.get(key) is True, key+"_not_attested")
    for key in ("person_crop_PTS_independently_verified",
                "processed_person_recording",
                "biometric_identity_matching",
                "camera_service_modified",
                "source_written",
                "crop_image_saved"):
        require(r.get(key) is False, key+"_unexpected")
    require(type(r.get("automatic_person_folder_assignments")) is int and
            r["automatic_person_folder_assignments"]==0,
            "person_folder_assignments_not_zero")
    geometry=tuple(r.get(k) for k in ("roi_x0","roi_y0","roi_x1","roi_y1"))
    require(geometry==ROI and r.get("roi_width")==128 and
            r.get("roi_height")==256,
            "roi_geometry_unexpected")
    require(sha(r.get("argb8888_pixel_sha256")),
            "missing_or_invalid_in_memory_pixel_digest")
    return {"requested_ms":request_ms,"actual_pts_us":pts,
            "pixel_digest":r["argb8888_pixel_sha256"]}

def compare(receipts,authorized_phone_delivery=False):
    require(authorized_phone_delivery is True,
            "diagnostic_receipt_not_authoritatively_delivered")
    require(isinstance(receipts,list) and len(receipts)==3,
            "three_replays_required")
    items=[validate_receipt(r,request) for r,request in zip(receipts,REQUESTS)]
    require(items[0]["actual_pts_us"]==items[1]["actual_pts_us"],
            "same_seek_different_decoded_pts")
    require(items[0]["pixel_digest"]==items[1]["pixel_digest"],
            "same_seek_different_pixel_digest")
    require(items[2]["actual_pts_us"]>items[1]["actual_pts_us"],
            "different_seek_nonmonotonic_actual_pts")
    require(items[2]["pixel_digest"]!=items[1]["pixel_digest"],
            "different_seek_duplicate_roi_pixels")
    return {
        "schema":"s9_r754_diagnostic_only_output_pts_replay",
        "result":"DIAGNOSTIC_DECODER_PTS_AND_PIXEL_DIGEST_REPEATABLE",
        "physical_decoder_seek_offsets_ms":list(REQUESTS),
        "observed_output_pts_us":[x["actual_pts_us"] for x in items],
        "physical_frame_seek_error_ms":[round((x["actual_pts_us"]-x["requested_ms"]*1000)/1000.,3) for x in items],
        "same_seek_pts_reproduced":True,
        "same_seek_pixel_digest_reproduced":True,
        "different_seek_pts_and_pixel_digest":True,
        "person_crop_frame_pts_certified":False,
        "person_identification_accuracy_evaluated":False,
        "production_filing_authorized":False,
        "raw_pixel_data_exported":0,
        "crops_saved":0,
        "new_chatgpt_tasks":0
    }

def self_test():
    base={
        "schema":"s9_r753_pinned_diagnostic_actual_decoded_crop_pts_v1",
        "result":"DIAGNOSTIC_ACTUAL_DECODER_PTS_AND_PIXEL_SHA_VERIFIED",
        "source_sha256":EXPECTED_SOURCE_SHA,
        "source_bytes":EXPECTED_SOURCE_SIZE,
        "requested_seek_ms":2000,
        "physical_output_frame_pts_us":2031822,
        "physical_pts_producer":PRODUCER,
        "frame_time_not_inferred_from_requested_seek":True,
        "original_source_revision_verified_twice_on_phone":True,
        "source_is_diagnostic_recording_only":True,
        "person_crop_PTS_independently_verified":False,
        "processed_person_recording":False,
        "biometric_identity_matching":False,
        "camera_service_modified":False,
        "source_written":False,
        "crop_image_saved":False,
        "automatic_person_folder_assignments":0,
        "roi_x0":1810,"roi_y0":950,"roi_x1":1938,"roi_y1":1206,
        "roi_width":128,"roi_height":256,
        "argb8888_pixel_sha256":"2caef9a5ae1062ee2c1a02415938a7ae9f1dc729badc2516724770ad5e10d1ea"
    }
    shifted=dict(base,requested_seek_ms=4000,
                 physical_output_frame_pts_us=4030788,
                 argb8888_pixel_sha256="137f1e9384e78a1928a9a72ed411a74acaae82366083369524054b4a11434de9")
    rows=[base,dict(base),shifted]
    good=compare(rows,True)
    assert good["result"]=="DIAGNOSTIC_DECODER_PTS_AND_PIXEL_DIGEST_REPEATABLE"
    assert good["person_crop_frame_pts_certified"] is False
    cases=0
    for idx,key,bad,reason in (
        (0,"source_sha256","0"*64,"source_revision_mismatch"),
        (0,"source_bytes",1,"source_revision_mismatch"),
        (1,"physical_pts_producer","requested_seek_time","not_actual_decoder_pts_producer"),
        (0,"frame_time_not_inferred_from_requested_seek",False,"frame_time_not_inferred_from_requested_seek_not_attested"),
        (0,"physical_output_frame_pts_us",1000000,"decoded_output_pts_invalid"),
        (0,"processed_person_recording",True,"processed_person_recording_unexpected"),
        (0,"person_crop_PTS_independently_verified",True,"person_crop_PTS_independently_verified_unexpected"),
        (0,"source_is_diagnostic_recording_only",False,"source_is_diagnostic_recording_only_not_attested"),
        (0,"automatic_person_folder_assignments",1,"person_folder_assignments_not_zero"),
        (0,"roi_x0",1600,"roi_geometry_unexpected"),
        (0,"argb8888_pixel_sha256","n/a","missing_or_invalid_in_memory_pixel_digest"),
        (1,"physical_output_frame_pts_us",2061822,"same_seek_different_decoded_pts"),
        (1,"argb8888_pixel_sha256","3"*64,"same_seek_different_pixel_digest"),
        (2,"argb8888_pixel_sha256",base["argb8888_pixel_sha256"],"different_seek_duplicate_roi_pixels"),
        (2,"physical_output_frame_pts_us",2031822,"decoded_output_pts_invalid")
    ):
        altered=[dict(x) for x in rows]
        altered[idx][key]=bad
        try:
            compare(altered,True)
            raise AssertionError("bad_receipt_accepted:"+key)
        except ValueError as ex:
            assert reason in str(ex),(key,ex)
        cases+=1
    try:
        compare(rows,False)
        raise AssertionError("untrusted_replay_accepted")
    except ValueError as ex:
        assert "not_authoritatively_delivered" in str(ex)
    cases+=1
    print(json.dumps({"status":"R754_DIAGNOSTIC_ONLY_RECEIPT_TESTS_PASS",
        "synthetic_faults_rejected":cases,
        "diagnostic_actual_pts_replay":True,
        "person_source_pts_claimed":False,
        "people_filing_activated":False},sort_keys=True))

def phone_verify():
    # Imported only during owner-authorized, read-only physical check.
    import s9_reid_capture_admission_v742 as admission
    pre=admission.camera_status()
    pid=admission.phone_status()
    require(not admission.inspect_camera(pre) and
            not admission.inspect_phone(pid),
            "camera_health_pre_admission_failed")
    check=subprocess.run(["adb","-s",PHONE,"shell","sha256sum",DEX],
                         capture_output=True,text=True,timeout=9,check=True)
    require(check.stdout.strip().split()[0]==EXPECTED_DEX_SHA,
            "phone_replay_binary_digest_mismatch")
    transcripts=[]
    observations=[]
    for request_ms in REQUESTS:
        before=admission.camera_status()
        start_phone=admission.phone_status()
        require(not admission.inspect_camera(before) and
                not admission.inspect_phone(start_phone),
                "camera_health_before_decoder_failed")
        cmd=(f"CLASSPATH={DEX} nice -n 15 /system/bin/app_process "
             " /system/bin nl.kalenel.s9offline.S9DiagnosticActualDecodedPtsV753 "
             f"--diagnostic-only {request_ms}")
        start=time.monotonic()
        proc=subprocess.run(["adb","-s",PHONE,"shell",cmd],
                            capture_output=True,text=True,timeout=26,check=True)
        lines=[line[len(PREFIX):] for line in proc.stdout.splitlines()
               if line.startswith(PREFIX)]
        require(len(lines)==1,"physical_decoder_receipt_missing")
        receipt=json.loads(lines[0])
        validate_receipt(receipt,request_ms)
        after=admission.camera_status()
        end_phone=admission.phone_status()
        require(not admission.inspect_camera(after) and
                not admission.inspect_phone(end_phone),
                "camera_health_after_decoder_failed")
        require(start_phone["recorder_pid"]==end_phone["recorder_pid"],
                "camera_restart_during_decoder")
        require(after["preroll_dropped_frames"]==before["preroll_dropped_frames"],
                "preroll_drops_during_decoder")
        require(after["sensor_capture_result_frames"]>
                before["sensor_capture_result_frames"],
                "sensor_frames_did_not_progress")
        require(after["preroll_encoded_frames"]>before["preroll_encoded_frames"],
                "preroll_frames_did_not_progress")
        observations.append({
            "elapsed_s":round(time.monotonic()-start,2),
            "sensor_frames":after["sensor_capture_result_frames"]-before["sensor_capture_result_frames"],
            "preroll_encoded_frames":after["preroll_encoded_frames"]-before["preroll_encoded_frames"],
            "preroll_drops":0,
            "sensor_fps":after["sensor_result_fps"],
            "camera_pid_stable":True
        })
        transcripts.append(receipt)
    result=compare(transcripts,authorized_phone_delivery=True)
    result["run_source"]="owner_connected_s9_guarded_read_only"
    result["phone_execution_count"]=len(transcripts)
    result["camera_observations"]=observations
    print(json.dumps(result,sort_keys=True,indent=2))

if __name__=="__main__":
    p=argparse.ArgumentParser()
    m=p.add_mutually_exclusive_group(required=True)
    m.add_argument("--self-test",action="store_true")
    m.add_argument("--phone-verify",action="store_true")
    args=p.parse_args()
    if args.self_test:
        self_test()
    else:
        phone_verify()
