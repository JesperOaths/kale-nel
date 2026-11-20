#!/usr/bin/env python3
"""R798: one-shot direct natural 4K event + phone-only synthetic ONNX overlap.

R788 strictly requires a prior completed diagnostic baseline in the CURRENT
camera process; after an external stop that proof is stale. This is a
separate, non-promoting path which uses the currently active NATURAL event
itself for end-to-end source proof: read-only capture status before and after
real 512D *synthetic* ONNX computation, exact PID/telemetry, that SAME completed
motion MP4 double SHA-256 checked directly on the S9, and MediaExtractor
3840x2160 encoded PTS with steady ~30FPS.

No manual recording, Camera2/MediaRecorder change, face/ROI input, identity
labels, People-folder assignment, new worker, cron or scheduled job. Runs
only when explicitly invoked, never retries unattended. R759's recognition
release gate remains authoritative and blocked.
"""
from __future__ import annotations
import argparse,hashlib,json,math,os,re,subprocess,time
import r788_natural_4k_model_overlap_once as existing

SCHEMA="s9_r798_direct_single_natural_4k_onnx_overlap_v1"

def ok(s,p,apk):
    reasons=existing.preflight(s,p)
    if apk!=existing.ORIGINAL_APK_SHA:
        reasons.append("installed_camera_apk_not_the_original_sha")
    return reasons

def synthetic():
    s={"ok":True,"mode":"recording","native_4k_enabled":True,
       "recorder":"camera2_3840x2160_h264",
       "continuous_4k_trial_active":False,"preroll_diagnostic_active":False,
       "failed":0,"last_error":"","recorded":9,
       "last_file":"motion_1234567890123.mp4",
       "preroll_dropped_frames":0,"sensor_result_fps":30.02,
       "temperature_c":32.5,"sensor_capture_result_frames":910,
       "last_frame_age_ms":15,"sensor_exposure_ms":30.0,
       "sd_free_bytes":48*1024**3}
    phone={"pid":"7091","mem_kib":2_500_000,"battery_temp_c":32.5}
    assert not ok(s,phone,existing.ORIGINAL_APK_SHA)
    invalid=[
        (s,phone,"f"*64),
        (dict(s,mode="watching"),phone,existing.ORIGINAL_APK_SHA),
        (dict(s,recorder="continuous_4k_unverified"),phone,existing.ORIGINAL_APK_SHA),
        (dict(s,preroll_diagnostic_active=True),phone,existing.ORIGINAL_APK_SHA),
        (dict(s,sensor_result_fps=10),phone,existing.ORIGINAL_APK_SHA),
        (dict(s,sensor_exposure_ms=99),phone,existing.ORIGINAL_APK_SHA),
        (dict(s,sd_free_bytes=15*1024**3),phone,existing.ORIGINAL_APK_SHA),
        (dict(s,preroll_dropped_frames=1),phone,existing.ORIGINAL_APK_SHA),
        (dict(s,failed=1),phone,existing.ORIGINAL_APK_SHA),
        (dict(s,temperature_c=45),phone,existing.ORIGINAL_APK_SHA),
        (s,dict(phone,mem_kib=1_300_000),existing.ORIGINAL_APK_SHA),
        (s,dict(phone,battery_temp_c=39),existing.ORIGINAL_APK_SHA),
    ]
    for idx,(a,b,c) in enumerate(invalid):
        assert ok(a,b,c),f"invalid_live_source_accepted_{idx}"
    after=dict(s,sensor_capture_result_frames=912)
    assert not existing.continuity(s,after,phone,phone)
    assert "camera_pid_changed" in existing.continuity(
        s,after,phone,dict(phone,pid="4444"))
    assert "no_sensor_frames_during_probe" in existing.continuity(
        s,dict(s),phone,phone)
    receipt={"model_sha256":existing.MODEL_SHA,"batch":1,
             "feature_dim":512,"person_identity_validated":False,
             "real_crops_processed":0,"auto_assignments":0,
             "timed_ms":[16.2,17.1]}
    existing.verify_model_receipt(receipt)
    try:existing.verify_model_receipt(dict(receipt,real_crops_processed=1))
    except ValueError:pass
    else:raise AssertionError("real_identity_crop_was_not_rejected")
    print(json.dumps({"status":"R798_DIRECT_NATURAL_EVENT_SYNTHETIC_GUARDS_PASS",
         "unsafe_initial_states_rejected":len(invalid),
         "additional_continuity_and_model_checks":4,
         "requires_a_prior_diagnostic_video":False,
         "requires_same_active_natural_event_source_mp4_double_sha_and_pts":True,
         "synthetic_model_only":True,
         "phone_or_original_videos_modified":False,
         "scheduled_jobs_created":0,"auto_people_filing_authorized":False},
         sort_keys=True))

