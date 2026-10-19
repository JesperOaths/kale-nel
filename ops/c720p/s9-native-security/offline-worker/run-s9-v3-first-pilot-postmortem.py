#!/usr/bin/env python3
"""Read-only private phone-side stage audit after first V3 archive pilot.

Only aggregate counts and evidence-presence flags are emitted. No clip,
person, embedding, crop image or raw exception is printed. Requires existing
C720P archive + S9 ADB connection. This worker only reads diagnostic evidence.
"""
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import sys

ROOT=Path(__file__).resolve().parent
STATE=Path("/home/jespern/c720p-home-hub/state")
MARK="S9_V3_FIRST_PILOT_DIAGNOSTIC "

def sibling(filename,alias):
    path=ROOT/filename
    if path.is_symlink() or not path.is_file():
        raise RuntimeError("missing_source_helper")
    spec=importlib.util.spec_from_file_location(alias,path)
    m=importlib.util.module_from_spec(spec)
    sys.modules[alias]=m
    spec.loader.exec_module(m)
    return m

def present(ctrl,path):
    r=ctrl.adb("shell","test -s "+path,timeout=15,check=False)
    if r.returncode==0:return True
    if r.returncode!=1 or r.stderr.strip():
        raise RuntimeError("adb_transport_unavailable")
    return False

def inspect():
    ctrl=sibling("backfill-s9-original-roi-osnet-temporal-v2.py","s9_v3_rois_probe")
    flow=sibling("run-s9-v3-resumable-archive.py","s9_v3_flow_probe")
    current=ctrl.adb("shell","pidof nl.kalenel.s9security",timeout=15).stdout.strip()
    if not re.fullmatch(r"[0-9 ]+",current):
        raise RuntimeError("camera_process_missing")
    led=flow.reviewed_ledger()
    events=ctrl.primary_events()
    approved=ctrl.approved_names()
    allowed=ctrl.candidates(events,approved,"archive")
    if not allowed:
        raise RuntimeError("no_eligible_archive_sources")
    # The first accepted pilot chooses the first pending source from this
    # priority-ordered roster. Also check the first logged source, if present.
    candidates=[row[1] for row in allowed]
    processed=[clip for clip in candidates if clip in led]
    subject=processed[0] if processed else candidates[0]
    key=hashlib.sha256(("s9_sd\x00"+subject).encode()).hexdigest()
    phone=ctrl.ROOT
    roi=phone+"/inbox/"+key+".jpg"
    detector=phone+"/features/"+key+"-detector.json"
    visual=phone+"/features/"+key+"-visual.json"
    hsv=phone+"/features/"+key+"-hsv-v2.json"
    exists={name:present(ctrl,path) for name,path in (
        ("crop",roi),("detector",detector),("visual",visual),("hsv",hsv),
        ("recovery_dex",phone+"/s9-offline-person-roi-recovery-v3.jar"),
        ("temporal_dex",phone+"/s9-offline-person-roi-temporal-v2.jar"),
        ("osnet_dex",phone+"/s9-crop-worker.jar"),
        ("hsv_dex",phone+"/s9-torso-hsv-v2.jar"))}
    if exists["detector"]:
        try:
            sha=ctrl.detector_provenance(subject,key,detector)
            exists["detector_provenance_valid"]=True
        except (TypeError,ValueError,RuntimeError,KeyError):
            sha=None;exists["detector_provenance_valid"]=False
    else:sha=None;exists["detector_provenance_valid"]=False
    if exists["crop"] and sha:
        result=ctrl.adb("shell","sha256sum "+roi,timeout=25).stdout.split()
        exists["crop_sha_matches"]=bool(result and result[0]==sha)
    else:exists["crop_sha_matches"]=False
    if exists["visual"] and sha:
        try:
            feature=json.loads(ctrl.adb("exec-out","cat",visual,timeout=30).stdout)
            exists["osnet_vector_valid"]=ctrl.valid_visual(feature,key,sha)
        except (ValueError,RuntimeError,TypeError):
            exists["osnet_vector_valid"]=False
    else:exists["osnet_vector_valid"]=False
    pointer=STATE/"s9-multivector-v3-active.json"
    if pointer.is_symlink():raise RuntimeError("invalid_active_pointer")
    active=pointer.exists()
    pointer_records=None
    if active:
        try:
            p=json.loads(pointer.read_text())
            value=p.get("verified_crops")
            if type(value) is int and 58<=value<=400:
                pointer_records=value
        except (ValueError,TypeError):
            pass
    latest_pid=ctrl.adb("shell","pidof nl.kalenel.s9security",timeout=15).stdout.strip()
    if current!=latest_pid:raise RuntimeError("camera_pid_changed")
    return {
        "eligible_sources":len(candidates),
        "ledger_rows":len(led),
        "ledger_successes":sum(x in ("already_verified","new_real_512d_vector")
                               for x in led.values()),
        "ledger_rejections":sum(x=="no_qualified_person_box" for x in led.values()),
        "ledger_stale":sum(x=="stale_feature" for x in led.values()),
        "sample_is_previously_logged":bool(processed),
        "first_candidate_private_evidence":exists,
        "active_v3_snapshot":active,
        "active_v3_verified_crops":pointer_records,
        "camera_pid_unchanged":True,
        "original_video_files_changed":False,
        "review_decisions_changed":False,
        "private_identifiers_disclosed":False
    }

if __name__=="__main__":
    try:print(MARK+json.dumps(inspect(),sort_keys=True),flush=True)
    except Exception as exc:
        message=str(exc)
        allowed={"missing_source_helper","adb_transport_unavailable",
                 "camera_process_missing","no_eligible_archive_sources",
                 "invalid_active_pointer","camera_pid_changed"}
        print("S9_V3_FIRST_PILOT_DIAGNOSTIC_BLOCKED "+json.dumps({
            "reason":message if message in allowed else "read_only_probe_failed",
            "private_output_suppressed":True}),flush=True)
        raise SystemExit(2)
