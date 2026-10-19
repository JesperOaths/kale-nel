#!/usr/bin/env python3
"""Repair exactly one missing OSNet vector paired with an existing real HSV32.

Only pre-existing, SHA-verifiable V40 full-person crops are eligible. Never
writes recording media, the Camera2 APK, manual review assignments, or V1/V2
indices. Default invocation does not write any feature sidecars.
"""
import argparse
import fcntl
import importlib.util
import json
import math
import os
from pathlib import Path
import re
import shutil
import sys
import urllib.request

HERE=Path(__file__).resolve().parent
STATE=Path("/home/jespern/c720p-home-hub/state")
LOCK=STATE/"s9-v3-archive-backfill.lock"
STATUS="http://127.0.0.1:18808/status"
MAX_START_C=39.5
MIN_HUB_BYTES=850*1024*1024
CHECK="S9_V3_ORPHAN_OSNET_DRYRUN "
DONE="S9_V3_ORPHAN_OSNET_RECOVERED "
DEFER="S9_V3_ORPHAN_OSNET_DEFERRED "
BLOCK="S9_V3_ORPHAN_OSNET_BLOCKED "
STAGE={"value":"startup"}
WRITES={"started":False}
def mark(value):
    # Only source-authored fixed stage names, never an exception or clip ID.
    STAGE["value"]=value


def helper(name,alias):
    p=HERE/name
    if p.is_symlink() or not p.is_file():
        raise RuntimeError("pinned_helper_missing")
    spec=importlib.util.spec_from_file_location(alias,p)
    module=importlib.util.module_from_spec(spec)
    sys.modules[alias]=module
    spec.loader.exec_module(module)
    return module

def healthy():
    with urllib.request.urlopen(STATUS,timeout=12) as r:
        if r.status!=200:raise RuntimeError("camera_unavailable")
        data=r.read(150001)
    if len(data)>150000:raise RuntimeError("camera_status_too_large")
    status=json.loads(data)
    if not isinstance(status,dict):raise RuntimeError("invalid_camera_status")
    value=status.get("temperature_c")
    if type(value) not in (int,float) or not math.isfinite(value):
        raise RuntimeError("thermal_telemetry_invalid")
    if value>MAX_START_C:raise RuntimeError("camera_too_warm")
    if (status.get("ok") is not True or status.get("mode")!="watching"
        or status.get("native_4k_enabled") is not True
        or status.get("continuous_4k_production_persisted") is not True
        or status.get("continuous_4k_ready") is not True
        or status.get("preroll_version")!="continuous_native_4k_h264_ring_v1"
        or type(status.get("continuous_4k_buffered_ms")) is not int
        or status["continuous_4k_buffered_ms"]<5000
        or status.get("continuous_4k_dropped_output_frames")!=0
        or bool(status.get("continuous_4k_error"))
        or any(status.get(k) is True for k in
          ("recording_active","recording_in_progress","garden_person_gate_busy",
           "face_backfill_queued","movement_4k_backfill_queued",
           "appearance_backfill_queued","historical_import_queued"))):
        raise RuntimeError("4k_capture_not_idle_ready")
    return status