def run(*argv,timeout=15):
    p=subprocess.run(list(argv),capture_output=True,text=True,timeout=timeout)
    existing.need(p.returncode==0,"phone_readonly_or_model_command_failed")
    return p.stdout.strip()

def live(wait_seconds,finish_wait):
    existing.need(type(wait_seconds) is int and 0<=wait_seconds<=10,
                  "natural_wait_must_be_one_shot_short")
    existing.need(type(finish_wait) is int and 0<=finish_wait<=15,
                  "completion_wait_must_be_one_shot_short")
    def abstain(name,**kw):
        print(json.dumps({
            "schema":SCHEMA,"status":name,
            "camera_control_actions":0,"real_video_or_face_crops_decoded":0,
            "people_folders_modified":False,"new_scheduled_jobs":False,
            "automatic_people_folder_filing_authorized":False,**kw},
            sort_keys=True),flush=True)
    start=time.monotonic()
    camera=existing.status()
    while camera.get("mode")!="recording" and time.monotonic()-start<wait_seconds:
        time.sleep(.4)
        camera=existing.status()
    if camera.get("mode")!="recording":
        return abstain("NO_NATURAL_ACTIVE_4K_EVENT_NO_ACTION",
                       camera_mode=camera.get("mode"),model_ran=False)
    firstpid=existing.phone_health()
    reasons=existing.preflight(camera,firstpid)
    if reasons:
        return abstain("REFUSED_UNHEALTHY_NATURAL_RECORDING",
                       reasons=reasons,model_ran=False)
    # This probe deliberately does NOT accept a stale prior R786 baseline.
    # Instead it must eventually physically prove *this precise finished
    # new MP4* under the same PID as synthetic on-phone model inference.
    installed=existing.adb(
        "shell","F=$(pm path "+existing.PACKAGE+
        " | sed -n '1s/^package://p'); sha256sum \"$F\"",
        timeout=11).split()[0]
    reasons=ok(camera,firstpid,installed)
    if reasons:
        return abstain("REFUSED_NONORIGINAL_CAMERA_OR_UNSAFE_RESOURCES",
                       reasons=reasons,model_ran=False)
    # Re-sample immediately before inference. Model is never invoked for
    # older records or if the natural event already ended.
    time.sleep(.2)
    first=existing.status()
    phone=existing.phone_health()
    if phone["pid"]!=firstpid["pid"] or existing.preflight(first,phone):
        return abstain("REFUSED_CAMERA_CHANGED_BEFORE_MODEL",model_ran=False)
    command=("CLASSPATH="+existing.BASE+"/probe_r740_batch16.dex.jar:"+
             "/data/local/tmp/s9_worker/s9-worker.jar "+
             "LD_LIBRARY_PATH=/data/local/tmp/s9_worker/lib "+
             "nice -n 15 /system/bin/app_process "+
             "-Djava.library.path=/data/local/tmp/s9_worker/lib "+
             "/system/bin nl.kalenel.s9offline.S9ReidSyntheticProbeV740 "+
             "--synthetic "+existing.BASE+"/"+existing.RESEARCH_MODEL+
             " "+existing.MODEL_SHA)
    result=subprocess.run(
        ["adb","-s",existing.PHONE,"shell",command],
        capture_output=True,text=True,timeout=13)
    marker=existing.ONE_SHOT_MARKER
    observations=[
        line[len(marker):] for line in result.stdout.splitlines()
        if line.startswith(marker)]
    if result.returncode or len(observations)!=1:
        return abstain("MODEL_PROBE_NOT_PROVEN_NO_CAPTURE_CLAIM",
                       model_ran=False,model_process_status=result.returncode)
    receipt=json.loads(observations[0])
    existing.verify_model_receipt(receipt)
    during=existing.status()
    post_phone=existing.phone_health()
    violations=existing.continuity(first,during,phone,post_phone)
    if violations:
        return abstain("REFUSED_UNINTERRUPTED_4K_OVERLAP_NOT_PROVEN",
                       model_ran=True,reasons=violations)
    print(json.dumps({
        "schema":SCHEMA,"status":"SYNTHETIC_ONNX_DURING_REAL_4K_EVENT",
        "current_process_pid":phone["pid"],
        "model_sha256":existing.MODEL_SHA,
        "model_timing_ms":receipt["timed_ms"],
        "native_sensor_frames_during_model":
          during["sensor_capture_result_frames"]-
          first["sensor_capture_result_frames"],
        "physical_completed_mp4_yet_verified":False,
        "automatic_people_folder_filing_authorized":False
    },sort_keys=True),flush=True)
    # Same currently recording natural event must end normally. If it does
    # not finish before bounded timeout, do NOT falsely assert success.
    finish=None
    deadline=time.monotonic()+finish_wait
    while time.monotonic()<deadline:
        current=existing.status()
        if current.get("mode")=="watching" and \
           current.get("recorded")==first["recorded"]+1:
            finish=current
            break
        if current.get("failed",0)>first["failed"] or \
           current.get("preroll_dropped_frames",0)>first["preroll_dropped_frames"]:
            break
        if existing.phone_health()["pid"]!=phone["pid"]:
            break
        time.sleep(.6)
    if finish is None:
        return abstain("UNINTERRUPTED_MODEL_OVERLAP_BUT_FINISHED_MP4_NOT_YET_PROVEN",
                       model_ran=True,unverified_completion_not_promoted=True)
    filename=finish.get("last_file")
    if type(filename) is not str or not existing.VIDEO.fullmatch(filename):
        return abstain("REFUSED_NONORDINARY_MOTION_VIDEO",model_ran=True)
    video=existing.ROOT+"/"+filename
    filesize=int(existing.adb("shell","stat -c %s "+video,timeout=8))
    if filesize<10_000_000 or filesize>existing.MAX_FILE_BYTES:
        return abstain("FINISHED_VIDEO_NOT_BOUNDED",model_ran=True)
    sha=existing.adb("shell","sha256sum "+video,timeout=19).split()[0]
    existing.need(bool(re.fullmatch("[0-9a-f]{64}",sha)),
                  "original_source_sha_invalid")
    nonce=os.urandom(16).hex()
    inspect=("CLASSPATH="+existing.BASE+"/r766_start_sample_inspector.dex.jar "+
        "nice -n 15 /system/bin/app_process /system/bin "+
        "nl.kalenel.s9offline.S9OriginalNative4KEventTimingV761 "+
        "--verified-native4k-original "+filename+" "+sha+
        " "+str(filesize)+" "+nonce)
    check=subprocess.run(
        ["adb","-s",existing.PHONE,"shell",inspect],
        capture_output=True,text=True,timeout=27)
    marker=existing.ENCODED_PTS_MARKER
    samples=[line[len(marker):] for line in check.stdout.splitlines()
             if line.startswith(marker)]
    if check.returncode or len(samples)!=1:
        return abstain("NO_PHONE_DOUBLE_SHA_AND_PTS_NO_CAPTURE_PROOF",
                       model_ran=True)
    pts=json.loads(samples[0])
    existing.need(pts.get("nonce")==nonce,"phone_source_pts_nonce_mismatch")
    finish_pid=existing.phone_health()
    if finish_pid["pid"]!=phone["pid"]:
        return abstain("SOURCE_VERIFIED_BUT_CAMERA_RESTARTED",
                       model_ran=True)
    final=existing.check_final(
        first,during,finish,phone,finish_pid,
        {"filename":filename,"bytes":filesize,"sha256":sha},pts)
    print(json.dumps({
        "schema":SCHEMA,"model_onnx_sha256":existing.MODEL_SHA,
        "real_source_double_sha_and_encoded_pts_verified":True,
        "no_prior_camera_process_baseline_used":True,
        "synthetic_input_only_on_s9":True,
        "camera_control_actions":0,
        "new_scheduled_jobs":False,**final
    },sort_keys=True))

def main():
    p=argparse.ArgumentParser()
    mode=p.add_mutually_exclusive_group(required=True)
    mode.add_argument("--self-test",action="store_true")
    mode.add_argument("--live-once",action="store_true")
    p.add_argument("--wait-seconds",type=int,default=0)
    p.add_argument("--completion-wait-seconds",type=int,default=12)
    a=p.parse_args()
    if a.self_test:synthetic()
    else:live(a.wait_seconds,a.completion_wait_seconds)
if __name__=="__main__":
    try:main()
    except (ValueError,OSError,subprocess.SubprocessError,TimeoutError,
            RuntimeError,TypeError) as e:
        print(json.dumps({
            "schema":SCHEMA,"status":"REFUSED_INCOMPLETE_NATURAL_EVENT_PROOF",
            "error_type":type(e).__name__,
            "camera_or_originals_modified":False,
            "identity_embeddings_or_face_crops_processed":False,
            "new_scheduled_jobs":False,
            "automatic_people_folder_filing_authorized":False
        },sort_keys=True))
        raise SystemExit(2)
