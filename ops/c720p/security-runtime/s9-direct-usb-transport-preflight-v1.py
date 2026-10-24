#!/usr/bin/env python3
"""Owner-scoped S9 USB ADB preflight. No camera controls or Wi-Fi conversion.

--check: read-only; requires a pre-existing direct USB -> localhost 18809 map.
--prepare: explicit opt-in to establish a *dedicated* forward over USB, then check.
A passed preflight is neither an uninterrupted link guarantee nor a camera
maintenance authorization.
"""
import argparse
import json
import subprocess
import sys
import time
import urllib.request

MODEL="SM-G965F"
EXPECTED_SERIAL="27bb603837047ece"
PORT="tcp:18809"
REMOTE="tcp:8808"
STATUS="http://127.0.0.1:18809/status"
ADB="/usr/bin/adb"

class NotReady(Exception):
    pass

def cmd(*argv,timeout=7):
    try:
        p=subprocess.run([ADB,*argv],capture_output=True,text=True,timeout=timeout)
    except (subprocess.TimeoutExpired,OSError) as exc:
        raise NotReady("adb_command_unavailable") from exc
    if p.returncode:
        raise NotReady("adb_command_failed")
    return p.stdout.strip()

def pinned_usb():
    lines=cmd("devices","-l").splitlines()[1:]
    usb=[]
    for line in lines:
        fields=line.split()
        if len(fields)<2 or fields[1]!="device":
            continue
        serial=fields[0]
        # ADB TCP transports contain a colon. Never reuse the Wi-Fi target.
        if ":" in serial:
            continue
        if not serial or not all(x.isascii() and (x.isalnum() or x in "_-.") for x in serial):
            continue
        try:
            model=cmd("-s",serial,"shell","getprop","ro.product.model")
            device_serial=cmd("-s",serial,"shell","getprop","ro.serialno")
        except NotReady:
            continue
        if model==MODEL and device_serial==EXPECTED_SERIAL:
            usb.append(serial)
    if len(usb)!=1:
        raise NotReady("exactly_one_authorized_s9_usb_required")
    return usb[0]

def mapping(serial):
    return serial+" "+PORT+" "+REMOTE

def assert_mapping(serial):
    mappings=cmd("forward","--list").splitlines()
    if mapping(serial) not in (x.strip() for x in mappings):
        raise NotReady("dedicated_usb_forward_absent_or_wrong_owner")

def status():
    try:
        with urllib.request.urlopen(STATUS,timeout=3) as r:
            if r.status!=200:raise NotReady("native_recorder_http_not_200")
            d=json.loads(r.read(65536))
    except NotReady:
        raise
    except Exception as exc:
        raise NotReady("native_usb_forward_status_unavailable") from exc
    if (not isinstance(d,dict) or d.get("ok") is not True
            or d.get("recorder")!="camera2_3840x2160_h264"):
        raise NotReady("unexpected_camera_status")
    n=d.get("frames")
    age=d.get("last_frame_age_ms")
    if type(n) is not int or n<1 or type(age) is not int or not 0<=age<2000:
        raise NotReady("camera_sensor_stale")
    return d

def inspect(*,prepare=False,interval=2):
    serial=pinned_usb()
    if cmd("-s",serial,"get-state")!="device":
        raise NotReady("s9_usb_not_authorized")
    if prepare:
        # Preserve any other owner's mapping. No forward --remove or rebind.
        existing=cmd("forward","--list").splitlines()
        if any(x.split()[1:2]==[PORT] and x.strip()!=mapping(serial)
               for x in existing if len(x.split())>=3):
            raise NotReady("usb_diagnostic_port_already_owned")
        if mapping(serial) not in [x.strip() for x in existing]:
            cmd("-s",serial,"forward","--no-rebind",PORT,REMOTE)
    assert_mapping(serial)
    first=status()
    time.sleep(interval)
    if pinned_usb()!=serial or cmd("-s",serial,"get-state")!="device":
        raise NotReady("usb_transport_changed_during_check")
    assert_mapping(serial)
    last=status()
    if last["frames"]<=first["frames"]:
        raise NotReady("recorder_frames_not_advancing")
    return {
        "schema":"s9_direct_usb_transport_preflight_v1",
        "usb_serial_present":True,
        "device_model":MODEL,
        "dedicated_forward":PORT+"->"+REMOTE,
        "samples":2,
        "frames_advanced":last["frames"]-first["frames"],
        "camera_mode":last.get("mode"),
        "continuous_4k_ready":last.get("continuous_4k_ready"),
        "continuous_4k_buffered_ms":last.get("continuous_4k_buffered_ms"),
        "preflight_passed":True,
        "control_transaction_authorized":False,
        "transport_lease_held":False,
        "camera_maintenance_performed":False,
    }

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--prepare",action="store_true",
                        help="explicitly establish dedicated USB-only loopback forward")
    a=parser.parse_args()
    try:
        print(json.dumps(inspect(prepare=a.prepare),sort_keys=True))
        return 0
    except NotReady as exc:
        print(json.dumps({"schema":"s9_direct_usb_transport_preflight_v1",
          "preflight_passed":False,"reason":str(exc),
          "control_transaction_authorized":False,
          "transport_lease_held":False,
          "camera_maintenance_performed":False},sort_keys=True))
        return 2

if __name__=="__main__":
    sys.exit(main())
