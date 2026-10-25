#!/usr/bin/env python3
"""PROPOSED ONLY — one-frame S9 worker peak monitor; no independent scheduling.

The caller owns the existing V304 queue lease and shared locks, passes the
unchanged camera_guard, and binds the enrolled source/model/task arguments.
No admission floors or existing camera/host guards are changed by this module.
"""
import re
import subprocess
import time

PHONE_CLASS = 'nl.kalenel.s9offline.S9Original4KGapAuditV370'
PID_RE = re.compile(r'[0-9]{2,7}\Z')
HEX64 = re.compile(r'[a-f0-9]{64}\Z')
SAMPLE_SECONDS = 3
MAX_FRAME_SECONDS = 65
MAX_SAMPLES = 24

class Unqualified(RuntimeError):
    """Frame and all its partial evidence must be discarded."""

def required_args(clip, sha, size, revision, offset):
    if not (re.fullmatch(r'motion_[0-9]{13}\.mp4', clip)
            and HEX64.fullmatch(sha) and HEX64.fullmatch(revision)
            and type(size) is int and 100000 < size < 800000000
            and type(offset) is int and 0 <= offset < 300000):
        raise Unqualified('untrusted_original_task_arguments')
    return (PHONE_CLASS, '--probe-one-frame', clip, sha, str(size),
            revision, str(offset))

def parse_start_ticks(stat, pid):
    """Linux /proc/PID/stat field 22, handling ')' in comm correctly."""
    if not isinstance(stat, str) or len(stat) > 4096 or not PID_RE.fullmatch(str(pid)):
        raise Unqualified('untrusted_process_stat')
    end = stat.rfind(')')
    if end < 2 or stat[:stat.find('(')].strip() != str(pid):
        raise Unqualified('process_stat_pid_mismatch')
    # Remaining fields begin with number 3 (state); 22 => offset 19.
    fields = stat[end + 1:].strip().split()
    if len(fields) < 20 or not fields[19].isdigit():
        raise Unqualified('process_starttime_missing')
    ticks = int(fields[19])
    if ticks <= 0:
        raise Unqualified('process_starttime_invalid')
    return ticks

def process_matches(argv, expected):
    """Match real argv; CLASSPATH is an environment variable, not argv."""
    if not isinstance(argv, str) or len(argv) > 4096:
        return False
    words = argv.replace('\x00', ' ').split()
    if not words or words[0].rsplit('/',1)[-1] not in (
            'app_process','app_process32','app_process64'):
        return False
    return tuple(words[-len(expected):]) == expected

def matching_pid(ps, expected, recorder_pid):
    if not isinstance(ps, str) or len(ps) > 65536:
        raise Unqualified('unbounded_phone_process_list')
    lines = ps.splitlines()
    if not lines or 'PID' not in lines[0] or 'ARGS' not in lines[0]:
        raise Unqualified('phone_process_list_untrusted')
    matches = []
    for line in lines[1:]:
        cols = line.strip().split(maxsplit=1)
        if len(cols) != 2 or not PID_RE.fullmatch(cols[0]):
            continue
        # Never allow an unrecognized standalone instance to be silently
        # ignored; it might belong to a prior timeout or a different task.
        if PHONE_CLASS in cols[1] and 'app_process' in cols[1]:
            if not process_matches(cols[1], expected):
                raise Unqualified('different_phone_worker_or_stale_task_running')
            matches.append(cols[0])
    if len(matches) > 1:
        raise Unqualified('multiple_phone_workers')
    if matches and matches[0] == str(recorder_pid):
        raise Unqualified('phone_pid_is_camera2')
    return matches[0] if matches else None

def extract_memory(status, meminfo):
    fields = dict((k, int(v)) for k,v in re.findall(
        r'^(VmRSS|VmHWM):\s+([0-9]+)\s+kB$', status, flags=re.M))
    available = re.search(r'^MemAvailable:\s+([0-9]+)\s+kB$', meminfo, re.M)
    if not available or not (0 < fields.get('VmRSS', 0)
            <= fields.get('VmHWM', 0) < 8 * 1024 * 1024):
        raise Unqualified('unavailable_native_peak_metrics')
    return (fields['VmRSS'], fields['VmHWM'], int(available.group(1)))

def identity(snapshot, expected, recorder_pid):
    """Caller must read stat and cmdline on either side of its /proc read."""
    pid = matching_pid(snapshot['ps'], expected, recorder_pid)
    if pid is None:
        return None
    if snapshot.get('pid') != pid or not process_matches(snapshot.get('argv'), expected):
        raise Unqualified('android_process_identity_unverified')
    before = parse_start_ticks(snapshot.get('stat_before', ''), pid)
    after = parse_start_ticks(snapshot.get('stat_after', ''), pid)
    if before != after:
        raise Unqualified('android_pid_reuse_detected')
    return (pid, before, expected)

