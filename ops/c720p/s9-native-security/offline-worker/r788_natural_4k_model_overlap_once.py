#!/usr/bin/env python3
"""R788 single invocation; guarded synthetic ONNX overlap with NATURAL 4K event.

NO background scheduler, looped task, artificial event, Camera2 change, faces,
real video decoding, identity embeddings, folder write or recording deletion.

Needs S9 original camera running and a naturally begun MediaRecorder session.
If no natural session is recording at invocation time, promptly abstain.
Only confirmed same-event recording before+after a phone-priority-nice15
synthetic ONNX x0.25 inference is eligible for a subsequent source-hash/
MediaExtractor PTS check of the finished native 4K MP4.

C720P only orchestrates / checks metadata; all ONNX runs on S9+.
Preliminary results are deliberately NOT evidence of person recognition.
"""
from __future__ import annotations
import argparse,datetime,hashlib,json,math,os,pathlib,re,subprocess,sys,time,urllib.request

PHONE="192.168.178.250:5555"
ROOT="/storage/9C33-6BBD/Android/data/nl.kalenel.s9security/files/Security4K"
PACKAGE="nl.kalenel.s9security"
STATUS_URL="http://127.0.0.1:18808/status"
ORIGINAL_APK_SHA="9aca447ce5e3e34a2d8360f9c40d9c4631c130b7fdc50fda9aeac931e9ad77da"
RESEARCH_MODEL="osnet_ain_x0_25_r744.onnx"
MODEL_SHA="e7adf72649332d97c613be93db17a047e526bf55fc8b7240f14a1da67390b7af"
VIDEO=re.compile(r"motion_[0-9]{13}[.]mp4")
PREROLL_SOURCE_LABELS_READ=0
MAX_SECONDS=18
MAX_FILE_BYTES=240_000_000
BASE="/data/local/tmp/s9_reid_r740"
ONE_SHOT_MARKER="S9_REID_V740_SYNTHETIC_PASS "
ENCODED_PTS_MARKER="S9_NATIVE4K_EVENT_R761 "

def need(ok,why):
    if not ok:raise ValueError(why)

def adb(*args,timeout=12):
    p=subprocess.run(["adb","-s",PHONE,*args],text=True,capture_output=True,timeout=timeout)
    need(p.returncode==0 and "error:" not in p.stderr[:160],
         "phone_status_or_command_unavailable")
    return p.stdout.strip()

def status():
    with urllib.request.urlopen(STATUS_URL,timeout=3) as r:
        need(r.status==200,"camera_status_http_not_200")
        data=r.read(750000+1)
        need(len(data)<750000,"camera_status_payload_not_bounded")
        return json.loads(data)

def phone_health():
    raw=adb("shell","pidof "+PACKAGE+
            ";awk '/MemAvailable:/{print $2}' /proc/meminfo"+
            ";dumpsys battery | awk '/temperature:/{print $2}'",timeout=10)
    x=[a.strip() for a in raw.splitlines() if a.strip()]
    need(len(x)==3 and all(v.isdecimal() for v in x),
         "phone_resource_check_incomplete")
    return {"pid":x[0],"mem_kib":int(x[1]),"battery_temp_c":int(x[2])/10.0}

def preflight(s,phone):
    why=[]
    def check(cond,name):
        if not cond:why.append(name)
    check(s.get("ok") is True,"camera_api_not_healthy")
    check(s.get("mode")=="recording","not_a_natural_recording_event")
    check(s.get("native_4k_enabled") is True,"native4k_disabled")
    check(s.get("recorder")=="camera2_3840x2160_h264","unexpected_camera_encoder")
    check(s.get("continuous_4k_trial_active") is False,
          "untested_experimental_continuous_encoder")
    check(s.get("preroll_diagnostic_active") is False,
          "diagnostic_or_forced_recorder_is_not_natural_event")
    check(s.get("failed")==0 and not s.get("last_error"),
          "existing_capture_error")
    check(type(s.get("recorded")) is int and s["recorded"]>=0,
          "record_counter_untrusted")
    check(type(s.get("preroll_dropped_frames")) is int and
          s["preroll_dropped_frames"]==0,"preexisting_preroll_drops")
    check(type(s.get("sensor_result_fps")) in (float,int) and
          math.isfinite(s["sensor_result_fps"]) and
          29<=s["sensor_result_fps"]<=31,"sensor_not_stable_30fps")
    check(type(s.get("temperature_c")) in (float,int) and
          math.isfinite(s["temperature_c"]) and
          s["temperature_c"]<38,"camera_too_hot_for_research")
    check(type(s.get("sensor_capture_result_frames")) is int,
          "sensor_frame_counter_invalid")
    check(type(s.get("sensor_exposure_ms")) in (float,int) and
          math.isfinite(s["sensor_exposure_ms"]) and
          0<s["sensor_exposure_ms"]<=33.35,
          "sensor_exposure_incompatible_with_30fps")
    check(type(s.get("last_frame_age_ms")) in (float,int) and
          0<=s["last_frame_age_ms"]<=350,
          "camera_preview_stale")
    # The live recorder's own startRecording() requires at least
    # 15 GiB free. Keep another GiB margin for the proof run.
    check(type(s.get("sd_free_bytes")) is int and
          s["sd_free_bytes"]>16*1024**3,"not_enough_source_storage")
    check(type(phone.get("mem_kib")) is int and
          phone["mem_kib"]>=1_700_000,
          "model_memory_may_reduce_capture")
    check(type(phone.get("battery_temp_c")) in (float,int) and
          phone["battery_temp_c"]<38.5,
          "phone_battery_too_hot")
    check(str(phone.get("pid","")).isdigit(),
          "phone_camera_pid_untrusted")
    return why

