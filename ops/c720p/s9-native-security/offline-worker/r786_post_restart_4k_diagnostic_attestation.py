#!/usr/bin/env python3
"""R786: independently attest a *completed diagnostic* 4K baseline.

Reads status, one phone-only diagnostic MP4 checksum, companion checksum,
and the exact live installed APK checksum. Does NOT read images, identify
people, start captures, change the camera or grant production recognition.

This provides a distinct and tightly scoped milestone after an APK restart:
  (1) true native-4K capture with steady-state ~30FPS shown by R785, versus
  (2) a native-4K capture DURING real model inference, not yet proved.
R759 remains authoritative for automatic People-folder filing.
"""
from __future__ import annotations
import argparse,datetime,json,os,pathlib,re,subprocess,time,urllib.request

PHONE="192.168.178.250:5555"
SERVICE="nl.kalenel.s9security"
ROOT="/storage/9C33-6BBD/Android/data/"+SERVICE+"/files/Security4K"
STATUS_URL="http://127.0.0.1:18808/status"
EXPECTED_ORIGINAL_APK_SHA=("9aca447ce5e3e34a2d8360f9c40d9c4631c130b7fdc50fda9aeac931e9ad77da")
CLIP=re.compile(r"diagnostic_preroll_[0-9]{13}[.]mp4")
SHA=re.compile(r"[0-9a-f]{64}")
MAX_AGE_MS=3*3600*1000

def need(condition,code):
    if not condition:raise ValueError(code)

def read_private_json(filename):
    p=pathlib.Path(filename)
    need(p.is_file() and not p.is_symlink(),"receipt_not_regular")
    st=p.stat()
    need(st.st_size<262144 and st.st_size>100 and st.st_mode & 0o077==0,
         "receipt_size_or_privacy_invalid")
    return json.loads(p.read_text(encoding="utf-8"))

