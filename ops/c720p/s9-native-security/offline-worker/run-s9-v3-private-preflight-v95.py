#!/usr/bin/env python3
"""Privacy-preserving, read-only C720P -> S9 V3 archive preparation check.

Runs the existing pinned source-qualified controller WITHOUT --apply.
No MP4 names, person labels, identities, or private filenames are printed.
This wrapper never modifies the S9+ recorder, review registry or model index.
"""
import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT=Path(__file__).resolve().parent
SOURCE=ROOT/"run-s9-v3-resumable-archive.py"
MARK="S9_V3_ARCHIVE_RESUMABLE_DRY_RUN "
OUT="S9_V3_ARCHIVE_PRIVATE_PREFLIGHT "

def summarize(payload):
    if not isinstance(payload,dict):raise ValueError("wrong_response_shape")
    numbers=("eligible_originals","previously_logged","pending")
    if any(type(payload.get(k)) is not int or payload[k]<0 for k in numbers):
        raise ValueError("invalid_archive_counts")
    selected=payload.get("selected")
    if (not isinstance(selected,list) or len(selected)>3 or
        any(not isinstance(name,str) or not name.startswith("motion_") or
            not name.endswith(".mp4") for name in selected)):
        raise ValueError("invalid_private_selection")
    if payload.get("videos_modified") is not False or payload.get("human_reviews_modified") is not False:
        raise ValueError("archive_mutation_reported")
    return {"eligible_originals":payload["eligible_originals"],
            "previously_logged":payload["previously_logged"],
            "pending":payload["pending"],"candidate_count":len(selected),
            "video_files_modified":False,"review_decisions_modified":False,
            "camera_apk_modified":False,"raw_filenames_disclosed":False}

def main():
    if SOURCE.is_symlink() or not SOURCE.is_file():
        raise RuntimeError("pinned_controller_missing")
    if shutil.disk_usage("/").free<650*1024*1024:
        print("S9_V3_ARCHIVE_PRIVATE_BLOCKED_LOW_DISK",flush=True)
        raise SystemExit(2)
    child=subprocess.run([sys.executable,str(SOURCE),"--limit","3"],
                         capture_output=True,text=True,timeout=160)
    # Never echo child stderr, which might contain private source identities.
    if child.returncode:
        print("S9_V3_ARCHIVE_PRIVATE_CONTROLLER_FAILED "+json.dumps({
            "exit_code":child.returncode,"private_output_suppressed":True}),flush=True)
        raise SystemExit(3)
    lines=[line for line in child.stdout.splitlines() if line.startswith(MARK)]
    if len(lines)!=1:
        print("S9_V3_ARCHIVE_PRIVATE_UNEXPECTED_RESPONSE",flush=True)
        raise SystemExit(4)
    try:summary=summarize(json.loads(lines[0][len(MARK):]))
    except (ValueError,TypeError):
        print("S9_V3_ARCHIVE_PRIVATE_INVALID_REPORT",flush=True)
        raise SystemExit(5)
    print(OUT+json.dumps(summary,sort_keys=True),flush=True)

if __name__=="__main__":main()
