#!/usr/bin/env python3
"""Process at most two missing *private* S9 HSV32 sidecars.

Never changes Camera2, originals, approved identities or ranking indices.
Existing V40 crops are verified against their SHA-256 before private temporary
use, and are never fabricated or counted as identified people.
"""
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import shutil
import sys
import urllib.request

ROOT=Path(__file__).resolve().parent
STATE=Path("/home/jespern/c720p-home-hub/state")
LOCK=STATE/"s9-v3-archive-backfill.lock"
MARK="S9_V3_HSV32_TWO_VERIFIED "
REJECT="S9_V3_HSV32_TWO_BLOCKED "
DEFER="S9_V3_HSV32_TWO_DEFERRED "
MAX_C=42.0
INITIAL_MAX_C=39.5
STATUS_URL="http://127.0.0.1:18808/status"
MIN_DISK=850*1024*1024

def helper(name,alias):
    path=ROOT/name
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("unsafe_pinned_helper")
    spec=importlib.util.spec_from_file_location(alias,path)
    obj=importlib.util.module_from_spec(spec)
    sys.modules[alias]=obj
    spec.loader.exec_module(obj)
    return obj

def temperature(h):
    value=h.adb("shell","dumpsys battery",timeout=20).stdout
    match=re.search(r"temperature:\s*(\d+)",value)
    if match is None:raise RuntimeError("missing_phone_thermal_reading")
    return int(match.group(1))/10

def capture_healthy():
    """Fail closed if camera, 4K ring, preroll, or thermal recovery is degraded."""
    with urllib.request.urlopen(STATUS_URL,timeout=12) as response:
        if response.status!=200:
            raise RuntimeError("camera_health_endpoint_unavailable")
        raw=response.read(150001)
    if len(raw)>150000:raise RuntimeError("unbounded_camera_health")
    status=json.loads(raw)
    if not isinstance(status,dict):
        raise RuntimeError("invalid_camera_health")
    temp=status.get("temperature_c")
    if type(temp) not in (float,int) or temp>INITIAL_MAX_C:
        raise RuntimeError("camera_too_warm_for_offline_processing")
    if (status.get("ok") is not True
        or status.get("mode")!="watching"
        or status.get("native_4k_enabled") is not True
        or status.get("continuous_4k_ready") is not True
        or type(status.get("continuous_4k_buffered_ms")) is not int
        or status["continuous_4k_buffered_ms"]<5000
        or status.get("continuous_4k_dropped_output_frames")!=0
        or bool(status.get("continuous_4k_error"))
        or status.get("continuous_4k_production_persisted") is not True
        or status.get("preroll_version")!="continuous_native_4k_h264_ring_v1"
        or status.get("recording_active") is True
        or status.get("recording_in_progress") is True
        or status.get("face_backfill_queued") is True
        or status.get("movement_4k_backfill_queued") is True):
        raise RuntimeError("camera_capture_not_stably_ready")
    # The native continuous-4K H.264 ring is itself the preroll buffer.
    # CameraService intentionally stops GardenPreRoll in this mode, so the
    # separate legacy 'preroll_ready' field is normally false here.
    # 'continuous_4k_trial_active' likewise stays true after promotion.
    return status


def camera_pid(h):
    pid=h.adb("shell","pidof nl.kalenel.s9security",timeout=20).stdout.strip()
    if not re.fullmatch(r"[0-9 ]+",pid):
        raise RuntimeError("camera_pid_missing")
    return pid