def parse_case(capture,ledger,now_ms):
    need(capture.get("schema")==
         "s9_r785_owner_one_shot_native_4k_post_restore_diagnostic_v1",
         "capture_receipt_wrong_schema")
    need(capture.get("diagnostic_attempts")==1 and
         capture.get("diagnostic_completed") is True and
         capture.get("source_identity_training_enabled") is not True,
         "diagnostic_failed_or_untrusted")
    need(capture.get("capturing_process_pid_stable") is True,
         "diagnostic_process_changed")
    need(capture.get("original_apk_sha256")==EXPECTED_ORIGINAL_APK_SHA,
         "capture_apk_not_verified_original")
    need(ledger.get("schema")==
         "s9_r785_excluded_diagnostic_completed_4k_and_companion_phone_ledger_v1",
         "source_timing_ledger_wrong_schema")
    need(ledger.get("source_sha_double_checked_on_s9") is True and
         ledger.get("native4k_file_completed_in_current_camera_process") is True and
         ledger.get("exact_phone_camera_pid_stable") is True and
         ledger.get("candidate_model_concurrent_during_capture") is False and
         ledger.get("diagnostic_never_eligible_as_prospective_identity_trial") is True and
         ledger.get("recordings_deleted")==0 and
         ledger.get("original_apk_sha256")==EXPECTED_ORIGINAL_APK_SHA,
         "ledger_not_independent_camera_capture")
    clip=ledger.get("clip_name")
    need(type(clip) is str and CLIP.fullmatch(clip),
         "diagnostic_clip_filename_invalid")
    capture_clip=capture.get("post_status",{}).get("preroll_diagnostic_clip")
    need(clip==capture_clip and
         capture.get("post_status",{}).get("preroll_diagnostic_used") is True and
         str(capture.get("post_status",{}).get("preroll_diagnostic_result","")).startswith(
             "4k_finalized_preroll_writing"),
         "diagnostic_result_and_video_mismatch")
    epoch=int(clip[len("diagnostic_preroll_"):-len(".mp4")])
    need(0<=now_ms-epoch<=MAX_AGE_MS,"stale_or_future_post_restart_diagnostic")
    files=ledger.get("files")
    need(type(files) is list and len(files)==2,
         "wrong_number_of_diagnostic_files")
    indexed={}
    for item in files:
        name=item.get("kind")
        need(name in ("native4k","preroll") and name not in indexed,
             "duplicate_or_unknown_diagnostic_type")
        indexed[name]=item
        need(type(item.get("sha256")) is str and
             SHA.fullmatch(item["sha256"]) and
             type(item.get("bytes")) is int and item["bytes"]>100_000,
             "unverified_source_digest_or_bytes")
    need(set(indexed)=={"native4k","preroll"},
         "diagnostic_pair_missing")
    native=indexed["native4k"];enc=native.get("evidence",{})
    need(native["bytes"]>=10_000_000 and native["bytes"]<240_000_000 and
         enc.get("steady_event_30fps_gap_check") is True and
         29<=enc.get("steady_fps_after_first_ten_samples",-1)<=31 and
         enc.get("steady_frame_gaps_over_100ms") ==0 and
         enc.get("nonmonotonic_pts")==0 and
         8_000<=enc.get("duration_ms",-1)<=12_000 and
         enc.get("encoded_video_sample_count",0)>=230 and
         str(enc.get("result","")).startswith("STEADY_NATIVE_4K_TIMING_PASS"),
         "verified_full_4k_stable_30fps_not_proven")
    need(enc.get("startup_gap_requires_separate_capture_fix") is True and
         enc.get("strict_full_event_30fps_gap_check") is False,
         "startup_gap_must_remain_explicit_nonpass")
    preroll=indexed["preroll"];pc=preroll.get("evidence",{})
    need(pc.get("nonmonotonic_pts_count")==0 and
         pc.get("video_samples",0)>=35 and
         pc.get("duration_ms",0)>=3_000 and
         5<=pc.get("average_sample_fps",-1)<=30,
         "paired_preroll_encoded_track_not_verified")
    return {
        "clip":clip,
        "expected_sha4k":native["sha256"],
        "expected_sha_preroll":preroll["sha256"],
        "source_bytes_4k":native["bytes"],
        "source_bytes_preroll":preroll["bytes"],
        "native4k_steady_fps":enc["steady_fps_after_first_ten_samples"],
        "preroll_average_fps":pc["average_sample_fps"],
        "max_native4k_startup_gap_ms":enc["max_sample_interval_ms"],
        "original_capture_pid":str(capture.get("capturing_process_pid","")) if
           capture.get("capturing_process_pid") is not None else None
    }

def adb(*args,timeout=10):
    p=subprocess.run(["adb","-s",PHONE,*args],capture_output=True,text=True,timeout=timeout)
    need(p.returncode==0 and not p.stderr.strip().startswith("error:"),
         "adb_source_inspection_failed")
    return p.stdout.strip()

def live_status():
    with urllib.request.urlopen(STATUS_URL,timeout=4) as r:
        need(r.status==200,"camera_status_http_failure")
        raw=r.read(1024*1024+1)
        need(len(raw)<1024*1024,"camera_status_too_large")
        return json.loads(raw)

def live_status_guard(s,clip):
    need(s.get("ok") is True and s.get("native_4k_enabled") is True and
         s.get("mode")=="watching" and s.get("preroll_ready") is True and
         s.get("preroll_diagnostic_used") is True and
         s.get("preroll_diagnostic_active") is False and
         s.get("preroll_diagnostic_clip")==clip and
         str(s.get("preroll_diagnostic_result","")).startswith(
             "4k_finalized_preroll_writing"),
         "camera_process_has_not_confirmed_completed_same_diagnostic")
    need(s.get("failed")==0 and not s.get("last_error") and
         s.get("preroll_dropped_frames")==0 and
         s.get("sensor_result_fps",0)>=29 and
         s.get("temperature_c",100)<39 and
         s.get("preroll_buffered_ms",0)>=5000 and
         s.get("continuous_4k_last_result")=="not_tested",
         "camera_liveness_or_unverified_diagnostic_reset")
    return True

