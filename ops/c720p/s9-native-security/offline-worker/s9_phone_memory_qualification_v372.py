#!/usr/bin/env python3
"""Task9 V372: read-only bounded S9+ phone memory qualification.

Does NOT run Android app_process, infer, load a model, change camera or activate
a worker. Produces a private fsynced receipt with a conservative memory floor
and clearly separates phone feasibility from full C720P/camera admission.
"""
import argparse
import datetime
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
import urllib.request

SERIAL="192.168.178.250:5555"
CAMERA="http://127.0.0.1:18808/status"
PIXELS=3840*2160
MIB=1024*1024
KIB=1024
# This is a prospective *reservation* not a measured ONNX inference RSS.
# Four retained 4K YUV frames (codec/reordering), four original-sized RGBA/
# Java copies (decoded bitmap+int[]+crop), six ONNX tensor buffers, native
# libraries, a deliberately oversized 384 MiB model/codec workspace, then
# Android OS/recorder reserve. Never label this an observed worker peak.
CONCURRENT_YUV_FRAMES=4
ARGB_COPIES=4
ONNX_TENSOR_BUFFERS=6
ORT_CODEC_WORKSPACE=384*MIB
ANDROID_SYSTEM_RECORDER_RESERVE=512*MIB
CONSERVATIVE_MIN_PHONE_MIB=1536
MAX_MEASUREMENTS=3
MEASUREMENT_GAP_SECONDS=2
MAX_REPORT_BYTES=16000

def budget():
    yuv=math.ceil(PIXELS*3/2)*CONCURRENT_YUV_FRAMES
    argb=PIXELS*4*ARGB_COPIES
    onnx=3*640*640*4*ONNX_TENSOR_BUFFERS
    native=18214224+100600
    base=yuv+argb+onnx+native+ORT_CODEC_WORKSPACE
    fragment=math.ceil(base/4)
    total=base+fragment+ANDROID_SYSTEM_RECORDER_RESERVE
    rounded=math.ceil(total/(128*MIB))*128*MIB
    floor=max(CONSERVATIVE_MIN_PHONE_MIB*MIB,rounded)
    return {"decoded_4k_frame_pixels":PIXELS,
            "four_codec_yuv_frames_bytes":yuv,
            "four_original_argb_buffers_bytes":argb,
            "six_onnx_input_output_buffers_bytes":onnx,
            "verified_ort_arm64_jni_library_bytes":native,
            "model_codec_extra_workspace_bytes":ORT_CODEC_WORKSPACE,
            "worker_fragmentation_reserve_bytes":fragment,
            "system_camera_reserve_bytes":ANDROID_SYSTEM_RECORDER_RESERVE,
            "computed_reservation_bytes":rounded,
            "enforced_provisional_phone_floor_kib":math.ceil(floor/KIB),
            "classification":"conservative_static_envelope_not_measured_inference_peak"}

def run(cmd,timeout=8,max_bytes=16000):
    out=subprocess.run(cmd,capture_output=True,timeout=timeout,check=False)
    if out.returncode or len(out.stdout)>max_bytes or len(out.stderr)>max_bytes:
        raise RuntimeError("bounded_read_only_probe_failed")
    return out.stdout.decode("utf-8","strict")

def adb(*args,timeout=8):
    return run(["adb","-s",SERIAL,*args],timeout=timeout)

def meminfo(data):
    fields={}
    for line in data.splitlines():
        m=re.fullmatch(r"([A-Za-z_()]+):\s+([0-9]+)\s+kB",line)
        if m:fields[m.group(1)]=int(m.group(2))
    if not (1000000<fields.get("MemTotal",0)<12000000 and
            0<fields.get("MemAvailable",0)<=fields["MemTotal"]):
        raise RuntimeError("phone_meminfo_not_trusted")
    return {"total_kib":fields["MemTotal"],
            "available_kib":fields["MemAvailable"],
            "swap_free_kib":fields.get("SwapFree")}

def recorder_status(raw):
    m={}
    for line in raw.splitlines():
        x=re.fullmatch(r"(VmRSS|VmHWM|VmSize|RssAnon):\s+([0-9]+)\s+kB",line.strip())
        if x:m[x.group(1)]=int(x.group(2))
    if not (0<m.get("VmRSS",0)<=m.get("VmHWM",0)
            and m["VmHWM"]<=8*1024*1024):
        raise RuntimeError("recorder_rss_not_trusted")
    return {"rss_kib":m["VmRSS"],"peak_rss_kib":m["VmHWM"],
            "rss_anon_kib":m.get("RssAnon")}

def camera(doc):
    if not isinstance(doc,dict):raise RuntimeError("camera_status_unavailable")
    safe=(doc.get("ok") is True and doc.get("mode")=="watching"
          and doc.get("native_4k_enabled") is True
          and doc.get("continuous_4k_ready") is True
          and type(doc.get("continuous_4k_buffered_ms")) is int
          and doc["continuous_4k_buffered_ms"]>=6500
          and doc.get("continuous_4k_dropped_output_frames")==0
          and type(doc.get("temperature_c")) in (int,float)
          and 0<doc["temperature_c"]<=40.0)
    exclusion=[name for name in
               ("recording_active","recording_in_progress","face_backfill_queued",
                "appearance_backfill_queued","historical_import_queued",
                "movement_4k_backfill_queued","garden_archive_triage_queued")
               if doc.get(name) is True]
    return {"camera_four_k_ready":safe,
            "temperature_c":doc.get("temperature_c"),
            "recorder_mode":doc.get("mode"),
            "buffered_ms":doc.get("continuous_4k_buffered_ms"),
            "dropped_frames":doc.get("continuous_4k_dropped_output_frames"),
            "active_exclusions":exclusion,
            "camera_and_exclusion_ok":safe and not exclusion}

