#!/usr/bin/env python3
"""Add on-phone recordings to the Camera clips pane without disturbing the C720P player."""
from pathlib import Path
import datetime,shutil
P=Path('/opt/homeassistant/config/www/frontyard-security-new/clips.html')
if not P.exists():raise SystemExit('Camera clips UI missing')
s=P.read_text()
MARK='C720P_S9_PHONE_CLIPS_UI_V1'
if MARK in s:print('S9_CAMERA_UI_ALREADY_INSTALLED');raise SystemExit(0)
if s.count('</body>')!=1:raise SystemExit('Unexpected UI HTML body')
stamp=datetime.datetime.now().strftime('%Y%m%d-%H%M%S')
backup=P.with_name('clips.html.before-s9-phone-'+stamp)
shutil.copy2(P,backup)
ui=r'''
<style id="C720P_S9_PHONE_CLIPS_UI_V1">
.s9phone-header{color:#8bddff;font-weight:950;font-size:13px;margin:12px 2px 5px;
 border-top:1px solid rgba(255,255,255,.18);padding-top:9px}
.s9phone-meta{color:#98aabb;font-size:10px;margin:0 3px 7px;line-height:1.35}
.s9phone-item{display:grid;grid-template-columns:92px minmax(0,1fr);gap:8px;padding:7px;
 border:1px solid rgba(94,205,255,.28);border-radius:12px;background:rgba(33,105,149,.12);
 margin-bottom:7px;color:#e5f7ff;cursor:pointer;text-align:left;width:100%}
.s9phone-item img{width:92px;height:56px;border-radius:7px;object-fit:cover;background:#000}
.s9phone-item .tag{font-size:12px;font-weight:950}
.s9phone-item .meta{font-size:11px;color:#b8cadd;margin-top:3px}
.s9phone-item.pending{border-color:rgba(255,197,82,.24);cursor:default}
.s9phone-item:focus-visible{outline:2px solid #82d8ff}
.s9phone-item[disabled]{opacity:.76}
@media(max-width:1050px){.s9phone-item{grid-template-columns:76px minmax(0,1fr)}
.s9phone-item img{width:76px;height:43px}}
</style>
<script id="c720p-s9-phone-clips-ui-v1">
(()=>{'use strict';
 const BASE='/local/frontyard-security-new/';
 let recordings=[], selected=false;
 const list=()=>document.getElementById('list');
 const encode=s=>encodeURIComponent(String(s||''));
 const toast=s=>{const e=document.getElementById('toast');if(e){e.textContent=s;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),2200)}};
 function releasePhone(){
   selected=false;
   for(const id of ['save','delete']){const b=document.getElementById(id);if(b)b.disabled=false}
 }
 async function playPhone(rec) {
   if(!rec.drive_verified || !rec.remote_name){toast('MicroSD copy awaiting Drive verification');return}
   if(!window.C720PSecureRelay || !C720PSecureRelay.url){
      toast('Saved Clips player is required for phone archive playback');
      try{window.parent.document.querySelector('[data-tab="saved"]').click()}catch(_){}
      return;
   }
   try{
     const url=await C720PSecureRelay.url('/new/saved/clip/'+encode(rec.remote_name));
     const video=document.getElementById('player');
     video.pause();video.src=url;video.preload='metadata';
     if(rec.thumbnail)video.poster=BASE+rec.thumbnail;
     video.load();video.play().catch(()=>{});
     selected=true;
     for(const id of ['save','delete']){const b=document.getElementById(id);if(b)b.disabled=true}
     document.getElementById('nowName').textContent='S9+ · '+rec.timestamp;
     document.getElementById('selectedBig').textContent='S9+ recording · verified Drive backup';
     document.getElementById('selectedSmall').textContent='Original retained on phone microSD. Manage Drive copy in Saved Clips.';
   }catch(e){toast('Could not load Drive copy: '+e.message)}
 }
 function renderPhone(){
    const root=list();
    if(!root || root.querySelector('#s9-phone-section') || !recordings.length)return;
    const section=document.createElement('section');section.id='s9-phone-section';
    const heading=document.createElement('div');heading.className='s9phone-header';
    heading.textContent='S9+ phone recordings · '+recordings.length;
    const info=document.createElement('div');info.className='s9phone-meta';
    info.textContent='High-resolution originals stored on phone. Green means verified in Google Drive; amber means pending backup.';
    section.append(heading,info);
    for(const rec of recordings.slice(0,80)){
      const btn=document.createElement('button');btn.type='button';
      btn.className='s9phone-item'+(rec.drive_verified?'':' pending');
      btn.title=rec.drive_verified?'Play verified Drive recording':'Stored on S9+ microSD; Drive backup pending';
      const img=document.createElement('img');img.alt='S9+ recording preview';img.loading='lazy';
      if(rec.thumbnail)img.src=BASE+rec.thumbnail;
      const text=document.createElement('div');
      const a=document.createElement('div');a.className='tag';
      a.textContent=rec.drive_verified?'✓ Drive verified':'◷ SD only, backup pending';
      const b=document.createElement('div');b.className='meta';b.textContent=rec.timestamp;
      text.append(a,b);btn.append(img,text);
      btn.addEventListener('click',()=>playPhone(rec));
      section.append(btn);
    }
    root.append(section);
 }
 async function refreshPhone(){
    try{
      const r=await fetch(BASE+'s9-phone-events.json?t='+Date.now(),{cache:'no-store'});
      if(!r.ok)throw new Error('missing');
      const d=await r.json();
      recordings=Array.isArray(d.phone_recordings)?d.phone_recordings.slice().reverse():[];
      const previous=list()?.querySelector('#s9-phone-section');
      if(previous)previous.remove();
      renderPhone();
    }catch(_){}
 }
 const observer=new MutationObserver(()=>{if(!list()?.querySelector('#s9-phone-section'))renderPhone()});
 if(list())observer.observe(list(),{childList:true});
 document.addEventListener('click',e=>{
   if(e.target.closest('.clip[data-no]'))releasePhone();
 },true);
 window.addEventListener('pageshow',refreshPhone);
 setInterval(refreshPhone,45000);
 setTimeout(refreshPhone,250);
})();
</script>
'''
s=s.replace('local C720P storage','C720P + S9+ microSD / verified Drive',1)
s=s.replace('</body>',ui+'</body>')
temp=P.with_suffix('.html.s9tmp')
temp.write_text(s);temp.chmod(P.stat().st_mode & 0o777);temp.replace(P)
print('S9_CAMERA_UI_INTEGRATED',str(backup),'size',P.stat().st_size)