def live(capture,ledger):
    facts=parse_case(capture,ledger,int(time.time()*1000))
    old=live_status()
    live_status_guard(old,facts["clip"])
    package_path=adb("shell","pm path "+SERVICE,timeout=7)
    need(package_path.startswith("package:/") and
         len(package_path.splitlines())==1 and
         package_path[8:].startswith("/data/app/"),
         "installed_camera_package_location_untrusted")
    package_sha=adb("shell","sha256sum "+package_path[8:],timeout=12).split()[0]
    need(package_sha==EXPECTED_ORIGINAL_APK_SHA,
         "running_camera_apk_is_not_pinned_original")
    pid=adb("shell","pidof "+SERVICE,timeout=8)
    need(pid.isdigit() and pid==str(capture.get("camera_pid",pid)),
         "phone_process_changed_since_diagnostic")
    # For this exact diagnostic prefix, do not broaden to ordinary motion
    # source names or any Person-folder reference material.
    hashes={}
    for name,expected in (
        (facts["clip"],facts["expected_sha4k"]),
        (facts["clip"]+".preroll.mp4",facts["expected_sha_preroll"])):
        actual=adb("shell","sha256sum "+ROOT+"/"+name,timeout=16)
        parts=actual.split()
        need(len(parts)>=2 and parts[0]==expected and
             parts[1].endswith("/"+name),
             "source_sha_changed_since_completed_diagnostic")
        hashes[name]=expected
    time.sleep(2)
    new=live_status()
    live_status_guard(new,facts["clip"])
    new_pid=adb("shell","pidof "+SERVICE,timeout=8)
    need(new_pid==pid,"camera_restarted_during_post_capture_attestation")
    need(new.get("sensor_capture_result_frames",0)>
         old.get("sensor_capture_result_frames",float("inf")),
         "camera_sensor_not_advancing")
    need(new.get("preroll_encoded_frames",0)>
         old.get("preroll_encoded_frames",float("inf")),
         "preroll_not_advancing_after_4k_event")
    return {
        "schema":"s9_r786_post_restart_completed_4k_capture_attestation_v1",
        "result":"PASS_COMPLETED_NATIVE_4K_CAPTURE_BASELINE_FOR_SYNTHETIC_ONLY",
        "original_production_apk_sha256":package_sha,
        "same_phone_camera_pid":pid,
        "native4k_diagnostic_original_sha256":facts["expected_sha4k"],
        "preroll_companion_sha256":facts["expected_sha_preroll"],
        "new_sensor_frames":new["sensor_capture_result_frames"]-
                             old["sensor_capture_result_frames"],
        "native4k_steady_fps":facts["native4k_steady_fps"],
        "paired_preroll_fps":facts["preroll_average_fps"],
        "max_native4k_startup_interval_ms":
            facts["max_native4k_startup_gap_ms"],
        "strict_gap_free_4k_output_proven":False,
        "separate_4k_startup_gap_fix_still_needed":True,
        "phone_video_sha256_independently_rechecked":True,
        "native4k_event_during_concurrent_model_inference_proven":False,
        "person_identity_recognition_accuracy_proven":False,
        "automated_people_folder_filing_authorized":False,
        "original_user_video_or_labels_modified":False,
        "status":"DIAGNOSTIC_CAPTURE_BASELINE_ONLY"
    }

