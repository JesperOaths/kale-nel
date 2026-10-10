#!/usr/bin/env python3
"""Repair nested authenticated S9 gallery and provide a unified Security overview.

UI-only, does not change live recording, microSD files, Drive, or private APIs.
Uses the existing signed relay; video and MJPEG start only after user clicks.
"""
import importlib.util
from pathlib import Path
import re

MARKER='id="s9-native-unified-security-style-v1"'
SCRIPT='id="s9-native-unified-security-script-v1"'
ANON='s9-anonymous-clips-script-v1'
SNIPPET=r'''
<style id="s9-native-unified-security-style-v1">
#s9-native-overview{border:1px solid #557e96;border-radius:13px;padding:14px;margin:13px 0;background:#122b3b;color:#e7f7ff;line-height:1.45}
#s9-native-overview h3{font-size:18px;margin:0 0 8px}
#s9-native-overview p{font-size:12px;color:#c0d9e8;margin:7px 0}
#s9-native-overview .s9-hub-stats{display:grid;grid-template-columns:repeat(auto-fit,minmax(145px,1fr));gap:9px}
#s9-native-overview .s9-hub-metric{background:#213e51;border:1px solid #45677d;border-radius:10px;padding:11px;min-width:0}
#s9-native-overview .s9-hub-number{font-size:21px;font-weight:750;font-variant-numeric:tabular-nums}
#s9-native-overview .s9-hub-label{color:#bfd8e6;font-size:12px}
#s9-native-overview .s9-hub-row{display:flex;flex-wrap:wrap;gap:8px;margin:10px 0}
#s9-native-overview button{font:inherit;font-size:13px;background:#254d66;color:#eaf8ff;border:1px solid #83b5cb;border-radius:8px;padding:9px 11px;cursor:pointer}
#s9-native-overview button:focus-visible{outline:2px solid #c4fffa;outline-offset:2px}
#s9-native-overview .s9-hub-progress{height:10px;border-radius:8px;background:#1b4356;overflow:hidden;margin:7px 0}
#s9-native-overview .s9-hub-progress span{display:block;background:#62b4c9;height:100%;width:0}
#s9-native-overview details{border:1px solid #36596c;border-radius:10px;padding:10px;margin-top:8px}
#s9-native-overview summary{cursor:pointer;font-weight:650}
#s9-native-overview .s9-hub-stream{display:block;width:100%;max-height:64vh;object-fit:contain;background:#04090d;margin-top:9px}
#s9-native-overview .s9-hub-category{font-size:12px;color:#c1dce8;margin-top:7px;line-height:1.65}
</style>
<script id="s9-native-unified-security-script-v1">
(()=>{
'use strict';
const ID='s9-native-overview';
let saved=null,history=null,live=null,fetching=false;
const relay=()=>{
 if(window.C720PSecureRelay?.fetch)return window.C720PSecureRelay;
 try{
  if(window.parent!==window && window.parent.location.origin===location.origin &&
     window.parent.C720PSecureRelay?.fetch)return window.parent.C720PSecureRelay;
 }catch(_){}
 return null;
};
const node=(tag,text,cls)=>{
 const el=document.createElement(tag);
 if(text!==undefined)el.textContent=String(text);
 if(cls)el.className=cls;
 return el;
};
function create(){
 const root=document.getElementById('list');if(!root)return null;
 let p=document.getElementById(ID);if(p)return p;
 p=node('section');p.id=ID;
 p.append(node('h3','S9+ native security · live, recordings & analytics'));
 p.append(node('p','Native Camera2, local microSD playback and on-device GPU/CPU detection. All object labels and percentages are unverified model evidence; temporary Person IDs are valid only within their own video.'));
 const grid=node('div',undefined,'s9-hub-stats');
 for(const [id,label] of [['clips','microSD recordings'],['people','Clips with person candidates'],['gpu','S9+ classifier'],['drive','Historical Drive classified']]){
  const tile=node('div',undefined,'s9-hub-metric');tile.append(node('div','—','s9-hub-number'),node('div',label,'s9-hub-label'));tile.dataset.metric=id;grid.append(tile);
 }
 p.append(grid);
 const progress=node('div',undefined,'s9-hub-progress');progress.append(node('span'));p.append(progress);
 const breakdown=node('p','Loading category summaries…','s9-hub-category');p.append(breakdown);
 const actions=node('div',undefined,'s9-hub-row');
 function action(text,fn){const b=node('button',text);b.type='button';b.addEventListener('click',fn);actions.append(b);}
 action('Browse all S9+ clips',()=>{
  const el=document.getElementById('s9-anonymous-clips-v1');
  if(el){const details=el.querySelector('details');if(details)details.open=true;
   const select=el.querySelector('select');if(select){select.value='all';select.dispatchEvent(new Event('change'));}
   el.scrollIntoView({behavior:'smooth',block:'start'});}
 });
 action('Person recordings',()=>{
  const el=document.getElementById('s9-anonymous-clips-v1');
  if(el){const d=el.querySelector('details');if(d)d.open=true;
   const s=el.querySelector('select');if(s){s.value='people';s.dispatchEvent(new Event('change'));}
   el.scrollIntoView({behavior:'smooth',block:'start'});}
 });
 action('Review historical Drive clips',()=>{
  const el=document.getElementById('s9-drive-person-review');
  if(el){const d=el.querySelector('details');if(d)d.open=true;
   el.scrollIntoView({behavior:'smooth',block:'start'});}
 });
 p.append(actions);
 const details=node('details');details.id='s9-on-demand-native-live';
 details.append(node('summary','Show native S9+ live camera (starts only when opened)'));
 const hint=node('p','Live camera from authenticated C720P relay. Closing this section stops the browser stream.');details.append(hint);
 const img=node('img');img.className='s9-hub-stream';img.alt='Live view from S9+ native Camera2 app';img.loading='lazy';details.append(img);
 const msg=node('p','Live stream is off until requested.');details.append(msg);
 let seq=0;
 function stop(){seq++;img.removeAttribute('src');msg.textContent='Live view paused.';}
 details.addEventListener('toggle',async()=>{
  const index=++seq;
  if(!details.open){stop();return;}
  msg.textContent='Authorizing the native live stream…';
  try{
   const client=relay();if(!client?.url)throw Error('Signed relay unavailable');
   const url=await client.url('/new/live.mjpg');
   if(seq!==index||!details.open||document.hidden)return;
   img.src=url;msg.textContent='Native S9+ stream requested.';
  }catch(_){msg.textContent='Could not authorize live view. Recording remains independent.';}
 });
 img.addEventListener('error',()=>{msg.textContent='Live stream unavailable. Saved footage remains accessible.';});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){details.open=false;stop();}});
 window.addEventListener('pagehide',stop);
 p.append(details);
 const note=node('p','Confidence percentages are detector scores, NOT calibrated accuracy or proof of a person. Clothes can look similar across different people. Stored videos remain on the S9+; historical Drive playback stays in the separate verified archive.');p.append(note);
 root.prepend(p);return p;
}
function metric(root,id,value){
 const tile=root.querySelector('[data-metric="'+id+'"] .s9-hub-number');
 if(tile)tile.textContent=String(value);
}
function render(){
 const p=create();if(!p)return;
 if(saved?.events){
  const events=saved.events.filter(e=>/^motion_[0-9]{13}[.]mp4$/.test(String(e.clip_no||'')));
  const group=k=>events.filter(e=>e.scene_category===k).length;
  const a=group('one_person'),b=group('multiple_people');
  const vehicle=events.filter(e=>(e.content_categories||[]).includes('vehicle')).length;
  const animal=events.filter(e=>(e.content_categories||[]).includes('animal')).length;
  metric(p,'clips',events.length);
  metric(p,'people',(a+b)+' / '+events.length);
  p.querySelector('.s9-hub-category').textContent=
   'Clip categories: one-person '+a+' · multiple-people '+b+
   ' · vehicle tag '+vehicle+' · animal tag '+animal+
   ' · other motion '+group('motion_other')+' · unreviewed '+group('unreviewed')+
   '. Categories can overlap; person counts mean concurrent detections, not unique visitors.';
 }
 if(live){
  const status=live.status||{};
  metric(p,'gpu',live.ok?'Active · '+String(live.camera_mode||'watching'):'Sensor stale');
  if(live.ok&&Number.isFinite(Number(status.person_score)))
   p.querySelector('.s9-hub-category').textContent+=' Live person score '+Math.round(Number(status.person_score)*100)+'% (uncalibrated).';
 }
 if(history){
  const summary=history.summary||{};
  const n=Number(summary.processed||history.processed||0);
  const total=Number(summary.eligible||0);
  metric(p,'drive',n+' / '+total);
  const percent=total>0?Math.max(0,Math.min(100,100*n/total)):0;
  p.querySelector('.s9-hub-progress span').style.width=percent.toFixed(1)+'%';
 }
}
async function refresh(){
 if(fetching)return;
 const client=relay();
 if(!client?.fetch){
  const p=create();if(p)p.querySelector('.s9-hub-category').textContent=
    'Signed Home Assistant relay unavailable in this iframe. Live recorder is unaffected.';
  return;
 }
 fetching=true;
 const paths=['/new/api/saved','/new/api/drive-person-review','/new/api/live-person-watch'];
 const replies=await Promise.allSettled(paths.map(async path=>{
  const response=await client.fetch(path,{cache:'no-store'});
  if(!response.ok)throw Error('HTTP '+response.status);
  return response.json();
 }));
 if(replies[0].status==='fulfilled' && replies[0].value?.archive_mode==='S9-microSD-only')saved=replies[0].value;
 if(replies[1].status==='fulfilled' && replies[1].value?.scope==='verified_legacy_drive_clips_only')history=replies[1].value;
 if(replies[2].status==='fulfilled')live=replies[2].value;
 render();fetching=false;
}
const observer=new MutationObserver(()=>{if(document.getElementById('list')&&!document.getElementById(ID))create();});
if(document.getElementById('list'))observer.observe(document.getElementById('list'),{childList:true});
window.addEventListener('pageshow',refresh);
setTimeout(refresh,1700);
setInterval(()=>{if(!document.hidden)refresh();},30000);
})();
</script>
'''

