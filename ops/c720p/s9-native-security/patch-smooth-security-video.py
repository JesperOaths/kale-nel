#!/usr/bin/env python3
"""Install shared smooth Security playback, preserving original media and auth.

Default is a dry run. --apply backs up every affected page and JS, then writes
atomically. No camera, Android, service, Home Assistant, or media restart.
"""
import argparse
import datetime
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess

HERE=Path(__file__).resolve().parent
MARKER='C720P_SECURITY_SMOOTH_VIDEO_V1'
SCRIPT='<script src="/local/security-video-playback.js?v='+MARKER+'"></script>'
STYLE='''<style id="security-smooth-video-style-v1">
.cam video[data-security-profile="live-h264"]{display:block;width:100%;height:auto;min-height:0;object-fit:contain;background:#000}
.cameraLayer video[data-security-profile="live-h264"]{position:absolute;inset:0;width:100%!important;height:100%!important;max-height:none!important;object-fit:cover!important}
.security-video-controls select,.security-video-controls button{cursor:pointer}
</style>'''

def patch(html,kind):
    if MARKER in html:
        if html.count(SCRIPT)!=1 or 'id="security-smooth-video-style-v1"' not in html:
            raise ValueError('unexpected_partial_smooth_video_patch')
        if kind=='security' and 'C720P_SECURITY_SMOOTH_LIVE_BRIDGE_V1' not in html:
            raise ValueError('main_smooth_live_bridge_missing')
        if kind=='home' and 'C720P_HOME_SMOOTH_LIVE_BRIDGE_V1' not in html:
            raise ValueError('home_smooth_live_bridge_missing')
        return html
    if html.count('</head>')!=1 or html.count('</body>')!=1:
        raise ValueError('unexpected_html_document')
    relay=re.findall(r'<script\b[^>]*src=["\']/local/c720p-secure-relay-client[.]js[^"\']*["\'][^>]*></script>',html)
    if kind=='faces':
        if relay or 'window.parent.C720PSecureRelay' not in html or 'id="s9-faces-appearances-gallery-v1"' not in html:
            raise ValueError('face_gallery_parent_relay_contract_changed')
        if 'id="player"' not in html or '/new/saved/clip/' not in html:
            raise ValueError('face_gallery_video_contract_missing')
        result=html.replace('</head>',SCRIPT+'\n'+STYLE+'\n</head>',1)
    else:
        if len(relay)!=1:raise ValueError('authenticated_relay_client_missing_or_duplicate')
        result=html.replace(relay[0],relay[0]+'\n'+SCRIPT+'\n'+STYLE,1)
    if kind=='security':
        start='/* S9_SECURITY_LIVE_V4_AUTHENTICATED_MJPEG_FETCH_FALLBACK */'
        end='function refreshPhoneBatteries()'
        if result.count(start)!=1 or result.count(end)!=1 or result.count('async function streams(on){')!=1:
            raise ValueError('main_security_live_contract_changed')
        a=result.index(start);b=result.index(end,a)
        bridge='''/* C720P_SECURITY_SMOOTH_LIVE_BRIDGE_V1 */
function streams(on){
 const img=document.getElementById('cameraLive');if(!img)return;
 const fast=document.getElementById('cameraFast');
 if(fast&&fast.getAttribute('src')!=='about:blank'){fast.style.display='none';fast.src='about:blank'}
 if(!on){window.C720PSecurityVideo.stopLive(img);return}
 window.C720PSecurityVideo.startLive(img,{status:document.getElementById('cameraStatus')});
}
'''
        result=result[:a]+bridge+result[b:]
    elif kind=='home':
        start='async function setSource(_kind,_url,badge,msg){'
        end='async function selectSource()'
        if result.count(start)!=1 or result.count(end)!=1 or 'function isOn()' not in result:
            raise ValueError('home_live_toggle_contract_changed')
        a=result.index(start);b=result.index(end,a)
        bridge='''/* C720P_HOME_SMOOTH_LIVE_BRIDGE_V1 */
async function setSource(_kind,_url,badge,msg){
 if(!isOn())return;activeSource="primary";badgeBox.textContent=badge;
 window.C720PSecurityVideo.startLive(cam,{status:statusBox});
 statusBox.classList.add('show');
}
'''
        result=result[:a]+bridge+result[b:]
    elif kind=='clips':
        if 'id="player"' not in result or '/new/saved/clip/' not in result:
            raise ValueError('native_clips_player_contract_missing')
    elif kind=='saved':
        if 'id="player"' not in result or '/saved/clip/' not in result:
            raise ValueError('archive_player_contract_missing')
    elif kind=='faces':
        pass
    else:raise ValueError('unknown_page_kind')
    return result

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--www',type=Path,default=Path('/opt/homeassistant/config/www'))
    p.add_argument('--js',type=Path,default=HERE/'security-video-playback.js')
    p.add_argument('--backup-root',type=Path,default=Path('/home/jespern/c720p-home-hub/backups/smooth-security-video'))
    p.add_argument('--apply',action='store_true')
    args=p.parse_args()
    js=args.js.read_bytes()
    if MARKER.encode() not in js or b'window.C720PSecurityVideo=' not in js:
        raise RuntimeError('shared_video_source_contract_missing')
    if shutil.which('node'):
        subprocess.run(['node','--check',str(args.js)],check=True,timeout=15,capture_output=True,text=True)
    pages={args.www/'c720p-surveillance.html':'security',args.www/'frontyard-security-new/clips.html':'clips',
           args.www/'frontyard-security-new/face-appearances.html':'faces',
           args.www/'c720p-drive-saved.html':'saved',args.www/'c720p-release/home-live-primary-v2.html':'home'}
    changes={}
    for path,kind in pages.items():
        if not path.is_file():
            if kind=='home':continue
            raise RuntimeError('production_page_missing_'+kind)
        old=path.read_text(encoding='utf-8');new=patch(old,kind)
        if patch(new,kind)!=new:raise RuntimeError('non_idempotent_'+kind)
        if old!=new:changes[path]=new.encode()
    target=args.www/'security-video-playback.js'
    if not target.exists() or target.read_bytes()!=js:changes[target]=js
    report={'changed':[str(x) for x in changes],'js_sha256':hashlib.sha256(js).hexdigest(),
            'camera_restart':False,'media_modified':False,'original_option':True}
    if not args.apply:
        print('SECURITY_SMOOTH_VIDEO_DRY_RUN '+json.dumps(report));return
    if not changes:
        print('SECURITY_SMOOTH_VIDEO_ALREADY_ACTIVE');return
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup=args.backup_root/stamp;backup.mkdir(parents=True,exist_ok=False)
    originals={};modes={};owners={}
    for number,path in enumerate(changes):
        modes[path]=path.stat().st_mode&0o777 if path.exists() else 0o644
        stat=path.stat() if path.exists() else path.parent.stat()
        owners[path]=(stat.st_uid,stat.st_gid)
        old=backup/(str(number)+'-'+path.name) if path.exists() else None
        if old:shutil.copy2(path,old)
        originals[path]=old
    manifest={'files':{str(path):str(old) if old else None for path,old in originals.items()},'report':report}
    (backup/'manifest.json').write_text(json.dumps(manifest,indent=2),encoding='utf-8')
    written=[];directory_modes={}
    try:
        # Release pages are intentionally read-only between authorized releases.
        # Permit atomic replacement only for directories owned by this account,
        # then restore the exact prior permission bits even after rollback.
        for path in changes:
            directory=path.parent
            if not os.access(directory,os.W_OK) and hasattr(os,'getuid'):
                stat=directory.stat()
                if stat.st_uid!=os.getuid():raise PermissionError('release_directory_owner_mismatch')
                directory_modes[directory]=stat.st_mode&0o777
                os.chmod(directory,directory_modes[directory]|0o200)
        for path,body in changes.items():
            temp=path.with_name(path.name+'.smooth-stage')
            temp.write_bytes(body);os.chmod(temp,modes[path])
            if hasattr(os,'chown') and os.geteuid()==0:os.chown(temp,*owners[path])
            os.replace(temp,path);written.append(path)
            if path.read_bytes()!=body:raise RuntimeError('postwrite_content_mismatch')
    except Exception:
        for path in reversed(written):
            original=originals[path]
            if original:
                temp=path.with_name(path.name+'.smooth-rollback');shutil.copy2(original,temp)
                if hasattr(os,'chown') and os.geteuid()==0:os.chown(temp,*owners[path])
                os.replace(temp,path)
            else:path.unlink(missing_ok=True)
        raise
    finally:
        for directory,mode in directory_modes.items():os.chmod(directory,mode)
    print('SECURITY_SMOOTH_VIDEO_DEPLOYED '+json.dumps({**report,'backup':str(backup)}))

if __name__=='__main__':main()