def continuity(before,after,phone0,phone1):
    errors=preflight(after,phone1)
    for label,cond in [
        ("camera_pid_changed",phone0.get("pid")==phone1.get("pid")),
        ("normal_recording_finished_before_probe_end",before.get("mode")==
         after.get("mode")=="recording"),
        ("recording_counter_changed_during_probe",before.get("recorded")==
         after.get("recorded")),
        ("existing_last_file_changed_during_probe",before.get("last_file")==
         after.get("last_file")),
        ("no_sensor_frames_during_probe",
         type(before.get("sensor_capture_result_frames")) is int and
         type(after.get("sensor_capture_result_frames")) is int and
         after["sensor_capture_result_frames"]>
         before["sensor_capture_result_frames"]),
        ("new_avc_drop_or_capture_error",
         before.get("preroll_dropped_frames")==
         after.get("preroll_dropped_frames") and
         before.get("failed")==after.get("failed"))
    ]:
        if not cond:errors.append(label)
    return errors

def verify_model_receipt(obj):
    need(obj.get("model_sha256")==MODEL_SHA and
         obj.get("batch")==1 and obj.get("feature_dim")==512 and
         obj.get("person_identity_validated") is False and
         obj.get("real_crops_processed")==0 and
         obj.get("auto_assignments")==0 and
         type(obj.get("timed_ms")) is list and
         len(obj["timed_ms"])==2 and
         all(type(x) in (float,int) and math.isfinite(x) and
             0<x<2000 for x in obj["timed_ms"]),
         "invalid_or_biometric_model_probe_receipt")



def verify_current_process_4k_attestation(baseline, current_pid):
    """Never let pre-restart camera evidence authorize new-process compute.

    A complete R786 result must be bound to the same currently recording
    camera PID; 4K files from a previous Android process cannot qualify.
    A verified 4K baseline is not itself proof of 4K under concurrent load.
    """
    need(type(baseline) is dict and
         baseline.get("schema")==
             "s9_r786_post_restart_completed_4k_capture_attestation_v1" and
         baseline.get("result")==
             "PASS_COMPLETED_NATIVE_4K_CAPTURE_BASELINE_FOR_SYNTHETIC_ONLY" and
         baseline.get("original_production_apk_sha256")==ORIGINAL_APK_SHA and
         str(baseline.get("same_phone_camera_pid"))==str(current_pid) and
         str(current_pid).isdigit() and
         baseline.get("phone_video_sha256_independently_rechecked") is True and
         type(baseline.get("new_sensor_frames")) is int and
         baseline["new_sensor_frames"]>0 and
         29<=baseline.get("native4k_steady_fps",-1)<=31 and
         baseline.get("native4k_event_during_concurrent_model_inference_proven") is False and
         baseline.get("automated_people_folder_filing_authorized") is False,
         "missing_or_stale_current_process_completed_4k_baseline")
    return True

def read_attestation_once(path):
    p=pathlib.Path(path)
    need(p.is_file() and not p.is_symlink() and
         100<p.stat().st_size<16000 and p.stat().st_mode&0o077==0 and
         0<=time.time()-p.stat().st_mtime<=48*3600,
         "4k_baseline_private_file_missing_or_stale")
    return json.loads(p.read_text(encoding="utf-8"))