def presence_inventory(h,rows):
    """Two descriptor flags per SHA-qualified crop, at most 24 per ADB shell.

    A transport error, incomplete batch, or malformed response must never be
    mistaken for a missing feature and cause it to be regenerated.
    Uses the same proven S9_PAIR_MASK_V1 protocol as the OSNet worker.
    """
    if not isinstance(rows,list) or not 58<=len(rows)<=400:
        raise RuntimeError("reference_cohort_outside_bound")
    root=h.ROOT
    if (not isinstance(root,str)
        or not re.fullmatch(r"/[A-Za-z0-9_./-]+",root)
        or ".." in root or len(root)>230):
        raise RuntimeError("untrusted_phone_feature_root")
    keys=[]
    for item in rows:
        if not isinstance(item,dict):
            raise RuntimeError("invalid_source_crop")
        key=item.get("key")
        sha=item.get("crop_sha256")
        if not isinstance(key,str) or not re.fullmatch(r"[a-f0-9]{64}",key):
            raise RuntimeError("invalid_source_qualified_key")
        if not isinstance(sha,str) or not re.fullmatch(r"[a-f0-9]{64}",sha):
            raise RuntimeError("invalid_crop_digest")
        keys.append(key)
    if len(set(keys))!=len(keys):
        raise RuntimeError("duplicate_source_qualified_key")
    found={}
    for offset in range(0,len(keys),24):
        chunk=keys[offset:offset+24]
        script="set -eu; "
        for key in chunk:
            base=root+"/features/"+key
            script+=(
                f"if test -s {base}-visual.json; then v=1; else v=0; fi; "
                f"if test -s {base}-hsv-v2.json; then h=1; else h=0; fi; "
                f"printf 'S9_PAIR_MASK_V1 {key} %s %s\\n' \"$v\" \"$h\"; "
            )
        result=h.adb("shell",script,timeout=45,required=False)
        raw=result.stdout
        if (result.returncode!=0 or not isinstance(raw,str)
            or not isinstance(result.stderr,str) or result.stderr.strip()
            or len(raw)>len(chunk)*100):
            raise RuntimeError("phone_descriptor_presence_indeterminate")
        lines=raw.splitlines()
        if len(lines)!=len(chunk):
            raise RuntimeError("phone_descriptor_presence_incomplete")
        for key,line in zip(chunk,lines):
            fields=line.split()
            if (len(fields)!=4 or fields[:2]!=["S9_PAIR_MASK_V1",key]
                or fields[2] not in ("0","1")
                or fields[3] not in ("0","1") or key in found):
                raise RuntimeError("phone_descriptor_presence_untrusted")
            found[key]=(fields[2]=="1",fields[3]=="1")
    if len(found)!=len(keys):
        raise RuntimeError("phone_descriptor_presence_incomplete")
    def present(key,kind):
        if key not in found or kind not in ("visual","hsv"):
            raise RuntimeError("untrusted_descriptor_presence_lookup")
        return found[key][0 if kind=="visual" else 1]
    return present


def validated_missing(rows,present):
    selected=[]
    for item in rows:
        if (not present(item["key"],"hsv")
            and present(item["key"],"visual")):
            selected.append(item)
    return selected


