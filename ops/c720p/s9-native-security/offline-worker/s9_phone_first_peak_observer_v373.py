#!/usr/bin/env python3
"""Task9 V373: bounded phone-app_process peak observer; *library only*.

This is NOT a qualification layer, another timer or a way to start inference.
The existing V304 worker must already hold its shared locks and processing lease,
pass its unchanged camera_guard(), and enroll the pinned V372 release switch.
It samples only the unique verified phone worker PID while that one frame runs.
No process is ever terminated unless its PID and cmdline still match the exact
enrolled standalone process, and the Camera2 recorder PID differs.
"""
import re
import subprocess
import time

POLL_SECONDS=3
MAX_FRAME_SECONDS=65
MAX_SAMPLES=24
PHONE_CLASS="nl.kalenel.s9offline.S9Original4KGapAuditV370"
PHONE_JAR="/data/local/tmp/s9_worker/s9_gap_v371.dex.jar"
PID_RX=re.compile(r"[0-9]{2,7}\Z")
MEM_RX=re.compile(r"^MemAvailable:\s+([0-9]+)\s+kB\s*$",re.M)
RSS_RX=re.compile(r"^(VmRSS|VmHWM):\s+([0-9]+)\s+kB\s*$",re.M)

class Unsafe(RuntimeError):
    pass

def phone_pid(ps, *, camera_pid):
    """Fail closed if two workers, indistinguishable wrappers or malformed ps."""
    if not isinstance(ps,str) or len(ps)>65536:
        raise Unsafe("unbounded_phone_ps")
    lines=ps.splitlines()
    if not lines or "PID" not in lines[0] or "ARGS" not in lines[0]:
        raise Unsafe("phone_ps_columns_unavailable")
    matches=[]
    for line in lines[1:]:
        terms=line.strip().split(maxsplit=1)
        if len(terms)!=2 or not PID_RX.fullmatch(terms[0]):continue
        args=terms[1]
        if ("app_process" in args and PHONE_CLASS in args
                and PHONE_JAR in args):
            matches.append(terms[0])
    if len(matches)>1:
        raise Unsafe("multiple_phone_workers")
    if not matches:return None
    pid=matches[0]
    if pid==str(camera_pid):
        raise Unsafe("phone_worker_pid_matches_recorder")
    return pid

def process_memory(status, meminfo):
    """Measured Linux high-water mark, not a hard allocation limit."""
    if not isinstance(status,str) or not isinstance(meminfo,str):
        raise Unsafe("phone_process_telemetry_invalid")
    fields={}
    for key,num in RSS_RX.findall(status):
        fields[key]=int(num)
    available=MEM_RX.search(meminfo)
    if not (available and 0<fields.get("VmRSS",0)<=fields.get("VmHWM",0)
            and 0<int(available.group(1))<12_000_000):
        raise Unsafe("phone_process_telemetry_missing")
    return {"rss_kib":fields["VmRSS"],"peak_rss_kib":fields["VmHWM"],
            "mem_available_kib":int(available.group(1))}

def supervise(*, command, recorder_pid, phone_mem_floor_kib,
              camera_guard, read_phone, start=subprocess.Popen,
              clock=time.monotonic, sleep=time.sleep):
    """Run exactly one already-authorized phone frame, with bounded monitor.

    read_phone() must return {ps,status,meminfo,cmdline}: a SINGLE bounded
    read-only telemetry snapshot from established ADB. No extra worker.
    Returning None status during startup is permitted for one 3s cycle.
    camera_guard() is the unmodified installed V304 full guard (900MiB hub,
    <=34.5C phone, 4K watch/buffer/drops/exclusions). A failed guard aborts.
    On abort, close only our HOST adb client; the caller's approved cleanup
    routine must verify/stop any orphaned phone process before a retry.
    """
    if not isinstance(command,list) or not command or command[:3]!=[
        "adb","-s","192.168.178.250:5555"]:
        raise Unsafe("command_not_pinned_adb")
    if type(phone_mem_floor_kib)is not int or phone_mem_floor_kib<1536*1024:
        raise Unsafe("unapproved_phone_ram_floor")
    if not PID_RX.fullmatch(str(recorder_pid)):
        raise Unsafe("recorder_pid_invalid")
    camera_guard()
    proc=start(command,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True)
    began=clock()
    report={"peak_rss_kib":0,"min_phone_available_kib":None,
            "samples":0,"worker_pid":None,"guard_checks":1,
            "recorder_pid":str(recorder_pid),
            "monitor_type":"read_only_peak_sampling_not_allocation_cap"}
    abort_reason=None
    try:
        while True:
            elapsed=clock()-began
            if elapsed>=MAX_FRAME_SECONDS:
                abort_reason="frame_walltime_exceeded"
                break
            if report["samples"]>=MAX_SAMPLES:
                abort_reason="telemetry_sample_budget_exhausted"
                break
            try:
                out,err=proc.communicate(timeout=min(POLL_SECONDS,MAX_FRAME_SECONDS-elapsed))
                if len(out)>14000 or len(err)>14000:
                    raise Unsafe("unbounded_phone_worker_output")
                if proc.returncode!=0:
                    raise Unsafe("phone_worker_nonzero_exit")
                if report["samples"]==0:
                    raise Unsafe("no_peak_memory_telemetry_obtained")
                camera_guard()
                report["guard_checks"]+=1
                return out.strip(),report
            except subprocess.TimeoutExpired:
                pass
            camera_guard()
            report["guard_checks"]+=1
            sample=read_phone()
            pid=phone_pid(sample["ps"],camera_pid=recorder_pid)
            if pid is None:
                if clock()-began>2*POLL_SECONDS:
                    raise Unsafe("phone_worker_missing_during_run")
                continue
            # Read identity twice in caller when sampling /proc, including
            # process cmdline; reject a recycled PID or a wrapper shell.
            cmdline=sample.get("cmdline","")
            if PHONE_CLASS not in cmdline or PHONE_JAR not in cmdline:
                raise Unsafe("worker_cmdline_not_pinned")
            if report["worker_pid"] not in (None,pid):
                raise Unsafe("phone_worker_pid_changed")
            report["worker_pid"]=pid
            memory=process_memory(sample["status"],sample["meminfo"])
            report["samples"]+=1
            report["peak_rss_kib"]=max(report["peak_rss_kib"],
                                      memory["peak_rss_kib"])
            nowavail=memory["mem_available_kib"]
            prev=report["min_phone_available_kib"]
            report["min_phone_available_kib"]=min(prev,nowavail) if prev is not None else nowavail
            if nowavail<phone_mem_floor_kib:
                abort_reason="phone_available_memory_below_enrolled_floor"
                break
        raise Unsafe(abort_reason or "unverified_frame_abort")
    finally:
        if proc.poll() is None:
            # Host client termination is NOT phone process cleanup. The
            # caller must verify a bounded, PID-qualified remote teardown
            # before any repeat; uncertainty remains an admission failure.
            proc.terminate()
            try:proc.communicate(timeout=2)
            except subprocess.TimeoutExpired:
                proc.kill()
                try:proc.communicate(timeout=2)
                except subprocess.TimeoutExpired:pass
