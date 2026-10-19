#!/usr/bin/env python3
"""Resumable, thermally guarded C720P control of isolated S9 archive workers.

Never decodes or downloads MP4s on the C720P. Does not install the camera APK,
assign an identity, update review state or replace V1/V2 indices. The scan
uses a per-source ledger, not a fragile numeric offset (new clips may arrive).
Only --apply modifies private S9 offline feature sidecars and the new V3 index.
"""
import argparse
import bisect
import hashlib
import fcntl
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import sys

ROOT=Path(__file__).resolve().parent
STATE=Path("/home/jespern/c720p-home-hub/state")
LEDGER=STATE/"s9-v3-archive-backfill-ledger.jsonl"
LOCK=STATE/"s9-v3-archive-backfill.lock"
AUDIT=STATE/"s9-v3-ledger-audit-cursor.json"
CLIP=re.compile(r"motion_[0-9]{13}[.]mp4\Z")
WORKER_STATUSES={"already_verified","new_real_512d_vector","no_qualified_person_box"}
ALLOWED=WORKER_STATUSES|{"stale_feature"}

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
            or data.get("source")!="s9_sd" or status not in ALLOWED):
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

def remote_file_present(ctrl,path):
    """Distinguish missing private evidence from an ADB transport failure."""
    result=ctrl.adb("shell","test -s "+path,timeout=15,check=False)
    if result.returncode==0:return True
    if result.returncode!=1 or result.stderr.strip():
        raise RuntimeError("S9 ADB transport failed before recovery bootstrap")
    return False


def prepare_partial_recovery(ctrl,clip):
    """Bootstrap independent recovery DEX only for one-sided ROI staging."""
    if not CLIP.fullmatch(clip):
        raise RuntimeError("Source-qualified archived clip invalid")
    key=hashlib.sha256(("s9_sd\x00"+clip).encode()).hexdigest()
    roi=ctrl.ROOT+"/inbox/"+key+".jpg"
    meta=ctrl.ROOT+"/features/"+key+"-detector.json"
    crop=remote_file_present(ctrl,roi)
    evidence=remote_file_present(ctrl,meta)
    if crop==evidence:return False
    # Gate CPU-side compilation/staging on the same physical-model, live
    # Camera2 PID and battery-temperature readiness used for ROI inference.
    ctrl.readiness()
    jar=ctrl.ROOT+"/s9-offline-person-roi-recovery-v3.jar"
    if remote_file_present(ctrl,jar):return False
    result=run_worker("install-s9-roi-partial-recovery-v3.py",
                      ["--install"],"S9_ROI_PARTIAL_RECOVERY_V3_INSTALLED",
                      timeout=400)
    if (result.get("no_camera_apk_changes") is not True
        or result.get("no_recording_changes") is not True
        or result.get("no_review_changes") is not True
        or not isinstance(result.get("dex_sha256"),str)
        or not re.fullmatch(r"[a-f0-9]{64}",result["dex_sha256"])):
        raise RuntimeError("Isolated ROI recovery installation was not verified")
    if not remote_file_present(ctrl,jar):
        raise RuntimeError("S9 private recovery DEX missing after install")
    return True


def capture_candidate_list(ctrl):
    events=ctrl.primary_events()
    approved=ctrl.approved_names()
    return ctrl.candidates(events,approved,"archive")

def single_status(doc):
    counts=doc.get("counts")
    if (doc.get("attempted")!=1 or not isinstance(counts,dict)
        or not counts or any(type(v) is not int or v<0 for v in counts.values())
        or sum(counts.values())!=1
        or any(x not in WORKER_STATUSES for x in counts)
        or doc.get("human_review_required") is not True
        or doc.get("recordings_modified") is not False
        or doc.get("camera_apk_modified") is not False
        or doc.get("review_decisions_modified") is not False):
        raise RuntimeError("Untrusted S9 ROI/OSNet acceptance result")
    return next(status for status,value in counts.items() if value==1)

def check_existing_feature(ctrl,clip):
    """Bounded read-only validation of a previous phone-side success."""
    if not CLIP.fullmatch(clip):raise RuntimeError("Invalid ledger source")
    key=hashlib.sha256(("s9_sd\x00"+clip).encode()).hexdigest()
    metadata=ctrl.ROOT+"/features/"+key+"-detector.json"
    sidecar=ctrl.ROOT+"/features/"+key+"-visual.json"
    for path,reason in ((metadata,"missing_detector"),
                        (sidecar,"missing_visual")):
        result=ctrl.adb("shell","test -s "+path,timeout=15,check=False)
        if result.returncode:
            # ADB transport errors are NOT evidence that features disappeared.
            if result.stderr.strip() or result.returncode!=1:
                raise RuntimeError("Phone ADB transport failed during ledger audit")
            return reason
    try:
        crop_sha=ctrl.detector_provenance(clip,key,metadata)
    except (ValueError,TypeError,KeyError,json.JSONDecodeError,RuntimeError):
        return "invalid_detector_provenance"
    roi=ctrl.ROOT+"/inbox/"+key+".jpg"
    image=ctrl.adb("shell","test -s "+roi,timeout=15,check=False)
    if image.returncode:
        if image.stderr.strip() or image.returncode!=1:
            raise RuntimeError("ADB lost while verifying private original ROI")
        return "missing_roi"
    observed=ctrl.adb("shell","sha256sum "+roi,timeout=25).stdout.split()
    if len(observed)<1 or observed[0]!=crop_sha:
        return "invalid_roi_checksum"
    try:
        value=json.loads(ctrl.adb("exec-out","cat",sidecar,timeout=25).stdout)
    except (TypeError,ValueError,json.JSONDecodeError):
        return "invalid_visual_metadata"
    if not ctrl.valid_visual(value,key,crop_sha):
        return "invalid_visual_metadata"
    return "verified"


