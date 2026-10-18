#!/usr/bin/env python3
"""Deploy only the authenticated evidence-quality backend, with exact rollback.

Stages immutable checksum-pinned sources and tests. Does not modify HTML, JS,
camera software/settings, recordings, native manifests or review decisions.
The optional incremental worker is idle between runs, one thread, CPU/memory
bounded, and pauses whenever the phone is recording or not healthy.
"""
import argparse
import datetime
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path('/home/jespern/c720p-home-hub')
PROXY = ROOT/'bin/s9_sd_proxy_extension.py'
MODULE = ROOT/'bin/s9_evidence_quality_v1.py'
UNIT = 'c720p-s9-evidence-quality'
UNITS = Path.home()/'.config/systemd/user'
ANCHOR = ' import s9_native_camera_controls\n s9_native_camera_controls.install(H)'
MOUNT = ("\n try:\n  import s9_evidence_quality_v1\n except ModuleNotFoundError as error:\n"
         "  if error.name!='s9_evidence_quality_v1':raise\n else:s9_evidence_quality_v1.install(H,rows)")
FILES = {
    'module': 'ops/c720p/s9-person-ml-v1/s9_evidence_quality_v1.py',
    'test': 'ops/c720p/s9-native-security/test-evidence-quality-v1.py',
    'rescan': 'ops/c720p/s9-native-security/rescan-original4k-face-gaps-v1.py'}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def run(command, timeout=40):
    result = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('deployment_command_failed:'+result.stderr[-1000:])
    return result.stdout


def get(url):
    with urllib.request.urlopen(url, timeout=25) as response:
        data = response.read(6000001)
    if len(data) > 6000000:
        raise ValueError('metadata_too_large')
    return json.loads(data)


def camera():
    value = get('http://127.0.0.1:18808/status')
    if (value.get('ok') is not True or value.get('mode') not in ('watching', 'recording')
            or value.get('continuous_4k_ready') is not True
            or value.get('continuous_4k_dropped_output_frames') != 0):
        raise RuntimeError('camera_health_regression')
    return value


def archive():
    value = get('http://127.0.0.1:8795/new/api/saved')
    if value.get('archive_mode') != 'S9-microSD-only' or not value.get('events'):
        raise ValueError('original_archive_unavailable')
    return {row['clip_no'] for row in value['events']}


