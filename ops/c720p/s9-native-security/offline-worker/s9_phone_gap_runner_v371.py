#!/usr/bin/env python3
"""UNWIRED sealed S9 app_process runner for V304's existing lock/lease.

Only invoked if an owner-approved, 0600 mode, source-pinned release manifest
is explicitly installed under the existing V304 private state folder.
This module never starts a timer, changes Camera2/Android APK, writes media,
moves human decisions, or directly publishes partial frames.
"""
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import types
import time
import urllib.request

# V304 injects the coordinator compiled from the verified release bytes. Direct
# imports remain available for offline tests; production never resolves this
# dependency through sys.path or a previously cached sys.modules entry.
if 'frames' not in globals():
    import s9_phone_gap_coordinator_v371 as frames
# Deliberately no top-level import of the observer: only source bytes
# verified against the enrolled digest may be executed as Python code.
observer=None

SERIAL="192.168.178.250:5555"
PHONE_JAR="/data/local/tmp/s9_worker/s9_gap_v371.dex.jar"
PHONE_LIB="/data/local/tmp/s9_worker/lib"
PHONE_CLASS="nl.kalenel.s9offline.S9Original4KGapAuditV370"
PREFIX="S9_ORIGINAL4K_PHONE_FRAME_V370 "
POLICY_SCHEMA="task9_phone_first_enrolled_release_v371"
# Independent prospective (non-inference) V372 native decoder/ONNX envelope.
# 1.5GiB phone reserve is NOT C720P hub's independent 900MiB floor.
PHONE_MEMORY_ENVELOPE_KIB=1536*1024
HEX=re.compile(r"[a-f0-9]{64}\Z")
# C720P existing V304 guards remain authoritative during all transitions.
# S9 minimum memory is separately reviewed by Chat1; DO NOT assume 900 MiB.
ROOT=Path("/home/jespern/c720p-home-hub")
OBSERVER=ROOT/"bin/s9_phone_first_peak_observer_v373.py"
INFLIGHT=ROOT/"state/s9-priority-rescan-v304/phone-inflight-v374.json"

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

def timed_adb(*args,deadline,timeout=9,cap=14000):
    left=deadline-time.monotonic()
    require(left>0,'phone_adb_budget_exhausted')
    result=adb(*args,timeout=min(timeout,left),cap=cap)
    require(time.monotonic()<deadline,'phone_adb_budget_exhausted')
    return result