def reconcile_ledger(ctrl,existing,max_checks=12):
    """Rotate across prior successes so phone-cache loss cannot be skipped.

    Called only inside the archive lock. A recheck never touches the original
    recordings or reviewed identities; stale private features are requeued.
    """
    positive=sorted(clip for clip,status in existing.items()
                    if status in ("already_verified","new_real_512d_vector"))
    if not positive:return {"checked":0,"stale":0,"reasons":{}}
    if AUDIT.is_symlink():raise RuntimeError("Unsafe archive audit cursor")
    if AUDIT.exists():
        if AUDIT.stat().st_size>4096:
            raise RuntimeError("Unbounded archive audit cursor")
        previous=json.loads(AUDIT.read_text())
        if previous.get("schema")!="s9_v3_ledger_audit_cursor_v1":
            raise RuntimeError("Unknown audit cursor schema")
        last=previous.get("last_clip","")
        if last and not CLIP.fullmatch(last):
            raise RuntimeError("Invalid audit cursor clip")
    else:last=""
    position=bisect.bisect_right(positive,last)%len(positive)
    chosen=[positive[(position+i)%len(positive)]
            for i in range(min(max_checks,len(positive)))]
    camera=ctrl.adb("shell","pidof nl.kalenel.s9security",timeout=15).stdout.strip()
    if not re.fullmatch(r"[0-9 ]+",camera):
        raise RuntimeError("Live camera process unavailable for ledger audit")
    failures={}
    for clip in chosen:
        reason=check_existing_feature(ctrl,clip)
        if reason!="verified":
            append_ledger(clip,"stale_feature")
            existing[clip]="stale_feature"
            failures[reason]=failures.get(reason,0)+1
    if ctrl.adb("shell","pidof nl.kalenel.s9security",timeout=15).stdout.strip()!=camera:
        raise RuntimeError("Camera PID changed during read-only ledger audit")
    data=(json.dumps({"schema":"s9_v3_ledger_audit_cursor_v1",
                      "last_clip":chosen[-1]},
                     sort_keys=True,separators=(",",":"))+"\n").encode()
    fd,tmp=tempfile.mkstemp(prefix=".s9-ledger-audit-",dir=STATE)
    try:
        with os.fdopen(fd,"wb") as dst:
            dst.write(data);dst.flush();os.fsync(dst.fileno())
        os.chmod(tmp,0o600)
        os.replace(tmp,AUDIT)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
    return {"checked":len(chosen),"stale":sum(failures.values()),
            "reasons":failures}


