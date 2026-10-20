#!/usr/bin/env python3
"""Exact two-file component-health release; default preflight is read-only.

Only the existing authenticated LAN relay may restart. A SHA-approved staged
core verifier supplies camera/archive/review reads; its main is never executed.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import tempfile
import time
import types

BASE=Path('/home/jespern/c720p-home-hub')
BACKUPS=BASE/'backups/security-component-health-v1'
RELEASE='component-health-20261020-v1'
READER='s9_security_component_health_v1.py'
RELAY='s9_continuity_relay_v1.py'
TARGETS={name:BASE/'bin'/name for name in (READER,RELAY)}
SERVICE='c720p-lan-camera-relay.service'
HELPER='deploy-security-continuity-v1.py'
ROUTE='/new/api/security-component-health'
SCHEMA='security_component_health_v1'
HASH=re.compile(r'[a-f0-9]{64}\Z')

def sha(raw):return hashlib.sha256(raw).hexdigest()
def encoded(value):return (json.dumps(value,sort_keys=True,separators=(',',':'))+'\n').encode()
def metadata(path):
    s=path.stat()
    return {'mode':stat.S_IMODE(s.st_mode),'uid':s.st_uid,'gid':s.st_gid}
def read(path,missing=False):
    if path.is_symlink():raise RuntimeError('symlink_source:'+path.name)
    if not path.exists():
        if missing:return None,None
        raise RuntimeError('missing_source:'+path.name)
    if not path.is_file() or path.stat().st_size>1_000_000:raise RuntimeError('invalid_source:'+path.name)
    return path.read_bytes(),metadata(path)
def sync_directory(path):
    fd=os.open(path,os.O_RDONLY|getattr(os,'O_DIRECTORY',0))
    try:os.fsync(fd)
    finally:os.close(fd)
def atomic(path,raw,meta):
    fd,tmp=tempfile.mkstemp(prefix='.component-health-',dir=path.parent)
    try:
        with os.fdopen(fd,'wb') as target:
            if hasattr(os,'fchown'):os.fchown(target.fileno(),meta['uid'],meta['gid'])
            os.fchmod(target.fileno(),meta['mode']);target.write(raw);target.flush();os.fsync(target.fileno())
        os.replace(tmp,path);sync_directory(path.parent)
    finally:
        if os.path.exists(tmp):os.unlink(tmp)
def private_write(path,raw):atomic(path,raw,{'mode':0o600,'uid':os.getuid(),'gid':os.getgid()})
def service(action):
    if action not in ('is-active','restart'):raise RuntimeError('invalid_service_action')
    p=subprocess.run(['systemctl','--user',action,SERVICE],capture_output=True,timeout=35)
    if p.returncode:raise RuntimeError('lan_relay_'+action+'_failed')

def prepare(stage,manifest_sha256):
    if not isinstance(manifest_sha256,str) or not HASH.fullmatch(manifest_sha256):raise RuntimeError('invalid_manifest_digest')
    stage=Path(stage).resolve(strict=True)
    raw,_=read(stage/'manifest.json')
    if sha(raw)!=manifest_sha256:raise RuntimeError('manifest_changed')
    doc=json.loads(raw)
    if (not isinstance(doc,dict) or set(doc)!={'release','files','verification_helper'}
            or doc['release']!=RELEASE or not isinstance(doc['files'],list) or len(doc['files'])!=2):
        raise RuntimeError('invalid_component_release_manifest')
    helper=doc['verification_helper']
    if not isinstance(helper,dict) or set(helper)!={'staged','sha256'} or helper['staged']!=HELPER:
        raise RuntimeError('invalid_verification_helper')
    code,_=read(stage/HELPER)
    if not isinstance(helper['sha256'],str) or not HASH.fullmatch(helper['sha256']) or sha(code)!=helper['sha256']:
        raise RuntimeError('verification_helper_changed')
    # Execute precisely the bytes whose digest was approved. A path loader could
    # reread different bytes between checking and importing; no main is called.
    verifier=types.ModuleType('approved_component_release_verifier')
    verifier.__file__=str(stage/HELPER)
    exec(compile(code,str(stage/HELPER),'exec'),verifier.__dict__)
    if any(not callable(getattr(verifier,n,None)) for n in ('camera','archive','reviews','request')):
        raise RuntimeError('verification_helper_contract')
    prepared={}
    for item in doc['files']:
        if not isinstance(item,dict) or set(item)!={'target','staged','before_sha256','after_sha256'}:
            raise RuntimeError('invalid_release_entry')
        name=item['staged']
        if name not in TARGETS or item['target']!=str(TARGETS[name]) or name in prepared:
            raise RuntimeError('unsafe_or_duplicate_target')
        before,after=item['before_sha256'],item['after_sha256']
        if (before is not None and (not isinstance(before,str) or not HASH.fullmatch(before))) or not isinstance(after,str) or not HASH.fullmatch(after):
            raise RuntimeError('invalid_asset_digest')
        if name==RELAY and before is None:raise RuntimeError('existing_relay_required')
        desired,_=read(stage/name)
        if sha(desired)!=after:raise RuntimeError('staged_asset_changed:'+name)
        compile(desired,str(TARGETS[name]),'exec')
        old,meta=read(TARGETS[name],missing=name==READER)
        current=sha(old) if old is not None else None
        if current not in (before,after):raise RuntimeError('concurrent_source_change:'+name)
        if meta is None:
            parent=TARGETS[name].parent.stat();meta={'mode':0o600,'uid':parent.st_uid,'gid':parent.st_gid}
        prepared[name]={'path':TARGETS[name],'old':old,'new':desired,'before':current,'after':after,'metadata':meta}
    if set(prepared)!=set(TARGETS):raise RuntimeError('missing_component_target')
    return prepared,verifier,raw

def snapshot(verifier):
    camera=verifier.camera();originals=verifier.archive();reviews=verifier.reviews()
    if not originals:raise RuntimeError('empty_original_archive')
    return {'camera':camera,'originals':originals,'reviews':reviews}

def verify_route(verifier):
    until=time.monotonic()+25
    while True:
        try:
            code,raw,headers=verifier.request('http://127.0.0.1:8794'+ROUTE)
            if code!=200:raise RuntimeError('health_get_http')
            doc=json.loads(raw)
            if (doc.get('ok') is not True or doc.get('schema_version')!=SCHEMA or doc.get('read_only') is not True
                    or any(doc.get(k) is not False for k in ('media_read','manual_reviews_modified','workers_started','rendered_playback_verified'))
                    or not isinstance(doc.get('components'),dict) or set(doc['components'])!={'infrastructure','evidence','saved_timing'}):
                raise RuntimeError('component_health_contract')
            if any(not isinstance(v,dict) or v.get('status') not in ('current','stale','unavailable') for v in doc['components'].values()):
                raise RuntimeError('component_health_status')
            if 'no-store' not in {k.lower():str(v).lower() for k,v in headers.items()}.get('cache-control',''):
                raise RuntimeError('component_health_must_not_cache')
            break
        except (OSError,ValueError,RuntimeError):
            if time.monotonic()>=until:raise
            time.sleep(.5)
    unsigned,_,_=verifier.request('http://192.168.178.141:8794'+ROUTE)
    head,_,_=verifier.request('http://127.0.0.1:8794'+ROUTE,method='HEAD')
    post,_,_=verifier.request('http://127.0.0.1:8794'+ROUTE,method='POST')
    if unsigned!=401 or head!=405 or 200<=post<300:raise RuntimeError('health_readonly_auth_boundary')
    return {'schema_version':SCHEMA,'no_store':True,'unsigned_lan_status':unsigned,'head_status':head,
            'post_status':post,'components':{k:v['status'] for k,v in doc['components'].items()}}

def matches(item,raw):
    current,meta=read(item['path'],missing=True)
    return current==raw and (current is None or meta==item['metadata'])

def rollback(prepared,attempted):
    # These two modules are one dependency pair. Do not remove our reader while
    # preserving an unknown newer relay extension that may import it.
    conflicts=[n for n,i in prepared.items() if not matches(i,i['old']) and not matches(i,i['new'])]
    if conflicts:return [],conflicts
    restored=[]
    for name in reversed(attempted):
        item=prepared[name]
        if matches(item,item['old']):continue
        if not matches(item,item['new']):return restored,[name]
        if item['old'] is None:
            item['path'].unlink();sync_directory(item['path'].parent)
        else:atomic(item['path'],item['old'],item['metadata'])
        restored.append(name)
    return restored,[]

def deploy(stage,manifest_sha256,apply=False):
    prepared,verifier,manifest_raw=prepare(stage,manifest_sha256)
    before=snapshot(verifier);service('is-active')
    changed=[name for name,item in prepared.items() if item['old']!=item['new']]
    if not apply:
        return {'release':RELEASE,'state':'read_only_preflight','manifest_sha256':manifest_sha256,
                'changed_files':len(changed),'originals':len(before['originals']),'camera':before['camera'],
                'targets':{n:{'before_sha256':i['before'],'after_sha256':i['after']} for n,i in prepared.items()}}
    if not changed:
        proof=verify_route(verifier);after=snapshot(verifier)
        if not before['originals']<=after['originals'] or before['reviews']!=after['reviews']:raise RuntimeError('evidence_changed')
        return {'release':RELEASE,'state':'already_applied_verified','route':proof,'camera':after['camera']}
    if BACKUPS.is_symlink():raise RuntimeError('unsafe_backup_directory')
    BACKUPS.mkdir(mode=0o700,parents=True,exist_ok=True)
    if stat.S_IMODE(BACKUPS.stat().st_mode)!=0o700:raise RuntimeError('backup_directory_not_private')
    backup=BACKUPS/dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ');backup.mkdir(mode=0o700)
    for name in changed:
        item=prepared[name]
        if not matches(item,item['old']):raise RuntimeError('source_changed_before_backup:'+name)
        if item['old'] is not None:private_write(backup/name,item['old'])
    private_write(backup/'manifest.json',manifest_raw)
    receipt={'release':RELEASE,'state':'prepared','backup':str(backup),'manifest_sha256':manifest_sha256,
             'camera_before':before['camera'],'originals_before':len(before['originals']),
             'files':{n:{'target':str(i['path']),'before_sha256':i['before'],'after_sha256':i['after'],
                         'metadata':i['metadata']} for n,i in prepared.items()},'services_restarted':[]}
    receipt_path=backup/'receipt.json';private_write(receipt_path,encoded(receipt));attempted=[]
    try:
        for name in changed:
            item=prepared[name]
            if not matches(item,item['old']):raise RuntimeError('source_changed_before_write:'+name)
            attempted.append(name)
            atomic(item['path'],item['new'],item['metadata'])
        service('restart');receipt['services_restarted']=[SERVICE]
        proof=verify_route(verifier);after=snapshot(verifier)
        if not before['originals']<=after['originals']:raise RuntimeError('original_catalog_shrank')
        if before['reviews']!=after['reviews']:raise RuntimeError('manual_reviews_changed')
        if any(not matches(i,i['new']) for i in prepared.values()):raise RuntimeError('source_changed_during_verification')
        receipt.update(state='backend_deployed_verified',route=proof,camera_after=after['camera'],
                       originals_preserved=len(before['originals']),manual_reviews_unchanged=True,
                       rendered_browser_verified=False)
        private_write(receipt_path,encoded(receipt))
        return dict(receipt,receipt=str(receipt_path))
    except Exception:
        restored,conflicts=rollback(prepared,attempted)
        receipt.update(state='code_rollback',restored=restored,concurrent_conflicts_preserved=conflicts)
        if restored and not conflicts:
            try:service('restart')
            except RuntimeError:receipt['rollback_relay_restart_failed']=True
        private_write(receipt_path,encoded(receipt))
        raise

def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--stage',type=Path,required=True)
    parser.add_argument('--manifest-sha256',required=True)
    parser.add_argument('--apply',action='store_true')
    args=parser.parse_args()
    print(json.dumps(deploy(args.stage,args.manifest_sha256,args.apply),sort_keys=True))

if __name__=='__main__':main()