def presence_inventory(h,rows):
    """Read bounded phone visual/HSV presence in batches, fail closed on ADB.

    Source keys must already be SHA-qualified; never interpret a lost ADB
    transport or partial response as absent verified evidence. Avoid two
    Android shell launches per crop as source inventory expands to 400 rows.
    """
    if not isinstance(rows,list) or not 58<=len(rows)<=400:
        raise RuntimeError("invalid_source_inventory_size")
    root=h.ROOT
    if (not isinstance(root,str)
        or not re.fullmatch(r"/[A-Za-z0-9_./-]+",root)
        or ".." in root or len(root)>230):
        raise RuntimeError("untrusted_phone_feature_root")
    keys=[x.get("key") if isinstance(x,dict) else None for x in rows]
    if (any(not isinstance(k,str) or not re.fullmatch(r"[a-f0-9]{64}",k)
            for k in keys) or len(set(keys))!=len(keys)):
        raise RuntimeError("invalid_phone_feature_source_keys")
    result={}
    for offset in range(0,len(keys),24):
        batch=keys[offset:offset+24]
        script="set -eu; "
        for key in batch:
            base=root+"/features/"+key
            visual=base+"-visual.json"
            hsv=base+"-hsv-v2.json"
            script+=(
                f"if test -s {visual}; then v=1; else v=0; fi; "
                f"if test -s {hsv}; then h=1; else h=0; fi; "
                f"printf 'S9_PAIR_MASK_V1 {key} %s %s\\n' \"$v\" \"$h\"; "
            )
        response=h.adb("shell",script,timeout=45,required=False)
        raw=response.stdout
        if (response.returncode!=0 or
            not isinstance(raw,str) or not isinstance(response.stderr,str) or
            response.stderr.strip() or len(raw)>len(batch)*100):
            raise RuntimeError("phone_descriptor_presence_indeterminate")
        lines=raw.splitlines()
        if len(lines)!=len(batch):
            raise RuntimeError("phone_descriptor_presence_incomplete")
        for key,line in zip(batch,lines):
            fields=line.split()
            if (len(fields)!=4 or fields[:2]!=["S9_PAIR_MASK_V1",key]
                or fields[2] not in ("0","1")
                or fields[3] not in ("0","1") or key in result):
                raise RuntimeError("phone_descriptor_presence_untrusted")
            result[key]={"visual":fields[2]=="1","hsv":fields[3]=="1"}
    if len(result)!=len(keys):
        raise RuntimeError("phone_descriptor_presence_incomplete")
    def present(key,kind):
        if key not in result or kind not in ("visual","hsv"):
            raise RuntimeError("untrusted_descriptor_presence_lookup")
        return result[key][kind]
    return present


def choose_orphan(rows,baseline_keys,present):
    """Choose one genuine V40 visual missing, prioritizing HSV-ready crops."""
    if not isinstance(rows,list) or not 58<=len(rows)<=400:
        raise RuntimeError("invalid_source_inventory_size")
    old_keys=set(baseline_keys)
    if len(old_keys)!=57:
        raise RuntimeError("invalid_immutable_v2_reference_count")
    found=[]
    for row in rows:
        key=row.get("key")
        if (not isinstance(key,str) or not re.fullmatch(r"[a-f0-9]{64}",key)
            # The trusted V40/temporal inventory omits a "source" field:
            # its V40 rows were *already* filtered to s9_sd and its
            # source-qualified key is independently matched to the V40
            # original crop SHA before a single OSNet write.
            or row.get("source","s9_sd")!="s9_sd"):
            raise RuntimeError("bad_source_qualified_crop")
        has_hsv=present(key,"hsv")
        has_visual=present(key,"visual")
        if key in old_keys and (not has_hsv or not has_visual):
            raise RuntimeError("historical_v2_reference_missing")
        if not has_visual:
            if key in old_keys or row.get("cohort")!="v40":
                raise RuntimeError("orphan_is_not_unassigned_v40")
            found.append((not has_hsv,key,row))
    if not found:
        raise RuntimeError("no_pending_v40_histogram_only_crop")
    # Prefer an existing verified HSV32 crop to complete a new V3 pair now,
    # otherwise repair one source where both features were missing. Every
    # selected source must still match one original V40 JPEG SHA256.
    return min(found,key=lambda entry:(entry[0],entry[1]))[2]

def choose_v40_source(old,entry):
    # Re-use the same source-qualified original V40 crop that produced
    # the histogram. Reject nonunique matches instead of guessing.
    planned=old.planned(old.catalog_items(),old.record_index())
    matches=[row for row in planned
        if row.get("source_key")==entry["key"]
        and row.get("source")=="s9_sd"
        and row.get("crop_sha256")==entry["crop_sha256"]]
    if len(matches)!=1:raise RuntimeError("v40_crop_provenance_mismatch")
    return matches[0]