def check_final(before,after,finish,phone0,phone1,source,pts):
    # Strictly require a *new* completed normal event after the exact
    # successful in-recording model probe; never attribute an older file.
    need(not continuity(before,after,phone0,phone1),
         "model_not_proven_to_overlap_uninterrupted_camera_recording")
    need(finish.get("mode")=="watching" and
         finish.get("recorded")==before["recorded"]+1 and
         finish.get("failed")==before["failed"] and
         finish.get("last_error")=="" and
         finish.get("preroll_dropped_frames")==before["preroll_dropped_frames"],
         "camera_event_completion_not_proven")
    name=finish.get("last_file")
    need(type(name) is str and VIDEO.fullmatch(name),
         "ordinary_motion_mp4_not_verified")
    need(source["filename"]==name and
         type(source["bytes"]) is int and
         10_000_000<=source["bytes"]<=MAX_FILE_BYTES and
         type(source["sha256"]) is str and
         re.fullmatch(r"[0-9a-f]{64}",source["sha256"]),
         "normal_source_not_sha_and_size_bound")
    need(pts.get("source_sha256_verified_on_s9")==source["sha256"] and
         pts.get("sha_checked_before_and_after_on_phone") is True and
         pts.get("original_source_bytes")==source["bytes"] and
         pts.get("resolution_width")==3840 and
         pts.get("resolution_height")==2160 and
         pts.get("finished_native4k_event_proven") is True and
         pts.get("steady_event_30fps_gap_check") is True and
         pts.get("steady_frame_gaps_over_100ms")==0 and
         29<=pts.get("steady_fps_after_first_ten_samples",-1)<=31 and
         pts.get("identity_or_folder_labels_read") is False and
         pts.get("people_folder_assignments")==0 and
         pts.get("candidate_model_inference_concurrent_with_original_capture_proven") is False,
         "completed_event_source_timing_not_verified")
    return {
        "status":"PASS_NATIVE_4K_EVENT_AND_SYNTHETIC_MODEL_OVERLAP",
        "model_inference_during_active_4k_event_attested":True,
        "native_4k_steady_fps":pts["steady_fps_after_first_ten_samples"],
        "strict_gap_free_4k":pts.get("strict_full_event_30fps_gap_check") is True,
        "startup_gap_still_present":pts.get("startup_gap_requires_separate_capture_fix") is True,
        "verified_native_source_sha256":source["sha256"],
        "recording_name_sha256":hashlib.sha256(name.encode()).hexdigest(),
        "person_identity_accuracy_proven":False,
        "people_folders_modified":False,
        "automatic_people_filing_authorized":False
    }

