#!/usr/bin/env python3
"""Security V6: quiet, image-first UI, no camera or media changes."""
from pathlib import Path
import argparse, hashlib, json, os, re, shutil, tempfile
from datetime import datetime, timezone

BASE=Path("/opt/homeassistant/config/www")
BACKUP=Path("/home/jespern/c720p-home-hub/backups/security-v6")
TARGETS={
 "security":"c720p-surveillance.html",
 "recordings":"frontyard-security-new/clips.html",
 "faces":"frontyard-security-new/face-appearances.html",
 "archive":"c720p-drive-saved.html",
}
STYLE={
"security":r"""
<style id="s9v6-security-style">
#s9v5-shell{grid-template-columns:178px minmax(0,1fr)!important;background:#0c121a!important;font:14px/1.45 system-ui,sans-serif!important}
#s9v5-side{background:#101923!important;border-right:1px solid #263442!important;padding:23px 12px!important}
.s9v5-brand{padding:2px 8px 25px!important;gap:8px!important}
.s9v5-brand-logo{width:29px!important;height:29px!important;border-radius:9px!important;font-size:15px!important;box-shadow:none!important;background:#8cddd0!important}
.s9v5-brand-word{font-size:11px!important;letter-spacing:.09em!important}
.s9v5-brand-word small,.s9v5-kicker,.s9v5-nav-sub,.s9v5-side-bottom p{display:none!important}
#s9v5-nav{gap:4px!important}
#s9v5-nav button{min-height:46px!important;padding:10px!important;border-radius:10px!important;font-weight:600!important;gap:10px!important}
#s9v5-nav button[aria-current=page]{box-shadow:none!important;background:#223d43!important;border-color:#31595e!important}
#s9v5-nav .s9v5-nav-icon{font-size:17px!important;width:19px!important}
#s9v5-shell .s9v5-main{background:#0e151e!important}
#s9v5-shell .s9v5-top{min-height:62px!important;padding:14px 26px!important;background:#0e151e!important}
#s9v5-title{font-size:23px!important;letter-spacing:-.025em!important}
.s9v5-eyebrow,#s9v5-subtitle,#s9v5-clock{display:none!important}
#s9v5-shell .s9v5-badge{border:none!important;background:transparent!important;font-size:11px!important;color:#9bb1bb!important}
#s9v5-shell .s9v5-btn{border-color:#30414e!important;background:#17242f!important;padding:7px 10px!important;min-height:32px!important;font-size:11px!important}
#s9v5-overview,#s9v5-nav button[data-view="overview"]{display:none!important}
#s9v5-shell #panel-live .c720p-s9-live-only{padding:28px!important;gap:20px!important}
#s9v5-shell .s9v5-rail-card{background:#121f2a!important;box-shadow:none!important}
@media(max-width:850px){
 #s9v5-shell{grid-template-columns:66px minmax(0,1fr)!important}
 .s9v5-brand-word,.s9v5-side-bottom,.s9v5-nav-label{display:none!important}
 #s9v5-nav button{justify-content:center!important}
}
@media(max-width:600px){
 #s9v5-shell{grid-template-columns:1fr!important;grid-template-rows:minmax(0,1fr) 66px!important}
 #s9v5-side{grid-row:2!important;grid-column:1!important;padding:5px!important;flex-direction:row!important;border-right:none!important;border-top:1px solid #263442!important}
 .s9v5-brand{display:none!important}
 #s9v5-nav{flex-direction:row!important;justify-content:space-around!important;width:100%!important}
 #s9v5-nav button{flex:1!important;min-height:53px!important;flex-direction:column!important;gap:1px!important;font-size:10px!important}
 #s9v5-nav .s9v5-nav-label{display:block!important;font-size:10px!important}
 .s9v5-main{grid-row:1!important;grid-column:1!important}
 #s9v5-shell .s9v5-top{min-height:54px!important;padding:9px 14px!important}
 #s9v5-shell #panel-live .c720p-s9-live-only{padding:12px!important}
}
</style>""",
"recordings":r"""
<style id="s9v6-recordings-style">
html:has(#s9v6-recording-note),body:has(#s9v6-recording-note){background:#0e151e!important}
#s9v5-browser{background:#0e151e!important}
#s9v5-browser .s9v5-browser-head{padding:12px 22px!important;min-height:61px!important;background:#0e151e!important}
#s9v5-browser .s9v5-browser-kicker,#s9v5-browser .s9v5-browser-caption,#s9v5-browser .s9v5-browser-pill,#s9v5-browser .s9v5-browser-foot{display:none!important}
#s9v5-browser h1{font-size:18px!important;font-weight:730!important;margin:0!important}
#s9v5-browser #s9-compact-layout{grid-template-columns:minmax(0,1fr)!important;grid-template-rows:192px minmax(0,1fr)!important;gap:14px!important;padding:14px 22px 21px!important}
#s9v5-browser #s9-compact-layout .s9-playback-pane,#s9v5-browser #s9-compact-layout .s9-selector-pane{background:#121e2a!important;border:1px solid #263947!important;box-shadow:none!important;border-radius:14px!important}
#s9v5-browser #s9-compact-layout .s9-playback-pane{height:192px!important;min-height:0!important;padding:13px 18px!important;overflow:auto!important;display:flex!important;align-items:center!important;gap:18px!important}
#s9v5-browser .s9-rotation-shell{width:260px!important;min-width:260px!important;max-width:260px!important}
#s9v5-browser #player,#s9v5-browser .s9-rotation-stage{width:260px!important;max-width:260px!important;max-height:150px!important;height:auto!important;object-fit:contain!important}
#s9v5-browser #s9-compact-layout .s9-selector-pane{min-height:0!important;overflow:hidden!important;padding:19px 23px!important}
#s9v5-browser #list{overflow:auto!important;max-height:none!important;padding-right:8px!important}
#s9v5-browser #s9-date-folders .s9-v4-cards{grid-template-columns:repeat(auto-fill,minmax(min(100%,325px),1fr))!important;gap:14px!important}
#s9v5-browser #s9-date-folders .s9-v4-clip{min-height:126px!important;padding:9px!important;background:#182837!important;box-shadow:none!important;border:1px solid #324554!important}
#s9v5-browser #s9-date-folders .s9-v4-photo{flex-basis:170px!important;min-width:170px!important;height:106px!important;overflow:hidden!important}
#s9v5-browser #s9-date-folders .s9-v4-photo img{width:100%!important;height:100%!important;object-fit:cover!important}
#s9v5-browser #s9-date-folders .s9-v4-legend{background:transparent!important;border:none!important;padding:7px 0!important;gap:8px 18px!important}
#s9v5-browser #s9-date-folders .s9-v4-count,#s9v5-browser #s9-detector-version-guide{display:none!important}
#s9v5-browser #s9-date-folders .s9-v4-date{background:#172532!important;min-width:114px!important}
#s9v5-browser #s9-date-folders .s9-v4-toolbar{margin:0 0 14px!important}
#s9v5-browser .s9-pane-heading{font-size:12px!important;padding:0 0 6px!important;margin:0 0 8px!important}
@media(max-width:720px){
 #s9v5-browser #s9-compact-layout{grid-template-rows:165px minmax(320px,1fr)!important;overflow:hidden!important;padding:9px!important}
 #s9v5-browser #s9-compact-layout .s9-playback-pane{height:165px!important;padding:8px!important;gap:9px!important}
 #s9v5-browser .s9-rotation-shell,#s9v5-browser #player,#s9v5-browser .s9-rotation-stage{width:170px!important;min-width:170px!important;max-width:170px!important;max-height:125px!important}
 #s9v5-browser #s9-compact-layout .s9-selector-pane{padding:12px!important}
 #s9v5-browser #s9-date-folders .s9-v4-photo{min-width:125px!important;flex-basis:125px!important;height:86px!important}
 #s9v5-browser #s9-date-folders .s9-v4-clip{min-height:105px!important}
}
</style>""",
"faces":r"""
<style id="s9v6-faces-style">
html,body{background:#0e151e!important}
body{overflow:hidden!important}
#s9v6-people,#s9v6-people *{box-sizing:border-box}
#s9v6-people{position:fixed;inset:0;z-index:9999;background:#0e151e;color:#eff5f8;overflow:auto;padding:30px 34px 60px;font:13px/1.4 system-ui,sans-serif}
#s9v6-people header{display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:25px}
#s9v6-people h1{font-size:22px!important;font-weight:760;margin:0!important}
#s9v6-people .quiet{color:#93a8b5;font-size:12px}
#s9v6-people .faces-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(170px,100%),1fr));gap:22px}
#s9v6-people .face-tile{border:0;background:transparent;color:#eaf3f8;padding:0;cursor:pointer;text-align:left;min-width:0}
#s9v6-people .face-photo{display:flex;align-items:center;justify-content:center;aspect-ratio:1;background:#182632;border:1px solid #344957;border-radius:15px;overflow:hidden;position:relative}
#s9v6-people .face-tile:hover .face-photo{border-color:#83c5ba}
#s9v6-people .face-photo img{width:100%;height:100%;object-fit:cover}
#s9v6-people .face-photo .figure{color:#8195a3;font-size:65px;font-weight:200}
#s9v6-people .face-label{display:block;padding-top:9px;font-size:13px;font-weight:650}
#s9v6-people .face-meta{display:block;padding-top:2px;color:#95aab6;font-size:11px}
#s9v6-people dialog{position:fixed;inset:5vh 7vw;width:auto;max-width:940px;max-height:90vh;overflow:auto;margin:auto;padding:24px;background:#111e2b;color:#f5f9fc;border:1px solid #3e5563;border-radius:16px}
#s9v6-people dialog::backdrop{background:#030a12d9}
#s9v6-people .modal-head{display:flex;align-items:center;justify-content:space-between;margin:0 0 14px}
#s9v6-people dialog h2{font-size:19px;margin:0}
#s9v6-people .dismiss{border:1px solid #3d5666;background:#1b303f;color:white;padding:7px 12px;border-radius:9px;cursor:pointer}
#s9v6-people video{display:block;max-height:260px;width:100%;background:#060a0e;margin:0 0 15px}
#s9v6-people .clip-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(165px,1fr));gap:12px}
#s9v6-people .clip-item{background:#1a2b38;border:1px solid #344957;border-radius:11px;padding:6px;color:#eff7fb;cursor:pointer;text-align:left}
#s9v6-people .clip-item img{display:block;aspect-ratio:16/10;width:100%;object-fit:cover;background:#243443;border-radius:7px}
#s9v6-people .clip-item span{display:block;padding:6px}
@media(max-width:650px){#s9v6-people{padding:16px 14px 90px}#s9v6-people .faces-grid{grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}#s9v6-people dialog{inset:3vh 3vw;padding:12px}}
</style>""",
"archive":r"""
<style id="s9v6-archive-style">
body{background:#0e151e!important}
#s9v6-archive,#s9v6-archive *{box-sizing:border-box}
#s9v6-archive{position:fixed;inset:0;z-index:9999;overflow:auto;background:#0e151e;color:#f0f6fa;padding:28px 35px 75px;font:13px/1.45 system-ui,sans-serif}
#s9v6-archive h1{font-size:22px!important;font-weight:760;margin:0 0 25px!important}
#s9v6-archive details{background:#121f2a;border:1px solid #293b48;border-radius:13px;margin:0 0 12px;overflow:hidden}
#s9v6-archive summary{padding:18px 21px;cursor:pointer;display:flex;align-items:center;justify-content:space-between;font-size:14px;font-weight:700;list-style:none}
#s9v6-archive summary::-webkit-details-marker{display:none}
#s9v6-archive summary .count{color:#8ca8b7;font-weight:500;margin:0}
#s9v6-archive summary:after{content:"⌄";margin-left:15px;color:#91b0bd;font-size:20px}
#s9v6-archive details[open] summary:after{transform:rotate(180deg)}
#s9v6-archive details[open] summary{border-bottom:1px solid #293b48}
#s9v6-archive .day-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(min(230px,100%),1fr));gap:14px;padding:19px}
#s9v6-archive .item{background:#192a38;border:1px solid #334653;border-left:4px solid var(--event-color,#73838d);border-radius:10px;color:#ecf5f9;padding:7px;text-align:left;cursor:pointer;min-width:0}
#s9v6-archive .item img{width:100%;aspect-ratio:16/9;object-fit:cover;display:block;background:#233544;border-radius:6px}
#s9v6-archive .item b{display:block;font-size:12px;padding:7px 4px 2px}
#s9v6-archive .item small{display:block;color:#9cb1bf;padding:0 4px 4px}
#s9v6-archive dialog{inset:8vh 10vw;max-width:680px;width:auto;margin:auto;background:#101d29;color:#f5fafc;padding:15px;border:1px solid #3c5360;border-radius:14px}
#s9v6-archive dialog::backdrop{background:#03080cd9}
#s9v6-archive video{display:block;width:100%;max-height:50vh;background:black;border-radius:8px}
#s9v6-archive .actions{display:flex;justify-content:space-between;align-items:center;margin:0 0 9px}
#s9v6-archive button{font:inherit;cursor:pointer}
#s9v6-archive .close{background:#243a47;color:white;border:1px solid #476272;border-radius:7px;padding:6px 12px}
@media(max-width:650px){#s9v6-archive{padding:18px 13px 90px}#s9v6-archive summary{padding:15px}#s9v6-archive .day-grid{grid-template-columns:repeat(2,minmax(0,1fr));padding:10px;gap:9px}#s9v6-archive dialog{inset:5vh 3vw}}
</style>"""
}