def protected_bytes(path, *, minimum, maximum, private=False):
    """Read one protected regular fd; never reopen checked source by pathname."""
    try:
        fd=os.open(path,os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    except OSError:
        raise frames.Deferred('phone_source_or_release_unavailable') from None
    try:
        st=os.fstat(fd)
        require(stat.S_ISREG(st.st_mode) and st.st_uid==os.getuid()
                and st.st_nlink==1 and not st.st_mode & (0o077 if private else 0o022)
                and minimum < st.st_size < maximum,
                'phone_source_or_release_not_protected')
        data=os.read(fd,st.st_size+1)
        after=os.fstat(fd)
        require(len(data)==st.st_size and
                (st.st_dev,st.st_ino,st.st_size,st.st_mtime_ns,st.st_ctime_ns)==
                (after.st_dev,after.st_ino,after.st_size,after.st_mtime_ns,after.st_ctime_ns),
                'phone_source_or_release_changed_during_read')
        return data
    finally:
        os.close(fd)

def policy(path, *, _verified_document=None, _verified_observer=None):
    """Never infer enrollment from a staged jar or a GitHub merge."""
    if _verified_document is None:
        try:
            document=json.loads(protected_bytes(path,minimum=40,maximum=4096,private=True))
        except (ValueError,TypeError):
            raise frames.Deferred('phone_first_release_malformed') from None
    else:
        # Internal V304 handoff only: its loader verified all three complete
        # source byte strings before executing any of them. No path reread.
        require(_verified_observer is not None,'phone_verified_observer_missing')
        document=dict(_verified_document)
    require(isinstance(document,dict) and document.get("schema")==POLICY_SCHEMA
            and document.get("active") is True
            # Explicit owner's guarded Task9 authorization is sufficient
            # for an isolated app_process; no fictitious extra-owner consent.
            # The private enrolled file is an audit switch, not a signature.
            and document.get("authorization_basis")==
                "user_explicit_guarded_task9_20261021"
            and document.get("camera2_apk_unchanged") is True
            and isinstance(document.get("approval_record"),str)
            and 12<=len(document["approval_record"])<=160
            and isinstance(document.get("phone_frame_jar_sha256"),str)
            and HEX.fullmatch(document["phone_frame_jar_sha256"])
            and isinstance(document.get("runner_sha256"),str)
            and HEX.fullmatch(document["runner_sha256"])
            and isinstance(document.get("coordinator_sha256"),str)
            and HEX.fullmatch(document["coordinator_sha256"])
            and type(document.get("min_phone_mem_available_kib")) is int
            and document["min_phone_mem_available_kib"]>=PHONE_MEMORY_ENVELOPE_KIB
            and type(document.get("min_phone_sd_free_bytes")) is int
            and document["min_phone_sd_free_bytes"]>=20*1024**3
            and document.get("source_reader")=="s9_source_current_priority_reader_v369"
            and document.get("consumer")=="s9_anonymous_quality_consumption_v361"
            and isinstance(document.get("observer_sha256"),str)
            and HEX.fullmatch(document["observer_sha256"])
            # This runtime reserve is distinct from the startup floor.
            # An explicit reviewed reserve >=512MiB is required for release.
            and type(document.get("protected_runtime_reserve_kib")) is int
            and document["protected_runtime_reserve_kib"]>=512*1024,
            "phone_first_release_approval_or_resource_floor_missing")
    # Open the exact bytes once, without following a symlink.  Verify the
    # opened fd (not just a path checked before import) before executing it.
    global observer
    if _verified_observer is not None:
        observer=_verified_observer
        return document
    raw=protected_bytes(OBSERVER,minimum=1000,maximum=30000)
    require(hashlib.sha256(raw).hexdigest()==document['observer_sha256'],
            'phone_observer_source_hash_mismatch')
    # The pre-verified bytes, not a second possibly substituted file read,
    # are compiled and executed.  Tampered/unapproved code never imports.
    loaded=types.ModuleType('s9_phone_first_peak_observer_v373')
    exec(compile(raw,str(OBSERVER),'exec'),loaded.__dict__)
    observer=loaded
    return document

def ensure_no_inflight():
    # Unknown remote outcomes are an explicit fence, not an invitation to
    # retry after one empty process list. Only independent reconciliation may
    # retire an abandoned marker; this module never clears one on startup.
    require(not INFLIGHT.exists() and not INFLIGHT.is_symlink(),
            'phone_previous_attempt_requires_reconciliation')

def begin_inflight(path,row,requested_ms):
    parent=path.parent
    parent.mkdir(mode=0o700,parents=True,exist_ok=True)
    st=parent.stat()
    require(not parent.is_symlink() and stat.S_ISDIR(st.st_mode)
            and st.st_uid==os.getuid() and not st.st_mode&0o077,
            'phone_inflight_parent_not_private')
    payload=json.dumps({'schema':'task9_phone_inflight_v374',
        'clip_no':row['clip_no'],'source_sha256':row['source_sha256'],
        'source_revision':row['media_revision'],'requested_ms':requested_ms,
        'created_at':time.time(),'controller_pid':os.getpid()},
        sort_keys=True,separators=(',',':'),allow_nan=False).encode()
    try:fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL|os.O_NOFOLLOW,0o600)
    except OSError:
        raise frames.Deferred('phone_previous_attempt_requires_reconciliation') from None
    with os.fdopen(fd,'wb') as out:
        out.write(payload);out.flush();os.fsync(out.fileno())
    directory=os.open(parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(directory)
    finally:os.close(directory)
    return payload

def finish_inflight(path,payload):
    # Called only after normal monitor success, two complete absence reads,
    # same recorder PID and a valid frame receipt. Never on a failure path.
    require(protected_bytes(path,minimum=40,maximum=4096,private=True)==payload,
            'phone_inflight_marker_changed')
    path.unlink()
    directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY|os.O_NOFOLLOW)
    try:os.fsync(directory)
    finally:os.close(directory)

