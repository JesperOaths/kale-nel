#!/usr/bin/env python3
"""Space-efficient S9 Security live and saved playback, without moving media files.

Injects scoped CSS/JS only. The microSD and Drive catalogs, authenticated
media URLs, video element and its existing event handlers are preserved.
Run once per target HTML page: --kind saved or --kind live. By default dry run.
"""
import argparse
from datetime import datetime, timezone
from pathlib import Path
import os
import shutil
import re

SAVED=Path('/opt/homeassistant/config/www/frontyard-security-new/clips.html')
LIVE=Path('/opt/homeassistant/config/www/c720p-surveillance.html')
MARK_SAVED='id="s9-compact-recordings-v1"'
MARK_LIVE='id="s9-live-viewport-fit-v1"'
SAVED_SNIPPET=r"""
<style id="s9-compact-recordings-v1">
/* The original list remains present until the signed S9 folder index loads. */
#s9-compact-layout{display:grid;grid-template-columns:minmax(290px,370px) minmax(0,1fr);
  align-items:start;gap:14px;max-width:100%;min-width:0;margin:9px 0 14px}
#s9-compact-layout .s9-playback-pane,#s9-compact-layout .s9-selector-pane{
  box-sizing:border-box;min-width:0;padding:10px;border:1px solid #35576b;
  background:#102431;border-radius:12px}
#s9-compact-layout .s9-playback-pane{position:sticky;top:8px;max-width:380px}
#s9-compact-layout .s9-pane-heading{font-size:15px;font-weight:800;color:#edf9ff;margin:0 0 8px}
#s9-compact-layout #player{display:block;max-width:100%;background:#000;border-radius:8px}
#s9-compact-layout .s9-playback-pane > video#player{max-height:220px!important;width:100%!important;object-fit:contain!important}
#s9-compact-layout .s9-rotation-shell{margin:0!important;width:min(100%,360px)!important;max-width:360px!important}
#s9-compact-layout .s9-rotation-stage{margin-left:0!important;margin-right:0!important}
#s9-compact-layout #list{min-width:0;max-height:calc(100dvh - 125px);overflow-y:auto;
  overflow-x:hidden;scrollbar-width:thin;overscroll-behavior:contain;padding-right:3px}
#list.s9-curated-ready > :not(#s9-date-folders):not(#s9-human-review):not(#s9-face-review):not(#s9-fallback-section):not(#s9-anonymous-clips-v1):not(#s9-drive-person-review):not(#s9-live-person-watch){display:none!important}
#s9-compact-layout #s9-date-folders{margin:0!important;border:0!important;
  padding:0!important;background:transparent!important}
@media(max-width:900px){
 #s9-compact-layout{grid-template-columns:minmax(0,1fr);gap:8px}
 #s9-compact-layout .s9-playback-pane{position:static}
 #s9-compact-layout #list{max-height:min(54dvh,620px)}
}
</style>
<script id="s9-compact-recordings-script-v1">
(()=>{
 'use strict';
 function mount(){
  const video=document.getElementById('player'),list=document.getElementById('list');
  if(!video||!list||document.getElementById('s9-compact-layout'))return;
  if(video.closest('dialog')||video.contains(list)||list.contains(video))return;
  const player=video.closest('.s9-rotation-shell')||video;
  const parent=list.parentNode;
  if(!parent||!player.parentNode||player.contains(list))return;
  const layout=document.createElement('section');layout.id='s9-compact-layout';
  layout.setAttribute('aria-label','Saved recordings workspace');
  const left=document.createElement('div');left.className='s9-playback-pane';
  const right=document.createElement('div');right.className='s9-selector-pane';
  const h=(label)=>{const n=document.createElement('h2');n.className='s9-pane-heading';
                    n.textContent=label;return n;};
  left.append(h('Video playback'));
  right.append(h('Recordings'));
  parent.insertBefore(layout,list);
  layout.append(left,right);
  left.append(player);
  right.append(list);
  // Moving nodes retains their media source, signed relay and event listeners.
 }
 if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
 else mount();
 // The orientation helper may wrap the video after this layout mounts.
 // In that case it already wraps inside the playback pane; no remount needed.
})();
</script>
"""
LIVE_SNIPPET=r"""
<style id="s9-live-viewport-fit-v1">
/* Prior rules set width:100% + 4/3 aspect ratio, producing >100vh images.
 * Fit the complete native preview within its embedded Security viewport.
 * This changes presentation only; the phone still encodes original 4K MP4s.
 */
#panel-live.active{height:100%!important;max-height:100%!important;overflow-y:auto!important;
  overflow-x:hidden!important}
#panel-live .c720p-s9-live-only{box-sizing:border-box!important;height:auto!important;
  min-height:0!important;display:flex!important;align-items:center!important;
  justify-content:flex-start!important;flex-direction:column!important;
  padding:8px!important;gap:6px!important}
#panel-live .c720p-s9-live-only .cam{
  box-sizing:border-box!important;flex:none!important;
  width:min(100%,calc(70dvh * 4 / 3),1120px)!important;
  max-width:100%!important;height:auto!important;
  max-height:70dvh!important;
  min-height:0!important;aspect-ratio:4 / 3!important;margin:0 auto!important}
#panel-live #cameraLive{
  display:block!important;width:100%!important;height:100%!important;
  max-height:70dvh!important;aspect-ratio:4 / 3!important;
  object-fit:contain!important}
@media(max-height:640px){
 #panel-live .c720p-s9-live-only .cam,#panel-live #cameraLive{
  max-height:calc(100dvh - 95px)!important}
 #panel-live .c720p-s9-live-only .cam{
  width:min(100%,calc((100dvh - 95px) * 4 / 3))!important}
}
@media(max-width:820px){
 #panel-live .c720p-s9-live-only{padding:4px!important}
 #panel-live .c720p-s9-live-only .cam{
  width:min(100%,calc((100dvh - 140px) * 4 / 3))!important}
}
</style>
"""

