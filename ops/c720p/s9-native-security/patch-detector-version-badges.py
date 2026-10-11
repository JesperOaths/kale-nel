#!/usr/bin/env python3
"""Version evidence badges for the S9+ Home Assistant Saved Clips browser.

No claims about precise pre-upgrade detector versions: only the installed
current release has a verified cutover (2026-10-11 04:59:57 Europe/Amsterdam).
"""
import argparse
import datetime
import os
from pathlib import Path
import shutil
import re

PAGE=Path('/opt/homeassistant/config/www/frontyard-security-new/clips.html')
BACKUPS=Path('/home/jespern/c720p-home-hub/backups/s9-detector-version-badges')
ANCHOR='<script id="s9-saved-virtual-folders-script-v1">'
OLD="button.type='button';\n    const img=tag('img');"
NEW="button.type='button';\n    button.dataset.clipNo=name;\n    const img=tag('img');"
MARK='<script id="s9-detector-version-badges-v1">'
STYLES='''<style id="s9-detector-version-badges-style-v1">
#s9-date-folders .s9-detector-badge{display:inline-block!important;font-size:10px!important;line-height:1.15!important;margin-top:2px;padding:3px 5px;border-radius:5px;font-weight:700;white-space:normal!important;overflow-wrap:anywhere}
#s9-date-folders .s9-detector-legacy{background:#6c4527;color:#ffe3bb;border:1px solid #b77f48}
#s9-date-folders .s9-detector-prior{background:#223c5c;color:#c5deff;border:1px solid #719ac5}
#s9-date-folders .s9-detector-current{background:#164b48;color:#adfce8;border:1px solid #4dbaa6}
#s9-date-folders .s9-detector-unknown{background:#3b4558;color:#e9edfa;border:1px solid #79859f}
#s9-detector-version-guide{padding:9px 10px;background:#102839;border:1px solid #587d95;border-radius:9px;font-size:12px;color:#cfe9fb;margin:8px 0}
</style>'''
SCRIPT=r'''<script id="s9-detector-version-badges-v1">
(()=>{
'use strict';
// Verified S9+ Android package lastUpdateTime from adb, not an invented
// per-recording model version. All earlier releases are conservatively
// labeled UNKNOWN / PRE-UPGRADE, even when later reviewed by current AI.
const CUTOFF=Date.parse('2026-10-11T02:59:57Z');
const V2_CUTOFF=Date.parse('2026-10-11T04:26:36Z');
const RX=/^(?:motion|native4k)_([0-9]{13})[.]mp4$/;
function generation(name){
 const match=RX.exec(String(name||''));
 if(!match)return ['unknown','Historical/imported · detector generation unknown'];
 const timestamp=Number(match[1]);
 if(!Number.isSafeInteger(timestamp)||timestamp<Date.parse('2025-01-01T00:00:00Z'))
  return ['unknown','Unverified timestamp · detector unknown'];
 if(timestamp<CUTOFF)return ['legacy','LEGACY · pre-garden gate, version unknown'];
 if(timestamp<V2_CUTOFF)return ['prior','PREVIOUS v1 · garden ROI + GPU person gate'];
 return ['current','CURRENT v2 · two positive person checks'];
}
function decorate(){
 const host=document.getElementById('s9-date-folders');
 if(!host)return;
 if(!document.getElementById('s9-detector-version-guide')){
  const guide=document.createElement('div');
  guide.id='s9-detector-version-guide';
  guide.textContent='Detector capture versions: amber = legacy before 11 Oct 04:59:57; blue = v1 garden person gate from 04:59:57 to 06:26:36; teal = v2 requiring two independent person detections after 06:26:36 (Amsterdam time). Model outputs are not verified human identification; rescanning never changes the capture version.';
  host.append(guide);
 }
 host.querySelectorAll('.s9-folder-clip[data-clip-no],.s9-v4-clip[data-clip-no]').forEach(button=>{
  const name=button.dataset.clipNo;
  const version=generation(name);
  if(button.dataset.detectorVersion===version[0])return;
  button.dataset.detectorVersion=version[0];
  const span=document.createElement('span');
  span.className='s9-detector-badge s9-detector-'+version[0];
  span.textContent=version[1];
  span.title='Recording generation inferred from the clip timestamp and actual installed APK date. Exact older build is unknown.';
  const copy=button.querySelector('.s9-folder-copy,.s9-v4-copy');
  if(!copy)return;
  const previous=copy.querySelector('.s9-detector-badge');if(previous)previous.remove();
  copy.append(span);
 });
}
const list=document.getElementById('list');
if(!list)return;
let scheduled=false;
const observer=new MutationObserver(()=>{
 if(scheduled)return;
 scheduled=true;
 queueMicrotask(()=>{scheduled=false;decorate();});
});
observer.observe(list,{childList:true,subtree:true});
decorate();
window.addEventListener('pageshow',decorate);
})();
</script>'''

def patch(content):
 if content.count('</body>')!=1 or content.count(ANCHOR)!=1:
  raise ValueError('unsupported_S9_saved_clips_page')
 script_start=content.index(ANCHOR)
 script_end=content.index('</script>',script_start)
 existing=content[script_start:script_end]
 if OLD in existing:
  content=content[:script_start]+existing.replace(OLD,NEW,1)+content[script_end:]
 elif NEW not in existing and "b.dataset.clipNo=name" not in existing:
  raise ValueError('existing_virtual_folder_card_layout_unknown')
 found=content.count(MARK)
 if found==1:
  if content.count('id="s9-detector-version-badges-style-v1"')!=1:raise ValueError('partial_badge_install')
  style=re.search(r'<style id="s9-detector-version-badges-style-v1">.*?</style>',content,re.S)
  script=re.search(r'<script id="s9-detector-version-badges-v1">.*?</script>',content,re.S)
  if not style or not script:raise ValueError('badge_source_tags_missing')
  return content.replace(style.group(0),STYLES,1).replace(script.group(0),SCRIPT,1)
 if found:raise ValueError('duplicate_badge_install')
 return content.replace('</body>',STYLES+SCRIPT+'</body>',1)

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument('--page',type=Path,default=PAGE)
 parser.add_argument('--apply',action='store_true')
 args=parser.parse_args()
 original=args.page.read_text()
 changed=patch(original)
 if patch(changed)!=changed:raise RuntimeError('not_idempotent')
 if not args.apply:
  print('DETECTOR_VERSION_BADGES_DRY_RUN_OK',{'will_update':changed!=original,'bytes':len(changed),'cutover':'2026-10-11 04:59:57 +0200'})
  return
 BACKUPS.mkdir(parents=True,exist_ok=True)
 stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
 backup=BACKUPS/('clips-before-detector-badges-'+stamp+'.html')
 shutil.copy2(args.page,backup);os.chmod(backup,0o600)
 temp=args.page.with_name(args.page.name+'.version-badges-stage')
 try:
  temp.write_text(changed);os.chmod(temp,args.page.stat().st_mode&0o777)
  os.replace(temp,args.page)
  if patch(args.page.read_text())!=changed:raise RuntimeError('bad_live_file')
 except Exception:
  temp.unlink(missing_ok=True)
  restore=args.page.with_name(args.page.name+'.version-badges-restore')
  shutil.copy2(backup,restore);os.replace(restore,args.page)
  raise
 print('DETECTOR_VERSION_BADGES_DEPLOY_OK',{'backup':str(backup),'bytes':len(changed),'videos_modified':False,'phone_changed':False})

if __name__=='__main__':main()