SCRIPTS={
"security":r"""
<script id="s9v6-security-script">
(()=>{'use strict';
const start=()=>{const shell=document.getElementById('s9v5-shell');if(!shell)return false;
const overview=shell.querySelector('#s9v5-overview');if(overview)overview.hidden=true;
const nav=shell.querySelector('#s9v5-nav button[data-view="overview"]');if(nav)nav.remove();
const logo=shell.querySelector('.s9v5-brand-word');if(logo)logo.firstChild.textContent='SECURITY';
const live=shell.querySelector('#s9v5-nav button[data-view="live"]');
if(shell.dataset.view==='overview'&&live)live.click();
return true;};
if(!start()){let tries=0;const t=setInterval(()=>{tries++;if(start()||tries>80)clearInterval(t);},125);}
})();
</script>""",
"recordings":r"""
<script id="s9v6-recordings-script">
(()=>{'use strict';
function init(){const root=document.getElementById('s9v5-browser');if(!root)return false;
if(root.querySelector('#s9v6-recording-note'))return true;
const e=document.createElement('span');e.id='s9v6-recording-note';e.textContent='S9+ · microSD';
e.style.cssText='color:#93aab8;font-size:11px';const head=root.querySelector('.s9v5-browser-head');
if(head)head.append(e);return true;}
if(!init()){let n=0;const t=setInterval(()=>{if(init()||++n>70)clearInterval(t)},130);}
})();
</script>""",
"faces":r"""
<script id="s9v6-faces-script">
(()=>{'use strict';
if(document.getElementById('s9v6-people'))return;
const safe=/^motion_[0-9]{13}[.]mp4$/;
const crop=/^motion_[0-9]{13}__[A-Za-z0-9_-]{1,65}__[0-9]{1,9}_[0-2][.]jpg$/;
const $=(t,c,s)=>{const el=document.createElement(t);if(c)el.className=c;if(s!==undefined)el.textContent=String(s);return el;};
const root=$('main');root.id='s9v6-people';
const head=$('header'),title=$('h1','','People & faces'),status=$('span','quiet','');
head.append(title,status);root.append(head);
const grid=$('div','faces-grid');root.append(grid);
const dlg=$('dialog'),bar=$('div','modal-head'),name=$('h2'),close=$('button','dismiss','Close');
close.type='button';close.onclick=()=>dlg.close();bar.append(name,close);
const video=$('video');video.controls=true;video.playsInline=true;video.preload='metadata';
const clips=$('div','clip-grid');dlg.append(bar,video,clips);root.append(dlg);
dlg.addEventListener('close',()=>{video.pause();video.removeAttribute('src');video.load();});
document.body.append(root);
const relay=()=>window.C720PSecureRelay || (window.parent!==window?window.parent.C720PSecureRelay:null);
const date=r=>{const n=Number(String(r.clip_no||'').slice(7,20));return new Date(n).toLocaleString('en-GB',{timeZone:'Europe/Amsterdam',month:'short',day:'numeric',hour:'2-digit',minute:'2-digit'});};
async function signedImage(img,path){try{const api=relay();if(api?.url&&img.isConnected)img.src=await api.url(path);}catch(_){}}
async function play(r){try{const api=relay();if(api?.url){video.src=await api.url('/new/saved/clip/'+encodeURIComponent(r.clip_no));video.load();video.play().catch(()=>{});}}catch(_){}}
function thumbnail(container,r,face){
 const p=$('div','face-photo');container.append(p);
 const imageName=face?.snapshot_name;
 const img=$('img');img.loading='lazy';img.decoding='async';
 if(imageName&&crop.test(imageName)&&imageName.startsWith(r.clip_no.slice(0,-4)+'__')){
  p.append(img);signedImage(img,'/new/saved/face/'+imageName);
 }else if(r.snapshot_name&&/^motion_[0-9]{13}[.]mp4[.]thumb[.]jpg$/.test(r.snapshot_name)){
  p.append(img);signedImage(img,'/new/saved/snap/'+r.snapshot_name);
 }else p.append($('span','figure','◯'));
}
function renderGroup(key,label,arr,face){
 const tile=$('button','face-tile');tile.type='button';
 thumbnail(tile,arr[0],face);
 tile.append($('span','face-label',label),$('span','face-meta',arr.length+' '+(arr.length===1?'clip':'clips')));
 tile.onclick=()=>{name.textContent=label;clips.replaceChildren();video.pause();video.removeAttribute('src');video.load();
  for(const r of arr){const b=$('button','clip-item');b.type='button';
   const im=$('img');im.loading='lazy';im.alt='Recording thumbnail';b.append(im);
   if(r.snapshot_name&&/^motion_[0-9]{13}[.]mp4[.]thumb[.]jpg$/.test(r.snapshot_name))
     signedImage(im,'/new/saved/snap/'+r.snapshot_name);
   b.append($('span','',date(r)));b.onclick=()=>play(r);clips.append(b);}
  dlg.showModal();};
 grid.append(tile);
}
async function load(){
 try{const api=relay();if(!api?.fetch)throw Error('relay');
  const resp=await api.fetch('/new/api/saved',{cache:'no-store'});
  if(!resp.ok)throw Error('offline');
  const data=await resp.json();if(!Array.isArray(data.events))throw Error('index');
  const people=new Map(),anonymous=[],noFace=[];
  for(const rec of data.events){
   if(!safe.test(String(rec.clip_no||'')))continue;
   const faces=Array.isArray(rec.face_candidates)?rec.face_candidates.filter(f=>crop.test(String(f.snapshot_name||''))):[];
   if(!faces.length){if(Number(rec.person_count)>0)noFace.push(rec);continue;}
   let anyNamed=false;
   for(const f of faces){
    const candidate=String(f.candidate_name||'').trim();
    const usable=candidate&&candidate.length<55&&!/anonymous|unknown|unrecogn|unidentified|person [0-9]|candidate$/i.test(candidate);
    if(usable){anyNamed=true;const key=candidate.toLocaleLowerCase();
     if(!people.has(key))people.set(key,{label:'Possible · '+candidate,rows:[],face:f});
     const group=people.get(key);if(!group.rows.some(x=>x.clip_no===rec.clip_no))group.rows.push(rec);
    }
   }
   if(!anyNamed)anonymous.push({rec,face:faces[0]});
  }
  grid.replaceChildren();
  for(const [key,g] of [...people.entries()].sort((a,b)=>b[1].rows.length-a[1].rows.length))
   renderGroup(key,g.label,g.rows,g.face);
  // Do not merge anonymous faces into a fictitious cross-video identity.
  let i=0;
  for(const item of anonymous){i++;renderGroup('anon'+i,'Unidentified '+String(i).padStart(2,'0'),[item.rec],item.face);}
  if(noFace.length)renderGroup('no-face','No face captured',noFace,null);
  if(!grid.children.length)grid.append($('p','quiet','No face images yet'));
  status.textContent=people.size+anonymous.length+' faces · '+noFace.length+' without face';
 }catch(_){status.textContent='Archive unavailable';grid.replaceChildren($('p','quiet','Unable to open recordings'));}
}
load();
})();
</script>""",
"archive":r"""
<script id="s9v6-archive-script">
(()=>{'use strict';
if(document.getElementById('s9v6-archive'))return;
const safe=/^(?:(?:motion|native4k)_[0-9]{13}|rec_[0-9]{4}-[0-9]{2}-[0-9]{2}_[0-9]{2}-[0-9]{2})[.]mp4$/;
const m=tag=>document.createElement(tag);
const root=m('main');root.id='s9v6-archive';
const h=m('h1');h.textContent='Archive';root.append(h);
const rows=m('div');root.append(rows);
const dlg=m('dialog'),bar=m('div');bar.className='actions';
const title=m('strong'),close=m('button');close.className='close';close.textContent='Close';close.onclick=()=>dlg.close();
bar.append(title,close);const video=m('video');video.controls=true;video.playsInline=true;video.preload='metadata';
dlg.append(bar,video);root.append(dlg);dlg.addEventListener('close',()=>{video.pause();video.removeAttribute('src');video.load();});
document.body.append(root);
const api=()=>window.C720PSecureRelay || (window.parent!==window?window.parent.C720PSecureRelay:null);
const name=r=>String(r.clip_no||r.remote_name||r.name||'');
const dateOf=r=>{const n=name(r),stamp=/^(?:motion|native4k)_([0-9]{13})/.exec(n);
 if(stamp)return new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Amsterdam',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(Number(stamp[1])));
 const old=/^rec_([0-9]{4}-[0-9]{2}-[0-9]{2})/.exec(n);return old?old[1]:'Unknown date';};
const timeOf=r=>{const x=name(r),match=/^(?:motion|native4k)_([0-9]{13})/.exec(x);if(match)return new Date(Number(match[1])).toLocaleTimeString('nl-NL',{timeZone:'Europe/Amsterdam',hour:'2-digit',minute:'2-digit'});return x;};
function category(r){const c=String(r.person_event_category||r.scene_category||'').toLowerCase();
 if(c.includes('person')||Number(r.person_count)>0)return ['#6da995','Person'];
 if(c.includes('vehicle'))return ['#709cc4','Vehicle'];
 if(c.includes('animal'))return ['#ad91c2','Animal'];
 return ['#586f7e','Motion'];}
async function picture(img,n){try{const a=api();if(a?.url)img.src=await a.url('/new/saved/snap/'+n+'.thumb.jpg')}catch(_){}}
async function play(r){const n=name(r);try{const a=api();if(!a?.url)return;
 video.src=await a.url('/new/saved/clip/'+encodeURIComponent(n));video.load();
 title.textContent=dateOf(r)+' · '+timeOf(r);dlg.showModal();}catch(_){}}
function buildDay(day,data,expanded){
 const details=m('details');details.open=expanded;
 const sum=m('summary');const date=m('span');date.textContent=day;
 const amount=m('span');amount.className='count';amount.textContent=data.length+' recordings';
 sum.append(date,amount);details.append(sum);
 const grid=m('div');grid.className='day-grid';details.append(grid);
 let drawn=false;
 const draw=()=>{if(drawn)return;drawn=true;
  for(const r of data){
   const btn=m('button');btn.type='button';btn.className='item';
   const c=category(r);btn.style.setProperty('--event-color',c[0]);
   const img=m('img');img.alt='Clip preview';img.loading='lazy';btn.append(img);
   if(/^(motion|native4k)_[0-9]{13}[.]mp4$/.test(name(r)))picture(img,name(r));
   const t=m('b');t.textContent=timeOf(r);btn.append(t);
   const info=m('small');info.textContent=c[1];btn.append(info);btn.onclick=()=>play(r);grid.append(btn);
  }};
 if(expanded)draw();
 details.addEventListener('toggle',()=>{if(details.open)draw()});return details;
}
async function load(){try{
 const a=api();if(!a?.fetch)throw Error('relay unavailable');
 const response=await a.fetch('/new/api/saved',{cache:'no-store'});
 if(!response.ok)throw Error('recordings unavailable');
 const json=await response.json();if(!Array.isArray(json.events))throw Error('empty index');
 const groups=new Map();
 for(const r of json.events){if(!safe.test(name(r)))continue;const day=dateOf(r);
  if(!groups.has(day))groups.set(day,[]);groups.get(day).push(r);}
 rows.replaceChildren();
 const days=[...groups.keys()].sort((a,b)=>b.localeCompare(a));
 for(const [i,day] of days.entries())rows.append(buildDay(day,groups.get(day),i===0));
 if(!days.length)rows.textContent='No recordings';
 }catch(_){rows.textContent='Archive unavailable';}}
load();
})();
</script>"""
}

