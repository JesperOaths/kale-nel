#!/usr/bin/env python3
"""Repair S9+ native source UI in the old IP-Webcam-era Home Assistant hub.

No camera power/input/storage mutation. Patches only existing static HTML,
with strict structural guards and an idempotent rollback-ready code path.
"""
from pathlib import Path
import argparse
import os
import re

MARKER="s9-native-today-camera-clips-v1"
LIVE_MARKER="C720P_S9_HOME_LIVE_RETAIN_TOGGLE_V1"
WWW=Path("/opt/homeassistant/config/www")
TODAY=r'''
<style id="s9-native-today-camera-clips-v1">
#s9-native-today{margin:12px 0 15px;background:#142b37;border:1px solid #43718c;border-radius:14px;padding:11px;color:#e4f6ff}
#s9-native-today .today-title{font-size:17px;font-weight:850;margin-bottom:5px}
#s9-native-today .today-meta{font-size:12px;color:#b2d3df;line-height:1.4;margin-bottom:8px}
#s9-native-today .today-tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(235px,1fr));gap:10px}
#s9-native-today button{border:1px solid #4b829c;border-radius:10px;background:#1c3646;color:#f1ffff;text-align:left;cursor:pointer;overflow:hidden;display:flex;gap:10px;padding:9px;align-items:center}
#s9-native-today button img{width:94px;height:68px;object-fit:cover;background:#090e12;border-radius:6px}
#s9-native-today button:focus-visible{outline:2px solid #9ffaff}
#s9-native-today button small{display:block;font-size:11px;color:#c2dce8}
</style>
<script id="s9-native-today-clips-script-v1">
(()=>{
'use strict';
const root=()=>document.getElementById('list');
const BASE='/local/frontyard-security-new/';
const filename=/^(?:motion|native4k)_[0-9]{13}\.mp4$/;
let latest=[];
const localDay=date=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(date);
const today=()=>localDay(new Date());
const dayOf=rec=>{
 const match=filename.exec(String(rec.name||''));
 if(!match)return null;
 const ms=Number(rec.name.split('_')[1].slice(0,13));
 if(!Number.isFinite(ms)||ms<1600000000000)return null;
 return localDay(new Date(ms));
};
const make=(tag,c,text)=>{
 const e=document.createElement(tag);
 if(c)e.className=c;
 if(text!==undefined)e.textContent=text;
 return e;
};
function render(){
 const list=root();if(!list)return;
 let section=document.getElementById('s9-native-today');
 if(!section){section=make('section');section.id='s9-native-today';list.prepend(section);}
 section.replaceChildren();
 const eligible=latest.filter(r=>r.sd_verified===true && filename.test(String(r.name||'')));
 const todays=eligible.filter(r=>dayOf(r)===today()).sort((a,b)=>b.name.localeCompare(a.name));
 section.append(make('div','today-title',"Today's S9+ camera clips · "+todays.length));
 section.append(make('p','today-meta','Native 4K recordings from the phone microSD. Local Amsterdam calendar date. Historical C720P recorder clips appear separately below.'));
 if(!todays.length){
  section.append(make('p','today-meta','No verified native S9+ recordings yet today. Live camera can be healthy without a motion-triggered clip.'));
  return;
 }
 const tiles=make('div','today-tiles');
 for(const rec of todays.slice(0,36)){
  const button=make('button');
  button.type='button';
  const photo=document.createElement('img');
  const safe='s9-phone-thumbs/'+rec.name+'.thumb.jpg';
  if(rec.thumbnail===safe)photo.src=BASE+safe;
  photo.alt='Native S9+ motion recording thumbnail';
  const info=make('span');
  let stamp='Time unknown';
  const ms=Number(rec.name.split('_')[1].slice(0,13));
  if(Number.isFinite(ms))stamp=new Date(ms).toLocaleTimeString('en-GB',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit',second:'2-digit'});
  info.append(make('strong','',stamp));
  info.append(make('small','',''));
  info.lastChild.textContent=(rec.scene_category||'Motion event')+' · microSD 4K';
  button.append(photo,info);
  button.addEventListener('click',async()=>{
   const video=document.getElementById('player');
   if(!video||!window.C720PSecureRelay?.url)return;
   try{
    const link=await C720PSecureRelay.url('/new/saved/clip/'+encodeURIComponent(rec.name));
    video.pause();video.src=link;video.preload='metadata';
    if(photo.src)video.poster=photo.src;
    video.load();video.play().catch(()=>{});
    const current=document.getElementById('nowName');
    if(current)current.textContent='S9+ native 4K · '+stamp;
    const big=document.getElementById('selectedBig');
    if(big)big.textContent='Native S9+ clip · stored on microSD';
    const small=document.getElementById('selectedSmall');
    if(small)small.textContent='Original is kept on the S9+; playback uses authenticated SD byte ranges.';
    for(const id of ['save','delete']){
     const b=document.getElementById(id);
     if(b)b.disabled=true;
    }
   }catch(e){
    const toast=document.getElementById('toast');
    if(toast){toast.textContent='Native recording unavailable: '+String(e.message||e);toast.classList.add('show');}
   }
  });
  tiles.append(button);
 }
 section.append(tiles);
 if(todays.length>36)section.append(make('p','today-meta','Showing latest 36 of '+todays.length+' verified native clips.'));
}
async function reload(){
 try{
  const response=await fetch(BASE+'s9-phone-events.json?today='+Date.now(),{cache:'no-store'});
  if(!response.ok)throw Error('catalog');
  const data=await response.json();
  latest=Array.isArray(data.phone_recordings)?data.phone_recordings:[];
  render();
 }catch(_){const section=document.getElementById('s9-native-today');if(section)section.append(make('p','today-meta','Native SD catalog temporarily unavailable'));}
}
let pending=false;
const observer=new MutationObserver(()=>{
 if(!root()||document.getElementById('s9-native-today'))return;
 if(pending)return;
 pending=true;
 Promise.resolve().then(()=>{pending=false;render()});
});
if(root())observer.observe(root(),{childList:true});
window.addEventListener('pageshow',reload);
setInterval(()=>{if(!document.hidden)reload()},40000);
setTimeout(reload,800);
})();
</script>
'''
def patch_clips(html):
 if f'id="{MARKER}"' in html and 'id="s9-native-today-clips-script-v1"' in html:
  return html
 if html.count("</body>")!=1 or 'c720p-s9-phone-clips-ui-v1' not in html or "id=\"player\"" not in html:
  raise ValueError("unexpected_camera_clips_layout")
 return html.replace("</body>",TODAY+"\n</body>",1)