def main():
    opts=argparse.ArgumentParser()
    opts.add_argument("--apply",action="store_true")
    opts.add_argument("--limit",type=int,default=3,
                      help="Maximum individual original clips this invocation")
    opts.add_argument("--retry-rejected",action="store_true",
                      help="Retry clips rejected under a previous detector pass")
    opts.add_argument("--activate-api",action="store_true",
                      help="After V3 success, invoke guarded separate API install")
    opts.add_argument("--roi-only",action="store_true",
                      help="Extract private phone crops without histogram/ranking/API writes")
    args=opts.parse_args()
    if not 1<=args.limit<=5:
        raise RuntimeError("Archive run maximum five originals")
    if args.roi_only and args.activate_api:
        raise RuntimeError("ROI-only processing cannot activate the V3 API")
    ctrl=helper("backfill-s9-original-roi-osnet-temporal-v2.py","s9_archive_controller")
    h=helper("backfill-s9-hsv32-uniform-v2.py","s9_uniform_hsv")
    if not args.apply:
        existing=reviewed_ledger()
        items=capture_candidate_list(ctrl)
        todo=[clip for _,clip,_ in items
              if clip not in existing or existing[clip]=="stale_feature" or
                 (args.retry_rejected and existing[clip]=="no_qualified_person_box")]
        print("S9_V3_ARCHIVE_RESUMABLE_DRY_RUN "+json.dumps({
            "eligible_originals":len(items),"previously_logged":len(existing),
            "pending":len(todo),"selected":todo[:args.limit],
            "videos_modified":False,"human_reviews_modified":False,
            "ledger_phone_integrity_checked":False}),flush=True)
        return
    STATE.mkdir(parents=True,exist_ok=True)
    if LOCK.is_symlink():raise RuntimeError("Archive pipeline lock symlink")
    fd=os.open(LOCK,os.O_CREAT|os.O_RDWR|os.O_NOFOLLOW,0o600)
    with os.fdopen(fd,"rb") as guard:
        fcntl.flock(guard,fcntl.LOCK_EX|fcntl.LOCK_NB)
        existing=reviewed_ledger()
        audit=reconcile_ledger(ctrl,existing)
        items=capture_candidate_list(ctrl)
        pending=[clip for _,clip,_ in items
                 if clip not in existing or existing[clip]=="stale_feature" or
                    (args.retry_rejected and existing[clip]=="no_qualified_person_box")]
        selected=pending[:args.limit]
        totals={};done=[];recovery_bootstraps=0
        for clip in selected:
            if prepare_partial_recovery(ctrl,clip):
                recovery_bootstraps+=1
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
        # The first physical validation is deliberately restricted to an
        # audited private phone-side crop and the resumable ledger. A
        # separate pass must publish full appearance rankings and APIs.
        if args.roi_only:
            print("S9_V3_ARCHIVE_ROI_ONLY_BATCH "+json.dumps({
                "selected":len(selected),"counts":totals,
                "recovery_worker_bootstraps":recovery_bootstraps,
                "ledger_phone_integrity_audit":audit,
                "originals_modified":False,"camera_apk_modified":False,
                "review_decisions_modified":False,
                "appearance_rankings_modified":False,
                "automatic_assignments_created":0}),flush=True)
            return
        ranked=False;histograms=0;active=False
        catalog=h.inventory(include_unreviewed=True)
        if len(catalog)>400:
            raise RuntimeError("V3 archive exceeds bounded scorer capacity")
        pending_hsv=[x for x in catalog if not h.remote_exists(
             h.ROOT+"/features/"+x["key"]+"-hsv-v2.json")]
        # If an earlier run reached its thermal stop after writing OSNet,
        # there may be no *new* vector in this invocation. Still resume
        # missing HSV computation / publishing the unactivated V3 snapshot.
        if pending_hsv:
            count=min(10,len(pending_hsv))
            out=run_worker(
                "backfill-s9-hsv32-uniform-v2.py",
                ["--include-unreviewed","--missing-only","--limit",
                 str(count),"--write"],
                "S9_HSV32_V2_BACKFILL_VERIFIED",timeout=380)
            counts=out.get("counts",{})
            if (sum(counts.values())!=count or
                counts.get("verified_histogram_and_osnet")!=count
                or out.get("recordings_modified") is not False):
                raise RuntimeError("Uniform HSV32 stage did not verify selected descriptors")
            histograms=count
        missing_remaining=max(0,len(pending_hsv)-histograms)
        active_pointer=STATE/"s9-multivector-v3-active.json"
        active_count=0
        if active_pointer.is_symlink():
            raise RuntimeError("Unsafe active V3 pointer")
        if active_pointer.exists():
            pointer=json.loads(active_pointer.read_text())
            active_count=pointer.get("verified_crops")
            if (type(active_count) is not int or
                not 58<=active_count<=400
                or pointer.get("schema")!="s9_appearance_v3_active_v1"
                or pointer.get("human_review_required") is not True):
                raise RuntimeError("Malformed existing V3 active snapshot")
            if active_count>len(catalog):
                raise RuntimeError("Verified V3 corpus regressed below active snapshot")
        if len(catalog)>=58 and missing_remaining==0 and active_count<len(catalog):
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
        if args.activate_api and len(catalog)>=58 and missing_remaining==0:
            if not active_pointer.exists():
                raise RuntimeError("No fully verified V3 snapshot to activate")
            api=run_worker("deploy-s9-multivector-api-v3.py",
                           ["--apply"],"S9_V3_READONLY_API_DEPLOY_VERIFIED",
                           timeout=360)
            active=api.get("status")=="verified_v3_rankings_live"
            if not active:
                raise RuntimeError("V3 API did not serve real active rankings")
        print("S9_V3_ARCHIVE_RESUMABLE_BATCH "+json.dumps({
            "selected":len(selected),"counts":totals,
            "recovery_worker_bootstraps":recovery_bootstraps,
            "ledger_phone_integrity_audit":audit,
            "new_histograms":histograms,
            "missing_histograms_remaining":missing_remaining,
            "ranked_v3":ranked,
            "live_api_confirmed":active,
            "processed_this_pass":done,
            "remaining_at_selection":max(0,len(pending)-len(selected)),
            "live_camera_modified":False,"originals_modified":False,
            "review_decisions_modified":False}),flush=True)

if __name__=="__main__":main()