def phone_readiness(cfg,recorder_pid=None,*,deadline=None):
    ensure_no_inflight()
    def read(*args,**kwargs):
        return (adb(*args,**kwargs) if deadline is None
                else timed_adb(*args,deadline=deadline,**kwargs))
    require(read("get-state",timeout=8).strip()=="device",
            "phone_authorized_transport_not_ready")
    pid=read("shell","pidof nl.kalenel.s9security",timeout=8)
    require(re.fullmatch(r"[0-9]{1,7}(?: [0-9]{1,7}){0,2}",pid),
            "native_camera_recorder_unavailable")
    if recorder_pid is not None:
        require(pid==recorder_pid,"native_recorder_pid_changed")
    mem=read("shell","cat /proc/meminfo",timeout=8,cap=12000)
    found=re.search(r"^MemAvailable:\s+([0-9]+)\s+kB\s*$",mem,re.M)
    require(found is not None and int(found.group(1))>=
            cfg["min_phone_mem_available_kib"],
            "phone_memory_admission_not_met")
    sd=read("shell","df -k /storage/9C33-6BBD",timeout=8,cap=3000)
    last=sd.splitlines()
    require(len(last)>=2,"phone_sd_headroom_unavailable")
    parts=last[-1].split()
    require(len(parts)>=4 and parts[3].isdigit() and
            int(parts[3])*1024>=cfg["min_phone_sd_free_bytes"],
            "phone_sd_reserve_not_met")
    # Local adb timeout can leave a detached app_process running on Android.
    # Never start/retry another original while a prior phone probe is alive.
    # If the process list is unsupported or truncated, refuse admission.
    listing=read("shell","ps -A -o PID,ARGS",timeout=9,cap=65536)
    lines=listing.splitlines()
    require(1<=len(lines)<=2000 and
            any("PID" in line and "ARGS" in line for line in lines[:2]),
            "phone_process_exclusion_unavailable")
    require(not any(PHONE_CLASS in line and "app_process" in line
                    for line in lines[1:]),
            "phone_original_4k_probe_already_running")
    digest=read("shell","sha256sum "+PHONE_JAR,timeout=12,cap=600)
    tokens=digest.split()
    require(len(tokens)==2 and HEX.fullmatch(tokens[0])
            and tokens[0]==cfg["phone_frame_jar_sha256"],
            "phone_worker_jar_revision_not_approved")
    return pid