REQUIRED={
 "security":('id="s9v5-shell"','id="panel-live"','id="panel-saved"'), # shell is dynamically created: check script anchor instead
 "recordings":('id="player"','id="list"','id="s9v5-browser-script"'),
 "faces":('id="gallery"','id="playerDialog"','C720PSecureRelay'),
 "archive":('C720PSecureRelay','/api/saved'),
}
REQUIRED["security"]=('id="s9v5-command-script"','id="panel-live"','id="panel-saved"')

def upgrade(original,kind):
 if original.count("</head>")!=1 or original.count("</body>")!=1:raise ValueError("invalid_html_"+kind)
 for anchor in REQUIRED[kind]:
  if anchor not in original:raise ValueError("missing_"+kind+"_"+anchor)
 html=original
 for tag,identifier,code,closing in (("style","s9v6-"+kind+"-style",STYLE[kind],"</head>"),
                                     ("script","s9v6-"+kind+"-script",SCRIPTS[kind],"</body>")):
  marker='<'+tag+' id="'+identifier+'">'
  if marker in html:
   if html.count(marker)!=1:raise ValueError("duplicate_"+identifier)
   pattern=re.escape(marker)+r"(?s:.*?)</"+tag+">"
   html,n=re.subn(pattern,lambda _:code.strip(),html,count=1)
   if n!=1:raise ValueError("partial_"+identifier)
  else:html=html.replace(closing,code.strip()+"\n"+closing,1)
 return html

