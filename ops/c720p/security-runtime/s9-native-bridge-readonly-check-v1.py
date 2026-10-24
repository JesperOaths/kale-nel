#!/usr/bin/env python3
"""Bounded READ-ONLY S9 bridge check; never authorizes camera control.

On-host diagnostic only. It neither starts ADB nor changes a forward, package,
camera, thermal state, recorder, recordings or review decisions. A successful
two-sample check does NOT reserve the ADB transport for a later transaction.
"""
import datetime as dt
import json
import subprocess
import sys
import time
import urllib.request

DEVICE="192.168.178.250:5555"
EXPECTED_MODEL="SM-G965F"
FORWARD="tcp:18808 tcp:8808"
STATUS_URL="http://127.0.0.1:18808/status"

class NotReady(Exception):
    pass

def adb(*args):
    try:
        p=subprocess.run(["/usr/bin/adb", *args],
            capture_output=True,text=True,timeout=6)
    except (OSError,subprocess.TimeoutExpired) as exc:
        raise NotReady("adb_transport_command_unavailable") from exc
    if p.returncode:
        raise NotReady("adb_transport_command_failed")
    return p.stdout.strip()

def camera_status():
    try:
        with urllib.request.urlopen(STATUS_URL,timeout=3) as response:
            if response.status != 200:
                raise NotReady("bridge_http_not_200")
            raw=response.read(65536)
        result=json.loads(raw)
    except NotReady:
        raise
    except Exception as exc:
        raise NotReady("bridge_status_unavailable") from exc
    if not isinstance(result,dict) or result.get("ok") is not True:
        raise NotReady("invalid_native_camera_status")
    if result.get("mode")!="watching" or result.get("recorder")!="camera2_3840x2160_h264":
        raise NotReady("native_camera_not_watching")
    frames=result.get("frames")
    age=result.get("last_frame_age_ms")
    if type(frames) is not int or frames<1 or type(age) is not int or not 0<=age<2000:
        raise NotReady("native_camera_frames_not_current")
    return result

def check(*,interval_seconds=2):
    if adb("-s",DEVICE,"get-state") != "device":
        raise NotReady("s9_adb_transport_not_device")
    if adb("-s",DEVICE,"shell","getprop","ro.product.model") != EXPECTED_MODEL:
        raise NotReady("s9_model_mismatch")
    entries=adb("forward","--list").splitlines()
    if not any(line.strip()==DEVICE+" "+FORWARD for line in entries):
        raise NotReady("native_bridge_forward_missing_or_misdirected")
    first=camera_status()
    time.sleep(interval_seconds)
    # Recheck the same device and forward after the interval. A successful first
    # HTTP200 is not sufficient if the mapping disappeared in the meantime.
    if adb("-s",DEVICE,"get-state") != "device":
        raise NotReady("s9_adb_transport_lost")
    if not any(line.strip()==DEVICE+" "+FORWARD
               for line in adb("forward","--list").splitlines()):
        raise NotReady("native_bridge_forward_lost")
    second=camera_status()
    if second["frames"] <= first["frames"]:
        raise NotReady("native_camera_status_stale_or_frames_stalled")
    return {
        "schema":"s9_native_bridge_readonly_bounded_diagnostic_v1",
        "observed_at_utc":dt.datetime.now(dt.timezone.utc).isoformat(),
        "transport_probe_passed":True,
        "sample_seconds":interval_seconds,
        "frames_advanced":second["frames"]-first["frames"],
        "mode":second["mode"],
        "continuous_4k_ready":second.get("continuous_4k_ready"),
        "continuous_4k_buffered_ms":second.get("continuous_4k_buffered_ms"),
        "control_transaction_accepted":False,
        "transport_reserved":False,
    }

def main():
    try:
        print(json.dumps(check(),sort_keys=True))
        return 0
    except NotReady as exc:
        print(json.dumps({"schema":"s9_native_bridge_readonly_bounded_diagnostic_v1",
          "transport_probe_passed":False,"reason":str(exc),
          "control_transaction_accepted":False,"transport_reserved":False},
          sort_keys=True))
        return 2

if __name__=="__main__":
    sys.exit(main())
