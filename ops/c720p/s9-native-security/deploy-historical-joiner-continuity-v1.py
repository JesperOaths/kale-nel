"""Pinned two-file joiner compatibility install; preflight unless --apply.

Does not run the compositor. Verifies the existing dry-run inventory only.
Never reinstalls/restarts Camera2, changes original media or review state.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile
import urllib.request

ROOT=Path('/home/jespern/c720p-home-hub')
NAME='s9_historical_joiner_health_v1.py'
WORKER=ROOT/'bin/s9-complete-worker-v1.py'
HELPER=ROOT/'bin'/NAME


def sha(raw):return hashlib.sha256(raw).hexdigest()


def read(path):
    if path.is_symlink():raise RuntimeError('symlink_target_refused')
    meta=path.stat()
    if (not stat.S_ISREG(meta.st_mode) or meta.st_uid!=os.getuid()
            or meta.st_mode&0o022 or meta.st_size>200000):
        raise RuntimeError('unsafe_source_metadata')
    return path.read_bytes(),stat.S_IMODE(meta.st_mode)


def atomic(path,raw,mode):
    fd,tmp=tempfile.mkstemp(dir=path.parent,prefix='.joiner-continuity-')
    try:
        os.fchmod(fd,mode)
        with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
        os.replace(tmp,path)
        directory=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(directory)
        finally:os.close(directory)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)


def camera():
    with urllib.request.urlopen('http://127.0.0.1:18808/status',timeout=8) as r:
        return json.loads(r.read(65536))


def originals():
    d=json.loads((ROOT/'state/s9-standalone-archive-catalog-v1.json').read_text())
    records=d['records']
    if not records:raise RuntimeError('empty_original_catalog')
    return {name:(x.get('bytes'),(x.get('manifest') or {}).get('sha256'))
            for name,x in records.items()}


def reviews():
    return {str(p.relative_to(ROOT)):sha(p.read_bytes())
        for p in (ROOT/'state').glob('*manual*.json*') if p.is_file() and not p.is_symlink()}


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--apply',action='store_true')
    ap.add_argument('--expected-worker-sha256',required=True)
    ap.add_argument('--helper-sha256',required=True);args=ap.parse_args()
    raw,_=read(Path(__file__).with_name(NAME))
    if sha(raw)!=args.helper_sha256:raise RuntimeError('staged_helper_changed')
    # Execute exactly the approved helper bytes, without rereading their path.
    import types
    module=types.ModuleType('approved_joiner_health')
    exec(compile(raw,NAME,'exec'),module.__dict__)
    before,mode=read(WORKER)
    if sha(before)!=args.expected_worker_sha256:raise RuntimeError('concurrent_worker_change')
    if HELPER.exists() or HELPER.is_symlink():raise RuntimeError('helper_already_present_reinspect')
    after=module.patch_worker(before.decode()).encode()
    compile(after,str(WORKER),'exec')
    before_camera=camera()
    if not module.safe(before_camera):raise RuntimeError('capture_not_ready_defer')
    if not module.reserves():raise RuntimeError('hub_reserve_not_ready_defer')
    old_originals=originals();old_reviews=reviews()
    plan={'worker_before_sha256':sha(before),'worker_after_sha256':sha(after),
          'helper_sha256':sha(raw),'originals_before':len(old_originals),
          'camera_changed':False,'applied':False}
    if not args.apply:print(json.dumps(plan,sort_keys=True));return
    backup=ROOT/'backups/historical-joiner-continuity-v1'/dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup.mkdir(parents=True,mode=0o700)
    atomic(backup/'worker.before.py',before,0o600)
    helper_installed=False;worker_installed=False
    try:
        with module.exclusion():
            p=subprocess.run(['systemctl','--user','is-active','--quiet',
                'c720p-s9-complete-clip-worker.service'],timeout=10)
            if p.returncode==0:raise RuntimeError('existing_joiner_running_defer')
            if read(WORKER)[0]!=before or HELPER.exists():raise RuntimeError('concurrent_source_change')
            atomic(HELPER,raw,0o600);helper_installed=True
            atomic(WORKER,after,mode);worker_installed=True
        check=subprocess.run(['/usr/bin/python3',str(WORKER),'--dry-run'],
                             capture_output=True,text=True,timeout=85)
        line=next((x for x in check.stdout.splitlines() if x.startswith('JOINER_DRY_RUN ')),None)
        if check.returncode or line is None:raise RuntimeError('real_dry_run_not_verified')
        inventory=json.loads(line[len('JOINER_DRY_RUN '):])
        end=camera();new_originals=originals()
        if not module.safe(end):raise RuntimeError('capture_after_not_ready')
        if any(new_originals.get(k)!=v for k,v in old_originals.items()):raise RuntimeError('original_catalog_changed')
        if reviews()!=old_reviews:raise RuntimeError('manual_metadata_changed')
        if read(WORKER)[0]!=after or read(HELPER)[0]!=raw:raise RuntimeError('installed_source_changed')
        plan.update(applied=True,backup=str(backup),eligible_historical_pairs=inventory['eligible'],
            existing_derivatives=inventory['existing_complete'],originals_preserved=len(old_originals),
            reviews_unchanged=True,camera_sensor_fps=end.get('sensor_result_fps'),
            camera_output_drops=end.get('continuous_4k_dropped_output_frames'),
            camera_buffer_ms=end.get('continuous_4k_buffered_ms'),
            camera_temperature_c=end.get('temperature_c'),media_processing_started=False)
        atomic(backup/'receipt.json',json.dumps(plan,sort_keys=True,indent=2).encode(),0o600)
        print(json.dumps(plan,sort_keys=True))
    except BaseException:
        # Do not overwrite a concurrent owner's later source change on rollback.
        if worker_installed and read(WORKER)[0]==after:
            atomic(WORKER,before,mode);worker_installed=False
        if (helper_installed and not worker_installed and read(WORKER)[0]==before
                and read(HELPER)[0]==raw):
            HELPER.unlink()
        raise


if __name__=='__main__':main()
