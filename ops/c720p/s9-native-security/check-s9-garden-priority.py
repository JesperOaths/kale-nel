#!/usr/bin/env python3
"""Read-only acceptance probe for isolated on-phone garden-person inference.

This intentionally does NOT generate camera motion, decode media, restart
services, change Camera2 controls, or write to the microSD. It verifies the
new live model can run independently of slower historical-review work.
"""
import argparse
import json
import time
import urllib.request

PHONE="http://127.0.0.1:18808/status"
ARCHIVE="http://127.0.0.1:8795/new/api/saved"

def fetch(url):
    with urllib.request.urlopen(url,timeout=10) as response:
        if response.status!=200:raise RuntimeError("endpoint_non_200")
        data=response.read(32769)
    if len(data)>32768:raise RuntimeError("status_oversize")
    return json.loads(data)

def assess(phone,archive=None):
    def numeric(key,default=None):
        try:return float(phone[key])
        except (ValueError,TypeError,KeyError):return default
    mode=phone.get("mode")
    backend=phone.get("garden_person_gate_backend")
    checks={
        "camera_live":phone.get("ok") is True and mode in ("watching","recording"),
        "4k_originals_enabled":phone.get("native_4k_enabled") is True,
        "phone_live_model_ready":phone.get("garden_person_gate_ready") is True,
        "phone_model_backend_valid":backend in ("gpu","cpu"),
        "garden_filter_present":phone.get("garden_zone") in ("strict","near","wide","all"),
        "max_24_4k_per_hour":numeric("recording_rate_max_per_hour")==24,
        "thermal_below_guard":numeric("temperature_c",100)<41.5,
        "microSD_reserve_available":numeric("sd_free_bytes",0)>15*1024*1024*1024,
        "live_model_not_stalled_in_long_queue":
            numeric("garden_person_gate_last_queue_wait_ms",0)<1750,
        "no_person_gate_initialization_errors":
            numeric("garden_person_gate_prepare_errors",0)==0,
    }
    if archive is not None:
        checks["saved_catalog_not_empty"]=len(archive.get("events") or [])>0
    return {
        "ok":all(checks.values()),"checks":checks,
        "mode":mode,"temperature_c":phone.get("temperature_c"),
        "person_model_backend":backend,
        "person_checks":phone.get("garden_person_gate_checked"),
        "person_candidates":phone.get("garden_person_gate_matches"),
        "person_rejected":phone.get("garden_person_gate_rejected"),
        "stale_person_results":phone.get("garden_person_gate_stale_dropped"),
        "model_queue_wait_ms":phone.get("garden_person_gate_last_queue_wait_ms"),
        "sensor_fps":phone.get("sensor_result_fps"),
        "on_phone_only":True,
        "original_recordings_modified":False,
    }

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--seconds",type=int,default=8)
    args=parser.parse_args()
    if not 3<=args.seconds<=25:parser.error("seconds must be 3 through 25")
    before=fetch(PHONE)
    time.sleep(args.seconds)
    after=fetch(PHONE)
    archive=fetch(ARCHIVE)
    result=assess(after,archive)
    n0=int(before.get("frames") or 0)
    n1=int(after.get("frames") or 0)
    result["yuv_callback_fps"]=round((n1-n0)/args.seconds,2)
    result["no_live_person_event_inferred"]=int(after.get("garden_person_gate_checked") or 0)==0
    print("S9_GARDEN_REALTIME_ACCEPTANCE "+json.dumps(result,separators=(",",":")))
    if not result["ok"]:raise SystemExit(1)

if __name__=="__main__":
    main()