def self_test():
    s={"ok":True,"mode":"recording","native_4k_enabled":True,
       "recorder":"camera2_3840x2160_h264",
       "continuous_4k_trial_active":False,
       "preroll_diagnostic_active":False,
       "failed":0,"last_error":"","recorded":5,"last_file":"motion_1234567890123.mp4",
       "preroll_dropped_frames":0,"sensor_result_fps":30.02,
       "temperature_c":32.8,"sensor_capture_result_frames":100,
       "last_frame_age_ms":18,
       "sensor_exposure_ms":30.01,
       "sd_free_bytes":18*1024**3}
    phone={"pid":"31276","mem_kib":2_400_000,"battery_temp_c":33.5}
    after=dict(s,sensor_capture_result_frames=112)
    need(not preflight(s,phone),"valid_natural_event_refused")
    need(not continuity(s,after,phone,phone),"valid_same_event_overlap_refused")
    proof={"schema":"s9_r786_post_restart_completed_4k_capture_attestation_v1",
           "result":"PASS_COMPLETED_NATIVE_4K_CAPTURE_BASELINE_FOR_SYNTHETIC_ONLY",
           "original_production_apk_sha256":ORIGINAL_APK_SHA,
           "same_phone_camera_pid":phone["pid"],
           "phone_video_sha256_independently_rechecked":True,
           "new_sensor_frames":118,"native4k_steady_fps":30.015,
           "native4k_event_during_concurrent_model_inference_proven":False,
           "automated_people_folder_filing_authorized":False}
    need(verify_current_process_4k_attestation(proof,phone["pid"]),
         "valid_current_process_4k_evidence_was_refused")
    from copy import deepcopy
    stale_negatives=0
    for key,bad in [
        ("same_phone_camera_pid","5653"),
        ("original_production_apk_sha256","0"*64),
        ("new_sensor_frames",0),
        ("automated_people_folder_filing_authorized",True),
        ("phone_video_sha256_independently_rechecked",False),
        ("native4k_steady_fps",10),
    ]:
        altered=deepcopy(proof);altered[key]=bad
        try:verify_current_process_4k_attestation(altered,phone["pid"])
        except ValueError:stale_negatives+=1
        else:raise AssertionError("stale_or_unverified_4k_process_accepted_"+key)
    need(stale_negatives==6,"current_process_proof_negative_cases_wrong")
    negative=stale_negatives
    for key,bad in [
        ("mode","watching"),("native_4k_enabled",False),
        ("recorder","unknown"),("continuous_4k_trial_active",True),
        ("preroll_diagnostic_active",True),
        ("failed",1),("sensor_result_fps",15),
        ("temperature_c",40),("sensor_capture_result_frames",None),
        ("last_frame_age_ms",3000),("sd_free_bytes",0),
        ("sd_free_bytes",15*1024**3),
        ("sensor_exposure_ms",100),
        ("preroll_dropped_frames",1)]:
        v=dict(s,**{key:bad})
        need(preflight(v,phone),"unsafe_pre_capture_"+key+"_accepted");negative+=1
    for p in [dict(phone,mem_kib=500000),
              dict(phone,battery_temp_c=41),dict(phone,pid="")]:
        need(preflight(s,p),"unsafe_phone_resources_accepted");negative+=1
    for badname,badnext,newphone in [
        ("pid_changed",after,dict(phone,pid="9")),
        ("record_end",dict(after,mode="watching"),phone),
        ("new_error",dict(after,last_error="camera_fault"),phone),
        ("record_counter",dict(after,recorded=6),phone),
        ("no_frames",dict(after,sensor_capture_result_frames=100),phone),
        ("more_drops",dict(after,preroll_dropped_frames=1),phone)]:
        need(continuity(s,badnext,phone,newphone),
             "unsafe_mid_capture_"+badname+"_accepted");negative+=1
    model={"model_sha256":MODEL_SHA,"batch":1,"feature_dim":512,
           "person_identity_validated":False,"real_crops_processed":0,
           "auto_assignments":0,"timed_ms":[20.1,19.8]}
    verify_model_receipt(model)
    for key,value in [("batch",16),("person_identity_validated",True),
                      ("real_crops_processed",1),("auto_assignments",1),
                      ("model_sha256","0"*64)]:
        try:verify_model_receipt(dict(model,**{key:value}))
        except ValueError:negative+=1
        else:raise AssertionError("unsafe_model_receipt_"+key+"_accepted")
    finishing=dict(s,mode="watching",recorded=6,last_error="",
                   last_file="motion_1795146172753.mp4")
    source={"filename":finishing["last_file"],"sha256":"a"*64,"bytes":40000000}
    pts={"source_sha256_verified_on_s9":"a"*64,
         "sha_checked_before_and_after_on_phone":True,
         "original_source_bytes":40000000,
         "resolution_width":3840,"resolution_height":2160,
         "finished_native4k_event_proven":True,"steady_event_30fps_gap_check":True,
         "steady_frame_gaps_over_100ms":0,"steady_fps_after_first_ten_samples":30.015,
         "identity_or_folder_labels_read":False,"people_folder_assignments":0,
         "candidate_model_inference_concurrent_with_original_capture_proven":False,
         "strict_full_event_30fps_gap_check":False,
         "startup_gap_requires_separate_capture_fix":True}
    result=check_final(s,after,finishing,phone,phone,source,pts)
    need(result["model_inference_during_active_4k_event_attested"] is True and
         result["automatic_people_filing_authorized"] is False,
         "synthetic_completion_model_permission_leak")
    for k,v in [
        ("last_file","diagnostic_preroll_1795146172753.mp4"),
        ("recorded",7),("mode","recording")]:
        try:check_final(s,after,dict(finishing,**{k:v}),
                        phone,phone,source,pts)
        except ValueError:negative+=1
        else:raise AssertionError("invalid_final_event_"+k+"_accepted")
    try:check_final(s,after,finishing,phone,phone,source,
                    dict(pts,steady_event_30fps_gap_check=False))
    except ValueError:negative+=1
    else:raise AssertionError("failed_source_continuity_accepted")
    print(json.dumps({
        "status":"R788_NATURAL_EVENT_ONLY_CONCURRENCY_GATE_SYNTHETIC_PASS",
        "negative_cases":negative,
        "forced_camera_recording":False,"new_scheduled_jobs":False,
        "person_identity_data_processed":False,
        "production_people_auto_filing_authorized":False
    },sort_keys=True))

