#!/usr/bin/env python3
"""R773 pure synthetic 30-FPS sensor vs preroll admitted-FPS invariant test.

No media bytes, person identities, gallery scores or phone controls accessed.
The source-only CameraService/GardenPreRoll patch is explicitly OFF by
default. This test models only cadence input admission, NOT MediaCodec
capacity and NOT actual saved-file 30 FPS on the Samsung S9+.
"""
from __future__ import annotations
import argparse,json,math,pathlib

SOURCE=pathlib.Path(__file__).resolve().parent.parent/"src"/"nl"/"kalenel"/"s9security"
CAMERA=SOURCE/"CameraService.java"
PREROLL=SOURCE/"GardenPreRoll.java"
SENSOR_PERIOD_MS=1000.0/30.0

def need(condition,why):
    if not condition:raise ValueError(why)

def replay(*,explicit_trial=False,temp_tenths_c=320,seconds=10,
           worker_busy=lambda ordinal:False,recording=False):
    need(type(seconds) is int and 1<=seconds<=100 and
         type(temp_tenths_c) is int and 0<=temp_tenths_c<1000 and
         type(explicit_trial) is bool,
         "untrusted_cadence_test_input")
    # CameraService uses elapsedRealtime() (integer ms), not the sensor
    # clock's high-precision nanosecond timeline.
    seen=skipped_interval=busy_skips=offered=0
    last_offer_ms=-100000
    min_interval_ms=(30 if explicit_trial and temp_tenths_c<400
                     else 44)
    for frame in range(seconds*30):
        if recording or temp_tenths_c>=420:
            continue
        ms=round(frame*SENSOR_PERIOD_MS)
        seen+=1
        if ms-last_offer_ms<min_interval_ms:
            skipped_interval+=1
            continue
        last_offer_ms=ms
        if worker_busy(frame):
            busy_skips+=1
        else:
            offered+=1
    return {
        "input_sensor_fps":30,
        "preroll_trial_explicit":explicit_trial,
        "frame_interval_minimum_ms":min_interval_ms,
        "temperature_c":temp_tenths_c/10,
        "observed_yuv_frame_count":seen,
        "interval_skipped":skipped_interval,
        "encoder_worker_busy_skipped":busy_skips,
        "offered_frame_count":offered,
        "offered_upper_fps_if_encoder_always_ready":offered/seconds,
        "all_input_frames_accounted":
            seen==offered+busy_skips+skipped_interval,
        "main_4k_recorder_modified_by_simulation":False,
    }

def source_guards():
    need(CAMERA.is_file() and PREROLL.is_file(),
         "native_source_files_not_present")
    c=CAMERA.read_text(encoding="utf-8")
    p=PREROLL.read_text(encoding="utf-8")
    for marker in (
        'getBoolean("preroll_30fps_trial_explicit",false)',
        'LEGACY_PREROLL_INTERVAL_MS=44L',
        'OPT_IN_PREROLL_INTERVAL_MS=30L',
        'TRIAL_PREROLL_FALLBACK_TEMP_TENTHS_C=400',
        'preRoll30FpsTrialEnabled=false',
        'preRollWorkerBusySkipped++',
        'preRollCadenceSkipped++',
        'preRollOffersAccepted++',
        'preroll_observed_cached_fps',
        'preroll_native_4k_recorder_preserved",true',
        'new GardenPreRoll(preRoll30FpsTrialEnabled)'
    ):
        need(marker in c,"source_opt_in_guard_missing_"+marker)
    for marker in (
        'static final int WIDTH=640,HEIGHT=480,FPS=24',
        'static final int OPT_IN_FPS=30',
        'public GardenPreRoll(){this(false);}',
        'encoderConfiguredFps=explicit30fpsTrial?OPT_IN_FPS:FPS',
        'MediaFormat.KEY_FRAME_RATE,encoderConfiguredFps',
        'GardenPreRollBulkCopyV783.copy(target,pitch,step,bytes,'
    ):
        need(marker in p,"encoder_default_compatibility_regression_"+marker)
    # Do not change recorder format, process, trigger or storage.
    for marker in (
        'recorder.setVideoSize(3840,2160);',
        'recorder.setVideoFrameRate(30);',
        'recorder.setVideoEncodingBitRate(36000000);',
        'recorder.start();',
        'preRoll.freeze();',
        'preRoll.saveAsync(saved,frozenPreRoll)'
    ):
        need(marker in c,"native_4k_capture_contract_changed_"+marker)
    return True

def self_test():
    source_guards()
    legacy=replay()
    fast=replay(explicit_trial=True)
    thermal=replay(explicit_trial=True,temp_tenths_c=400)
    hot=replay(explicit_trial=True,temp_tenths_c=420)
    busy=replay(explicit_trial=True,worker_busy=lambda i:i%3!=0)
    recording=replay(explicit_trial=True,recording=True)
    need(legacy["offered_frame_count"]==150 and
         legacy["frame_interval_minimum_ms"]==44,
         "legacy_44ms_max_admission_not_15fps")
    need(fast["offered_frame_count"]==300 and
         fast["frame_interval_minimum_ms"]==30,
         "trial_30ms_cannot_admit_30fps_sensor")
    need(thermal["offered_frame_count"]==150,
         "thermal_fallback_did_not_restore_legacy")
    need(hot["offered_frame_count"]==0,
         "hard_temp_bound_violated")
    need(busy["offered_frame_count"]<fast["offered_frame_count"] and
         busy["encoder_worker_busy_skipped"]>0,
         "worker_backpressure_not_measured")
    need(recording["offered_frame_count"]==0,
         "trial_encoder_must_not_compete_when_recording")
    need(all(x["all_input_frames_accounted"] for x in
             (legacy,fast,thermal,hot,busy,recording)),
         "preroll_skip_accounting_incomplete")
    print(json.dumps({
        "status":"R773_NATIVE_PREROLL_30FPS_TRIAL_SYNTHETIC_PASS",
        "legacy_max_candidate_fps":legacy["offered_upper_fps_if_encoder_always_ready"],
        "explicit_trial_max_candidate_fps":fast["offered_upper_fps_if_encoder_always_ready"],
        "trial_at_40c_fallback_fps":thermal["offered_upper_fps_if_encoder_always_ready"],
        "worker_busy_skips_tested":busy["encoder_worker_busy_skipped"],
        "default_deployed_camera_behavior_altered":False,
        "real_phone_30fps_preroll_verified":False,
        "production_camera_apk_installed":False
    },sort_keys=True))

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--self-test",required=True,action="store_true")
    p.parse_args()
    self_test()

if __name__=="__main__":main()