def run(apply=False):
    mark("hub_disk_preflight")
    if shutil.disk_usage("/").free<MIN_HUB_BYTES:
        raise RuntimeError("hub_disk_reserve_low")
    if LOCK.is_symlink() or not LOCK.parent.is_dir():
        raise RuntimeError("unsafe_shared_lock")
    mark("shared_worker_lock")
    fd=os.open(LOCK,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"rb") as lock:
        try:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
        except BlockingIOError:
            # Another phone worker owns the global capture-safe window.
            # Scheduled retries must defer, never fight for Camera2 time.
            raise RuntimeError("shared_archive_worker_busy") from None
        mark("camera_health")
        healthy()
        mark("loading_source_dependencies")
        h=helper("backfill-s9-hsv32-uniform-v2.py","s9_one_orphan_hsv")
        old=helper("backfill-v40-person-rois-on-s9.py","s9_one_orphan_v40")
        ctrl=helper("backfill-s9-original-roi-osnet-temporal-v2.py","s9_one_orphan_provenance")
        rank=helper("run-s9-uniform-appearance-rankings-v3.py","s9_one_orphan_rank_validator")
        mark("historical_v2_provenance")
        original_map=rank.BASELINE_V2_MAP
        if original_map.is_symlink() or not original_map.is_file():
            raise RuntimeError("immutable_v2_map_unavailable")
        frozen_bytes=original_map.read_bytes()
        frozen=json.loads(frozen_bytes)
        if frozen.get("schema")!="s9_multivector_source_map_v2":
            raise RuntimeError("untrusted_historical_v2_map")
        baseline=frozen.get("rows")
        if not isinstance(baseline,list) or len(baseline)!=57:
            raise RuntimeError("untrusted_historical_v2_rows")
        mark("phone_model_and_dex_readiness")
        camera_id,_=ctrl.readiness()
        mark("manual_review_registry")
        approved=ctrl.approved_names()
        mark("verified_original_catalog")
        inventory_before=ctrl.primary_events()
        mark("source_crop_inventory")
        rows=h.inventory(include_unreviewed=True)
        keyset={r.get("key") for r in rows}
        if len(keyset)!=len(rows):raise RuntimeError("duplicate_source_keys")
        if any(b.get("key") not in keyset or
               any(next(x for x in rows if x["key"]==b["key"]).get(k)!=b.get(k)
                   for k in ("clip","crop_sha256","cohort"))
               for b in baseline):
            raise RuntimeError("v2_source_map_changed")
        mark("v2_hsv_osnet_source_presence")
        present=presence_inventory(h,rows)
        try:
            orphan=choose_orphan(rows,[b["key"] for b in baseline],present)
        except RuntimeError as no_orphan:
            if str(no_orphan)!="no_pending_v40_histogram_only_crop":
                raise
            # A previous attempt may have completed append-only phone inference
            # and only failed a later post-check. Reconcile genuine real pair
            # evidence instead of trying to rewrite or duplicate it.
            mark("reconcile_preexisting_real_descriptor_pair")
            complete=rank.verified_ready_subset(h,rows)
            rank.verified_v2_baseline(complete)
            old_keys={x["key"] for x in baseline}
            extras=[x for x in complete
                    if x["key"] not in old_keys and x["cohort"]=="v40"]
            if len(extras)<1 or len(complete)<58:
                raise RuntimeError("no_new_complete_real_reference")
            healthy()
            if ctrl.adb("shell","pidof nl.kalenel.s9security",timeout=15).stdout.strip()!=camera_id:
                raise RuntimeError("camera_pid_changed_during_reconcile")
            if ctrl.approved_names()!=approved or not set(inventory_before).issubset(ctrl.primary_events()):
                raise RuntimeError("review_or_archive_changed")
            if original_map.read_bytes()!=frozen_bytes:
                raise RuntimeError("immutable_v2_changed_during_reconcile")
            print(DONE+json.dumps({
                "single_real_osnet_vector_verified":True,
                "existing_hsv32_matched_and_verified":True,
                "new_osnet_sidecar_created":False,
                "historical_v2_references_preserved":57,
                "camera_pid_unchanged":True,
                "originals_modified":False,"manual_review_decisions_modified":False,
                "camera_apk_modified":False,"rankings_written":False,
                "automatic_people_assigned":0,
                "private_identifiers_disclosed":False,
                "already_complete_readonly_reconciliation":True},sort_keys=True),flush=True)
            return
        mark("original_v40_crop_sha_provenance")
        old_source=choose_v40_source(old,orphan)
        if not apply:
            print(CHECK+json.dumps({"original_v2_preserved":True,
                "eligible_orphans":1,"new_vectors_written":0,
                "camera_apk_modified":False,
                "originals_modified":False,"reviews_modified":False,
                "private_identifiers_disclosed":False}),flush=True)
            return
        mark("pre_inference_capture_readiness")
        healthy()
        mark("one_actual_on_phone_osnet_inference")
        WRITES["started"]=True
        result=old.extract_one(old_source)
        if result not in ("verified_new","already_indexed"):
            raise RuntimeError("on_phone_osnet_not_verified")
        # Independently validate the 512D real ONNX model/crop SHA and L2.
        # HSV32 will be generated in a later safe window if missing: never
        # fabricate a histogram or imply the pair was fully verified.
        mark("persisted_visual_and_hsv_sha_readback")
        h.safe_visual(orphan["key"],orphan["crop_sha256"])
        visual=h.ROOT+"/features/"+orphan["key"]+"-visual.json"
        digest=rank.existing_sha(visual)
        if not isinstance(digest,str) or not re.fullmatch(r"[a-f0-9]{64}",digest):
            raise RuntimeError("post_processing_visual_checksum_missing")
        has_hsv=present(orphan["key"],"hsv")
        if has_hsv:
            complete=rank.verified_ready_subset(h,[orphan])
            if len(complete)!=1 or complete[0]["key"]!=orphan["key"]:
                raise RuntimeError("post_processing_descriptor_pair_invalid")
        mark("post_inference_camera_readiness")
        healthy()
        if ctrl.adb("shell","pidof nl.kalenel.s9security",timeout=15).stdout.strip()!=camera_id:
            raise RuntimeError("live_camera_pid_changed")
        mark("post_inference_review_and_video_provenance")
        if ctrl.approved_names()!=approved:
            raise RuntimeError("manual_review_registry_changed")
        if not set(inventory_before).issubset(ctrl.primary_events()):
            raise RuntimeError("original_video_catalog_regressed")
        if original_map.read_bytes()!=frozen_bytes:
            raise RuntimeError("original_v2_baseline_changed")
        mark("complete")
        print(DONE+json.dumps({
            "single_real_osnet_vector_verified":True,
            "existing_hsv32_matched_and_verified":has_hsv,
            "hsv32_completion_still_pending":not has_hsv,
            "new_osnet_sidecar_created":result=="verified_new",
            "historical_v2_references_preserved":57,
            "camera_pid_unchanged":True,"originals_modified":False,
            "manual_review_decisions_modified":False,
            "camera_apk_modified":False,"rankings_written":False,
            "automatic_people_assigned":0,
            "private_identifiers_disclosed":False},sort_keys=True),flush=True)

def main():
    parser=argparse.ArgumentParser()
    parser.add_argument("--apply",action="store_true")
    args=parser.parse_args()
    try:run(args.apply)
    except Exception as exc:
        reason=str(exc)
        temporary={"camera_too_warm","4k_capture_not_idle_ready",
                   "shared_archive_worker_busy"}
        if reason in temporary:
            print(DEFER+json.dumps({"reason":reason,"stage":STAGE["value"],"completed":False,
                "may_have_written_one_real_sidecar":WRITES["started"],
                "private_identifiers_disclosed":False}),flush=True)
            return
        print(BLOCK+json.dumps({"stage":STAGE["value"],"reason":reason if reason in
             {"hub_disk_reserve_low","expected_exactly_one_orphan",
              "historical_v2_reference_missing","v40_crop_provenance_mismatch",
              "no_pending_v40_histogram_only_crop",
              "invalid_source_inventory_size"} else "private_verification_failed",
              "private_output_suppressed":True,
              "completed":False}),flush=True)
        raise SystemExit(2)

if __name__=="__main__":main()
