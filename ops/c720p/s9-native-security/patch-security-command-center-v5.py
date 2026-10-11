#!/usr/bin/env python3
"""Visual-only overhaul of existing C720P Security and S9 recordings pages.

Moves existing DOM nodes into a responsive shell; uses original tab handlers,
signed relay, and iframe assets. Does NOT mutate camera/app/media settings.
"""
import re

ROOT_STYLE='id="s9v5-command-style"'
ROOT_SCRIPT='id="s9v5-command-script"'
CLIPS_STYLE='id="s9v5-browser-style"'
CLIPS_SCRIPT='id="s9v5-browser-script"'

ROOT_CSS=r'''
<style id="s9v5-command-style">
:root{--v5-bg:#080e16;--v5-surface:#111c29;--v5-card:#152334;--v5-line:#29394b;--v5-border:#344a5d;--v5-ink:#f3f8fc;--v5-muted:#91a7ba;--v5-accent:#60e1cc}
#s9v5-shell,#s9v5-shell *{box-sizing:border-box}
#s9v5-shell{position:fixed;inset:0;z-index:2147480000;display:grid;grid-template-columns:224px minmax(0,1fr);background:#080e16;color:var(--v5-ink);font:14px/1.42 system-ui,-apple-system,"Segoe UI",sans-serif;overflow:hidden;isolation:isolate}
#s9v5-shell button{font:inherit;cursor:pointer;color:inherit}
#s9v5-shell button:focus-visible{outline:2px solid var(--v5-accent);outline-offset:3px}
#s9v5-side{display:flex;flex-direction:column;min-height:0;min-width:0;background:linear-gradient(160deg,#121d2a,#0c1420 65%);border-right:1px solid #2b3e50;padding:24px 13px 16px}
.s9v5-brand{display:flex;align-items:center;gap:11px;padding:4px 10px 31px}
.s9v5-brand-logo{width:42px;height:42px;flex:none;display:grid;place-items:center;color:#08171b;background:linear-gradient(135deg,#8cf8e0,#37adcf);border-radius:13px;font-weight:950;font-size:23px;box-shadow:0 5px 24px #51dece2a}
.s9v5-brand-word{font-weight:860;letter-spacing:.13em;font-size:16px}
.s9v5-brand-word small{display:block;color:#9bb1be;font-weight:550;font-size:9px;letter-spacing:.16em;margin-top:3px}
.s9v5-kicker{padding:0 11px;color:#7691a5;text-transform:uppercase;font-size:10px;letter-spacing:.17em;font-weight:800;margin-bottom:11px}
#s9v5-nav{display:flex;flex-direction:column;gap:5px;min-height:0}
#s9v5-nav button{border:1px solid transparent;border-radius:11px;display:flex;align-items:center;gap:13px;text-align:left;background:transparent;color:#a9becc;padding:13px 13px;font-weight:650;transition:background .15s,color .15s,border-color .15s;min-height:48px}
#s9v5-nav button:hover{background:#233347;color:#fff}
#s9v5-nav button[aria-current=page]{color:#effffa;background:linear-gradient(100deg,#1e4a50,#17383f 88%);border-color:#478c88;box-shadow:inset 3px 0 0 #75f2d1}
.s9v5-nav-icon{width:24px;flex:none;display:grid;place-items:center;font-size:19px;line-height:1}
.s9v5-nav-sub{display:block;font-weight:500;font-size:10px;color:#89a5ae;margin-top:1px}
.s9v5-nav-label{display:flex;flex-direction:column;min-width:0}
.s9v5-side-bottom{margin-top:auto;border-top:1px solid #2d4252;padding:18px 11px 2px;color:#94aabd;font-size:11px}
.s9v5-side-bottom strong{display:block;font-size:12px;color:#d9e6ef;margin-bottom:5px}
.s9v5-side-dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:7px;background:#6c7885}
.s9v5-side-dot[data-health=ok]{background:#5adab3;box-shadow:0 0 0 4px #5adab31d}
.s9v5-main{display:flex;flex-direction:column;min-width:0;min-height:0;overflow:hidden;background:radial-gradient(ellipse at 85% -16%,#173144 0,transparent 38%),#0a111b}
.s9v5-top{flex:none;display:flex;align-items:center;justify-content:space-between;gap:15px;min-height:84px;padding:17px 30px;border-bottom:1px solid #283b4d;background:#0f1925b8}
.s9v5-top-title{min-width:0}
.s9v5-eyebrow{color:#6cdec9;font-size:10px;letter-spacing:.19em;font-weight:800;text-transform:uppercase;margin:0 0 2px}
#s9v5-title{font-size:clamp(21px,2.4vw,29px);font-weight:820;letter-spacing:-.036em;line-height:1.1;margin:0}
#s9v5-subtitle{color:#9ab0c1;margin:4px 0 0;font-size:12px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:640px}
.s9v5-top-actions{display:flex;align-items:center;gap:11px;flex:none}
.s9v5-badge{padding:7px 11px;border:1px solid #385363;background:#142735;border-radius:999px;color:#c5d6e2;font-size:11px;font-weight:700;display:flex;align-items:center;gap:6px}
.s9v5-status{width:7px;height:7px;border-radius:50%;background:#7f94a4}
.s9v5-status[data-state=ok]{background:#69ecc6;box-shadow:0 0 0 4px #69ecc617}
#s9v5-clock{font-size:12px;color:#a5bac9;font-variant-numeric:tabular-nums;white-space:nowrap}
.s9v5-btn{display:inline-flex;align-items:center;justify-content:center;gap:8px;background:#193044;border:1px solid #3c6075;border-radius:10px;color:#ecf9ff;padding:9px 13px;min-height:36px;font-weight:700}
.s9v5-btn:hover{background:#25506a}
.s9v5-stage{flex:1;min-height:0;overflow:hidden;position:relative;padding:0}
#s9v5-shell .s9v5-stage>section.panel{min-height:0!important;max-height:100%!important;width:100%!important;height:100%!important;overflow:auto!important;border:none!important;box-shadow:none!important;margin:0!important;padding:0!important;background:transparent!important}
#s9v5-shell .s9v5-stage>section.panel[hidden]{display:none!important}
#s9v5-shell .s9v5-stage>section.panel:not(.s9v5-active){display:none!important}
#s9v5-shell .s9v5-stage>section.panel.s9v5-active{display:block!important}
#s9v5-shell #panel-saved.s9v5-active{overflow:hidden!important}
#s9v5-shell #panel-saved .s9-saved-subnav{display:none!important}
#s9v5-shell #panel-saved iframe,#s9v5-shell #panel-faces iframe{display:block;border:0;width:100%!important;height:100%!important;min-height:0!important;max-height:100%!important;background:#0a111a}
#s9v5-shell #panel-saved iframe.s9v5-frame-off{display:none!important}
#s9v5-shell #panel-faces.s9v5-active{overflow:hidden!important}
#s9v5-shell #panel-live.s9v5-active{overflow:auto!important}
#s9v5-shell #panel-live .c720p-s9-live-only{height:auto!important;min-height:0!important;max-width:1680px!important;margin:0 auto!important;padding:22px 26px!important;display:grid!important;grid-template-columns:minmax(0,1fr) minmax(230px,295px)!important;gap:18px!important;align-items:start!important;background:transparent!important}
#s9v5-shell #panel-live .s9v5-live-stage{min-width:0;padding:14px;border:1px solid #33495b;border-radius:18px;background:#0c1621;box-shadow:0 13px 50px #0006}
#s9v5-shell #panel-live .s9v5-live-stage-heading{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:2px 4px 12px;font-size:12px;color:#a9bacb;font-weight:700}
#s9v5-shell #panel-live .s9v5-live-stage-heading strong{color:#ecf5fa;font-size:13px}
#s9v5-shell #panel-live .s9v5-live-stage .cam{width:100%!important;max-width:100%!important;height:auto!important;max-height:min(69dvh,800px)!important;aspect-ratio:4/3!important;margin:0!important;overflow:hidden!important;border-radius:12px!important;background:#020508!important;position:relative!important;box-shadow:0 0 0 1px #395064}
#s9v5-shell #panel-live .s9v5-live-stage #cameraLive{width:100%!important;height:100%!important;max-height:69dvh!important;object-fit:contain!important;aspect-ratio:4/3!important;background:#020508!important}
#s9v5-shell #panel-live .s9v5-live-rail{display:flex;flex-direction:column;gap:12px;min-width:0;max-width:none!important;padding:0!important;background:transparent!important}
#s9v5-shell .s9v5-rail-card{border:1px solid #314858;background:linear-gradient(155deg,#172b3a,#101d2a);border-radius:15px;padding:16px;color:#deedf6;min-width:0;overflow-wrap:anywhere}
#s9v5-shell .s9v5-rail-card h3{margin:0 0 12px;font-weight:800;font-size:13px;color:#f4faff}
#s9v5-shell .s9v5-rail-card p{font-size:12px;color:#9fb7c7;line-height:1.5;margin:0 0 9px}
#s9v5-shell .s9v5-mini-value{font-size:19px;font-weight:800;letter-spacing:-.02em;color:#fafcff}
#s9v5-shell .s9v5-rail-card>.s9v5-readout{display:grid;gap:10px}
#s9v5-shell .s9v5-rail-card>.s9v5-readout>div{border-bottom:1px solid #304557;padding-bottom:7px;display:flex;justify-content:space-between;gap:5px;font-size:12px}
#s9v5-shell .s9v5-readout b{font-weight:700;color:#eff9ff}
#s9v5-shell #panel-live .s9v5-live-extras{padding:4px 0 0}
#s9v5-shell #panel-live .s9v5-live-extras>*{max-width:100%;margin:6px 0;font-size:12px}
#s9v5-overview{height:100%;overflow-y:auto;padding:clamp(18px,2vw,30px);max-width:1600px;margin:0 auto}
.s9v5-hero{position:relative;display:flex;flex-wrap:wrap;align-items:center;justify-content:space-between;gap:18px;overflow:hidden;padding:clamp(22px,3vw,38px);border:1px solid #386a70;background:radial-gradient(ellipse at 87% 5%,#266575 0,transparent 54%),linear-gradient(130deg,#152e38,#10202d 85%);border-radius:22px;min-height:205px;box-shadow:0 16px 50px #0004}
.s9v5-hero::after{content:"";position:absolute;right:-48px;top:-100px;width:340px;height:340px;border:1px solid #8ffde119;border-radius:50%;box-shadow:0 0 0 45px #8ffde110,0 0 0 95px #8ffde106;pointer-events:none}
.s9v5-hero>*{position:relative;z-index:1}
.s9v5-hero h2{font-size:clamp(25px,3.4vw,43px);font-weight:840;line-height:1.07;letter-spacing:-.05em;margin:6px 0 12px;max-width:610px}
.s9v5-hero p{max-width:550px;font-size:13px;color:#bdd1df;margin:0}
.s9v5-hero .s9v5-btn{font-size:13px;background:#8df3de;border-color:#8df3de;color:#082532;padding:12px 19px}
.s9v5-dashboard-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:14px;margin:18px 0}
.s9v5-metric{background:linear-gradient(160deg,#182939,#101c29);border:1px solid #30465a;border-radius:16px;padding:19px 18px;min-width:0}
.s9v5-metric-label{font-size:11px;color:#93adbd;font-weight:690;margin-bottom:12px}
.s9v5-metric-value{font-size:clamp(25px,3vw,35px);font-weight:850;line-height:1.1;letter-spacing:-.05em;font-variant-numeric:tabular-nums}
.s9v5-metric-meta{font-size:11px;color:#7fa3ae;margin-top:10px}
.s9v5-overview-panels{display:grid;grid-template-columns:minmax(0,1.35fr) minmax(270px,.75fr);gap:16px}
.s9v5-overview-panel{border:1px solid #314a5b;border-radius:17px;background:#121e2c;padding:21px}
.s9v5-overview-panel h3{font-size:17px;margin:0 0 8px;font-weight:800}
.s9v5-overview-panel p{font-size:12px;color:#99b0c1;margin:0 0 16px}
.s9v5-quick-links{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.s9v5-quick-links button{border:1px solid #335669;background:#1a3242;padding:16px;text-align:left;border-radius:11px;font-weight:760}
.s9v5-quick-links button:hover{border-color:#70c5cf;background:#244556}
.s9v5-quick-links small{display:block;font-size:11px;color:#a1b9c6;font-weight:500;margin-top:4px}
.s9v5-live-state{font-size:13px;line-height:1.7;color:#b8d0d9}
#s9v5-shell .s9v5-stage #panel-camera{padding:22px!important}
@media(max-width:1150px){
 #s9v5-shell{grid-template-columns:78px minmax(0,1fr)}
 #s9v5-side{padding:17px 8px}
 .s9v5-brand{padding:4px 6px 26px;justify-content:center}
 .s9v5-brand-word,.s9v5-kicker,.s9v5-nav-label,.s9v5-side-bottom{display:none}
 #s9v5-nav button{justify-content:center;padding:12px 7px}
 #s9v5-nav button[aria-current=page]{box-shadow:inset 2px 0 0 #75f2d1}
 #s9v5-shell #panel-live .c720p-s9-live-only{grid-template-columns:minmax(0,1fr) minmax(205px,250px)!important;padding:15px!important;gap:11px!important}
 .s9v5-dashboard-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@media(max-width:760px){
 #s9v5-shell{grid-template-columns:1fr;grid-template-rows:minmax(0,1fr) 72px}
 #s9v5-side{grid-row:2;grid-column:1;flex-direction:row;padding:6px 9px;border-right:0;border-top:1px solid #314456;overflow-x:auto}
 .s9v5-brand,.s9v5-kicker,.s9v5-side-bottom{display:none}
 #s9v5-nav{width:100%;display:flex;flex-direction:row;align-items:center;justify-content:space-around;gap:2px}
 #s9v5-nav button{display:flex;flex-direction:column;gap:2px;min-height:58px;padding:7px 4px;font-size:10px;flex:1}
 #s9v5-nav button[aria-current=page]{box-shadow:inset 0 -3px 0 #75f2d1}
 .s9v5-nav-label{display:flex;font-size:10px}
 .s9v5-nav-sub{display:none}
 .s9v5-nav-icon{font-size:18px;height:20px}
 .s9v5-main{grid-row:1;grid-column:1}
 .s9v5-top{min-height:70px;padding:12px 15px}
 #s9v5-subtitle,#s9v5-clock{display:none}
 .s9v5-top-actions{gap:6px}
 #s9v5-shell #panel-live .c720p-s9-live-only{grid-template-columns:minmax(0,1fr)!important}
 #s9v5-shell #panel-live .s9v5-live-stage .cam{max-height:53dvh!important}
 #s9v5-shell #panel-live .s9v5-live-stage #cameraLive{max-height:53dvh!important}
 #s9v5-shell #panel-live .s9v5-live-rail{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr))}
 .s9v5-hero{min-height:0}
 .s9v5-dashboard-grid{gap:8px}
 .s9v5-overview-panels{grid-template-columns:1fr}
}
@media(max-width:480px){
 #s9v5-shell #panel-live .c720p-s9-live-only{padding:8px!important}
 #s9v5-shell .s9v5-rail-card{padding:12px}
 #s9v5-title{font-size:20px}
 .s9v5-badge{padding:6px 7px;font-size:10px}
 .s9v5-top .s9v5-btn{display:none}
 .s9v5-overview-panel{padding:14px}
 .s9v5-quick-links{grid-template-columns:1fr}
}
@media(prefers-reduced-motion:reduce){#s9v5-shell *{transition:none!important;animation:none!important}}
</style>
'''
ROOT_JS=r'''
<script id="s9v5-command-script">
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const create=(tag,cls,txt)=>{const n=document.createElement(tag);if(cls)n.className=cls;if(txt!==undefined)n.textContent=txt;return n;};
const SCREENS=[
 ['overview','Overview','◈','Security at a glance','Health and recent activity'],
 ['live','Live camera','◉','Garden camera','On-device S9+ live view'],
 ['saved','Recordings','▣','Video library','Local microSD footage'],
 ['faces','People & faces','◎','Visual evidence','Anonymous appearance review'],
 ['archive','Archive','▤','Historical archive','Previously saved recordings'],
 ['camera','Camera settings','⚙','Camera controls','Existing diagnostics']
];
let mounted=false,current='overview',polling=false,lastData=null,legacy={};
const setText=(id,v)=>{const n=$(id);if(n)n.textContent=String(v);};
function prettyBytes(x){const n=Number(x);return Number.isFinite(n)&&n>0?(n/(1024*1024*1024)).toFixed(1)+' GB':'—';}
function mount(){
 if(mounted||$('s9v5-shell'))return;
 const panels=[...document.querySelectorAll('section.panel')].filter(p=>p.id&&/^panel-(camera|live|saved|faces)$/.test(p.id));
 if(!$('panel-live')||!$('panel-saved')||panels.length<2)return;
 const originalButtons=[...document.querySelectorAll('button[data-tab]')];
 for(const b of originalButtons)legacy[b.dataset.tab]=b;
 const shell=create('div');shell.id='s9v5-shell';shell.dataset.view='overview';shell.setAttribute('aria-label','Security command center');
 const side=create('aside');side.id='s9v5-side';
 const brand=create('div','s9v5-brand');brand.append(create('div','s9v5-brand-logo','◈'));
 const brandWord=create('div','s9v5-brand-word','SENTINEL');brandWord.append(create('small','','HOME SECURITY'));brand.append(brandWord);side.append(brand);
 side.append(create('div','s9v5-kicker','WORKSPACES'));
 const nav=create('nav');nav.id='s9v5-nav';nav.setAttribute('aria-label','Security destinations');
 for(const [id,label,icon,,subtitle]of SCREENS){
  if((id==='faces'&&!$('panel-faces'))||(id==='camera'&&!$('panel-camera')))continue;
  const btn=create('button');btn.type='button';btn.dataset.view=id;btn.setAttribute('aria-current',id==='overview'?'page':'false');
  btn.title=label;btn.append(create('span','s9v5-nav-icon',icon));
  const text=create('span','s9v5-nav-label',label);text.append(create('small','s9v5-nav-sub',subtitle));btn.append(text);
  btn.addEventListener('click',()=>activate(id));
  nav.append(btn);
 }
 side.append(nav);
 const bottom=create('div','s9v5-side-bottom');bottom.innerHTML='<strong><span class="s9v5-side-dot" id="s9v5-side-dot"></span>Camera status</strong><span id="s9v5-side-health">Checking on-device status…</span><p style="margin:14px 0 0;color:#668394">S9+ · microSD archive</p>';side.append(bottom);
 const main=create('main','s9v5-main');
 const top=create('header','s9v5-top');const titles=create('div','s9v5-top-title');
 titles.append(create('div','s9v5-eyebrow','S9+ / SURVEILLANCE'));
 const heading=create('h1');heading.id='s9v5-title';titles.append(heading);
 const sub=create('p');sub.id='s9v5-subtitle';titles.append(sub);top.append(titles);
 const actions=create('div','s9v5-top-actions');
 const badge=create('div','s9v5-badge');badge.append(create('span','s9v5-status'));badge.lastChild.id='s9v5-status-dot';
 const badgeText=create('span','','Checking');badgeText.id='s9v5-status-label';badge.append(badgeText);
 actions.append(badge);
 const time=create('span');time.id='s9v5-clock';actions.append(time);
 const refresh=create('button','s9v5-btn','↻  Refresh');refresh.type='button';refresh.addEventListener('click',refreshData);
 actions.append(refresh);top.append(actions);main.append(top);
 const stage=create('div','s9v5-stage');stage.id='s9v5-stage';main.append(stage);
 shell.append(side,main);
 document.body.append(shell);
 const overview=create('section');overview.id='s9v5-overview';stage.append(overview);
 overview.innerHTML='<section class="s9v5-hero"><div><div class="s9v5-eyebrow">PRIVATE · ON-DEVICE MONITORING</div><h2>Your garden.<br>One clear overview.</h2><p>Live monitoring, local 4K evidence, visual review and archive access in a single workspace.</p></div><button type="button" class="s9v5-btn" data-s9v5-open="live">◉  Open live camera →</button></section><section class="s9v5-dashboard-grid"><div class="s9v5-metric"><div class="s9v5-metric-label">Camera</div><div class="s9v5-metric-value" id="s9v5-value-camera">—</div><div class="s9v5-metric-meta">Current recorder mode</div></div><div class="s9v5-metric"><div class="s9v5-metric-label">Saved recordings</div><div class="s9v5-metric-value" id="s9v5-value-recordings">—</div><div class="s9v5-metric-meta">S9+ microSD library</div></div><div class="s9v5-metric"><div class="s9v5-metric-label">Person candidates</div><div class="s9v5-metric-value" id="s9v5-value-person">—</div><div class="s9v5-metric-meta">Unverified model evidence</div></div><div class="s9v5-metric"><div class="s9v5-metric-label">Storage available</div><div class="s9v5-metric-value" id="s9v5-value-free">—</div><div class="s9v5-metric-meta">Phone removable microSD</div></div></section><div class="s9v5-overview-panels"><section class="s9v5-overview-panel"><h3>Go straight to what matters</h3><p>Four focused views, without duplicate camera players or nested archives.</p><div class="s9v5-quick-links"><button data-s9v5-open="saved">▣  Browse recordings<small>Date and category filters</small></button><button data-s9v5-open="faces">◎  Visual review<small>Faces and clothing clues</small></button><button data-s9v5-open="archive">▤  Historical archive<small>Previously saved Drive clips</small></button><button data-s9v5-open="camera">⚙  Camera controls<small>Existing settings and diagnostics</small></button></div></section><section class="s9v5-overview-panel"><h3>System details</h3><p>Live telemetry from the existing authenticated hub relay.</p><div class="s9v5-live-state" id="s9v5-system-details">Waiting for authenticated camera status. Recordings continue independently of this interface.</div></section></div>';
 overview.addEventListener('click',event=>{const b=event.target.closest('[data-s9v5-open]');if(b)activate(b.dataset.s9v5Open);});
 for(const panel of panels){panel.classList.remove('active');panel.classList.remove('s9v5-active');stage.append(panel);}
 const live=$('panel-live'),wrap=live?.querySelector('.c720p-s9-live-only');
 if(wrap&&!wrap.querySelector('.s9v5-live-stage')){
  const cam=wrap.querySelector('.cam');
  if(cam){
   const stageBox=create('section','s9v5-live-stage');
   const label=create('div','s9v5-live-stage-heading');
   label.append(create('strong','','◉  Front garden · live stream'),create('span','','S9+ native camera'));
   stageBox.append(label);wrap.insertBefore(stageBox,wrap.firstChild);stageBox.append(cam);
   const rail=create('aside','s9v5-live-rail');
   const card=create('section','s9v5-rail-card');
   card.innerHTML='<h3>Camera health</h3><div class="s9v5-readout"><div><span>Recorder</span><b id="s9v5-rail-mode">—</b></div><div><span>Battery temperature</span><b id="s9v5-rail-temp">—</b></div><div><span>microSD available</span><b id="s9v5-rail-sd">—</b></div></div>';
   rail.append(card);
   const extra=create('section','s9v5-rail-card s9v5-live-extras');extra.append(create('h3','','Live diagnostics'));
   for(const child of [...wrap.children])if(child!==stageBox)extra.append(child);
   rail.append(extra);wrap.append(rail);
  }
 }
 mounted=true;activate('overview');refreshData();
 setInterval(()=>{const now=new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',weekday:'short',hour:'2-digit',minute:'2-digit'}).format(new Date());setText('s9v5-clock',now);},15000);
 setText('s9v5-clock',new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/Amsterdam',weekday:'short',hour:'2-digit',minute:'2-digit'}).format(new Date()));
 setInterval(()=>{if(!document.hidden)refreshData();},30000);
 window.addEventListener('pageshow',()=>{refreshData();activate(current);});
}
function showPanel(name){
 const stage=$('s9v5-stage');
 for(const panel of stage.querySelectorAll(':scope > section.panel')){
  const shown=panel.id==='panel-'+name || (name==='archive'&&panel.id==='panel-saved');
  panel.classList.toggle('s9v5-active',shown);
  panel.hidden=!shown;
  panel.style.setProperty('display',shown?'block':'none','important');
 }
 $('s9v5-overview').style.display=name==='overview'?'block':'none';
 const saved=$('panel-saved'),micro=$('s9SavedFolderFrame'),drive=$('cameraSavedFrame');
 if(saved&&micro&&drive){
  const archival=name==='archive';
  micro.classList.toggle('s9v5-frame-off',archival);
  drive.classList.toggle('s9v5-frame-off',!archival);
  micro.style.setProperty('display',archival?'none':'block','important');
  drive.style.setProperty('display',archival?'block':'none','important');
  const frame=archival?drive:micro;
  if((name==='archive'||name==='saved')&&!frame.getAttribute('src')&&frame.dataset.src)
   frame.src=frame.dataset.src;
 }
 const faces=$('s9FacesGalleryFrame');
 if(name==='faces'&&faces&&!faces.getAttribute('src')&&faces.dataset.src)faces.src=faces.dataset.src;
}
function activate(id){
 if(!mounted||!SCREENS.some(x=>x[0]===id))return;
 if(id==='faces'&&!$('panel-faces'))id='overview';
 if(id==='camera'&&!$('panel-camera'))id='overview';
 current=id;
 const base=(id==='archive'||id==='overview')?'saved':id;
 const source=legacy[base];
 // The old click handler owns the camera stream's start/stop lifecycle.
 if(source)source.click();
 $('s9v5-shell').dataset.view=id;
 for(const button of $('s9v5-nav').querySelectorAll('button')){
  button.setAttribute('aria-current',button.dataset.view===id?'page':'false');
 }
 const page=SCREENS.find(x=>x[0]===id);
 setText('s9v5-title',page[1]);
 setText('s9v5-subtitle',page[3]+' · '+page[4]);
 // Other legacy handlers may schedule style changes as microtasks.
 showPanel(id);
 queueMicrotask(()=>showPanel(id));
 setTimeout(()=>{if(current===id)showPanel(id);},80);
}
function renderData(){
 const live=lastData?.live||{},archive=lastData?.archive||{};
 const status=live.status||{};
 const good=live.ok===true&&(live.camera_mode==='watching'||live.camera_mode==='recording');
 const mode=good?(live.camera_mode==='recording'?'Recording':'Watching'):(live.ok===false?'Unavailable':'—');
 setText('s9v5-value-camera',mode);
 setText('s9v5-rail-mode',mode);
 setText('s9v5-status-label',good?'Camera online':'Status unknown');
 setText('s9v5-side-health',good?'Live recorder responding':'Camera status not verified');
 const health=good?'ok':'unknown';
 for(const id of ['s9v5-status-dot','s9v5-side-dot']){const el=$(id);if(el)el.dataset.state=el.dataset.health=health;}
 if(Array.isArray(archive.events)){
  const events=archive.events;
  setText('s9v5-value-recordings',events.length.toLocaleString('en-GB'));
  const persons=events.filter(x=>x.scene_category==='one_person'||x.scene_category==='multiple_people'||
   (Number(x.person_count)||0)>0).length;
  setText('s9v5-value-person',persons.toLocaleString('en-GB'));
 }
 const sd=status.sd_free_bytes??live.sd_free_bytes;
 setText('s9v5-value-free',prettyBytes(sd));
 setText('s9v5-rail-sd',prettyBytes(sd));
 const temp=live.camera_temperature_c??status.temperature_c??null;
 setText('s9v5-rail-temp',Number.isFinite(Number(temp))&&temp!==null?Number(temp).toFixed(1)+' °C':'—');
 setText('s9v5-system-details',(good?'Phone camera responding':'Phone status unavailable')+
   ' · '+(archive.archive_mode==='S9-microSD-only'?'microSD archive connected':'Archive status unknown')+
   ' · Detector outputs are estimates, not verified identities. Original video stays on the S9+.');
}
async function refreshData(){
 if(polling)return;
 const relay=window.C720PSecureRelay;
 if(!relay||typeof relay.fetch!=='function'){setText('s9v5-system-details','Signed camera relay is not available in this view. The phone records independently.');return;}
 polling=true;
 try{
  const paths=['/new/api/live-person-watch','/new/api/saved'];
  const results=await Promise.allSettled(paths.map(async p=>{
   const response=await relay.fetch(p,{cache:'no-store'});
   if(!response.ok)throw Error('relay_status_'+response.status);
   return response.json();
  }));
  lastData=lastData||{};
  if(results[0].status==='fulfilled')lastData.live=results[0].value;
  if(results[1].status==='fulfilled'&&results[1].value.archive_mode==='S9-microSD-only')lastData.archive=results[1].value;
  renderData();
 }catch(_){}
 finally{polling=false;}
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
else mount();
})();
</script>
'''

