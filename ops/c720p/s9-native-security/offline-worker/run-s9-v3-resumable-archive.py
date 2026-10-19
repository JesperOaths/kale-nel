#!/usr/bin/env python3
"""Resumable, thermally guarded C720P control of isolated S9 archive workers.

Never decodes or downloads MP4s on the C720P. Does not install the camera APK,
assign an identity, update review state or replace V1/V2 indices. The scan
uses a per-source ledger, not a fragile numeric offset (new clips may arrive).
Only --apply modifies private S9 offline feature sidecars and the new V3 index.
"""
import argparse
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import sys

ROOT=Path(__file__).resolve().parent
STATE=Path("/home/jespern/c720p-home-hub/state")
LEDGER=STATE/"s9-v3-archive-backfill-ledger.jsonl"
LOCK=STATE/"s9-v3-archive-backfill.lock"
CLIP=re.compile(r"motion_[0-9]{13}[.]mp4\Z")
ALLOWED={"already_verified","new_real_512d_vector","no_qualified_person_box"}

def helper(name,alias):
    path=ROOT/name
    spec=importlib.util.spec_from_file_location(alias,path)
    if spec is None or spec.loader is None:
        raise RuntimeError("Pinned archive helper unavailable")
    obj=importlib.util.module_from_spec(spec)
    sys.modules[alias]=obj
    spec.loader.exec_module(obj)
    return obj

def reviewed_ledger():
    if LEDGER.is_symlink():raise RuntimeError("Unsafe archive ledger symlink")
    if not LEDGER.exists():return {}
    if LEDGER.stat().st_size>500000:
        raise RuntimeError("Unbounded archive ledger")
    stored={}
    for raw in LEDGER.read_text().splitlines():
        if not raw:continue
        data=json.loads(raw)
        clip=data.get("clip") if isinstance(data,dict) else None
        status=data.get("status") if isinstance(data,dict) else None
        if (not isinstance(clip,str) or not CLIP.fullmatch(clip)
            or status not in ALLOWED):
            raise RuntimeError("Invalid prior source ledger entry")
        stored[clip]=status
    return stored

def append_ledger(clip,status):
    if not CLIP.fullmatch(clip) or status not in ALLOWED:
        raise RuntimeError("Refuse invalid archive backfill ledger result")
    body=json.dumps({"source":"s9_sd","clip":clip,"status":status},
                    sort_keys=True,separators=(",",":"))+"\n"
    fd=os.open(LEDGER,os.O_APPEND|os.O_CREAT|os.O_WRONLY|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"a",encoding="utf-8") as out:
        out.write(body);out.flush();os.fsync(out.fileno())

def run_worker(filename,arguments,marker,timeout=450):
    file=ROOT/filename
    if not file.is_file() or file.is_symlink():
        raise RuntimeError("Required pinned S9 worker script missing: "+filename)
    proc=subprocess.run([sys.executable,str(file),*arguments],
                        capture_output=True,text=True,timeout=timeout)
    if proc.returncode:
        raise RuntimeError("Offline S9 stage failed ["+filename+"] rc="+
                           str(proc.returncode)+": "+proc.stderr[-450:])
    rows=[line for line in proc.stdout.splitlines() if line.startswith(marker+" ")]
    if len(rows)!=1:raise RuntimeError("Offline S9 stage did not produce exact audit marker")
    payload=json.loads(rows[0][len(marker)+1:])
    if not isinstance(payload,dict):
        raise RuntimeError("Malformed stage response")
    return payload

def capture_candidate_list(ctrl):
    events=ctrl.primary_events()
    approved=ctrl.approved_names()
    return ctrl.candidates(events,approved,"archive")

def single_status(doc):
    counts=doc.get("counts")
    if (doc.get("attempted")!=1 or not isinstance(counts,dict)
        or sum(v for v in counts.values() if type(v) is int)!=1
        or any(x not in ALLOWED for x in counts)
        or doc.get("human_review_required") is not True
        or doc.get("recordings_modified") is not False
        or doc.get("camera_apk_modified") is not False
        or doc.get("review_decisions_modified") is not False):
        raise RuntimeError("Untrusted S9 ROI/OSNet acceptance result")
    return next(iter(counts))