def sample():
    if adb("get-state").strip()!="device":
        raise RuntimeError("s9_device_not_authorized")
    pid=adb("shell","pidof nl.kalenel.s9security").strip()
    if not re.fullmatch(r"[0-9]{2,7}",pid):
        raise RuntimeError("recorder_pid_unavailable")
    memory=meminfo(adb("shell","cat /proc/meminfo"))
    status=recorder_status(adb("shell","cat /proc/"+pid+"/status"))
    with urllib.request.urlopen(CAMERA,timeout=7) as response:
        cam=camera(json.loads(response.read(65536)))
    return {"observed_utc":datetime.datetime.now(datetime.timezone.utc).isoformat(),
            "recorder_pid":pid,"phone":memory,"recorder":status,"camera":cam}

def assess(samples,host_available_kib,root_free_bytes):
    if len(samples)!=MAX_MEASUREMENTS:
        raise RuntimeError("phone_qualification_missing_samples")
    if len({r["recorder_pid"] for r in samples})!=1:
        raise RuntimeError("camera_pid_changed_during_observation")
    info=budget()
    low=min(x["phone"]["available_kib"] for x in samples)
    minrec=max(x["recorder"]["peak_rss_kib"] for x in samples)
    floor=info["enforced_provisional_phone_floor_kib"]
    flags=sorted({flag for x in samples for flag in x["camera"]["active_exclusions"]})
    phone_ok=low>=floor
    camera_ok=all(x["camera"]["camera_four_k_ready"] for x in samples)
    hub_ok=host_available_kib>=900*1024
    root_ok=root_free_bytes>=850*MIB
    return {"schema":"s9_phone_memory_qualification_v372",
            "mode":"read_only_no_model_or_video_executed",
            "observations":samples,"budget":info,
            "min_observed_phone_available_kib":low,
            "max_observed_recorder_peak_rss_kib":minrec,
            "host_mem_available_kib":host_available_kib,
            "root_free_bytes":root_free_bytes,
            "phone_static_envelope_pass":phone_ok,
            "existing_hub_guard_pass":hub_ok,
            "existing_root_guard_pass":root_ok,
            "existing_4k_thermal_guard_pass":camera_ok,
            "existing_worker_exclusions_clear":not flags,
            "blocking_exclusions":flags,
            "qualified_for_phone_inference":False,
            "actual_phone_onnx_codec_peak_rss_measured":False,
            "reason":"no_inference_peak_measurement_and_full_admission_not_established",
            "required_next_phases":[
              "existing 900MiB hub, 850MiB root, <=40.0C phone, 4K and exclusion guards must all pass",
              "use conservative phone memory reservation from this receipt, never a positive arbitrary value",
              "begin one bounded real frame only through existing exclusive V304 lease",
              "measure phone app_process high water and remaining phone MemAvailable before/between/after frame; abort on unsafe pressure",
              "three independently observed PTS plus complete V369/V361 publication and queue completion"]}

def obtain(n=MAX_MEASUREMENTS,pause=MEASUREMENT_GAP_SECONDS,sampler=sample,sleep=time.sleep):
    if n!=MAX_MEASUREMENTS or pause!=MEASUREMENT_GAP_SECONDS:
        raise ValueError("probe_frequency_fixed")
    results=[]
    for index in range(n):
        results.append(sampler())
        if index<n-1:sleep(pause)
    return results

def write_receipt(path,data):
    path=Path(path)
    if path.is_symlink() or path.exists() or not path.parent.is_dir():
        raise RuntimeError("receipt_path_untrusted_or_exists")
    payload=(json.dumps(data,sort_keys=True,indent=2)+"\n").encode()
    if len(payload)>MAX_REPORT_BYTES:raise RuntimeError("report_unbounded")
    temp=path.with_suffix(path.suffix+".staging")
    if temp.exists() or temp.is_symlink():raise RuntimeError("staging_path_exists")
    fd=os.open(temp,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
    try:
        os.write(fd,payload);os.fsync(fd)
    finally:os.close(fd)
    os.replace(temp,path)
    return hashlib.sha256(payload).hexdigest()

def main():
    args=argparse.ArgumentParser(description=__doc__)
    args.add_argument("--receipt",required=True,type=Path)
    ns=args.parse_args()
    samples=obtain()
    available=next(int(x.split()[1]) for x in Path("/proc/meminfo").read_text().splitlines()
                   if x.startswith("MemAvailable:"))
    doc=assess(samples,available,shutil.disk_usage("/").free)
    sha=write_receipt(ns.receipt,doc)
    print(json.dumps({"receipt_path":str(ns.receipt),"receipt_sha256":sha,
                      "phone_static_envelope_pass":doc["phone_static_envelope_pass"],
                      "existing_hub_guard_pass":doc["existing_hub_guard_pass"],
                      "existing_4k_thermal_guard_pass":doc["existing_4k_thermal_guard_pass"],
                      "existing_worker_exclusions_clear":doc["existing_worker_exclusions_clear"],
                      "qualified_for_phone_inference":False},
                     sort_keys=True))

if __name__=="__main__":main()