def live_once(seconds:int, attestation_path):
    need(type(seconds) is int and 0<=seconds<=20,"one_shot_wait_out_of_bounds")
    def outcome(message,**kwargs):
        print(json.dumps({"schema":"s9_r788_natural_4k_overlap_v1",
              "status":message,"model_ran":False,
              "camera_action_performed":False,
              "new_scheduled_jobs":False,
              "automatic_people_filing_authorized":False,**kwargs},
              sort_keys=True),flush=True)
    start=time.monotonic()
    phone=phone_health()
    old=status()
    # Conserve camera resources: only query for a bounded time if requested.
    while old.get("mode")!="recording" and time.monotonic()-start<seconds:
        time.sleep(.3)
        old=status()
    if old.get("mode")!="recording":
        return outcome("NO_NATURAL_RECORDING_ACTIVE_NO_ACTION",
                       last_seen_camera_mode=old.get("mode"))
    reasons=preflight(old,phone)
    if reasons:return outcome("REFUSED_UNSAFE_IN_RECORDING_PROBE",reasons=reasons)
    try:
        attestation=read_attestation_once(attestation_path)
        verify_current_process_4k_attestation(attestation,phone["pid"])
    except (ValueError,OSError,TypeError,AttributeError) as e:
        return outcome("REFUSED_STALE_OR_MISSING_4K_PROCESS_ATTESTATION",
                       reason=type(e).__name__)
    sha=adb("shell","F=$(pm path "+PACKAGE+" | sed -n '1s/^package://p');sha256sum \"$F\"",timeout=12).split()[0]
    if sha!=ORIGINAL_APK_SHA:
        return outcome("REFUSED_CAMERAPK_NOT_PINNED_ORIGINAL")
    time.sleep(.30)
    phone=phone_health()
    old=status()
    reasons=preflight(old,phone)
    if reasons:return outcome("REFUSED_UNSAFE_IN_RECORDING_PROBE",reasons=reasons)
    # S9 device itself performs all model CPU work. The hub only starts it
    # and interprets a JSON receipt of 512D dimensionality, not any vector.
    cmd=("CLASSPATH="+BASE+"/probe_r740_batch16.dex.jar:"+
         "/data/local/tmp/s9_worker/s9-worker.jar "+
         "LD_LIBRARY_PATH=/data/local/tmp/s9_worker/lib "+
         "nice -n 15 /system/bin/app_process "+
         "-Djava.library.path=/data/local/tmp/s9_worker/lib "+
         "/system/bin nl.kalenel.s9offline.S9ReidSyntheticProbeV740 "+
         "--synthetic "+BASE+"/"+RESEARCH_MODEL+" "+MODEL_SHA)
    probe=subprocess.run(["adb","-s",PHONE,"shell",cmd],
                         capture_output=True,text=True,timeout=13)
    lines=[x[len(ONE_SHOT_MARKER):] for x in probe.stdout.splitlines()
           if x.startswith(ONE_SHOT_MARKER)]
    if probe.returncode or len(lines)!=1:
        return outcome("MODEL_PROCESS_FAILED_NO_CONCURRENCY_CLAIM",
                       model_returncode=probe.returncode)
    model=json.loads(lines[0])
    verify_model_receipt(model)
    after=status();newphone=phone_health()
    diff=continuity(old,after,phone,newphone)
    if diff:return outcome("REFUSED_INCOMPLETE_CAPTURE_OVERLAP",
                           reasons=diff,model_ran=True,
                           synthetic_only=True)
    print(json.dumps({"schema":"s9_r788_natural_4k_overlap_v1",
                       "status":"SYNTHETIC_INFERENCE_OVERLAP_DURING_ACTIVE_4K_EVENT",
                       "camera_pid":phone["pid"],
                       "model_sha256":MODEL_SHA,
                       "model_warmup_ms":model["warmup_ms"],
                       "model_timed_ms":model["timed_ms"],
                       "new_sensor_frames":after["sensor_capture_result_frames"]-
                                           old["sensor_capture_result_frames"],
                       "model_ran":True,
                       "camera_action_performed":False,
                       "fresh_completed_event_verified":False,
                       "automatic_people_filing_authorized":False},
                     sort_keys=True),flush=True)
    # Natural events may last >120 seconds. A single short observation
    # must NOT falsely claim a completed MP4 while no file is finalized.
    finish=None
    deadline=time.monotonic()+15
    while time.monotonic()<deadline:
        current=status()
        if (current.get("mode")=="watching" and
            current.get("recorded")==old["recorded"]+1):
            finish=current
            break
        if (current.get("failed",0)>old["failed"] or
            current.get("preroll_dropped_frames",0)>old["preroll_dropped_frames"]):
            break
        time.sleep(.5)
    if finish is None:
        return outcome("MODEL_OVERLAP_VERIFIED_EVENT_NOT_YET_FINALIZED",
                       model_ran=True,synthetic_only=True,
                       completed_native_mp4_evidence=False)
    filename=finish.get("last_file")
    if type(filename) is not str or not VIDEO.fullmatch(filename):
        return outcome("REFUSED_NONORDINARY_FINAL_CLIP_NAME",model_ran=True)
    stats=adb("shell","stat -c %s "+ROOT+"/"+filename,timeout=9)
    need(stats.isdecimal(),"completed_file_size_not_verified")
    count=int(stats)
    if not 10_000_000<=count<=MAX_FILE_BYTES:
        return outcome("REFUSED_UNBOUNDED_FINISHED_VIDEO",model_ran=True)
    checksum=adb("shell","sha256sum "+ROOT+"/"+filename,timeout=17).split()[0]
    need(bool(re.fullmatch("[a-f0-9]{64}",checksum)),"completed_sha_invalid")
    source={"filename":filename,"bytes":count,"sha256":checksum}
    # R761 phone-only MediaExtractor reports PTS metadata and SHA. It never
    # decodes a frame. Actual original SHA is checked before and after.
    nonce=os.urandom(16).hex()
    command=("CLASSPATH="+BASE+"/r766_start_sample_inspector.dex.jar "+
             "nice -n 15 /system/bin/app_process /system/bin "+
             "nl.kalenel.s9offline.S9OriginalNative4KEventTimingV761 "+
             "--verified-native4k-original "+filename+" "+
             checksum+" "+str(count)+" "+nonce)
    check=subprocess.run(["adb","-s",PHONE,"shell",command],
                         capture_output=True,text=True,timeout=27)
    output=[line[len(ENCODED_PTS_MARKER):]
            for line in check.stdout.splitlines()
            if line.startswith(ENCODED_PTS_MARKER)]
    if check.returncode or len(output)!=1:
        return outcome("SOURCE_PTS_UNVERIFIED_NO_COMPLETE_EVENT_CLAIM",
                       model_ran=True,synthetic_only=True)
    pts=json.loads(output[0])
    need(pts.get("nonce")==nonce,"phone_pts_nonce_mismatch")
    # Confirm same live camera process was uninterrupted through capture.
    afterphone=phone_health()
    if afterphone["pid"]!=phone["pid"]:
        return outcome("SOURCE_PTS_VERIFIED_BUT_CAMERA_PID_CHANGED",
                       model_ran=True)
    final=check_final(old,after,finish,phone,afterphone,source,pts)
    print(json.dumps({"schema":"s9_r788_natural_4k_overlap_v1",
                      "model_onnx_sha256":MODEL_SHA,
                      "model_ran_on_s9_phone":True,
                      "concurrent_4k_capture":True,
                      "source_sha_double_checked_on_s9":True,
                      "camera_action_performed":False,
                      "new_scheduled_jobs":False,**final},sort_keys=True))
    return

def main():
    p=argparse.ArgumentParser()
    mode=p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--self-test",action="store_true")
    mode.add_argument("--live-once",action="store_true")
    p.add_argument("--wait-seconds",type=int,default=0)
    p.add_argument("--baseline-receipt",default=(
        "/home/jespern/c720p-home-hub/staging/"
        "recognition-r744-ain-small-model-assets-20261120/"
        "r785_native4k_post_restore_diagnostic/post_restart_attestation.json"))
    a=p.parse_args()
    if a.self_test:return self_test()
    live_once(a.wait_seconds,a.baseline_receipt)

if __name__=="__main__":
    try:main()
    except (ValueError,OSError,subprocess.SubprocessError,TimeoutError,
            RuntimeError) as e:
        print(json.dumps({"schema":"s9_r788_natural_4k_overlap_v1",
              "status":"REFUSED_PROBE_OR_EVIDENCE_INVALID",
              "error_type":type(e).__name__,
              "camera_or_recordings_modified":False,
              "new_scheduled_jobs":False,
              "automatic_people_filing_authorized":False},sort_keys=True))
        raise SystemExit(2)