def supervise(*, argv, expected, recorder_pid, startup_floor_kib,
              protected_runtime_reserve_kib, frame_budget_seconds,
              camera_guard, snapshot, cleanup_remote,
              start=subprocess.Popen, monotonic=time.monotonic):
    """One authorized frame; kernel VmHWM provides a sampled resident peak.

    The 1536MiB startup floor is independent of the runtime reserve. Neither
    is a hard allocation cap. A too-fast worker without VmHWM is unqualified.
    cleanup_remote(identity, expected, aborted) is called on BOTH success and
    failure and must prove remote worker absence or fail closed, blocking
    retry. Local ADB exit alone never establishes Android worker exit.
    """
    if (not isinstance(argv, list) or argv[:3] !=
            ['adb','-s','192.168.178.250:5555'] or
            type(startup_floor_kib) is not int or
            startup_floor_kib < 1536 * 1024 or
            type(protected_runtime_reserve_kib) is not int or
            protected_runtime_reserve_kib < 512 * 1024 or
            type(frame_budget_seconds) not in (int, float) or
            not 0 < frame_budget_seconds <= MAX_FRAME_SECONDS):
        raise Unqualified('unapproved_worker_launch_or_ram_contract')
    if not PID_RE.fullmatch(str(recorder_pid)) or len(expected) != 7:
        raise Unqualified('invalid_recorder_or_expected_task')
    begun = monotonic()
    deadline_seconds = min(MAX_FRAME_SECONDS, frame_budget_seconds)
    deadline = begun + deadline_seconds
    # The caller's budget includes admission and process-launch overhead.
    # Reaching the guard cannot reset an already elapsed coordinator budget.
    camera_guard()
    if monotonic() >= deadline:
        raise Unqualified('frame_deadline_reached_before_launch')
    proc = None
    found = None
    report = {'sample_count':0, 'worker_vm_hwm_peak_kib':0,
              'minimum_phone_available_kib':None, 'protected_runtime_reserve_kib':
              protected_runtime_reserve_kib, 'startup_floor_kib':startup_floor_kib,
              'peak_is_observed_not_hard_cap':True}
    success = False
    try:
        proc = start(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        if monotonic() >= deadline:
            raise Unqualified('frame_deadline_reached_during_launch')
        for _ in range(MAX_SAMPLES):
            remaining = deadline - monotonic()
            if remaining <= 0:
                raise Unqualified('frame_deadline_reached')
            try:
                out, err = proc.communicate(timeout=min(SAMPLE_SECONDS, remaining))
            except subprocess.TimeoutExpired:
                out = err = None
            camera_guard()  # existing hub >=900, phone <=34.5, 4K, exclusions
            # Do not accept after a slow ADB completion or a slow final guard.
            if monotonic() >= deadline:
                raise Unqualified('frame_deadline_reached_after_guard')
            if out is not None:
                if (proc.returncode != 0 or len(out) > 14000 or len(err) > 14000
                        or report['sample_count'] == 0):
                    raise Unqualified('phone_exit_or_peak_telemetry_missing')
                # Even if ADB host exited, remote worker may still be alive.
                cleanup_remote(found, expected, False)
                if monotonic() >= deadline:
                    raise Unqualified('frame_deadline_reached_during_cleanup')
                success = True
                return out.strip(), report
            data = snapshot(expected)  # bounded read-only adb, /proc reads
            if monotonic() >= deadline:
                raise Unqualified('frame_deadline_reached_during_telemetry')
            current = identity(data, expected, recorder_pid)
            if current is None:
                # A too-fast launch that cannot produce sampled VmHWM does not
                # qualify, even if a receipt appears later.
                continue
            if found is not None and current != found:
                raise Unqualified('pid_reused_or_worker_restarted')
            found = current
            rss, hwm, available = extract_memory(data['status'],data['meminfo'])
            report['sample_count'] += 1
            report['worker_vm_hwm_peak_kib'] = max(report['worker_vm_hwm_peak_kib'],hwm)
            old = report['minimum_phone_available_kib']
            report['minimum_phone_available_kib'] = min(old, available) if old is not None else available
            if available < protected_runtime_reserve_kib:
                raise Unqualified('camera_system_runtime_reserve_breached')
        raise Unqualified('phone_peak_monitor_sample_budget_exhausted')
    finally:
        if not success:
            # NEVER infer that host ADB exit equals phone exit. Controller must
            # fail the entire recording on any unverified remote cleanup.
            # Attempt remote absence verification even if local termination,
            # kill or the final communicate itself raises or times out.
            try:
                if proc is not None and proc.poll() is None:
                    proc.terminate()
                    try:
                        proc.communicate(timeout=2)
                    except subprocess.TimeoutExpired:
                        proc.kill()
                        proc.communicate(timeout=2)
            except (OSError,subprocess.SubprocessError):
                raise Unqualified('host_teardown_cleanup_unverified') from None
            finally:
                cleanup_remote(found, expected, True)
