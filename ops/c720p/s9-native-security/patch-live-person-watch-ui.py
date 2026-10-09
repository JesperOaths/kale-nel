#!/usr/bin/env python3
"""Idempotent S9 Home Assistant Security live SSD person-watch status widget."""
from pathlib import Path
import os

MARKER='id="s9-live-person-watch-v1"'
SNIPPET=r'''
<style id="s9-live-person-watch-v1">
#s9-live-person-watch{padding:13px;margin:16px 0;background:#122733;border:1px solid #3d5d6d;border-radius:12px;color:#eef8ff}
#s9-live-person-watch h3{font-size:17px;margin:0 0 5px}
#s9-live-person-watch p{font-size:12px;line-height:1.55;margin:5px 0;color:#c0d3df}
#s9-live-person-watch .s9-person-readout{font-size:15px;font-weight:750;line-height:1.5;margin:7px 0}
#s9-live-person-watch .s9-person-row{font-size:12px;margin:4px 0;color:#c5d7e0}
#s9-live-person-watch .s9-person-events{font-size:12px;padding-left:16px;margin-top:6px}
</style>
<script id="s9-live-person-watch-script-v1">
(()=>{
 'use strict';
 const id='s9-live-person-watch';
 const names={
  person_likely_candidate:'Person likely detected (AI candidate)',
  multiple_people_candidate:'Multiple people likely (AI candidate)',
  possible_person_needs_review:'Possible person — review required',
  vehicle_candidate:'Vehicle detected (AI candidate)',
  animal_candidate:'Animal detected (AI candidate)',
  other_motion_detected:'Motion detected; no classified person',
  no_object_detected:'No confident object detection in sampled preview',
  sensor_stale:'Live person classifier data is stale',
  sensor_not_started:'Live person classifier is not running',
  sensor_unavailable:'Live camera person classifier unavailable'
 };
 const el=(tag,cls,v)=>{
  const e=document.createElement(tag);
  if(cls)e.className=cls;
  if(v!==undefined)e.textContent=v;
  return e;
 };
 function root(){return document.getElementById('list');}
 function create(){
  let p=document.getElementById(id);if(p)return p;
  const parent=root();if(!parent)return null;
  p=document.createElement('section');p.id=id;
  p.append(el('h3','','S9+ live person & motion sensing'));
  p.append(el('p','','Private, read-only preview classification. Motion comes from the phone; person, vehicle and animal labels are unverified AI candidates. Never a verified person identity.'));
  p.append(el('div','s9-person-readout','Checking live detector…'));
  p.append(el('div','s9-person-row',''));
  p.append(el('div','s9-person-row',''));
  p.append(el('ul','s9-person-events'));
  parent.prepend(p);return p;
 }
 function show(data){
  const p=create();if(!p)return;
  const kind=data?.status?.kind||'sensor_unavailable';
  p.querySelector('.s9-person-readout').textContent=names[kind]||'Live analysis unavailable';
  const stats=p.querySelectorAll('.s9-person-row');
  if(data?.ok===true && Number(data.last_sample_age_ms)<17000){
   const score=Number(data.status.person_score||0),vehicle=Number(data.status.vehicle_score||0),animal=Number(data.status.animal_score||0);
   stats[0].textContent='Person score '+Math.round(score*100)+'% · Vehicles '+Math.round(vehicle*100)+'% · Animals '+Math.round(animal*100)+'% · People detected in frame '+(data.status.simultaneous_people||0);
   stats[1].textContent='Camera '+(data.camera_mode||'unknown')+' · Temp '+(data.camera_temperature_c??'?')+'°C · Sample age '+Math.round(data.last_sample_age_ms/1000)+'s · Brightness/motion are checked on the S9+';
  }else{
   stats[0].textContent='No reliable fresh live classification';
   stats[1].textContent='Existing recording and Home Assistant live feeds are independent of this optional sensor';
  }
  const ul=p.querySelector('.s9-person-events');ul.replaceChildren();
  const events=Array.isArray(data?.recent_candidate_transitions)?data.recent_candidate_transitions.slice(-5).reverse():[];
  for(const item of events){
   const when=Number(item.time_ms||0);
   const date=Number.isFinite(when)&&when>0?new Date(when).toLocaleTimeString():'time unknown';
   ul.append(el('li','',date+' · '+(names[item.kind]||'Other AI candidate')));
  }
 }
 async function refresh(){
  if(!window.C720PSecureRelay?.fetch)return;
  try{
   const response=await window.C720PSecureRelay.fetch('/new/api/live-person-watch',{cache:'no-store'});
   if(!response.ok)throw Error('Live sensor route unavailable');
   show(await response.json());
  }catch(_){show({status:{kind:'sensor_unavailable'}});}
 }
 const observer=new MutationObserver(()=>{if(!document.getElementById(id)&&root())create();});
 if(root())observer.observe(root(),{childList:true});
 window.addEventListener('pageshow',refresh);
 setInterval(()=>{if(!document.hidden)refresh()},6500);
 setTimeout(refresh,1500);
})();
</script>
'''
def patch_text(html):
 if MARKER in html and 'id="s9-live-person-watch-script-v1"' in html:return html
 if html.count('</body>')!=1 or 'c720p-s9-phone-clips-ui-v1' not in html:
  raise ValueError("unknown_security_html_layout")
 return html.replace('</body>',SNIPPET+'\n</body>',1)

if __name__=="__main__":
 import argparse
 parser=argparse.ArgumentParser();parser.add_argument('path',type=Path)
 p=parser.parse_args().path
 old=p.read_text();new=patch_text(old)
 if new!=old:
  temp=p.with_suffix('.html.live-person-stage')
  temp.write_text(new);os.chmod(temp,p.stat().st_mode&0o777);os.replace(temp,p)
  print('S9_LIVE_PERSON_UI_ADDED')
 else:print('S9_LIVE_PERSON_UI_ALREADY_PRESENT')