def run(h,ctrl):
    if shutil.disk_usage("/").free<MIN_DISK:
        raise RuntimeError("hub_free_disk_guard")
    if LOCK.is_symlink() or not LOCK.parent.is_dir():
        raise RuntimeError("unsafe_lock_path")
    fd=os.open(LOCK,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"rb") as locked:
        try:
            fcntl.flock(locked,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            raise RuntimeError("shared_archive_worker_busy") from None
        capture_healthy()
        pid=camera_pid(h)
        before_temp=temperature(h)
        if before_temp>INITIAL_MAX_C:raise RuntimeError("phone_warm_before_batch")
        approved=ctrl.approved_names()
        originals=set(ctrl.primary_events())
        rows=h.inventory(include_unreviewed=True)
        if not 58<=len(rows)<=400:
            raise RuntimeError("reference_cohort_outside_bound")
        before_presence=presence_inventory(h,rows)
        missing=validated_missing(rows,before_presence)
        selected=missing[:2]
        # Count true unprocessed HSV sources separately from OSNet-ready
        # candidates; withholding missing-visual sources is a deferral, not
        # a claim that the original crop has no person or no future work.
        pending_osnet=sum(1 for x in rows if not before_presence(x["key"],"visual"))
        # Do not touch images or sidecars until each source-derived 512D
        # embedding passed the verified model SHA, crop SHA and L2 checks.
        for row in selected:h.safe_visual(row["key"],row["crop_sha256"])
        completed=0
        observed_max=before_temp
        for row in selected:
            capture_healthy()
            t=temperature(h)
            observed_max=max(observed_max,t)
            if t>INITIAL_MAX_C:raise RuntimeError("phone_warm_before_descriptor")
            if camera_pid(h)!=pid:raise RuntimeError("camera_pid_changed")
            if h.v2_histogram(row)!="verified_histogram_and_osnet":
                raise RuntimeError("phone_histogram_unverified")
            after=temperature(h)
            observed_max=max(observed_max,after)
            capture_healthy()
            if after>MAX_C:raise RuntimeError("phone_thermal_post_limit")
            if camera_pid(h)!=pid:raise RuntimeError("camera_pid_changed")
            # Independently reread each newly written sidecar, not just the
            # Java worker's write marker.
            if h.v2_histogram(row)!="verified_histogram_and_osnet":
                raise RuntimeError("phone_histogram_readback_failed")
            completed+=1
        if not originals.issubset(set(ctrl.primary_events())):
            raise RuntimeError("original_catalog_regressed")
        if approved!=ctrl.approved_names():raise RuntimeError("manual_reviews_changed")
        if camera_pid(h)!=pid:raise RuntimeError("camera_pid_changed")
        capture_healthy()
        after_presence=presence_inventory(h,rows)
        remaining=len(validated_missing(rows,after_presence))
        if remaining!=len(missing)-completed:
            raise RuntimeError("unexpected_hsv_source_delta")
        return {
            "verified_crops":len(rows),"missing_before":len(missing),
            "new_verified_histograms":completed,"missing_after":remaining,
            "pending_real_visual_sidecars":pending_osnet,
            "phone_max_temp_c":observed_max,"phone_pid_unchanged":True,
            "originals_unchanged":True,"manual_reviews_unchanged":True,
            "camera_apk_changed":False,"rankings_modified":False,
            "automatic_people_assigned":0,"private_identifiers_disclosed":False}

def classify_abort(reason):
    # Pure, privacy-bounded result contract; raw exception details never logged.
    temporary={"shared_archive_worker_busy",
               "phone_warm_before_batch","phone_warm_before_descriptor",
               "phone_thermal_post_limit",
               "camera_too_warm_for_offline_processing",
               "camera_capture_not_stably_ready"}
    if reason in temporary:
        return DEFER,{"reason":reason,"verified_batch_completed":False,
               "intermediate_sidecars_may_have_been_written":True,
               "retry_only_after_new_capture_readiness":True,
               "private_output_suppressed":True},0
    expected={"hub_free_disk_guard","phone_transport_untrusted"}
    return REJECT,{"reason":reason if reason in expected else
                   "verification_or_worker_failed",
                   "private_output_suppressed":True,
                   "originals_not_intentionally_written":True,
                   "existing_reviews_not_intentionally_written":True},2


def main():
    h=helper("backfill-s9-hsv32-uniform-v2.py","s9_v3_hsv_guarded")
    ctrl=helper("backfill-s9-original-roi-osnet-temporal-v2.py","s9_v3_temporal_guarded")
    result=run(h,ctrl)
    print(MARK+json.dumps(result,sort_keys=True),flush=True)

if __name__=="__main__":
    try:main()
    except Exception as error:
        # Clip names, persons, sidecar paths and raw phone stderr must never
        # enter public CI logs. Expose only allowlisted policy reason codes.
        marker,payload,exit_code=classify_abort(str(error))
        print(marker+json.dumps(payload,sort_keys=True),flush=True)
        raise SystemExit(exit_code)