def _load_anon(path):
 spec=importlib.util.spec_from_file_location("s9_native_nested_anon_patch",path)
 module=importlib.util.module_from_spec(spec)
 spec.loader.exec_module(module)
 result=re.findall(r'<script id="s9-anonymous-clips-script-v1">[\s\S]*?</script>',module.SNIPPET)
 if len(result)!=1:raise ValueError("missing_pinned_anonymous_script")
 return result[0]

def patch(html,anon_source=None):
 if html.count("</body>")!=1 or html.count('id="list"')!=1 or html.count('id="'+ANON+'"')!=1:
  raise ValueError("unrecognized_saved_clips_html")
 if '/local/c720p-secure-relay-client.js' not in html:
  raise ValueError("signed_relay_script_must_be_present")
 if bool(MARKER in html)!=bool(SCRIPT in html):
  raise ValueError("partial_integrated_security_widget")
 if anon_source is None:anon_source=Path(__file__).with_name("patch-anonymous-tracks-ui.py")
 expected=_load_anon(Path(anon_source))
 old=re.findall(r'<script id="s9-anonymous-clips-script-v1">[\s\S]*?</script>',html)
 if len(old)!=1:raise ValueError("unexpected_anonymous_script")
 html=html.replace(old[0],expected,1)
 if MARKER not in html:
  html=html.replace("</body>",SNIPPET+"\n</body>",1)
 return html
