"""Exact additive two-file publisher patch with private rollback.

Uses the existing authenticated health service/destination. No database,
permission, UI, recorder, inference or review configuration is changed.
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
import types
import urllib.request

ROOT=Path('/home/jespern/c720p-home-hub')
PUBLISHER=ROOT/'bin/c720p-cloud-health-report.py'
HELPER=ROOT/'bin/s9_pipeline_cloud_health_v1.py'
COMPONENT=ROOT/'bin/s9_security_component_health_v1.py'
SERVICE='c720p-cloud-health-report.service'


def sha(raw):return hashlib.sha256(raw).hexdigest()


def read(path):
    if path.is_symlink():raise RuntimeError('symlink_refused')
    s=path.stat()
    if not stat.S_ISREG(s.st_mode) or s.st_uid!=os.getuid() or s.st_mode&0o022 or s.st_size>200000:
        raise RuntimeError('unsafe_source')
    return path.read_bytes(),stat.S_IMODE(s.st_mode)


def atomic(path,raw,mode):
    fd,tmp=tempfile.mkstemp(dir=path.parent,prefix='.pipeline-health-')
    try:
        os.fchmod(fd,mode)
        with os.fdopen(fd,'wb') as f:f.write(raw);f.flush();os.fsync(f.fileno())
        os.replace(tmp,path)
        d=os.open(path.parent,os.O_RDONLY|os.O_DIRECTORY)
        try:os.fsync(d)
        finally:os.close(d)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)


def capture():
    with urllib.request.urlopen('http://127.0.0.1:18808/status',timeout=8) as r:
        d=json.loads(r.read(65536))
    if d.get('ok') is not True or d.get('continuous_4k_ready') is not True or d.get('continuous_4k_dropped_output_frames')!=0:
        raise RuntimeError('capture_not_ready')
    return {k:d.get(k) for k in ('mode','sensor_result_fps','continuous_4k_buffered_ms','continuous_4k_dropped_output_frames','temperature_c')}


def main():
    ap=argparse.ArgumentParser();ap.add_argument('--apply',action='store_true')
    for name in ('publisher','helper','component'):ap.add_argument('--'+name+'-sha256',required=True)
    a=ap.parse_args()
    before,mode=read(PUBLISHER);raw,_=read(Path(__file__).with_name(HELPER.name))
    if sha(before)!=a.publisher_sha256 or sha(raw)!=a.helper_sha256 or sha(read(COMPONENT)[0])!=a.component_sha256:
        raise RuntimeError('source_changed')
    if HELPER.exists() or HELPER.is_symlink():raise RuntimeError('helper_present_reinspect')
    h=types.ModuleType('approved_cloud_projection')
    exec(compile(raw,str(HELPER),'exec'),h.__dict__)
    after=h.patch_publisher(before.decode()).encode();compile(after,str(PUBLISHER),'exec')
    camera_before=capture()
    receipt={'applied':False,'publisher_before_sha256':sha(before),'publisher_after_sha256':sha(after),
             'helper_sha256':sha(raw),'component_sha256':a.component_sha256}
    if not a.apply:print(json.dumps(receipt,sort_keys=True));return
    active=subprocess.run(['systemctl','--user','is-active','--quiet',SERVICE],timeout=10)
    if active.returncode==0:raise RuntimeError('publisher_already_running_defer')
    backup=ROOT/'backups/pipeline-cloud-health-v1'/dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup.mkdir(mode=0o700,parents=True)
    atomic(backup/'publisher.before.py',before,0o600)
    installed=False
    try:
        if read(PUBLISHER)[0]!=before or sha(read(COMPONENT)[0])!=a.component_sha256:raise RuntimeError('source_raced')
        atomic(HELPER,raw,0o600)
        atomic(PUBLISHER,after,mode);installed=True
        p=subprocess.run(['systemctl','--user','start',SERVICE],capture_output=True,timeout=150)
        if p.returncode:raise RuntimeError('existing_health_publication_failed')
        d=json.loads((ROOT/'state/c720p-cloud-health-report.json').read_text())
        projection=d.get('security_pipeline')
        if (d.get('post_ok') is not True or not isinstance(projection,dict)
                or projection.get('schema_version')!=h.SCHEMA
                or 'components' not in projection):raise RuntimeError('published_projection_missing')
        if read(PUBLISHER)[0]!=after or read(HELPER)[0]!=raw:raise RuntimeError('installed_source_changed')
        receipt.update(applied=True,backup=str(backup),cloud_http_status=d.get('post_status'),
            projection_sha256=sha(json.dumps(projection,sort_keys=True,separators=(',',':')).encode()),
            projection_schema=projection['schema_version'],camera_before=camera_before,
            camera_after=capture(),media_read=False,reviews_modified=False,
            database_or_access_rules_changed=False,remote_readback_pending=True)
        atomic(backup/'receipt.json',json.dumps(receipt,sort_keys=True,indent=2).encode(),0o600)
        print(json.dumps(receipt,sort_keys=True))
    except BaseException:
        if installed and read(PUBLISHER)[0]==after:atomic(PUBLISHER,before,mode)
        if read(PUBLISHER)[0]==before and HELPER.exists() and read(HELPER)[0]==raw:HELPER.unlink()
        raise


if __name__=='__main__':main()
