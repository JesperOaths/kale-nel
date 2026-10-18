#!/usr/bin/env python3
"""Checksum-pinned runtime repairs with predecessor leases and rollback.

No UI assets, camera settings, manual reviews or original recordings are edited.
Legacy retention retains its existing policy; its live check is restricted to
the already protected six-clip archive. Capture on the S9+ remains independent.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import sqlite3
import subprocess
import tempfile
import time
import urllib.request

ROOT = Path('/home/jespern/c720p-home-hub')
ORIGIN = Path('/home/jespern/c720p-security-web/security-origin.py')
ORIGIN_SHA = '1195546c42637dc0c71d1bff7c299d4cd44872e919a68764f402886a5249ecbc'
PREFIX = 'ops/c720p/security-runtime/'
FILES = {
    'ops/c720p/s9-person-ml-v1/s9_evidence_quality_v1.py': ('s9_evidence_quality_v1.py', '4c3788abf7c09a183467049cdad8ca6863ee0aed6d2db493171373acf3fb5295'),
    PREFIX+'s9_evidence_quality_watchdog_v1.py': ('s9_evidence_quality_watchdog_v1.py', '1ea86fab6010b4f27c02577eada1b56fa7ead0431f211d59347f252d404117d1'),
    PREFIX+'c720p-security-value-retention.sh': ('c720p-security-value-retention.sh', '7a7cff77fbb45af83f3e1b9d1e8df670a86c04ddd03de403bd5bef39aaf148c9'),
    PREFIX+'s9_hub_playback.py': ('s9_hub_playback.py', '97f6fd5247ecef8dac93ffc9fe4fbc51b8209cc9a00196ba11ec9dced21d7443'),
    PREFIX+'c720p-person-no-person-clean-v126.py': ('c720p-person-no-person-clean-v126.py', 'f6cf68d908fc1fd9de87a2b31967a9d320e004d407ac50a2f536cce45a70bdae'),
    PREFIX+'quiet_http_disconnect_v1.py': ('quiet_http_disconnect_v1.py', None),
    PREFIX+'test-security-runtime.py': (None, None),
    'ops/c720p/s9-native-security/test-evidence-quality-v1.py': (None, None),
    'ops/c720p/s9-native-security/rescan-original4k-face-gaps-v1.py': (None, None),
}
SOURCE_HASHES = {'ops/c720p/s9-person-ml-v1/s9_evidence_quality_v1.py': '4e881de5e4e58a3fcdf7508b44ff21882d78834b64efe6c439f6731f03a3c6f1', 'ops/c720p/security-runtime/s9_evidence_quality_watchdog_v1.py': '11f19650ffb636833c331cd8aebb077f4ab5fc32d29f6a766b5bc6d2c31f3abb', 'ops/c720p/security-runtime/c720p-security-value-retention.sh': 'd5fcef1e125312f41e46a2616e593654e3d9a790ba63a304fbbd965bcf5f9408', 'ops/c720p/security-runtime/s9_hub_playback.py': '2553c93a293566918b77bd4b5ea4acf1812b0e6e6e5cab6f1d27b08af573eda8', 'ops/c720p/security-runtime/c720p-person-no-person-clean-v126.py': '8823a4063bc20cabfb53050fb3f3be51bb03c109563c2877af1387d61bcffd5f', 'ops/c720p/security-runtime/quiet_http_disconnect_v1.py': '016661353665c6898989f86af615dd95d1470b11eb742e46766f8411ae02d5ee', 'ops/c720p/security-runtime/test-security-runtime.py': 'f1bb3fde974be05e300a8e9979d24ef74d7e86fd8f04bef5d6bddbb6582e110e', 'ops/c720p/s9-native-security/test-evidence-quality-v1.py': 'fe11cd72d6cf28ace5254a8378a2204dc5953cb103c496a169556c4f102ecb07', 'ops/c720p/s9-native-security/rescan-original4k-face-gaps-v1.py': '292060ec4671520878086dfb5750dd0c43c61e1c69338ecf32fbfe2c79934dd9'}
SERVICES = ['c720p-drive-security-archive.service', 'c720p-security-web.service']
TIMERS = ['c720p-s9-evidence-quality.timer', 'c720p-s9-evidence-quality-audit.timer',
          'c720p-security-value-retention.timer', 'c720p-person-no-person-clean.timer']


def sha(data): return hashlib.sha256(data).hexdigest()


def run(command, timeout=40):
    p = subprocess.run(command, capture_output=True, text=True, timeout=timeout)
    if p.returncode: raise RuntimeError('command_failed:'+p.stderr[-500:])
    return p.stdout


def systemctl(*args, timeout=40): return run(['systemctl', '--user', *args], timeout)


def active(unit):
    return subprocess.run(['systemctl', '--user', 'is-active', '--quiet', unit]).returncode == 0


def atomic(path, data, mode=0o600):
    fd, temporary = tempfile.mkstemp(prefix='.runtime-repair-', dir=path.parent)
    try:
        with os.fdopen(fd, 'wb') as out:
            out.write(data);out.flush();os.fsync(out.fileno())
        os.chmod(temporary, mode);os.replace(temporary, path)
    finally:
        if os.path.exists(temporary): os.unlink(temporary)


def get(route):
    with urllib.request.urlopen('http://127.0.0.1:8795'+route, timeout=20) as r:
        raw = r.read(6000001)
    if len(raw)>6000000: raise ValueError('metadata_too_large')
    return json.loads(raw)


def archive():
    data = get('/new/api/saved')
    if data.get('archive_mode')!='S9-microSD-only' or data.get('ok') is not True:
        raise ValueError('archive_unavailable')
    return {r['clip_no'] for r in data['events']}


def camera():
    with urllib.request.urlopen('http://127.0.0.1:18808/status', timeout=10) as r: d=json.load(r)
    if (d.get('ok') is not True or d.get('mode') not in ('watching','recording')
            or d.get('continuous_4k_ready') is not True
            or d.get('continuous_4k_dropped_output_frames')!=0):
        raise RuntimeError('camera_health_regression')
    return {k:d.get(k) for k in ['mode','temperature_c','continuous_4k_ready','continuous_4k_dropped_output_frames']}


def legacy_snapshot():
    root=Path('/opt/homeassistant/config/www/frontyard-security-new/clips')
    return sorted((p.name,p.stat().st_size,p.stat().st_mtime_ns) for p in root.glob('*.mp4'))


def reviews():
    path=ROOT/'state/s9-visual-attributes-v36/review.sqlite3'
    with sqlite3.connect(path.as_uri()+'?mode=ro', uri=True) as db:
        return sha('\n'.join(db.iterdump()).encode())


def patch_origin(raw):
    anchor="ThreadingHTTPServer(('127.0.0.1',PORT),H).serve_forever()"
    hook=("import sys\nsys.path.insert(0, '/home/jespern/c720p-home-hub/bin')\n"
          "import quiet_http_disconnect_v1\nquiet_http_disconnect_v1.install(H)\n")
    text=raw.decode()
    if text.count(anchor)!=1 or 'quiet_http_disconnect_v1' in text:
        raise ValueError('unexpected_origin_install_contract')
    result=text.replace(anchor,hook+anchor).encode();compile(result,str(ORIGIN),'exec')
    return result


def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--ref',required=True);ap.add_argument('--apply',action='store_true')
    args=ap.parse_args()
    if not re.fullmatch('[a-f0-9]{40}',args.ref): raise ValueError('immutable_ref_required')
    if set(SOURCE_HASHES)!=set(FILES): raise ValueError('missing_source_pins')
    stage=ROOT/'build/security-runtime-audit'/args.ref
    bodies={}
    for rel in FILES:
        with urllib.request.urlopen('https://raw.githubusercontent.com/JesperOaths/kale-nel/'+args.ref+'/'+rel,timeout=30) as r:
            raw=r.read(100001)
        if len(raw)>100000 or sha(raw)!=SOURCE_HASHES[rel]: raise ValueError('source_checksum_mismatch:'+rel)
        p=stage/rel;p.parent.mkdir(parents=True,exist_ok=True);atomic(p,raw)
        if p.suffix=='.py': compile(raw,str(p),'exec')
        elif p.suffix=='.sh': run(['bash','-n',str(p)])
        bodies[rel]=raw
    for rel in [PREFIX+'test-security-runtime.py','ops/c720p/s9-native-security/test-evidence-quality-v1.py']:
        run(['/usr/bin/python3',str(stage/rel)])
    previous={};patches={};modes={}
    for rel,(name,expected) in FILES.items():
        if name is None: continue
        path=ROOT/'bin'/name
        if path.is_symlink(): raise ValueError('unexpected_target_symlink')
        raw=path.read_bytes() if path.exists() else None
        if (sha(raw) if raw is not None else None)!=expected: raise ValueError('concurrent_runtime_update:'+name)
        previous[path]=raw;patches[path]=bodies[rel];modes[path]=path.stat().st_mode&0o777 if raw else 0o600
    if ORIGIN.is_symlink() or sha(ORIGIN.read_bytes())!=ORIGIN_SHA: raise ValueError('concurrent_origin_update')
    previous[ORIGIN]=ORIGIN.read_bytes();patches[ORIGIN]=patch_origin(previous[ORIGIN]);modes[ORIGIN]=ORIGIN.stat().st_mode&0o777
    before=archive();legacy=legacy_snapshot();review_hash=reviews();phone=camera()
    print('RUNTIME_PREFLIGHT',json.dumps({'ref':args.ref,'originals':len(before),'legacy_clips':len(legacy),'camera':phone,'tests':34,'apply':args.apply}),flush=True)
    if not args.apply:return
    backup=ROOT/'backups/security-runtime-audit'/datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup.mkdir(mode=0o700,parents=True)
    for path,raw in previous.items():
        if raw is not None: atomic(backup/path.name,raw,modes[path])
    atomic(backup/'manifest.json',json.dumps({str(p):{'before':sha(raw) if raw is not None else None,'after':sha(patches[p])} for p,raw in previous.items()},indent=2).encode())
    timers=[u for u in TIMERS if active(u)]
    changed=False
    try:
        for u in timers: systemctl('stop',u)
        deadline=time.monotonic()+65
        while any(active(u.replace('.timer','.service')) for u in TIMERS):
            if time.monotonic()>deadline: raise RuntimeError('worker_still_active_no_changes_applied')
            time.sleep(2)
        for path,raw in previous.items():
            if (path.read_bytes() if path.exists() else None)!=raw: raise ValueError('final_source_lease_changed')
        changed=True
        for path,raw in patches.items(): atomic(path,raw,modes[path])
        for service in SERVICES: systemctl('restart',service)
        for attempt in range(20):
            try:
                after=archive()
                if before<=after: break
            except (OSError,ValueError): pass
            time.sleep(.5)
        else: raise RuntimeError('archive_restart_regression')
        systemctl('start','c720p-s9-evidence-quality.service',timeout=160)
        quality=get('/new/api/evidence-quality')
        if quality.get('ok') is not True or 'worker_run' not in quality: raise RuntimeError('new_evidence_worker_unverified')
        systemctl('start','c720p-s9-evidence-quality-audit.service',timeout=70)
        audit=json.loads((ROOT/'state/s9-recognition-evidence-health.json').read_text())
        dry=run(['bash',str(ROOT/'bin/c720p-security-value-retention.sh'),'--dry-run'])
        if len(legacy)<=6:
            systemctl('start','c720p-security-value-retention.service',timeout=45)
        if legacy_snapshot()!=legacy: raise RuntimeError('legacy_media_changed')
        if not before<=archive(): raise RuntimeError('originals_disappeared')
        if reviews()!=review_hash: raise RuntimeError('manual_review_snapshot_changed_concurrently')
        phone=camera()
        for service in SERVICES:
            if not active(service): raise RuntimeError('service_not_active')
        print('RUNTIME_LIVE_VERIFIED',json.dumps({'ref':args.ref,'backup':str(backup),'originals':len(archive()),'worker_run':quality['worker_run'],
              'audit_recordings':audit['recordings_indexed'],'retention_dry_run':dry.strip(),'manual_reviews_unchanged':True,'legacy_media_unchanged':True,'camera':phone}),flush=True)
    except BaseException:
        if changed:
            for path,raw in previous.items():
                if raw is None:path.unlink(missing_ok=True)
                else:atomic(path,raw,modes[path])
            for service in SERVICES:systemctl('restart',service)
        raise
    finally:
        for u in timers:systemctl('start',u)


if __name__=='__main__':main()
