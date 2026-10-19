#!/usr/bin/env python3
"""Private aggregate-only single-original S9 V3 phone acceptance pilot.

The only write operation is the existing bounded, source-provenance-verified
controller with --limit 1 --apply. Does not install/replace the live Camera2
APK, edit original videos, or change any human review. Failure is fail-closed,
with output/error text suppressed to avoid disclosing person/clip identifiers.
"""
import importlib.util
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE=Path(__file__).resolve().parent
CONTROLLER=HERE/"run-s9-v3-resumable-archive.py"
TEMPORAL=HERE/"backfill-s9-original-roi-osnet-temporal-v2.py"
MARKER="S9_V3_ARCHIVE_RESUMABLE_BATCH "
REPORT="S9_V3_SINGLE_ORIGINAL_LIVE_PILOT "
REQUIRED=(
  "run-s9-v3-resumable-archive.py",
  "backfill-s9-original-roi-osnet-temporal-v2.py",
  "backfill-s9-hsv32-uniform-v2.py",
  "backfill-v40-person-rois-on-s9.py",
  "backfill-s9-original-person-roi-osnet.py",
  "run-s9-uniform-appearance-rankings-v3.py",
  "S9AppearanceRankingWorkerV3.java",
  "PhoneOfflineSimilarity.java",
  "install-s9-roi-partial-recovery-v3.py",
  "S9StandalonePersonRoiRecoveryV3.java",
)

def load_temporal():
    spec=importlib.util.spec_from_file_location("s9_v3_phone_precheck",TEMPORAL)
    module=importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module

def checked_status(doc):
    if not isinstance(doc,dict):
        raise RuntimeError("untrusted_aggregate_result")
    for name in ("live_camera_modified","originals_modified",
                 "review_decisions_modified"):
        if doc.get(name) is not False:
            raise RuntimeError("reported_mutation_"+name)
    if type(doc.get("selected")) is not int or doc["selected"]!=1 or not isinstance(doc.get("counts"),dict):
        raise RuntimeError("unexpected_pilot_batch")
    allowed={"already_verified","new_real_512d_vector","no_qualified_person_box"}
    counts=doc["counts"]
    if (any(name not in allowed or type(value) is not int or value<0
            for name,value in counts.items())
        or sum(counts.values())!=1):
        raise RuntimeError("unverified_person_crop_counts")
    if (doc.get("new_histograms") is None or
        type(doc["new_histograms"]) is not int
        or not 0<=doc["new_histograms"]<=10 or
        type(doc.get("missing_histograms_remaining")) is not int or
        doc["missing_histograms_remaining"]<0 or
        doc.get("live_api_confirmed") is not False or
        type(doc.get("ranked_v3")) is not bool or
        type(doc.get("remaining_at_selection")) is not int or
        doc["remaining_at_selection"]<0):
        raise RuntimeError("incomplete_rank_stage_integrity")
    # Do NOT return/copy the controller's processed_this_pass identifiers.
    return {"processed":1,
            "already_verified":counts.get("already_verified",0),
            "new_512d_vectors":counts.get("new_real_512d_vector",0),
            "no_qualified_person_box":counts.get("no_qualified_person_box",0),
            "verified_new_histograms":doc["new_histograms"],
            "pending_histogram_followups":doc["missing_histograms_remaining"],
            "v3_snapshot_generated":doc["ranked_v3"],
            "remaining_at_selection":doc["remaining_at_selection"],
            "camera_apk_modified":False,
            "originals_modified":False,
            "manual_review_decisions_modified":False,
            "raw_filenames_disclosed":False}

def main():
    if shutil.disk_usage("/").free<650*1024*1024:
        raise RuntimeError("insufficient_c720p_free_space")
    if any((HERE/name).is_symlink() or not (HERE/name).is_file() for name in REQUIRED):
        raise RuntimeError("missing_immutable_snapshot_source")
    ctrl=load_temporal()
    # Readiness includes exact SSD and pretrained OSNet SHA256, required
    # independent Android DEXes, stable Camera2 PID and <=42C battery.
    camera,temperature=ctrl.readiness()
    if (not re.fullmatch(r"[0-9 ]+",camera) or
        not isinstance(temperature,(float,int)) or temperature>42):
        raise RuntimeError("live_phone_readiness_failed")
    if ctrl.adb("shell","test -s "+ctrl.ROOT+"/s9-torso-hsv-v2.jar",
                check=False).returncode:
        raise RuntimeError("uniform_HSV32_worker_unavailable")
    before_events=ctrl.primary_events()
    before_approvals=ctrl.approved_names()
    if len(before_events)<150:
        raise RuntimeError("insufficient_s9_original_catalog")
    prospective=ctrl.candidates(before_events,before_approvals,"archive")
    if len(prospective)<100:
        raise RuntimeError("archive_candidate_selection_degraded")
    # An existing previously finished ledger must not be blindly replaced.
    # The coordinator owns append-only decisions and re-audits positive rows.
    child=subprocess.run([sys.executable,str(CONTROLLER),"--limit","1","--apply"],
                         capture_output=True,text=True,timeout=510)
    if child.returncode:
        raise RuntimeError("guarded_phone_backfill_failed")
    lines=[line for line in child.stdout.splitlines()
           if line.startswith(MARKER)]
    if len(lines)!=1:raise RuntimeError("no_verified_phone_batch_marker")
    result=checked_status(json.loads(lines[0][len(MARKER):]))
    after_events=ctrl.primary_events()
    after_approvals=ctrl.approved_names()
    if not set(before_events).issubset(after_events):
        raise RuntimeError("original_archive_catalog_regressed")
    if before_approvals!=after_approvals:
        raise RuntimeError("manual_approvals_modified")
    current_pid=ctrl.adb("shell","pidof nl.kalenel.s9security",timeout=15).stdout.strip()
    if current_pid!=camera:raise RuntimeError("camera_process_changed")
    print(REPORT+json.dumps({**result,
         "camera_pid_preserved":True,
         "approved_reference_registry_unchanged":True,
         "archive_catalog_nonregressed":True},sort_keys=True),flush=True)

if __name__=="__main__":
    try:main()
    except Exception as err:
        # Expose only exception class/selected non-private reason.
        reason=str(err)
        known={"insufficient_c720p_free_space","missing_immutable_snapshot_source",
               "live_phone_readiness_failed","uniform_HSV32_worker_unavailable",
               "insufficient_s9_original_catalog","archive_candidate_selection_degraded",
               "guarded_phone_backfill_failed","no_verified_phone_batch_marker",
               "original_archive_catalog_regressed","manual_approvals_modified",
               "camera_process_changed"}
        print("S9_V3_SINGLE_ORIGINAL_PILOT_BLOCKED "+
              json.dumps({"reason":reason if reason in known else "integrity_preflight_failed",
                          "private_output_suppressed":True}),flush=True)
        raise SystemExit(2)