CLIPS_CSS=r'''
<style id="s9v5-browser-style">
:root{--s9v5c-bg:#0a111a;--s9v5c-card:#162535;--s9v5c-line:#304658}
html:has(#s9v5-browser),body:has(#s9v5-browser){background:#0a111a!important;overflow:hidden!important}
#s9v5-browser,#s9v5-browser *{box-sizing:border-box}
#s9v5-browser{position:fixed;inset:0;z-index:2147480000;background:radial-gradient(ellipse at 88% -24%,#20405a 0,transparent 42%),#0a111a;color:#eff8fc;font:13px/1.42 system-ui,-apple-system,"Segoe UI",sans-serif;display:flex;flex-direction:column;overflow:hidden}
#s9v5-browser .s9v5-browser-head{flex:none;display:flex;align-items:center;justify-content:space-between;gap:12px;padding:15px 24px 14px;border-bottom:1px solid #2d4356}
#s9v5-browser .s9v5-browser-title{min-width:0}
#s9v5-browser .s9v5-browser-kicker{font-size:10px;letter-spacing:.18em;text-transform:uppercase;font-weight:800;color:#6bdfca}
#s9v5-browser h1{font-size:25px;line-height:1.1;letter-spacing:-.04em;font-weight:850;margin:5px 0}
#s9v5-browser .s9v5-browser-caption{font-size:11px;color:#92b1c3}
#s9v5-browser .s9v5-browser-pill{white-space:nowrap;font-size:11px;font-weight:740;padding:8px 12px;background:#163c3d;border:1px solid #448b7f;border-radius:999px;color:#bef3dc}
#s9v5-browser #s9-compact-layout{flex:1;min-height:0;width:100%!important;max-width:none!important;margin:0!important;display:grid!important;grid-template-columns:minmax(290px,400px) minmax(0,1fr)!important;gap:12px!important;padding:14px!important;overflow:hidden!important;align-items:stretch!important}
#s9v5-browser #s9-compact-layout .s9-playback-pane,
#s9v5-browser #s9-compact-layout .s9-selector-pane{min-width:0!important;min-height:0!important;padding:16px!important;border:1px solid #32495c!important;background:#111e2b!important;border-radius:16px!important;box-shadow:0 10px 32px #0003!important}
#s9v5-browser #s9-compact-layout .s9-playback-pane{position:static!important;max-width:none!important;overflow-y:auto}
#s9v5-browser #s9-compact-layout .s9-selector-pane{overflow:hidden!important;display:flex!important;flex-direction:column!important}
#s9v5-browser .s9-pane-heading{font-size:14px!important;font-weight:850!important;color:#f5fafc!important;padding:1px 0 14px;border-bottom:1px solid #304658;margin-bottom:14px!important}
#s9v5-browser .s9-rotation-shell{width:100%!important;max-width:100%!important}
#s9v5-browser #player{width:100%!important;max-width:100%!important;max-height:260px!important;object-fit:contain!important;border-radius:10px!important;background:#03080e!important}
#s9v5-browser .s9-rotation-stage{max-height:260px!important}
#s9v5-browser #list{flex:1;min-height:0!important;max-height:none!important;overflow-y:auto!important;padding:0 4px 7px 0!important}
#s9v5-browser #s9-date-folders h3{display:none!important}
#s9v5-browser #s9-date-folders .s9-v4-toolbar{gap:8px;margin:0 0 13px}
#s9v5-browser #s9-date-folders .s9-v4-toolbar button,#s9v5-browser #s9-date-folders .s9-v4-toolbar select{padding:9px 12px!important;background:#1b3547!important;color:#e4f8fd!important;border:1px solid #40697e!important;font-weight:670!important;font-size:12px!important}
#s9v5-browser #s9-date-folders .s9-v4-date{min-width:120px!important;background:#152536!important;border-color:#38556a!important;border-radius:11px!important;padding:10px 11px!important}
#s9v5-browser #s9-date-folders .s9-v4-date[aria-pressed=true]{background:#214c53!important;border-color:#71d6c4!important;box-shadow:inset 0 -2px 0 #73edd5}
#s9v5-browser #s9-date-folders .s9-v4-date small{font-size:10px!important}
#s9v5-browser #s9-date-folders .s9-v4-legend{display:flex!important;gap:8px 14px!important;padding:10px 12px!important;margin:0 0 12px!important;background:#111f2e;border:1px solid #2c4355;border-radius:10px}
#s9v5-browser #s9-date-folders .s9-v4-legend span{font-size:11px!important}
#s9v5-browser #s9-date-folders .s9-v4-cards{grid-template-columns:repeat(auto-fill,minmax(min(100%,285px),1fr))!important;gap:10px!important}
#s9v5-browser #s9-date-folders .s9-v4-clip{min-height:104px!important;border-radius:12px!important;border-top-color:#375569!important;border-right-color:#375569!important;border-bottom-color:#375569!important;gap:10px!important;padding:8px!important;background:linear-gradient(140deg,#1d3243,#122433)!important;transition:transform .14s,border-color .14s}
#s9v5-browser #s9-date-folders .s9-v4-clip:hover{transform:translateY(-1px);border-color:#73adbf!important}
#s9v5-browser #s9-date-folders .s9-v4-photo{flex-basis:127px!important;height:79px!important;border-radius:8px!important}
#s9v5-browser #s9-date-folders .s9-v4-copy strong{font-size:14px!important;color:#f5fbff}
#s9v5-browser #s9-date-folders .s9-v4-count{font-size:11px!important;color:#9bb7c8;margin:8px 0 13px!important}
#s9v5-browser #s9-detector-version-guide{font-size:10px!important;color:#849cae!important;border:0!important;background:transparent!important;padding:9px 0!important;margin:8px 0!important}
#s9v5-browser .s9v5-browser-foot{flex:none;padding:9px 24px;border-top:1px solid #2b4051;font-size:10px;color:#8eabba;display:flex;align-items:center;justify-content:space-between}
#s9v5-browser button:focus-visible,#s9v5-browser select:focus-visible{outline:2px solid #76eed2!important;outline-offset:2px}
@media(max-width:760px){
 #s9v5-browser .s9v5-browser-head{padding:11px 13px}
 #s9v5-browser #s9-compact-layout{grid-template-columns:minmax(0,1fr)!important;overflow:auto!important;padding:8px!important}
 #s9v5-browser #s9-compact-layout .s9-playback-pane{max-height:280px!important;flex:none}
 #s9v5-browser #s9-compact-layout .s9-selector-pane{min-height:360px!important}
 #s9v5-browser #player{max-height:188px!important}
 #s9v5-browser #s9-date-folders .s9-v4-cards{grid-template-columns:repeat(auto-fill,minmax(265px,1fr))!important}
}
@media(prefers-reduced-motion:reduce){#s9v5-browser *{transition:none!important}}
</style>
'''
CLIPS_JS=r'''
<script id="s9v5-browser-script">
(()=>{
'use strict';
function mount(){
 if(document.getElementById('s9v5-browser'))return;
 const layout=document.getElementById('s9-compact-layout');
 if(!layout)return;
 const root=document.createElement('main');root.id='s9v5-browser';
 const head=document.createElement('header');head.className='s9v5-browser-head';
 const title=document.createElement('div');title.className='s9v5-browser-title';
 const kicker=document.createElement('div');kicker.className='s9v5-browser-kicker';kicker.textContent='S9+ · ORIGINAL MICROSD EVIDENCE';
 const heading=document.createElement('h1');heading.textContent='Recordings';
 const caption=document.createElement('div');caption.className='s9v5-browser-caption';caption.textContent='Select a day, filter by event type, and open the original video.';
 title.append(kicker,heading,caption);head.append(title);
 const badge=document.createElement('span');badge.className='s9v5-browser-pill';badge.textContent='●  Local 4K archive';
 head.append(badge);root.append(head);
 const footer=document.createElement('footer');footer.className='s9v5-browser-foot';
 footer.append(document.createTextNode('Footage remains on S9+ · categories are AI estimates'));
 const right=document.createElement('span');right.textContent='SECURITY / VIDEO LIBRARY';
 footer.append(right);
 document.body.append(root);root.append(layout,footer);
}
if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',mount,{once:true});
else mount();
const observer=new MutationObserver(()=>{if(!document.getElementById('s9v5-browser'))mount();});
observer.observe(document.documentElement,{childList:true,subtree:true});
setTimeout(()=>{observer.disconnect();mount();},12000);
})();
</script>
'''