def main():
    opts=argparse.ArgumentParser()
    opts.add_argument("--apply",action="store_true")
    opts.add_argument("--limit",type=int,default=3,
                      help="Maximum individual original clips this invocation")
    opts.add_argument("--retry-rejected",action="store_true",
                      help="Retry clips rejected under a previous detector pass")
    opts.add_argument("--activate-api",action="store_true",
                      help="After V3 success, invoke guarded separate API install")
    args=opts.parse_args()
    if not 1<=args.limit<=5:
        raise RuntimeError("Archive run maximum five originals")
    ctrl=helper("backfill-s9-original-roi-osnet-temporal-v2.py","s9_archive_controller")
    h=helper("backfill-s9-hsv32-uniform-v2.py","s9_uniform_hsv")
    if not args.apply:
        existing=reviewed_ledger()
        items=capture_candidate_list(ctrl)
        todo=[clip for _,clip,_ in items
              if clip not in existing or
                 (args.retry_rejected and existing[clip]=="no_qualified_person_box")]
        print("S9_V3_ARCHIVE_RESUMABLE_DRY_RUN "+json.dumps({
            "eligible_originals":len(items),"previously_logged":len(existing),
            "pending":len(todo),"selected":todo[:args.limit],
            "videos_modified":False,"human_reviews_modified":False}),flush=True)
        return
    STATE.mkdir(parents=True,exist_ok=True)
    if LOCK.is_symlink():raise RuntimeError("Archive pipeline lock symlink")
    fd=os.open(LOCK,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"rb") as guard:
        fcntl.flock(guard,fcntl.LOCK_EX|fcntl.LOCK_NB)
        existing=reviewed_ledger()
        items=capture_candidate_list(ctrl)
        pending=[clip for _,clip,_ in items
                 if clip not in existing or
                    (args.retry_rejected and existing[clip]=="no_qualified_person_box")]
        selected=pending[:args.limit]
        totals={};done=[]
        for clip in selected:
            # Catalog can grow while active 4K recording continues. Re-select
            # by immutable original filename for each independent phone run.
            latest=capture_candidate_list(ctrl)
            offsets={row[1]:i for i,row in enumerate(latest)}
            if clip not in offsets:
                raise RuntimeError("Selected S9 original changed/disappeared")
            result=run_worker(
                "backfill-s9-original-roi-osnet-temporal-v2.py",
                ["--mode","archive","--limit","1","--offset",
                 str(offsets[clip]),"--expected-clip",clip,"--apply"],
                "S9_TEMPORAL_FALLBACK_ROI_OSNET_BACKFILL_BATCH",timeout=340)
            status=single_status(result)
            append_ledger(clip,status)
            done.append(clip)
            totals[status]=totals.get(status,0)+1
        # A prior snapshot is still valid if nothing new qualified; do not
        # endlessly recompute full historical rankings for empty detections.
        generated=totals.get("new_real_512d_vector",0)
        ranked=False;histograms=0;active=False
        if generated:
            catalog=h.inventory(include_unreviewed=True)
            if len(catalog)>400:raise RuntimeError("V3 archive exceeds bounded scorer capacity")
            pending_hsv=[x for x in catalog if not h.remote_exists(
                 h.ROOT+"/features/"+x["key"]+"-hsv-v2.json")]
            if len(pending_hsv)>10:
                raise RuntimeError("More than ten missing HSV sidecars; run bounded histogram batches")
            if pending_hsv:
                out=run_worker(
                    "backfill-s9-hsv32-uniform-v2.py",
                    ["--include-unreviewed","--missing-only","--limit","10","--write"],
                    "S9_HSV32_V2_BACKFILL_VERIFIED",timeout=380)
                counts=out.get("counts",{})
                if (sum(counts.values())!=len(pending_hsv) or
                    counts.get("verified_histogram_and_osnet")!=len(pending_hsv)
                    or out.get("recordings_modified") is not False):
                    raise RuntimeError("Uniform HSV32 stage did not verify all new descriptors")
                histograms=len(pending_hsv)
            if len(catalog)>=58:
                out=run_worker(
                    "run-s9-uniform-appearance-rankings-v3.py",
                    ["--apply"],"S9_V3_MODEL_BACKED_RANKINGS_PRODUCED",
                    timeout=400)
                if (out.get("verified_uniform_crop_records")!=len(catalog)
                    or out.get("v1_v2_indices_sha256_unchanged") is not True
                    or out.get("camera_apk_changed") is not False
                    or out.get("manual_reviews_changed") is not False):
                    raise RuntimeError("V3 ranked snapshot failed source preservation")
                ranked=True
                if args.activate_api:
                    api=run_worker("deploy-s9-multivector-api-v3.py",
                                   ["--apply"],"S9_V3_READONLY_API_DEPLOY_VERIFIED",
                                   timeout=360)
                    active=api.get("status")=="verified_v3_rankings_live"
                    if not active:
                        raise RuntimeError("V3 API did not serve real active rankings")
        print("S9_V3_ARCHIVE_RESUMABLE_BATCH "+json.dumps({
            "selected":len(selected),"counts":totals,
            "new_histograms":histograms,"ranked_v3":ranked,
            "live_api_confirmed":active,
            "processed_this_pass":done,
            "remaining_at_selection":max(0,len(pending)-len(selected)),
            "live_camera_modified":False,"originals_modified":False,
            "review_decisions_modified":False}),flush=True)

if __name__=="__main__":main()