def self_test():
    now=1795146172753+1000
    clip="diagnostic_preroll_1795146172753.mp4"
    digest="a"*64
    d={
        "schema":"s9_r785_owner_one_shot_native_4k_post_restore_diagnostic_v1",
        "diagnostic_attempts":1,"diagnostic_completed":True,
        "capturing_process_pid_stable":True,
        "original_apk_sha256":EXPECTED_ORIGINAL_APK_SHA,
        "post_status":{"preroll_diagnostic_used":True,
          "preroll_diagnostic_result":"4k_finalized_preroll_writing",
          "preroll_diagnostic_clip":clip},
    }
    record={
        "schema":"s9_r785_excluded_diagnostic_completed_4k_and_companion_phone_ledger_v1",
        "source_sha_double_checked_on_s9":True,
        "native4k_file_completed_in_current_camera_process":True,
        "exact_phone_camera_pid_stable":True,
        "candidate_model_concurrent_during_capture":False,
        "diagnostic_never_eligible_as_prospective_identity_trial":True,
        "recordings_deleted":0,
        "original_apk_sha256":EXPECTED_ORIGINAL_APK_SHA,
        "clip_name":clip,
        "files":[{"kind":"native4k","sha256":digest,"bytes":40000000,
                  "evidence":{"steady_event_30fps_gap_check":True,
                              "steady_fps_after_first_ten_samples":30.015,
                              "steady_frame_gaps_over_100ms":0,
                              "nonmonotonic_pts":0,"duration_ms":8940.4,
                              "encoded_video_sample_count":264,
                              "result":"STEADY_NATIVE_4K_TIMING_PASS_WITH_STARTUP_GAP",
                              "startup_gap_requires_separate_capture_fix":True,
                              "strict_full_event_30fps_gap_check":False,
                              "max_sample_interval_ms":178.277}},
                 {"kind":"preroll","sha256":"b"*64,"bytes":1000000,
                  "evidence":{"nonmonotonic_pts_count":0,
                              "video_samples":87,"duration_ms":5874.1,
                              "average_sample_fps":14.82}}]
    }
    assert parse_case(d,record,now)["native4k_steady_fps"]==30.015
    negative=0
    def refuses(c,l,t,why):
        nonlocal negative
        try:parse_case(c,l,t)
        except ValueError as e:
            need(why in str(e),"wrong_refusal_"+str(e))
            negative+=1
        else:raise AssertionError("unsafe_diagnostic_baseline_accepted_"+why)
    import copy
    fails=[
        ("camera_process_changed",lambda c,l:c.update(capturing_process_pid_stable=False)),
        ("source_timing_ledger_wrong_schema",lambda c,l:l.update(schema="wrong")),
        ("diagnostic_result_and_video_mismatch",lambda c,l:c["post_status"].update(
            preroll_diagnostic_clip="other")),
        ("diagnostic_clip_filename_invalid",lambda c,l:l.update(
            clip_name="motion_1795146172753.mp4")),
        ("ledger_not_independent_camera_capture",lambda c,l:l.update(
            candidate_model_concurrent_during_capture=True)),
        ("wrong_number_of_diagnostic_files",lambda c,l:l.update(files=[])),
        ("verified_full_4k_stable_30fps_not_proven",lambda c,l:l["files"][0][
            "evidence"].update(steady_fps_after_first_ten_samples=10)),
        ("startup_gap_must_remain_explicit_nonpass",lambda c,l:l["files"][0][
            "evidence"].update(strict_full_event_30fps_gap_check=True)),
        ("paired_preroll_encoded_track_not_verified",lambda c,l:l["files"][1][
            "evidence"].update(average_sample_fps=0)),
        ("capture_apk_not_verified_original",lambda c,l:c.update(
            original_apk_sha256="b"*64)),
    ]
    for error,mutate in fails:
        c=copy.deepcopy(d);l=copy.deepcopy(record)
        mutate(c,l);refuses(c,l,now,error)
    refuses(copy.deepcopy(d),copy.deepcopy(record),now+MAX_AGE_MS+1,
            "stale_or_future_post_restart_diagnostic")
    print(json.dumps({"result":"R786_CAPTURE_BASELINE_GATE_SYNTHETIC_PASS",
                      "negative_cases":negative,
                      "production_model_release_approved":False,
                      "phone_camera_touched":False},sort_keys=True))

def main():
    p=argparse.ArgumentParser()
    modes=p.add_mutually_exclusive_group(required=True)
    modes.add_argument("--self-test",action="store_true")
    modes.add_argument("--live",action="store_true")
    p.add_argument("--capture-status")
    p.add_argument("--timing-ledger")
    a=p.parse_args()
    if a.self_test:return self_test()
    need(a.capture_status and a.timing_ledger,"missing_capture_and_timing_receipts")
    print(json.dumps(live(read_private_json(a.capture_status),
                          read_private_json(a.timing_ledger)),sort_keys=True))

if __name__=="__main__":main()