def build(root):
 result={}
 for kind,relative in TARGETS.items():
  target=root/relative
  if not target.is_file() or target.is_symlink():raise ValueError("unsafe_or_missing_"+kind)
  original=target.read_text(encoding="utf-8")
  if len(original)<800 or len(original)>2_000_000:raise ValueError("invalid_target_size_"+kind)
  newer=upgrade(original,kind)
  if upgrade(newer,kind)!=newer:raise AssertionError("not_idempotent_"+kind)
  result[target]=(original,newer)
 return result

def deploy(root=BASE,backup_root=BACKUP,apply=False):
 result=build(root)
 if not apply:
  return {"dry_run":True,"changes":{p.name:a!=b for p,(a,b) in result.items()}}
 if not any(a!=b for a,b in result.values()):return {"already_installed":True}
 folder=backup_root/datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%S%fZ")
 folder.mkdir(parents=True,exist_ok=False);os.chmod(folder,0o700)
 backups={};changed=[]
 try:
  for i,(target,(old,new)) in enumerate(result.items()):
   original=folder/("%d-%s"%(i,target.name))
   shutil.copy2(target,original);os.chmod(original,0o600);backups[target]=original
   if original.read_text(encoding="utf-8")!=old:raise RuntimeError("backup_failed")
  for target,(old,new) in result.items():
   if old==new:continue
   fd,name=tempfile.mkstemp(prefix=".security-v6-",suffix=".html",dir=target.parent)
   os.close(fd);stage=Path(name)
   try:
    stage.write_text(new,encoding="utf-8")
    st=target.stat();os.chmod(stage,st.st_mode&0o777)
    try:os.chown(stage,st.st_uid,st.st_gid)
    except PermissionError:pass
    os.replace(stage,target);changed.append(target)
   finally:stage.unlink(missing_ok=True)
  for target,(_,new) in result.items():
   if target.read_text(encoding="utf-8")!=new:raise RuntimeError("readback_failed")
 except BaseException:
  for target in reversed(changed):
   tmp=target.with_suffix(".restore-v6")
   shutil.copy2(backups[target],tmp);os.replace(tmp,target)
  raise
 return {"deployed":True,"backup":str(folder),"sha256":{str(p):hashlib.sha256(b.encode()).hexdigest() for p,(_,b) in result.items()},"media_modified":False,"apk_modified":False}

def main():
 parser=argparse.ArgumentParser()
 parser.add_argument("--root",type=Path,default=BASE)
 parser.add_argument("--backup-root",type=Path,default=BACKUP)
 parser.add_argument("--apply",action="store_true")
 args=parser.parse_args()
 print("SECURITY_V6",json.dumps(deploy(args.root,args.backup_root,args.apply),sort_keys=True),flush=True)

if __name__=="__main__":main()
