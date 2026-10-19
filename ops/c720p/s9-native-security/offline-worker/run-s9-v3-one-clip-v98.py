#!/usr/bin/env python3
"""One bounded physical S9+ V3 ROI validation, never an identity assignment.

The existing controller enforces real 4K source checks, live camera PID,
phone temperature <=42C, exact original filename, and verified OSNet output.
This wrapper captures private child output so no person/clip names reach CI.
"""
import json
from pathlib import Path
import shutil
import subprocess
import sys

ROOT=Path(__file__).resolve().parent
CONTROLLER=ROOT/"run-s9-v3-resumable-archive.py"
LEDGER=Path("/home/jespern/c720p-home-hub/state/s9-v3-archive-backfill-ledger.jsonl")
MARK="S9_V3_ARCHIVE_ROI_ONLY_BATCH "
OK="S9_V3_ONE_CLIP_ROI_VERIFIED "
ALLOWED={"already_verified","new_real_512d_vector","no_qualified_person_box"}

def ledger_lines():
    if LEDGER.is_symlink():raise RuntimeError("unsafe_ledger_symlink")
    if not LEDGER.exists():return 0
    if not LEDGER.is_file() or LEDGER.stat().st_size>500000:
        raise RuntimeError("unbounded_ledger")
    return sum(bool(row) for row in LEDGER.read_text().splitlines())

def summarize(payload,before,after):
    if not isinstance(payload,dict) or type(before) is not int or type(after) is not int:
        raise ValueError("invalid_execution_report")
    counts=payload.get("counts")
    n=payload.get("selected")
    if (type(n) is not int or n not in (0,1) or
        not isinstance(counts,dict) or any(k not in ALLOWED or
          type(v) is not int or v<0 for k,v in counts.items()) or
        sum(counts.values())!=n or after-before!=n):
        raise ValueError("unexpected_source_ledger_result")
    for k in ("originals_modified","camera_apk_modified",
              "review_decisions_modified","appearance_rankings_modified"):
        if payload.get(k) is not False:raise ValueError("unexpected_side_effect_"+k)
    if payload.get("automatic_assignments_created")!=0:
        raise ValueError("automatic_identity_changed")
    audit=payload.get("ledger_phone_integrity_audit")
    if not isinstance(audit,dict) or type(audit.get("checked")) is not int or type(audit.get("stale")) is not int:
        raise ValueError("phone_ledger_audit_missing")
    return {"source_originals_processed":n,"outcomes":counts,
        "ledger_previous_rows":before,"ledger_current_rows":after,
        "existing_phone_vectors_audited":audit["checked"],
        "stale_phone_vectors_flagged":audit["stale"],
        "camera_apk_changed":False,"originals_changed":False,
        "review_decisions_changed":False,"rankings_activated":False,
        "human_identity_assigned":False,"private_names_disclosed":False}

def main():
    if CONTROLLER.is_symlink() or not CONTROLLER.is_file():
        raise RuntimeError("pinned_s9_worker_missing")
    # Leave room on the 96%-used C720P: no model/video download on the hub.
    if shutil.disk_usage("/").free<850*1024*1024:
        print("S9_V3_ONE_CLIP_BLOCKED_LOW_DISK",flush=True)
        raise SystemExit(2)
    previous=ledger_lines()
    result=subprocess.run([sys.executable,str(CONTROLLER),
        "--apply","--limit","1","--roi-only"],
        capture_output=True,text=True,timeout=675)
    if result.returncode:
        print("S9_V3_ONE_CLIP_STOPPED "+json.dumps({
            "worker_return_code":result.returncode,
            "private_worker_output_suppressed":True}),flush=True)
        raise SystemExit(3)
    reports=[line[len(MARK):] for line in result.stdout.splitlines()
             if line.startswith(MARK)]
    if len(reports)!=1:
        print("S9_V3_ONE_CLIP_UNEXPECTED_REPORT",flush=True)
        raise SystemExit(4)
    try:out=summarize(json.loads(reports[0]),previous,ledger_lines())
    except (ValueError,RuntimeError,TypeError):
        print("S9_V3_ONE_CLIP_UNVERIFIED",flush=True)
        raise SystemExit(5)
    print(OK+json.dumps(out,sort_keys=True),flush=True)

if __name__=="__main__":main()
