#!/usr/bin/env python3
"""Read-only physical S9 V3 partial ranker preflight, no phone writes.

Checks fully validated OSNet and uniform HSV32 pairs, immutable historical V2
reference subset, and camera health before allowing future on-phone rankings.
No ranking index, model, original recording or manual identity is changed.
"""
import json
import math
from pathlib import Path
import shutil
import subprocess
import sys
import urllib.request

HERE=Path(__file__).resolve().parent
RANKER=HERE/"run-s9-uniform-appearance-rankings-v3.py"
STATUS="http://127.0.0.1:18808/status"
STAGE="S9_V3_MULTIVECTOR_RANKING_PREFLIGHT "
PASS="S9_V3_PARTIAL_REFERENCE_READONLY_VERIFIED "
DEFER="S9_V3_PARTIAL_REFERENCE_READONLY_DEFERRED "
FAIL="S9_V3_PARTIAL_REFERENCE_READONLY_BLOCKED "
MIN_FREE=700*1024*1024
MAX_READONLY_TEMP=41.8

def camera():
    with urllib.request.urlopen(STATUS,timeout=14) as response:
        if response.status!=200:raise RuntimeError("camera_status_unavailable")
        raw=response.read(150001)
    if len(raw)>150000:raise RuntimeError("unbounded_camera_status")
    d=json.loads(raw)
    if not isinstance(d,dict):raise RuntimeError("invalid_camera_status")
    temp=d.get("temperature_c")
    if type(temp) not in (int,float) or not math.isfinite(temp):
        raise RuntimeError("no_temperature")
    if temp>MAX_READONLY_TEMP:return None,"temperature_readonly_deferred"
    if (d.get("ok") is not True or d.get("mode")!="watching"
        or d.get("continuous_4k_ready") is not True
        or d.get("continuous_4k_production_persisted") is not True
        or type(d.get("continuous_4k_buffered_ms")) is not int
        or d["continuous_4k_buffered_ms"]<5000
        or d.get("continuous_4k_dropped_output_frames")!=0
        or bool(d.get("continuous_4k_error"))):
        return None,"camera_not_stably_ready"
    return d,None

def accepted(doc):
    if not isinstance(doc,dict):
        raise RuntimeError("unexpected_ranker_report")
    n=doc.get("uniform_real_person_crop_records")
    cohort=doc.get("cohorts")
    if (type(n) is not int or not 58<=n<=400 or
        not isinstance(cohort,dict) or
        any(type(x) is not int or x<0 for x in cohort.values()) or
        sum(cohort.values())!=n or
        cohort.get("v40",0)<51 or cohort.get("approved_new",0)<6 or
        any(k not in ("v40","approved_new","archive_unassigned") for k in cohort) or
        doc.get("v2_reference_baseline_preserved") is not True or
        doc.get("new_rankings_written") is not False or
        doc.get("old_rankings_modified") is not False):
        raise RuntimeError("incomplete_real_ranker_preflight")
    return {"complete_descriptors":n,
            "old_v40_complete":cohort.get("v40",0),
            "approved_complete":cohort.get("approved_new",0),
            "unassigned_complete":cohort.get("archive_unassigned",0),
            "original_57_v2_descriptors_preserved":True,
            "ranking_written":False,"camera_apk_modified":False,
            "recordings_modified":False,"manual_reviews_modified":False,
            "source_identifiers_disclosed":False}

def main():
    if RANKER.is_symlink() or not RANKER.is_file():
        raise RuntimeError("missing_pinned_ranker")
    if shutil.disk_usage("/").free<MIN_FREE:
        raise RuntimeError("not_enough_hub_storage")
    d,reason=camera()
    if reason:
        print(DEFER+json.dumps({"reason":reason,
          "complete_descriptors_not_remeasured":True,
          "rankings_written":False,"source_identifiers_disclosed":False}),flush=True)
        return
    child=subprocess.run([sys.executable,str(RANKER)],capture_output=True,
                         text=True,timeout=420)
    if child.returncode:
        raise RuntimeError("private_ranker_preflight_failed")
    lines=[line[len(STAGE):] for line in child.stdout.splitlines()
           if line.startswith(STAGE)]
    if len(lines)!=1:raise RuntimeError("unexpected_ranker_marker")
    result=accepted(json.loads(lines[0]))
    after,reason=camera()
    if reason:raise RuntimeError("camera_state_changed_during_preflight")
    print(PASS+json.dumps(result,sort_keys=True),flush=True)

if __name__=="__main__":
    try:main()
    except Exception:
        print(FAIL+json.dumps({"reason":"preflight_not_verified",
                               "private_output_suppressed":True}),flush=True)
        raise SystemExit(2)
