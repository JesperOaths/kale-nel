#!/usr/bin/env python3
"""Read-only live S9+ buffer, people suggestion and appearance-index health."""
from pathlib import Path
import hashlib
import json
import subprocess
import urllib.parse
import urllib.request

BASE=Path('/home/jespern/c720p-home-hub')
PHONE='192.168.178.250:5555'
def get(path,port=8795,limit=6_000_000):
    with urllib.request.urlopen('http://127.0.0.1:'+str(port)+path,timeout=20) as r:
        data=r.read(limit+1)
        if len(data)>limit:raise RuntimeError('oversized_result')
        return json.loads(data)

def main():
    adb=subprocess.run(['adb','-s',PHONE,'shell','getprop','ro.product.model'],
                       capture_output=True,text=True,timeout=15)
    if adb.returncode or adb.stdout.strip()!='SM-G965F':
        raise RuntimeError('not_the_expected_s9')
    fw=subprocess.run(['adb','-s',PHONE,'forward','tcp:18808','tcp:8808'],
                      capture_output=True,timeout=15)
    if fw.returncode:raise RuntimeError('s9_local_status_unreachable')
    camera=get('/status',18808)
    if not camera.get('ok') or not camera.get('native_4k_enabled'):
        raise RuntimeError('camera_status_unhealthy')
    fields=('mode','temperature_c','continuous_4k_trial_active',
        'continuous_4k_production_persisted','continuous_4k_ready',
        'continuous_4k_buffered_ms','continuous_4k_completed',
        'continuous_4k_failures','preroll_enabled','preroll_ready',
        'preroll_buffered_ms','person_post_motion_hold_ms',
        'garden_motion_strong_only_extends_recording',
        'continuous_4k_dropped_output_frames')
    cam={k:camera.get(k) for k in fields}
    sources={}
    for source,endpoint in [('sd','/new/api/saved'),('drive','/new/api/drive-saved')]:
        report=get(endpoint)
        if report.get('ok') is not True or not isinstance(report.get('events'),list):
            raise RuntimeError('original_catalog_missing_'+source)
        sources[source]=len(report['events'])
    script=BASE/'state/s9-auto-person-face-proposals-v1.json'
    auto={'exists':script.is_file(),'count':None}
    if script.is_file() and not script.is_symlink() and script.stat().st_size<1_400_000:
        rows=json.loads(script.read_text()).get('suggestions')
        auto['count']=len(rows) if isinstance(rows,list) else None
    try:
        ready=get('/new/api/automatic-person')
        auto['api_status']=ready.get('status')
        auto['available_count']=len(ready.get('items',[]))
    except Exception:
        auto['api_status']='unavailable'
    v40=get('/new/api/visual-review?workflow=clip_folders_v40&tab=all&offset=0&limit=24')
    folders=v40.get('folders',[])
    selected=None
    for folder in folders[:40]:
        if not isinstance(folder,dict) or not folder.get('id') or not folder.get('approved_clips'):continue
        query=urllib.parse.urlencode({'workflow':'clip_folders_v40','tab':'approved',
            'folder':str(folder['id']),'offset':0,'limit':24})
        page=get('/new/api/visual-review?'+query)
        for row in page.get('items',[]):
            name=row.get('clip')
            if isinstance(name,str) and name.startswith('motion_') and name.endswith('.mp4'):
                selected=name;break
        if selected:break
    appearance={'reviewed_reference_found':bool(selected),'upper_available':False,
                'lower_available':False,'upper_candidates':0,'lower_candidates':0}
    if selected:
        for kind in ('upper_clothing','lower_clothing'):
            query=urllib.parse.urlencode({'clip':selected,'category':kind,
                'method':'bhattacharyya','limit':10})
            try:
                result=get('/new/api/appearance-search?'+query)
                appearance[kind.replace('_clothing','')+'_available']=result.get('ok') is True
                appearance[kind.replace('_clothing','')+'_candidates']=len(result.get('results',[]))
            except Exception:
                pass
    ui=Path('/opt/homeassistant/config/www/frontyard-security-new/security-people-v45.js')
    ui_sha=hashlib.sha256(ui.read_bytes()).hexdigest() if ui.is_file() and not ui.is_symlink() else None
    print('SECURITY_FEATURE_V69_READONLY '+json.dumps({'camera':cam,
          'archive_originals':sources,'automatic_proposals':auto,
          'outfit_index':appearance,'people_ui_sha256':ui_sha,
          'camera_apk_modified':False,'originals_modified':False,
          'review_decisions_modified':False},sort_keys=True))
if __name__=='__main__':main()
