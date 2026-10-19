#!/usr/bin/env python3
"""Aggregate-only, read-only S9 v3 reference inventory/histogram audit.

Purpose: distinguish whether initial combined archive run failed at
legacy V40 inventory, new ROI provenance, histogram existence or valid
OSNet feature metadata. Never creates rankings, private files or clips.
"""
from collections import Counter
import importlib.util
import json
from pathlib import Path
import re
import sys

ROOT=Path(__file__).resolve().parent
MARK="S9_V3_READONLY_INVENTORY_STAGE "

def sibling(name,alias):
    p=ROOT/name
    if p.is_symlink() or not p.is_file():
        raise RuntimeError("missing_helper")
    spec=importlib.util.spec_from_file_location(alias,p)
    obj=importlib.util.module_from_spec(spec)
    sys.modules[alias]=obj
    spec.loader.exec_module(obj)
    return obj

def categorized(error):
    # Do not log private filenames or exception bodies. Match only fixed
    # internal failure strings, otherwise report a generic category.
    message=str(error)
    if "Ambiguous V40 full-person source" in message:return "ambiguous_old_crop"
    if "Newer S9 person crop provenance invalid" in message:return "new_roi_provenance"
    if "Missing verified V40/approved crop cohort" in message:return "insufficient_baseline"
    if "Duplicate source-qualified crop keys" in message:return "duplicate_crop_key"
    if "Connection refused" in message or "urlopen" in message:return "local_archive_api_unavailable"
    if "S9 unavailable or private command failed" in message:return "phone_adb_or_sidecar_read"
    if "Pinned source-qualified helper missing" in message:return "missing_sibling"
    return "unclassified_aggregate_only"

def audit():
    h=sibling("backfill-s9-hsv32-uniform-v2.py","s9_v3_hsv_inventory")
    stage="inventory"
    try:
        rows=h.inventory(include_unreviewed=True)
    except Exception as e:
        return {"ok":False,"stage":stage,"failure_class":categorized(e),
                "identifiers_disclosed":False}
    if not isinstance(rows,list) or not 51<=len(rows)<=400:
        return {"ok":False,"stage":stage,"failure_class":"invalid_inventory_range",
                "identifiers_disclosed":False}
    counts=Counter(item["cohort"] for item in rows)
    stage="histogram_presence"
    missing=0
    try:
        for item in rows:
            key=item.get("key")
            if not isinstance(key,str) or not re.fullmatch(r"[a-f0-9]{64}",key):
                raise RuntimeError("invalid_crop_key")
            if not h.remote_exists(h.ROOT+"/features/"+key+"-hsv-v2.json"):
                missing+=1
    except Exception as e:
        return {"ok":False,"stage":stage,"failure_class":categorized(e),
                "inventory_crops":len(rows),"identifiers_disclosed":False}
    stage="verified_sample_embeddings"
    sample=rows[:min(5,len(rows))]
    passed=0;failed=0
    try:
        for item in sample:
            try:
                h.safe_visual(item["key"],item["crop_sha256"])
                passed+=1
            except (ValueError,TypeError,RuntimeError):
                failed+=1
    except Exception as e:
        return {"ok":False,"stage":stage,"failure_class":categorized(e),
                "inventory_crops":len(rows),"identifiers_disclosed":False}
    return {"ok":True,"stage":"complete","inventory_crops":len(rows),
            "v40_crops":counts.get("v40",0),
            "approved_new_crops":counts.get("approved_new",0),
            "archive_unassigned_crops":counts.get("archive_unassigned",0),
            "missing_uniform_hsv32":missing,
            "sample_osnet_valid":passed,
            "sample_osnet_invalid":failed,
            "sample_count":len(sample),
            "originals_modified":False,
            "review_decisions_modified":False,
            "camera_apk_modified":False,
            "identifiers_disclosed":False}

if __name__=="__main__":
    try:
        response=audit()
        print(MARK+json.dumps(response,sort_keys=True),flush=True)
        if not response.get("ok"):raise SystemExit(3)
    except Exception as e:
        # Generic constant; no filenames, embedding JSON, IDs or stack.
        print("S9_V3_READONLY_INVENTORY_BLOCKED "+json.dumps({
            "reason":"unexpected_inventory_probe_error",
            "identifiers_disclosed":False}),flush=True)
        raise SystemExit(4)