def _replace_tag_once(source: str, tag: str, marker: str, replacement: str) -> str:
    expression=r'<'+tag+r' '+re.escape(marker)+r'>[\\s\\S]*?</'+tag+r'>'
    matches=list(re.finditer(expression,source))
    if len(matches)!=1:raise ValueError('missing_or_duplicate_existing_'+tag)
    old=matches[0].group(0)
    if marker=='id="s9-compact-recordings-script-v1"' and (
        "function mount()" not in old or "s9-compact-layout" not in old):
        raise ValueError('unknown_existing_layout_script')
    return source[:matches[0].start()]+replacement+source[matches[0].end():]

def patch(source: str, kind: str) -> str:
    if source.count('</head>')!=1:
        raise ValueError('unexpected_security_head')
    if kind=='saved':
        for anchor in ('id="player"','id="list"','s9-video-orientation-script-v1',
                       's9-saved-virtual-folders-script-v1'):
            if anchor not in source:raise ValueError('missing_saved_layout_anchor_'+anchor)
        if MARK_SAVED in source:
            if source.count(MARK_SAVED)!=1 or source.count('id="s9-compact-recordings-script-v1"')!=1:
                raise ValueError('partial_compact_recordings_widget')
            newStyle=SAVED_SNIPPET.split('</style>',1)[0]+'</style>'
            newScript='<script id="s9-compact-recordings-script-v1">'+SAVED_SNIPPET.split('<script id="s9-compact-recordings-script-v1">',1)[1]
            changed=_replace_tag_once(source,'style',MARK_SAVED,newStyle)
            changed=_replace_tag_once(changed,'script','id="s9-compact-recordings-script-v1"',newScript.strip())
            return changed
        return source.replace('</head>',SAVED_SNIPPET+'</head>',1)
    if kind=='live':
        for anchor in ('id="panel-live"','id="cameraLive"','c720p-s9-live-only'):
            if anchor not in source:raise ValueError('missing_live_layout_anchor_'+anchor)
        if MARK_LIVE in source:
            if source.count(MARK_LIVE)!=1:raise ValueError('partial_live_viewport_widget')
            return _replace_tag_once(source,'style',MARK_LIVE,LIVE_SNIPPET.strip())
        return source.replace('</head>',LIVE_SNIPPET+'</head>',1)
    raise ValueError('unknown_layout_kind')

def main():
    p=argparse.ArgumentParser()
    p.add_argument('--kind',required=True,choices=('saved','live'))
    p.add_argument('--page',type=Path)
    p.add_argument('--apply',action='store_true')
    a=p.parse_args()
    target=a.page or (SAVED if a.kind=='saved' else LIVE)
    old=target.read_text()
    new=patch(old,a.kind)
    if patch(new,a.kind)!=new:
        raise RuntimeError('layout_patch_not_idempotent')
    if not a.apply:
        print('S9_SECURITY_COMPACT_LAYOUT_DRY_RUN',a.kind,old!=new)
        return
    if old==new:
        print('S9_SECURITY_COMPACT_LAYOUT_ALREADY_PRESENT',a.kind)
        return
    backup_dir=Path('/home/jespern/c720p-home-hub/backups/security-compact-layout')
    backup_dir.mkdir(parents=True,exist_ok=True)
    stamp=datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup=backup_dir/(a.kind+'.before-compact-'+stamp+'.html')
    shutil.copy2(target,backup)
    os.chmod(backup,0o600)
    staging=target.with_name(target.name+'.compact-stage')
    committed=False
    try:
        staging.write_text(new)
        os.chmod(staging,target.stat().st_mode&0o777)
        if staging.read_text()!=new:
            raise RuntimeError('staging_integrity_failed')
        os.replace(staging,target)
        committed=True
        if patch(target.read_text(),a.kind)!=new:
            raise RuntimeError('installed_layout_mismatch')
    except Exception:
        staging.unlink(missing_ok=True)
        if committed:
            restored=target.with_name(target.name+'.compact-rollback')
            shutil.copy2(backup,restored)
            os.replace(restored,target)
        raise
    print('S9_SECURITY_COMPACT_LAYOUT_INSTALLED',a.kind,
          'rollback='+str(backup),'recordings_modified=False')

if __name__=='__main__':
    main()
