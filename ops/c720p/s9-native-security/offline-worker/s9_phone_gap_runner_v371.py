#!/usr/bin/env python3
"""UNWIRED sealed S9 app_process runner for V304's existing lock/lease.

Only invoked if an owner-approved, 0600 mode, source-pinned release manifest
is explicitly installed under the existing V304 private state folder.
This module never starts a timer, changes Camera2/Android APK, writes media,
moves human decisions, or directly publishes partial frames.
"""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import urllib.request

import s9_phone_gap_coordinator_v371 as frames

SERIAL="192.168.178.250:5555"
PHONE_JAR="/data/local/tmp/s9_worker/s9_gap_v371.dex.jar"
PHONE_LIB="/data/local/tmp/s9_worker/lib"
PHONE_CLASS="nl.kalenel.s9offline.S9Original4KGapAuditV370"
PREFIX="S9_ORIGINAL4K_PHONE_FRAME_V370 "
POLICY_SCHEMA="task9_phone_first_enrolled_release_v371"
HEX=re.compile(r"[a-f0-9]{64}\Z")
# C720P existing V304 guards remain authoritative during all transitions.
# S9 minimum memory is separately reviewed by Chat1; DO NOT assume 900 MiB.
ROOT=Path("/home/jespern/c720p-home-hub")

def require(ok,why,exc=frames.Deferred):
    if not ok:raise exc(why)

def bounded(argv,timeout=9,cap=14000):
    """Fixed executable/arguments from internally validated immutable provenance."""
    try:
        result=subprocess.run(argv,capture_output=True,text=True,timeout=timeout,
                              check=False)
    except (OSError,subprocess.TimeoutExpired):
        raise frames.Deferred("phone_transport_or_worker_timeout") from None
    require(len(result.stdout)<=cap and len(result.stderr)<=cap,
            "phone_worker_response_unbounded")
    require(result.returncode==0,"phone_worker_unavailable_or_killed")
    return result.stdout.strip()

def adb(*args,timeout=9,cap=14000):
    return bounded(["adb","-s",SERIAL,*args],timeout=timeout,cap=cap)

def policy(path):
    """Never infer enrollment from a staged jar or a GitHub merge."""
    require(not path.is_symlink() and path.is_file(),
            "phone_first_release_not_enrolled")
    st=path.stat()
    require(st.st_uid==os.getuid() and st.st_nlink==1
            and st.st_mode&0o077==0 and 40<st.st_size<4096,
            "phone_first_release_not_private")
    document=json.loads(path.read_text())
    require(document.get("schema")==POLICY_SCHEMA
            and document.get("active") is True
            and document.get("approved_by_camera_owner") is True
            and document.get("approved_by_infrastructure_owner") is True
            and document.get("approved_by_task9_owner") is True
            and isinstance(document.get("approval_record"),str)
            and 12<=len(document["approval_record"])<=160
            and isinstance(document.get("phone_frame_jar_sha256"),str)
            and HEX.fullmatch(document["phone_frame_jar_sha256"])
            and type(document.get("min_phone_mem_available_kib")) is int
            and document["min_phone_mem_available_kib"]>0
            and type(document.get("min_phone_sd_free_bytes")) is int
            and document["min_phone_sd_free_bytes"]>=20*1024**3
            and document.get("source_reader")=="s9_source_current_priority_reader_v369"
            and document.get("consumer")=="s9_anonymous_quality_consumption_v361",
            "phone_first_release_approval_or_resource_floor_missing")
    return document