def phone_probe(row,requested_ms,remaining,release,*,recorder_pid,camera_guard,
                _inflight_path=None):
    """Invoke exactly one pinned phone frame through the V373 peak observer.

    Each frame remains under the existing V304 queue lease and shared locks.
    V304 itself exclusively owns report publication and queue completion.
    """
    begun=time.monotonic()
    require(type(remaining) in (int,float) and 1<=remaining<=65,
            "phone_attempt_unbounded")
    deadline=begun+remaining
    frames.source_tuple(row)
    require(observer is not None,'phone_observer_not_verified_before_use')
    expected=observer.required_args(row["clip_no"],row["source_sha256"],
                                    row["source_bytes"],row["media_revision"],
                                    requested_ms)
    cmd=("export LD_LIBRARY_PATH="+PHONE_LIB+
         "; export CLASSPATH="+PHONE_JAR+
         "; app_process -Djava.library.path="+PHONE_LIB+
         " /system/bin "+PHONE_CLASS+
         " --probe-one-frame "+row["clip_no"]+" "+row["source_sha256"]+
         " "+str(row["source_bytes"])+" "+row["media_revision"]+
         " "+str(requested_ms))
    pinned=["adb","-s",SERIAL,"shell",cmd]

    def snapshot(task_args):
        # Read-only observations; never assume a local ADB exit means remote
        # worker exit. Bounded reads may fail closed if /proc is restricted.
        listing=timed_adb("shell","ps -A -o PID,ARGS",deadline=deadline,timeout=5,cap=65536)
        pid=observer.matching_pid(listing,task_args,recorder_pid)
        if pid is None:return {"ps":listing}
        def proc(name):
            return timed_adb("shell","cat /proc/"+pid+"/"+name,deadline=deadline,
                       timeout=5,cap=16000)
        before=proc("stat")
        argv=proc("cmdline").replace("\x00"," ")
        status=proc("status")
        meminfo=timed_adb("shell","cat /proc/meminfo",deadline=deadline,timeout=5,cap=16000)
        after=proc("stat")
        return {"ps":listing,"pid":pid,"stat_before":before,
                "stat_after":after,"argv":argv,
                "status":status,"meminfo":meminfo}

    def cleanup_remote(last_identity, task_args, aborted):
        # Observation only. A numeric PID cannot safely bind a signal to the
        # process whose /proc identity was checked earlier. Never signal any
        # Android process, including a putative orphan. A surviving or unknown
        # worker leaves the whole recording unqualified and blocks new work.
        cleanup_deadline=deadline
        if aborted:
            # Bounded observation during unwind only; never another inference
            # or a success after the processing deadline. Keep >=5s of lease
            # for the controller's durable refusal/queue update.
            allowance=9.0
            if _inflight_path is not None:
                lease=row.get('lease_until')
                require(type(lease) is int,'phone_cleanup_lease_unverified')
                allowance=min(allowance,max(0,lease-time.time()-5))
            cleanup_deadline=time.monotonic()+allowance
        for _ in range(2):
            listing=timed_adb('shell','ps -A -o PID,ARGS',deadline=cleanup_deadline,timeout=3,cap=65536)
            require(observer.matching_pid(listing,task_args,recorder_pid) is None,
                    'remote_phone_worker_not_yet_gone')
        require(timed_adb("shell","pidof nl.kalenel.s9security",deadline=cleanup_deadline,timeout=3)==
                recorder_pid,"camera_pid_changed_during_cleanup")

    # The production V304 wrapper always supplies the fixed owner-private
    # marker path. Optional injection keeps pure observer unit tests in-memory.
    fence=(begin_inflight(_inflight_path,row,requested_ms)
           if _inflight_path is not None else None)
    budget=(remaining-(time.monotonic()-begun)
            if _inflight_path is not None else remaining)
    require(0<budget<=65,'phone_attempt_budget_exhausted_before_launch')
    # Enrolled worker watchdog halts only its own standalone VM. Decimal
    # environment data avoids changing task argv/identity and is never user
    # supplied shell syntax. A newly built/hash-enrolled JAR is required.
    budget_ms=int(budget*1000)
    require(1<=budget_ms<=65000,'phone_attempt_budget_exhausted_before_launch')
    pinned[-1]='export TASK9_FRAME_BUDGET_MS='+str(budget_ms)+'; '+cmd
    def start_before_deadline(argv,**kwargs):
        # The observer calls this after its initial camera guard. Recalculate
        # at the actual launch boundary, so fsync/guards cannot give the VM a
        # fresh stale budget beyond the caller's absolute frame deadline.
        require(fence is not None,'phone_launch_requires_durable_inflight_fence')
        left=deadline-time.monotonic()
        require(0<left<=65,'phone_attempt_budget_exhausted_before_launch')
        milliseconds=int(left*1000)
        require(1<=milliseconds<=65000,'phone_attempt_budget_exhausted_before_launch')
        launch=list(argv)
        launch[-1]='export TASK9_FRAME_BUDGET_MS='+str(milliseconds)+'; '+cmd
        return subprocess.Popen(launch,**kwargs)
    try:
        raw, peak=observer.supervise(
            argv=pinned,expected=expected,recorder_pid=recorder_pid,
            startup_floor_kib=release["min_phone_mem_available_kib"],
            protected_runtime_reserve_kib=
                release["protected_runtime_reserve_kib"],
            frame_budget_seconds=budget,
            camera_guard=camera_guard,snapshot=snapshot,
            cleanup_remote=cleanup_remote,start=start_before_deadline)
    except (observer.Unqualified,subprocess.SubprocessError,OSError) as exc:
        raise frames.Deferred("phone_frame_monitor_or_cleanup_unqualified") from None
    require(time.monotonic()<deadline,'phone_frame_expired_before_receipt')
    lines=[line for line in raw.splitlines() if line.startswith(PREFIX)]
    require(len(lines)==1,"phone_frame_attestation_missing_or_duplicate")
    try:out=json.loads(lines[0][len(PREFIX):])
    except (ValueError,TypeError):
        raise frames.Deferred("phone_frame_receipt_malformed") from None
    # The peak receipt is per-frame telemetry only, not evidence on its own.
    # The 3-frame coordinator independently validates every original/model,
    # actual MediaCodec output PTS and all-or-nothing publication eligibility.
    require(peak["sample_count"]>0 and
            peak["worker_vm_hwm_peak_kib"]>0,
            "phone_peak_unobserved")
    require(time.monotonic()<deadline,'phone_frame_expired_before_acceptance')
    if fence is not None:finish_inflight(_inflight_path,fence)
    require(time.monotonic()<deadline,'phone_frame_expired_during_acceptance')
    return out

