"""Recorder compatibility and exclusion for the existing historical joiner.

No camera commands, original-file operations, or inference. Missing current
capture metrics fail closed; an obsolete preview ring is never required when
the native continuous ring is healthy.
"""
import contextlib
import math
import os
from pathlib import Path
import shutil
import stat

ROOT = Path('/home/jespern/c720p-home-hub')
LOCKS = ('state/s9-v3-archive-backfill.lock',
         'state/s9-evidence-quality-v1/worker.lock')
BUSY = ('recording_active', 'recording_in_progress', 'face_backfill_queued',
        'appearance_backfill_queued', 'historical_import_queued',
        'movement_4k_backfill_queued', 'garden_archive_triage_queued')


def number(value):
    return type(value) in (int, float) and math.isfinite(value)


def safe(s):
    if not isinstance(s, dict):
        return False
    if (s.get('ok') is not True or s.get('mode') != 'watching'
            or s.get('native_4k_enabled') is not True
            or s.get('garden_person_gate_backend') != 'gpu'
            or any(s.get(key) is True or (key in s and type(s[key]) is not bool)
                   for key in BUSY)
            or not number(s.get('temperature_c'))
            or not 0 < s['temperature_c'] < 36.2
            or not number(s.get('last_frame_age_ms'))
            or not 0 <= s['last_frame_age_ms'] < 2600
            or type(s.get('sd_free_bytes')) is not int
            or s['sd_free_bytes'] <= 10 * 1024**3):
        return False
    # A declared continuous ring must never fall back to the legacy flag.
    if s.get('continuous_4k_ready') is True or s.get('continuous_4k_enabled') is True:
        return (s.get('continuous_4k_ready') is True
                and type(s.get('continuous_4k_buffered_ms')) is int
                and s['continuous_4k_buffered_ms'] >= 6500
                and type(s.get('continuous_4k_dropped_output_frames')) is int
                and s['continuous_4k_dropped_output_frames'] == 0
                and number(s.get('sensor_result_fps'))
                and 24 <= s['sensor_result_fps'] <= 60)
    # Retain the prior legacy-ring contract for older verified recorder modes.
    return (s.get('preroll_enabled') is True
            and s.get('preroll_ready') is True)


@contextlib.contextmanager
def exclusion(root=ROOT):
    """Hold the same existing inode locks as rescan/evidence workers."""
    import fcntl
    with contextlib.ExitStack() as stack:
        for relative in LOCKS:
            path = Path(root) / relative
            fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
            stack.callback(os.close, fd)
            meta = os.fstat(fd)
            if (not stat.S_ISREG(meta.st_mode) or meta.st_uid != os.getuid()
                    or meta.st_mode & 0o077 or meta.st_size != 0):
                raise RuntimeError('unsafe_existing_worker_lock')
            fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            current = path.lstat()
            if (current.st_dev, current.st_ino) != (meta.st_dev, meta.st_ino):
                raise RuntimeError('worker_lock_replaced')
        yield


def reserves():
    if shutil.disk_usage('/').free < 850 * 1024**2:
        return False
    if shutil.disk_usage('/tmp').free < 420 * 1024**2:
        return False
    values = dict(line.split(':', 1) for line in Path('/proc/meminfo').read_text().splitlines())
    return int(values['MemAvailable'].split()[0]) >= 1024 * 1024


def run_exclusive(callback, root=ROOT):
    try:
        with exclusion(root):
            if not reserves():
                print('JOINER_DEFER_HUB_RESERVE', flush=True)
                return 0
            return callback()
    except (BlockingIOError, FileNotFoundError):
        print('JOINER_DEFER_SHARED_WORKER_BUSY_OR_LOCK_UNAVAILABLE', flush=True)
        return 0


def patch_worker(source):
    """Change only admission and the entry point; retain the media pipeline."""
    start = source.index('def safe(s):\n')
    end = source.index('\ndef head(url):', start)
    old = source[start:end]
    if 's.get("preroll_ready") is True' not in old:
        raise ValueError('unexpected_joiner_health_contract')
    entry = 'if __name__=="__main__":raise SystemExit(main())'
    if source.count(entry) != 1:
        raise ValueError('unexpected_joiner_entrypoint')
    source = source[:start] + (
        'def safe(s):\n'
        ' from s9_historical_joiner_health_v1 import safe as current_capture_safe\n'
        ' return current_capture_safe(s)\n') + source[end:]
    return source.replace(entry,
        'if __name__=="__main__":\n'
        ' from s9_historical_joiner_health_v1 import run_exclusive\n'
        ' raise SystemExit(run_exclusive(main))', 1)


def retry_ready(item, now):
    """Keep interrupted jobs from monopolizing the newest-first picker."""
    if not isinstance(item, dict) or not number(now):
        return False
    failures=item.get('failures',0)
    last=item.get('last_attempt',0)
    until=item.get('retry_after',0)
    if (type(failures) is not int or not 0<=failures<3
            or not number(last) or last<0 or not number(until) or until<0):
        return False
    return now>=until and now-last>=min(3600,90*2**failures)


def defer_entry(item, now, reason):
    """A capture interruption is not a media failure or a completed job."""
    if not isinstance(item,dict) or not number(now) or now<0:
        raise ValueError('invalid_retry_state')
    previous=item.get('guard_deferrals',0)
    if type(previous) is not int or not 0<=previous<=1000000:
        raise ValueError('invalid_guard_deferrals')
    attempts=min(1000000,previous+1)
    allowed={'encoding_time_limit','live_recording_or_camera_health_changed',
        'phone_status_unavailable','hub_ram_tmpfs_insufficient','phone_not_stable',
        'source_files_changed_after_encoding','phone_unhealthy_before_publish'}
    return dict(item,guard_deferrals=attempts,last_attempt=now,
        retry_after=now+min(3600,180*2**min(attempts-1,5)),
        last_guard_reason=reason if reason in allowed else 'capture_guard_interrupted')


def patch_retry_worker(source):
    old=('  if now-float(item.get("last_attempt",0))<min(3600,90*2**item.get("failures",0)):\n'
         '   continue')
    new=('  from s9_historical_joiner_health_v1 import retry_ready\n'
         '  if not retry_ready(item,now):continue')
    cancel=('  # Reschedule short-lived guard failures without exhausting attempts.\n'
            '  return 0')
    replacement=('  # Persist a bounded capture deferral, keeping other pairs eligible.\n'
        '  from s9_historical_joiner_health_v1 import defer_entry\n'
        '  failures[name]=defer_entry(failures[name],time.time(),str(exc))\n'
        '  atomic_json(STATE,failures)\n'
        '  return 0')
    if (source.count(old)!=1 or source.count(cancel)!=1
            or 'run_exclusive(main)' not in source):
        raise ValueError('unexpected_joiner_retry_contract')
    return source.replace(old,new,1).replace(cancel,replacement,1)
