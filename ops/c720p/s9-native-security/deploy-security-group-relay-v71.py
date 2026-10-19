#!/usr/bin/env python3
"""Fail-closed authenticated relay compatibility for already-deployed V70 UI.

A clip may be filed under up to eight people in a single human-reviewed,
revisioned backend transaction. The 8794 relay must accept the *extra* folders
field without relaxing previous JSON shape, origin, auth or intent boundaries.
No camera APK, web UI, 4K original, analysis or human review file is written.
"""
from pathlib import Path
import argparse
import datetime as dt
import importlib.util
import json
import re
import stat
import subprocess
import urllib.error
import urllib.request

BASE=Path('/home/jespern/c720p-home-hub')
FILE=BASE/'bin/c720p-lan-camera-relay.py'
BACK=BASE/'backups/security-group-relay-v71'
EXPECTED_JS='25c41501a5f870475530adfbfd671aaa601a1883156b5a0863519fdce86f30c1'
TAG='security-group-relay-v71'
spec=importlib.util.spec_from_file_location('security_v65_helper',Path(__file__).with_name('deploy-security-filing-v65.py'))
b=importlib.util.module_from_spec(spec);spec.loader.exec_module(b)
MODULE_PATH='ops/c720p/s9-person-ml-v1/s9_manual_recording_links.py'
JS=Path('/opt/homeassistant/config/www/frontyard-security-new/security-people-v45.js')
HTML=JS.with_name('security-people-v50.html')
MANUAL=BASE/'bin/s9_manual_recording_links.py'
ASSET_FILES=('s9-manual-recording-links-v1.json','s9-manual-recording-links-v1.audit.jsonl',
             's9-auto-person-rejections-v1.json','s9-auto-person-rejections-v1.audit.jsonl')
SCHEMA_OLD="set(obj)!={'action','source','name','folder','revision','human_confirmed'}"
SCHEMA_NEW=("(set(obj)!={'action','source','name','folder','revision','human_confirmed'} "
    "and not (obj.get('action')=='assign_many' and "
    "set(obj)=={'action','source','name','folder','folders','revision','human_confirmed'}))")
ACTION_OLD="('assign','return_to_queue','skip','reject')"
ACTION_NEW="('assign','assign_many','return_to_queue','skip','reject')"
START="  if path=='/new/api/s9-manual-recording-links':"
END="  parts=path.strip('/').split('/')"

def patch_relay(original):
    s=original.decode()
    block=b.block(s,START,END)
    if 'X-S9-Manual-Link-Intent' not in block or 'self.origin_ok()' not in block or 'self.authorized()' not in block:
        raise RuntimeError('relay_security_boundary_missing')
    if SCHEMA_NEW in block and ACTION_NEW in block:
        return original,True
    new=b.one(block,SCHEMA_OLD,SCHEMA_NEW)
    new=b.one(new,ACTION_OLD,ACTION_NEW)
    return b.one(s,block,new).encode(),False

def snapshot():
    return {name:b.sha((BASE/'state'/name).read_bytes()) if (BASE/'state'/name).is_file() else None
            for name in ASSET_FILES}

def relay_service(action):
    r=subprocess.run(['systemctl','--user',action,'c720p-lan-camera-relay.service'],
                     capture_output=True,timeout=38)
    if r.returncode:raise RuntimeError('relay_service_'+action+'_failed')

def probe_group():
    """Bogus filename MUST return source_not_in_verified_archive with no writes."""
    for port in (8794,8795):
        obj={'action':'assign_many','source':'drive','name':'__nonexistent_group_probe__.mp4',
             'folder':'G_probe_one','folders':['G_probe_one','G_probe_two'],
             'revision':-1,'human_confirmed':True}
        request=urllib.request.Request(
            'http://127.0.0.1:'+str(port)+'/new/api/s9-manual-recording-links',
            data=json.dumps(obj).encode(),headers={
             'Content-Type':'application/json',
             'X-S9-Manual-Link-Intent':'manual-original-review-links-v1',
             'Origin':'http://127.0.0.1:8123',
             'Sec-Fetch-Site':'same-site' if port==8794 else 'same-origin'},method='POST')
        try:r=urllib.request.urlopen(request,timeout=20)
        except urllib.error.HTTPError as e:r=e
        with r:
            answer=json.load(r)
            if r.status!=404 or answer.get('error')!='source_not_in_verified_archive':
                raise RuntimeError('group_post_relay_rejected_or_misrouted_'+str(port))

def main():
    args=argparse.ArgumentParser()
    args.add_argument('--ref',required=True)
    args.add_argument('--apply',action='store_true')
    a=args.parse_args()
    if not re.fullmatch(r'[a-f0-9]{40}',a.ref):raise RuntimeError('pinned_source_required')
    if not all(x.is_file() and not x.is_symlink() for x in (FILE,JS,HTML,MANUAL)):
        raise RuntimeError('unsafe_security_asset')
    if b.sha(JS.read_bytes())!=EXPECTED_JS:
        raise RuntimeError('another_ui_update_occurred')
    if b.sha(MANUAL.read_bytes())!=b.sha(b.src(a.ref,MODULE_PATH).encode()):
        raise RuntimeError('manual_backend_drift')
    if not all(marker in HTML.read_text() for marker in ('id="approvalMorePeople"','id="approvalAddPerson"')):
        raise RuntimeError('group_form_not_live')
    relay_service('is-active')
    before=b.inventory()
    reviews=snapshot()
    existing=FILE.read_bytes()
    mode=stat.S_IMODE(FILE.stat().st_mode)
    desired,already=patch_relay(existing)
    compile(desired.decode(),str(FILE),'exec')
    if already:
        probe_group()
        if reviews!=snapshot():raise RuntimeError('review_changed_during_readonly_probe')
        print('SECURITY_GROUP_V71_VERIFIED '+json.dumps({'already':True,'probe':True,
          'archives':{k:len(x) for k,x in before.items()},'review_writes':0}),flush=True)
        return
    print('SECURITY_GROUP_V71_PREFLIGHT '+json.dumps({'apply':a.apply,
      'old_sha256':b.sha(existing),'new_sha256':b.sha(desired),
      'archives':{k:len(x) for k,x in before.items()},'review_unchanged':reviews==snapshot()}),flush=True)
    if not a.apply:return
    if FILE.read_bytes()!=existing:raise RuntimeError('relay_changed_before_backup')
    backup=BACK/dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup.mkdir(parents=True,mode=0o700,exist_ok=False)
    b.atom(backup/'relay-before.py',existing,0o600)
    try:
        if FILE.read_bytes()!=existing:raise RuntimeError('concurrent_relay_edit')
        b.atom(FILE,desired,mode)
        relay_service('restart')
        probe_group()
        after=b.inventory()
        if any(not before[k]<=after[k] for k in before):raise RuntimeError('originals_lost')
        if reviews!=snapshot():raise RuntimeError('review_registry_changed')
        if b.sha(FILE.read_bytes())!=b.sha(desired):raise RuntimeError('live_relay_mismatch')
        print('SECURITY_GROUP_V71_VERIFIED '+json.dumps({
          'already':False,'probe':True,'archives':{k:len(x) for k,x in after.items()},
          'review_writes':0,'originals_unchanged':True,'backup':str(backup),
          'sha256':b.sha(desired)}),flush=True)
    except BaseException:
        b.atom(FILE,existing,mode)
        relay_service('restart')
        print('SECURITY_GROUP_V71_ROLLED_BACK',flush=True)
        raise
if __name__=='__main__':main()
