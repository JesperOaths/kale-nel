#!/usr/bin/env python3
"""Classify one authorized S9 CameraService/ADB observation; no camera actions.

No ADB connect/reconnect, shell mutation, camera STOP/START, package install,
monitor loop, or phone-memory/temperature inspection. An HTTP endpoint may
disappear normally when a service stops. The app PID is NOT a service state.
"""
import json
import subprocess
import urllib.request
import urllib.error
import sys

SERIAL="192.168.178.250:5555"
MODEL="SM-G965F"
URL="http://127.0.0.1:18808/status"

def exec_read(*args,timeout=6):
    try:
        p=subprocess.run(["/usr/bin/adb",*args],capture_output=True,text=True,timeout=timeout)
    except (OSError,subprocess.TimeoutExpired):
        return None
    return p.stdout.strip() if p.returncode==0 else None

def classify(adb_connected,forward_correct,service_registered,http_status,http_error=None):
    if not adb_connected:
        return "adb_transport_unavailable"
    if not forward_correct:
        return "adb_connected_forward_missing_or_wrong_owner"
    if service_registered is None:
        return "service_state_unknown_do_not_control"
    if not service_registered:
        if http_status is None:
            return "native_service_not_registered_endpoint_absent_expected"
        return "native_service_absent_but_endpoint_present_inconsistent"
    if http_status is None:
        return "native_service_registered_endpoint_unavailable"
    if not isinstance(http_status,dict):
        return "invalid_native_status"
    mode=http_status.get("mode")
    if mode in ("opening","starting","stopping"):
        return "camera_service_transition_in_progress"
    if mode=="stopped":
        return "camera_service_reports_stopped"
    if mode=="watching":
        if (http_status.get("continuous_4k_ready") is True and
            type(http_status.get("continuous_4k_buffered_ms")) is int and
            http_status["continuous_4k_buffered_ms"]>0):
            return "camera_watching_native_4k_buffering"
        return "camera_watching_native_4k_unavailable"
    if mode=="recording":
        return "camera_recording_do_not_interrupt"
    return "camera_mode_unknown_do_not_control"

def observe():
    state=exec_read("-s",SERIAL,"get-state")
    if state!="device":
        return {"adb_connected":False,"forward_correct":False,
            "service_registered":None,"http_status":None,
            "classification":classify(False,False,None,None)}
    model=exec_read("-s",SERIAL,"shell","getprop","ro.product.model")
    if model!=MODEL:
        return {"adb_connected":True,"classification":"s9_identity_not_confirmed"}
    fw=exec_read("forward","--list") or ""
    expected=SERIAL+" tcp:18808 tcp:8808"
    correct=expected in fw.splitlines()
    if not correct:
        return {"adb_connected":True,"forward_correct":False,
                "classification":classify(True,False,None,None)}
    svc=exec_read("-s",SERIAL,"shell","dumpsys","activity","services","nl.kalenel.s9security")
    present=None if svc is None else ("ServiceRecord" in svc and "CameraService" in svc)
    body=None
    try:
        with urllib.request.urlopen(URL,timeout=3) as response:
            if response.status==200:body=json.loads(response.read(65536))
    except (OSError,ValueError,urllib.error.URLError):
        pass
    return {"adb_connected":True,"forward_correct":True,
        "service_registered":present,
        "http_status_obtained":body is not None,
        "camera_mode":body.get("mode") if isinstance(body,dict) else None,
        "native_4k_ready":body.get("continuous_4k_ready") if isinstance(body,dict) else None,
        "native_4k_buffered_ms":body.get("continuous_4k_buffered_ms") if isinstance(body,dict) else None,
        "classification":classify(True,True,present,body),
        "camera_control_authorized":False}

def main():
    output=observe()
    print(json.dumps(output,sort_keys=True))
    return 0 if output["classification"] not in ("s9_identity_not_confirmed",) else 2

if __name__=="__main__":
    sys.exit(main())