def atomic(path, data, mode=0o600):
    fd, temporary = tempfile.mkstemp(prefix='.evidence-deploy-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as output:
            output.write(data)
            output.flush()
            os.fsync(output.fileno())
        os.chmod(temporary, mode)
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ref', required=True)
    parser.add_argument('--proxy-live-sha', required=True)
    for name in FILES:
        parser.add_argument('--'+name+'-sha', required=True)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--enable-timer', action='store_true')
    args = parser.parse_args()
    if not re.fullmatch('[a-f0-9]{40}', args.ref):
        raise ValueError('immutable_ref_required')
    for name in [n+'_sha' for n in FILES]+['proxy_live_sha']:
        if not re.fullmatch('[a-f0-9]{64}', getattr(args, name)):
            raise ValueError('source_checksum_required')
    stage = ROOT/'build/s9-evidence-quality'/args.ref
    bodies = {}
    for key, relative in FILES.items():
        with urllib.request.urlopen('https://raw.githubusercontent.com/JesperOaths/kale-nel/'+args.ref+'/'+relative,
                                    timeout=30) as response:
            data = response.read(100001)
        if len(data) > 100000 or sha(data) != getattr(args, key+'_sha'):
            raise ValueError('immutable_source_checksum_mismatch_'+key)
        path = stage/relative
        path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
        atomic(path, data)
        run(['/usr/bin/python3', '-m', 'py_compile', str(path)])
        bodies[key] = data
    run(['/usr/bin/python3', str(stage/FILES['test'])])
    if PROXY.is_symlink() or not PROXY.is_file() or MODULE.exists():
        raise ValueError('unexpected_backend_target')
    predecessor = PROXY.read_bytes()
    if sha(predecessor) != args.proxy_live_sha:
        raise ValueError('concurrent_proxy_update')
    source = predecessor.decode()
    if source.count(ANCHOR) != 1 or MOUNT in source:
        raise ValueError('unexpected_proxy_install_anchor')
    patched = source.replace(ANCHOR, ANCHOR+MOUNT).encode()
    compile(patched, str(PROXY), 'exec')
    before = archive()
    camera()
    report = json.loads((ROOT/'state/s9-evidence-quality-v1/report.json').read_text())
    if report.get('analysis_version') != 's9_evidence_quality_v1' or report.get('pending_images') != 0:
        raise ValueError('screening_not_completed')
    for suffix in ('.service', '.timer'):
        if (UNITS/(UNIT+suffix)).exists():
            raise ValueError('unexpected_existing_worker_unit')
    print('EVIDENCE_QUALITY_PREFLIGHT', json.dumps({'original_recordings': len(before),
        'images_measured': report['images_measured'], 'apply': args.apply, 'tests_passed': True}), flush=True)
    if not args.apply:
        return
    backup = ROOT/'backups/s9-evidence-quality'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup.mkdir(mode=0o700, parents=True)
    atomic(backup/'s9_sd_proxy_extension.py', predecessor)
    if sha((backup/'s9_sd_proxy_extension.py').read_bytes()) != args.proxy_live_sha:
        raise ValueError('backup_checksum_failed')
    # Final lease check after staging, tests and live diagnostics.
    if PROXY.read_bytes() != predecessor or MODULE.exists():
        raise ValueError('concurrent_backend_update')
    unit_paths = []
    proxy_mode = PROXY.stat().st_mode & 0o777
    try:
        atomic(MODULE, bodies['module'])
        atomic(PROXY, patched, proxy_mode)
        run(['systemctl', '--user', 'restart', 'c720p-drive-security-archive.service'])
        for attempt in range(15):
            try:
                after = archive()
                result = get('http://127.0.0.1:8795/new/api/evidence-quality')
                if result.get('analysis_version') == 's9_evidence_quality_v1' and 'recordings' in result:
                    break
            except (OSError, ValueError):
                pass
            time.sleep(.5)
        else:
            raise RuntimeError('new_endpoint_unavailable')
        if not before <= after or result.get('image_errors') != 0:
            raise RuntimeError('originals_or_analysis_regression')
        camera()
        if args.enable_timer:
            python = ROOT/'person-detector/venv/bin/python3'
            if not python.is_file():
                raise ValueError('existing_detector_runtime_unavailable')
            service = ('[Unit]\nDescription=Incremental private S9 evidence screening\n'
                '[Service]\nType=oneshot\nExecStart='+str(python)+' '+str(MODULE)+' --budget-seconds 420\n'
                'Nice=15\nIOSchedulingClass=idle\nCPUQuota=20%\nMemoryMax=384M\n'
                'TimeoutStartSec=480\nUMask=0077\n')
            timer = ('[Unit]\nDescription=Refresh S9 evidence quality incrementally\n'
                '[Timer]\nOnActiveSec=15min\nOnUnitInactiveSec=15min\nAccuracySec=1min\n'
                '[Install]\nWantedBy=timers.target\n')
            UNITS.mkdir(parents=True, exist_ok=True)
            for suffix, content in (('.service', service), ('.timer', timer)):
                path = UNITS/(UNIT+suffix)
                atomic(path, content.encode())
                unit_paths.append(path)
            run(['systemctl', '--user', 'daemon-reload'])
            run(['systemctl', '--user', 'enable', '--now', UNIT+'.timer'])
            run(['systemctl', '--user', 'is-active', UNIT+'.timer'])
        print('EVIDENCE_QUALITY_LIVE_VERIFIED', json.dumps({'ref': args.ref,
            'original_recordings': len(after), 'images_measured': result['images_measured'],
            'supported_face_candidates': result['supported_face_candidates'],
            'unconfirmed_image_candidates': result['unconfirmed_image_candidates'],
            'backup': str(backup), 'incremental_timer_enabled': args.enable_timer,
            'camera_modified': False, 'ui_modified': False, 'original_recordings_modified': False,
            'review_decisions_modified': False}), flush=True)
    except BaseException:
        if unit_paths:
            subprocess.run(['systemctl', '--user', 'disable', '--now', UNIT+'.timer'], capture_output=True)
            for path in unit_paths:
                path.unlink(missing_ok=True)
            subprocess.run(['systemctl', '--user', 'daemon-reload'], capture_output=True)
        atomic(PROXY, predecessor, proxy_mode)
        MODULE.unlink(missing_ok=True)
        run(['systemctl', '--user', 'restart', 'c720p-drive-security-archive.service'])
        raise


if __name__ == '__main__':
    main()
