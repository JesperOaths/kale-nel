#!/usr/bin/env python3
"""Read-only, aggregate-only S9+ capture priority gate for offline V3 work.

Never restarts Camera2, stages models, changes phone configuration,
touches recordings, or queries personal identities or saved classifications.
This is a one-shot diagnostic, not a persistent retry scheduler.
"""
import json
import re
import subprocess
import urllib.request

PHONE="192.168.178.250:5555"
STATUS="http://127.0.0.1:18808/status"
MARK="S9_CAPTURE_PRIORITY_V103 "
MIN_BUFFER_MS=4500
MAX_OFFLINE_START_C=39.5
PHONE_THERMAL_REARM_C=40.5
WHITELIST={"watching","recording","starting","stopping","opening","stopped","configuring_preview"}

def valid_numeric(value):
    return type(value) in (int,float) and 0<=value<=100

def classify(camera,temperature_c,pid_present):
    if not isinstance(camera,dict):camera={}
    mode=camera.get("mode")
    if mode not in WHITELIST:mode="unknown"
    buffered=camera.get("continuous_4k_buffered_ms")
    buffer_ok=type(buffered) is int and 0<=buffered<=20000
    drops=camera.get("continuous_4k_dropped_output_frames")
    errors=camera.get("continuous_4k_error")
    known_error=type(errors) is str and errors==""
    camera_ok=camera.get("ok") is True and pid_present
    temp_ok=valid_numeric(temperature_c)
    on4k=camera.get("continuous_4k_trial_active") is True and camera.get("continuous_4k_ready") is True
    reason="ready"
    if not camera_ok:reason="camera_health_unconfirmed"
    elif not temp_ok:reason="temperature_unavailable"
    elif temperature_c>MAX_OFFLINE_START_C:reason="thermal_headroom_required"
    elif mode!="watching":reason="capture_not_idle"
    elif not on4k:reason="continuous_4k_not_ready"
    elif not buffer_ok or buffered<MIN_BUFFER_MS:reason="pre_event_buffer_not_ready"
    elif drops is None or type(drops) is not int or drops!=0:reason="encoder_drops_detected_or_unknown"
    elif not known_error:reason="encoder_error_detected_or_unknown"
    result={
       "status":"read_only",
       "camera_running":camera_ok,
       "camera_mode":mode,
       "phone_temperature_c":round(temperature_c,1) if temp_ok else None,
       "continuous_4k_ready":on4k,
       "continuous_4k_preference_saved":camera.get("continuous_4k_production_persisted") is True,
       "buffered_ms":buffered if buffer_ok else None,
       "output_frames_dropped":drops if type(drops) is int and 0<=drops<1000000 else None,
       "native_4k_enabled":camera.get("native_4k_enabled") is True,
       "healthy_start_temperature_max_c":MAX_OFFLINE_START_C,
       "configured_4k_rearm_below_c":PHONE_THERMAL_REARM_C,
       "background_processing_permitted":reason=="ready",
       "defer_reason":reason,
       "recordings_modified":False,
       "review_decisions_modified":False,
       "camera_apk_modified":False,
       "private_clip_names_disclosed":False}
    return result

def query():
    with urllib.request.urlopen(STATUS,timeout=16) as response:
        if response.status!=200:raise RuntimeError("status_api_unavailable")
        body=response.read(120001)
    if len(body)>120000:raise RuntimeError("oversized_camera_status")
    camera=json.loads(body)
    pid=subprocess.run(["adb","-s",PHONE,"shell","pidof nl.kalenel.s9security"],
        capture_output=True,text=True,timeout=16)
    running=pid.returncode==0 and bool(re.fullmatch(r"[0-9 ]+",pid.stdout.strip()))
    power=subprocess.run(["adb","-s",PHONE,"shell","dumpsys battery"],
        capture_output=True,text=True,timeout=16)
    temp=None
    if power.returncode==0:
        match=re.search(r"temperature:\s*(\d+)",power.stdout)
        if match:temp=int(match.group(1))/10
    return classify(camera,temp,running)

def main():
    try:state=query()
    except Exception:
        # Device stderr, active clip names and stack traces must stay private.
        state=classify({},None,False)
    print(MARK+json.dumps(state,sort_keys=True),flush=True)

if __name__=="__main__":main()