def _upgrade(html, style_marker, script_marker, css, js):
    if html.count('</head>')!=1 or html.count('</body>')!=1:
        raise ValueError('unexpected_html_structure')
    if html.count(style_marker)!=html.count(script_marker):
        raise ValueError('partial_v5_install')
    if style_marker in html:
        if html.count(style_marker)!=1 or html.count(script_marker)!=1:raise ValueError('duplicate_v5_markers')
        for tag,mark,new in [('style',style_marker,css.strip()),('script',script_marker,js.strip())]:
            expression=r'<'+tag+r' '+re.escape(mark)+r'>(?s:.*?)</'+tag+r'>'
            matches=list(re.finditer(expression,html))
            if len(matches)!=1:raise ValueError('partial_v5_'+tag)
            found=matches[0]
            html=html[:found.start()]+new+html[found.end():]
        return html
    html=html.replace('</head>',css+'\n</head>',1)
    html=html.replace('</body>',js+'\n</body>',1)
    return html

def patch_security(html):
    for required in ('id="panel-live"','id="panel-saved"','id="cameraLive"',
                     'data-tab="live"','data-tab="saved"',
                     's9SavedFolderFrame','cameraSavedFrame'):
        if required not in html:raise ValueError('missing_security_anchor_'+required)
    return _upgrade(html,ROOT_STYLE,ROOT_SCRIPT,ROOT_CSS,ROOT_JS)

def patch_clips(html):
    for required in ('id="player"','id="list"','id="s9-compact-recordings-v1"',
                     'id="s9-saved-virtual-folders-script-v1"','C720PSecureRelay'):
        if required not in html:raise ValueError('missing_saved_anchor_'+required)
    return _upgrade(html,CLIPS_STYLE,CLIPS_SCRIPT,CLIPS_CSS,CLIPS_JS)