def run(row,target,*,worker,quality,release_path,_verified_release=None):
    """Called ONLY by V304.evaluate_one() while its two worker locks are held.

    This wrapper checks current source and priority before and after each
    phone frame. V304 owns all atomic publication, V361 consumption, queue
    completion, retry policy and post-completion fresh revision.
    """
    begun=time.monotonic()
    # V304's internal preverified handoff avoids checking one path revision
    # and later importing another. Direct callers retain the protected loader.
    cfg=(dict(_verified_release) if _verified_release is not None
         else policy(release_path))
    require(type(row.get('lease_until')) is int,'phone_processing_lease_unverified')
    sequence_deadline=min(begun+frames.MAX_WALL_SECONDS,
                          time.monotonic()+row['lease_until']-time.time()-frames.MIN_LEASE_REMAINING)
    require(time.monotonic()<sequence_deadline,'phone_sequence_budget_exhausted')
    require(target.get("face_deep_review_version")==worker.NATIVE and
            target.get("face_candidates")==[],
            "native_source_no_crop_priority_revoked",frames.Revoked)
    require(row["priority_reason"]=="no_indexed_image",
            "unsupported_same_model_priority",frames.Revoked)
    # Also require the same existing C720P thermal/memory/4K/lock policy
    # until Chat1 has measured and explicitly approved a revised contract.
    worker.camera_guard(deadline=sequence_deadline)
    expected_source=frames.source_tuple(row)
    camera_pid=phone_readiness(cfg,deadline=sequence_deadline)
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
        worker.camera_guard(deadline=sequence_deadline)
        phone_readiness(cfg,recorder_pid=camera_pid,deadline=sequence_deadline)
    def guard_with_budget(task,budget):
        guard_deadline=min(sequence_deadline,time.monotonic()+budget)
        worker.camera_guard(deadline=guard_deadline)
        phone_readiness(cfg,recorder_pid=camera_pid,deadline=guard_deadline)
    def probe(task,requested,budget):
        frame_deadline=min(sequence_deadline,time.monotonic()+budget)
        return phone_probe(task,requested,budget,cfg,
                           recorder_pid=camera_pid,
                           camera_guard=lambda:worker.camera_guard(deadline=frame_deadline),
                           _inflight_path=INFLIGHT)
    result=frames.coordinate(row,target["duration_ms"],guard=guard,
                              source_check=current_source,probe=probe,
                              guard_with_budget=guard_with_budget)
    guard(row)
    frames.original_still_current(row,current_source)
    require(expected_source==frames.source_tuple(row),
            "phone_original_provenance_changed",frames.Revoked)
    require(time.monotonic()<sequence_deadline and
            row['lease_until']-time.time()>frames.MIN_LEASE_REMAINING,
            'phone_sequence_expired_before_return')
    return result