def phone_readiness(cfg,recorder_pid=None):
    require(adb("get-state",timeout=8).strip()=="device",
            "phone_authorized_transport_not_ready")
    pid=adb("shell","pidof nl.kalenel.s9security",timeout=8)
    require(re.fullmatch(r"[0-9]{1,7}(?: [0-9]{1,7}){0,2}",pid),
            "native_camera_recorder_unavailable")
    if recorder_pid is not None:
        require(pid==recorder_pid,"native_recorder_pid_changed")
    mem=adb("shell","cat /proc/meminfo",timeout=8,cap=12000)
    found=re.search(r"^MemAvailable:\s+([0-9]+)\s+kB\s*$",mem,re.M)
    require(found is not None and int(found.group(1))>=
            cfg["min_phone_mem_available_kib"],
            "phone_memory_admission_not_met")
    sd=adb("shell","df -k /storage/9C33-6BBD",timeout=8,cap=3000)
    last=sd.splitlines()
    require(len(last)>=2,"phone_sd_headroom_unavailable")
    parts=last[-1].split()
    require(len(parts)>=4 and parts[3].isdigit() and
            int(parts[3])*1024>=cfg["min_phone_sd_free_bytes"],
            "phone_sd_reserve_not_met")
    digest=adb("shell","sha256sum "+PHONE_JAR,timeout=12,cap=600)
    require(digest.split()[0]==cfg["phone_frame_jar_sha256"],
            "phone_worker_jar_revision_not_approved")
    return pid

def phone_probe(row,requested_ms,remaining,release):
    require(1<=remaining<=65,"phone_attempt_unbounded")
    clip=row["clip_no"]
    frames.source_tuple(row)
    cmd=("CLASSPATH="+PHONE_JAR+" LD_LIBRARY_PATH="+PHONE_LIB+
         " /system/bin/app_process /system/bin "+PHONE_CLASS+
         " --probe-one-frame "+clip+" "+row["source_sha256"]+
         " "+str(row["source_bytes"])+" "+row["media_revision"]+
         " "+str(requested_ms))
    # Timeout leaves enough time for V304 to recover its lease and guard
    # downstream. No same-recording asynchronous/background job is launched.
    raw=adb("shell",cmd,timeout=min(70,remaining+4),cap=14000)
    lines=[line for line in raw.splitlines() if line.startswith(PREFIX)]
    require(len(lines)==1,"phone_frame_attestation_missing_or_duplicate")
    try:out=json.loads(lines[0][len(PREFIX):])
    except (ValueError,TypeError):
        raise frames.Deferred("phone_frame_receipt_malformed") from None
    return out

def run(row,target,*,worker,quality,release_path):
    """Called ONLY by V304.evaluate_one() while its two worker locks are held.

    This wrapper checks current source and priority before and after each
    phone frame. V304 owns all atomic publication, V361 consumption, queue
    completion, retry policy and post-completion fresh revision.
    """
    cfg=policy(release_path)
    require(target.get("face_deep_review_version")==worker.NATIVE and
            target.get("face_candidates")==[],
            "native_source_no_crop_priority_revoked",frames.Revoked)
    require(row["priority_reason"]=="no_indexed_image",
            "unsupported_same_model_priority",frames.Revoked)
    # Also require the same existing C720P thermal/memory/4K/lock policy
    # until Chat1 has measured and explicitly approved a revised contract.
    worker.camera_guard()
    expected_source=frames.source_tuple(row)
    camera_pid=phone_readiness(cfg)
    def current_source(task):
        report,priorities,catalog=worker.source()
        record=catalog["records"].get(task["clip_no"])
        if not isinstance(record,dict):return False
        manifest=record.get("manifest")
        matches=[r for r in priorities if r.get("clip_no")==task["clip_no"]]
        return bool(isinstance(manifest,dict)
              and len(matches)==1
              and matches[0].get("targeted_rescan_priority") is True
              and matches[0].get("native_face_pass_complete") is True
              and matches[0].get("extraction_status")=="no_indexed_image"
              and manifest.get("sha256")==task["source_sha256"]
              and manifest.get("bytes")==task["source_bytes"]
              and record.get("version")==task["media_revision"]
              and record.get("bytes")==task["source_bytes"]
              and worker.MODEL_SHA==task["model_sha256"])
    def guard(task):
        worker.camera_guard()
        phone_readiness(cfg,recorder_pid=camera_pid)
    def probe(task,requested,budget):
        return phone_probe(task,requested,budget,cfg)
    result=frames.coordinate(row,target["duration_ms"],guard=guard,
                              source_check=current_source,probe=probe)
    guard(row)
    frames.original_still_current(row,current_source)
    require(expected_source==frames.source_tuple(row),
            "phone_original_provenance_changed",frames.Revoked)
    return result
