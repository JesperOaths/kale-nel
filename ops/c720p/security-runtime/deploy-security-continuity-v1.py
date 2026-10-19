"""Guarded exact-byte Security transport/UI/screen release, with code rollback.

The operator must stage reviewed files and supply the exact manifest digest.
No camera controls, inference, recording moves or human-review writes occur.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import sqlite3
import stat
import subprocess
import tempfile
import time
import urllib.error
import urllib.request

BASE=Path('/home/jespern/c720p-home-hub')
WEB=Path('/opt/homeassistant/config/www/frontyard-security-new')
ALLOWED={str(BASE/'bin'/n) for n in ('s9_continuity_relay_v1.py','c720p-lan-camera-relay.py',
    's9_phone_garden_status.py','c720p-screen-idle.py')} | {str(WEB/n) for n in
    ('security-people-v45.js','security-archive-v7.html','security-review-v8.html','security-hub-v30.js')}
SERVICES=('c720p-drive-security-archive.service','c720p-lan-camera-relay.service','c720p-screen-idle.service')
STATE_FILES=('s9-manual-recording-links-v1.json','s9-manual-recording-links-v1.audit.jsonl',
    's9-auto-person-rejections-v1.json','s9-auto-person-rejections-v1.audit.jsonl','s9-manual-evidence-cases-v1.json')

def sha(raw):return hashlib.sha256(raw).hexdigest()
def read_json(path):return json.loads(Path(path).read_bytes())
def request(url,*,method='GET',headers=None):
    r=urllib.request.Request(url,method=method,headers=headers or {})
    try:response=urllib.request.urlopen(r,timeout=20)
    except urllib.error.HTTPError as error:response=error
    with response:
        raw=response.read(3_500_001)
        if len(raw)>3_500_000:raise RuntimeError('oversize_metadata')
        return response.status,raw,dict(response.headers)
def get(port,path):
    status,raw,_=request('http://127.0.0.1:'+str(port)+path)
    if status!=200:raise RuntimeError('metadata_http_'+str(status))
    return json.loads(raw)
def camera():
    d=get(18808,'/status')
    if (d.get('ok') is not True or d.get('mode') not in ('watching','recording')
        or d.get('native_4k_enabled') is not True or d.get('continuous_4k_ready') is not True
        or d.get('continuous_4k_dropped_output_frames')!=0):
        raise RuntimeError('native_capture_not_healthy')
    return {k:d.get(k) for k in ('mode','temperature_c','sensor_result_fps','continuous_4k_buffered_ms','continuous_4k_dropped_output_frames')}
def archive():
    d=get(8795,'/new/api/saved')
    if d.get('ok') is not True or d.get('archive_mode')!='S9-microSD-only':
        raise RuntimeError('archive_not_ready')
    return {x['clip_no'] for x in d.get('events',[]) if isinstance(x,dict) and isinstance(x.get('clip_no'),str)}
def reviews():
    result={n:sha((BASE/'state'/n).read_bytes()) if (BASE/'state'/n).is_file() else None for n in STATE_FILES}
    db=BASE/'state/s9-visual-attributes-v36/review.sqlite3'
    if db.is_file():
        with sqlite3.connect('file:'+str(db)+'?mode=ro',uri=True) as c:
            c.execute('PRAGMA query_only=ON')
            present={r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type='table'")}
            for table in ('folder_clips_v40','inbox_skips_v40','reviews','audit'):
                if table in present:
                    rows=c.execute('SELECT * FROM '+table).fetchall()
                    result['sqlite:'+table]=sha(json.dumps(sorted(rows,key=repr),sort_keys=True,default=str).encode())
    return result
def service(action,name):
    p=subprocess.run(['systemctl','--user',action,name],capture_output=True,text=True,timeout=35)
    if p.returncode:raise RuntimeError('service_'+action+'_failed:'+name)
def atomic(path,raw,mode):
    fd,tmp=tempfile.mkstemp(prefix='.continuity-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as out:
            os.fchmod(out.fileno(),mode);out.write(raw);out.flush();os.fsync(out.fileno())
        os.replace(tmp,path)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
def wait(port,path):
    until=time.monotonic()+25
    while time.monotonic()<until:
        try:return get(port,path)
        except (OSError,RuntimeError,ValueError):time.sleep(.5)
    raise RuntimeError('metadata_socket_not_ready')
def verify():
    auto=wait(8794,'/new/api/automatic-person')
    if auto.get('ok') is not True:raise RuntimeError('automatic_person_route')
    quality=get(8794,'/new/api/evidence-quality')
    recovery=get(8794,'/new/api/s9-auxiliary-recovery')
    if quality.get('ok') is not True or recovery.get('ok') is not True:
        raise RuntimeError('quality_or_recovery_route')
    probe='/new/api/appearance-multivector-v3?clip=motion_1000000000000.mp4'
    code,raw,_=request('http://127.0.0.1:8794'+probe)
    if code!=404 or json.loads(raw).get('error')!='no_verified_v3_person_crop':
        raise RuntimeError('v3_query_not_forwarded')
    code,_,headers=request('http://127.0.0.1:8794/new/api/automatic-person',method='OPTIONS',
        headers={'Origin':'http://127.0.0.1:8123','Access-Control-Request-Headers':'X-S9-Automatic-Person-Intent'})
    if code!=204 or 'X-S9-Automatic-Person-Intent' not in headers.get('Access-Control-Allow-Headers',''):
        raise RuntimeError('denial_preflight')
    # LAN source is intentionally not loopback; no auth token is supplied.
    code,_,_=request('http://192.168.178.141:8794/new/api/automatic-person')
    if code!=401:raise RuntimeError('unauthorized_lan_not_rejected')
    live=get(8794,'/new/api/live-person-watch')
    if live.get('native_4k_enabled') is not True or live.get('continuous_4k_ready') is not True:
        raise RuntimeError('native_telemetry_not_forwarded')
    return {'automatic_status':auto.get('status'),'quality_available':True,
       'recovery_candidates':recovery.get('structural_candidates'),'v3_query_forwarded':True,
       'unauthorized_lan_status':code,'native_capture_ready':True,'denial_preflight':True}

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage',type=Path,required=True)
    parser.add_argument('--manifest-sha256',required=True)
    parser.add_argument('--apply',action='store_true')
    a=parser.parse_args();stage=a.stage.resolve(strict=True)
    manifest_raw=(stage/'manifest.json').read_bytes()
    if sha(manifest_raw)!=a.manifest_sha256:raise RuntimeError('stage_manifest_changed')
    manifest=json.loads(manifest_raw)
    if manifest.get('release')!='security-continuity-20261019-v1' or len(manifest.get('files',[]))!=8:
        raise RuntimeError('wrong_release_manifest')
    desired={};before={};modes={}
    for item in manifest['files']:
        target=Path(item['target']);source=stage/item['staged']
        if str(target) not in ALLOWED or target in desired or source.parent!=stage or source.is_symlink() or target.is_symlink():
            raise RuntimeError('unsafe_release_target')
        raw=source.read_bytes()
        if sha(raw)!=item['after_sha256']:raise RuntimeError('staged_source_changed')
        old=target.read_bytes() if target.exists() else None
        actual=sha(old) if old is not None else None
        if actual not in (item['before_sha256'],item['after_sha256']):raise RuntimeError('concurrent_live_edit:'+target.name)
        if target.suffix=='.py':compile(raw.decode(),str(target),'exec')
        desired[target]=raw;before[target]=old
        modes[target]=stat.S_IMODE(target.stat().st_mode) if target.exists() else 0o600
    changed=[p for p in desired if desired[p]!=before[p]]
    camera_before=camera();originals=archive();manual=reviews()
    if not originals:raise RuntimeError('empty_original_archive')
    screen_before=read_json(BASE/'state/screen-smart-brightness.json')
    for name in SERVICES:service('is-active',name)
    if not a.apply:
        print('CONTINUITY_PREFLIGHT '+json.dumps({'changed_files':len(changed),'originals':len(originals),'camera':camera_before}));return
    if not changed:
        print('CONTINUITY_ALREADY_APPLIED '+json.dumps(verify()));return
    backup=BASE/'backups/security-continuity-v1'/dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup.mkdir(parents=True,mode=0o700)
    for p in changed:
        current=p.read_bytes() if p.exists() else None
        if current!=before[p]:raise RuntimeError('concurrent_edit_before_backup:'+p.name)
        if current is not None:atomic(backup/p.name,current,0o600)
    atomic(backup/'manifest.json',manifest_raw,0o600)
    touched=[]
    try:
        for p in changed:
            if (p.read_bytes() if p.exists() else None)!=before[p]:raise RuntimeError('concurrent_edit_before_write:'+p.name)
            atomic(p,desired[p],modes[p]);touched.append(p)
        service('restart',SERVICES[0]);wait(8795,'/new/api/saved');camera()
        service('restart',SERVICES[1]);proof=verify();camera()
        service('restart',SERVICES[2])
        until=time.monotonic()+12
        while time.monotonic()<until:
            screen=read_json(BASE/'state/screen-smart-brightness.json')
            if screen.get('updated_at',0)>screen_before.get('updated_at',0):break
            time.sleep(.4)
        if screen.get('updated_at',0)<=screen_before.get('updated_at',0):
            raise RuntimeError('screen_did_not_publish_fresh_state')
        service('is-active',SERVICES[2])
        if screen.get('full')!=screen_before.get('full') or screen.get('dim')!=screen_before.get('dim'):
            raise RuntimeError('screen_brightness_baseline_changed')
        if screen.get('camera_fresh') is not True:raise RuntimeError('current_motion_not_accepted')
        if not originals<=archive():raise RuntimeError('original_catalog_shrank')
        if manual!=reviews():raise RuntimeError('manual_review_changed_during_release')
        after=camera()
        for p in desired:
            if p.read_bytes()!=desired[p]:raise RuntimeError('source_changed_during_verification:'+p.name)
        receipt={'release':manifest['release'],'state':'deployed_live_verified','backup':str(backup),
            'manifest_sha256':a.manifest_sha256,'verified_at_utc':dt.datetime.now(dt.timezone.utc).isoformat(),
            'camera_before':camera_before,'camera_after':after,'originals_preserved':len(originals),
            'manual_reviews_unchanged':True,'screen_camera_fresh':True,'screen_full':screen['full'],
            'screen_dim':screen['dim'],'routes':proof,'changed_files':len(changed)}
        atomic(backup/'verification.json',(json.dumps(receipt,indent=2)+'\n').encode(),0o600)
        print('CONTINUITY_DEPLOY_VERIFIED '+json.dumps(receipt,sort_keys=True))
    except Exception:
        conflicts=[]
        for p in reversed(touched):
            if p.read_bytes()!=desired[p]:conflicts.append(p.name);continue
            if before[p] is None:p.unlink()
            else:atomic(p,before[p],modes[p])
        for name in SERVICES:
            try:service('restart',name)
            except RuntimeError:pass
        print('CONTINUITY_CODE_ROLLBACK '+json.dumps({'backup':str(backup),'concurrent_conflicts_preserved':conflicts}))
        raise

if __name__=='__main__':main()