def patch_home(html):
 if LIVE_MARKER in html:return html
 if html.count("</body>")!=1 or '/new/live.mjpg' not in html or 'function isOn()' not in html:
  raise ValueError("unexpected_main_hub_live_layout")
 # Older code deliberately reset all persisted LIVE toggle state whenever
 # a component version changed. This could hide the native stream immediately
 # after clicking LIVE; retain explicit user toggle instead.
 pattern=r'if\(localStorage\.getItem\(VERSION_KEY\)!==["\']v61-primary-new-only-no-s3["\']\)\{localStorage\.setItem\(LIVE_KEY,["\']off["\']\);localStorage\.setItem\(KEY,["\']off["\']\);localStorage\.setItem\(OLD_KEY,["\']off["\']\);localStorage\.setItem\(VERSION_KEY,["\']v61-primary-new-only-no-s3["\']\)\}'
 s,n=re.subn(pattern,'localStorage.setItem(VERSION_KEY,"v62-native-live-toggle-preserved")',html,count=1)
 if n!=1:raise ValueError("live_toggle_reset_pattern_changed")
 # Keep first-party relay URL with auth and only S9 camera. Wire explicit
 # click/message events in addition to prior cross-iframe storage and channels.
 marker='<!-- '+LIVE_MARKER+' -->'
 listener=r'''
<script id="s9-home-live-toggle-bridge-v1">
(()=>{
'use strict';
const name='c720p_live_camera';
function notify(on){
  try{localStorage.setItem(name,on?'on':'off')}catch(_){}
  try{new BroadcastChannel('c720p-live-camera').postMessage({on:!!on})}catch(_){}
  try{window.postMessage({type:'c720p-live-camera',on:!!on},'*')}catch(_){}
}
window.addEventListener('message',e=>{
 const data=e.data||{};
 if(data.type==='c720p-live-camera-toggle' && typeof data.on==='boolean')
  notify(data.on);
});
})();
</script>
'''
 # The existing script already responds to the broadcast; this code merely
 # bridges a bottom navigation event when it is delivered via postMessage.
 return s.replace("</body>",marker+"\n"+listener+"\n</body>",1)

if __name__=="__main__":
 parser=argparse.ArgumentParser()
 parser.add_argument("--clips",type=Path,default=WWW/"frontyard-security-new/clips.html")
 parser.add_argument("--home",type=Path,default=WWW/"c720p-release/home-live-primary-v2.html")
 args=parser.parse_args()
 for file,patch in [(args.clips,patch_clips),(args.home,patch_home)]:
  original=file.read_text()
  new=patch(original)
  if new!=original:
   temp=file.with_name(file.name+".s9tabs-stage")
   temp.write_text(new)
   os.chmod(temp,file.stat().st_mode&0o777)
   os.replace(temp,file)
  print("S9_UI_CHECK",file.name,"CHANGED" if new!=original else "ALREADY_PRESENT")
