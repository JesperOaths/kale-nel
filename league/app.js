/* 20261007-league-web-v309 · decision-intelligence integration and visual coherence */
(function(){
'use strict';

const cfg=window.GEJAST_CONFIG||{};
const API=(cfg.SUPABASE_URL||'')+'/functions/v1/printify-gildan-diff-diag-v1';
const KEY=cfg.SUPABASE_PUBLISHABLE_KEY||'';
const $=(id)=>document.getElementById(id);
const state={profile:null,report:null,ddVersion:'',openMatch:null,activeDetailTab:'macro',learningHabit:'all',busy:false,riotApiKey:'',serverRiotKey:false,backendAnalyzerVersion:'',publicWorkspace:true,gameSort:{key:'recent',dir:'desc'},gameFilter:'all',gameChampion:'all',matchHistoryLimit:10,matchHistoryFilter:'all',matchHistoryArcKey:'',matchHistoryObjectiveFamilyKey:'',savedProfiles:[],selectedProfileId:'',selectedRole:'ADC',profileLoadEpoch:0};

function esc(v){return String(v??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
const LEAGUE_WORKSPACE_KEY='bruisienator_public_workspace_v1';
const LEAGUE_SLOT_SELECTION_KEY='bruisienator_saved_profile_selection_v1';
const LEAGUE_PROFILE_PREFS_KEY='bruisienator_profile_preferences_v1';
const LEAGUE_PROFILE_NOTE_PREFIX='kalenel_league_profile_v2';
function canonicalRole(v){
  const r=String(v||'').trim().toUpperCase();
  if(r==='BOTTOM'||r==='BOT'||r==='DUO_CARRY'||r==='ADC')return'ADC';
  if(r==='UTILITY'||r==='DUO_SUPPORT'||r==='SUPPORT')return'SUPPORT';
  if(r==='MIDDLE'||r==='MID')return'MID';
  if(r==='JUNGLE')return'JUNGLE';
  if(r==='TOP')return'TOP';
  return'ADC';
}
function roleLabel(v){const r=canonicalRole(v);return r==='ADC'?'ADC':r==='MID'?'Mid':r==='JUNGLE'?'Jungle':r==='SUPPORT'?'Support':'Top';}
function selectedAnalysisRole(){return canonicalRole($('requestRole')?.value||state.selectedRole||'ADC');}
function profileRole(p){
  const m=String(p?.notes||'').match(/(?:^|\|)role=(ADC|SUPPORT|MID|JUNGLE|TOP)(?:\||$)/i);
  const preferred=profilePreferences().roles[String(p?.id||'')];
  return canonicalRole(preferred||m?.[1]||'ADC');
}
function profilePreferences(){
  try{const p=JSON.parse(localStorage.getItem(LEAGUE_PROFILE_PREFS_KEY)||'{}');return{roles:p?.roles&&typeof p.roles==='object'?p.roles:{},pins:Array.isArray(p?.pins)?p.pins.map(String):[]};}catch(_){return{roles:{},pins:[]};}
}
function saveProfilePreference(id,role){
  const prefs=profilePreferences();prefs.roles[String(id)]=canonicalRole(role);
  try{localStorage.setItem(LEAGUE_PROFILE_PREFS_KEY,JSON.stringify(prefs));}catch(_){}
}
function toggleProfilePin(id){
  if(state.busy)return;
  const prefs=profilePreferences(),key=String(id);prefs.pins=prefs.pins.includes(key)?prefs.pins.filter(x=>x!==key):[...prefs.pins,key];
  try{localStorage.setItem(LEAGUE_PROFILE_PREFS_KEY,JSON.stringify(prefs));}catch(_){}
  renderSavedProfiles();
}
function openReportAncestors(node){
  for(let p=node;p;p=p.parentElement)if(p.tagName==='DETAILS')p.open=true;
}
function openStatGuide(key){
  const target=$('term-'+key)||$('stat-guide');openReportAncestors(target);target?.scrollIntoView({behavior:'auto',block:'start'});
}
function profileFeedback(message,kind=''){
  const node=$('profileFeedback');if(!node)return;node.textContent=message;node.className='profile-feedback '+kind;
}
function clearSelectedReport(message='Choose a saved profile or add a player'){
  state.report=null;state.openMatch=null;state.gameFilter='all';state.gameChampion='all';state.matchHistoryFilter='all';
  heavyRenderTicket++;clearHeavyObservers();
  $('report').hidden=true;$('reportEmpty').hidden=false;
  $('reportEmpty').querySelector('h2').textContent=message;
}
function profileNotes(role){return LEAGUE_PROFILE_NOTE_PREFIX+'|role='+canonicalRole(role);}
function sameRiotIdentity(p,gameName,tagLine,platformRegion){
  return String(p?.game_name||'').toLowerCase()===String(gameName||'').toLowerCase()&&String(p?.tag_line||'').toLowerCase()===String(tagLine||'').toLowerCase()&&String(p?.platform_region||'euw1').toLowerCase()===String(platformRegion||'euw1').toLowerCase();
}
function generatedProfileKey(gameName,tagLine,platformRegion){
  return ['riot',gameName,tagLine,platformRegion].join('-').toLowerCase().replace(/[^a-z0-9_-]+/g,'-').replace(/^-+|-+$/g,'').slice(0,96)||'league-profile';
}
function secureWorkspaceToken(){
  if(globalThis.crypto&&typeof globalThis.crypto.randomUUID==='function')return globalThis.crypto.randomUUID();
  if(globalThis.crypto&&typeof globalThis.crypto.getRandomValues==='function'){
    const bytes=new Uint8Array(24);globalThis.crypto.getRandomValues(bytes);
    return 'lw1_'+Array.from(bytes,b=>b.toString(16).padStart(2,'0')).join('');
  }
  throw new Error('Secure browser randomness is unavailable; League workspace cannot be created safely.');
}
function validWorkspaceToken(value){
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)||/^lw1_[0-9a-f]{48,64}$/i.test(value);
}
function workspaceId(){
  try{
    let value=String(localStorage.getItem(LEAGUE_WORKSPACE_KEY)||'').trim();
    if(!validWorkspaceToken(value)){
      value=secureWorkspaceToken();
      localStorage.setItem(LEAGUE_WORKSPACE_KEY,value);
    }
    return value;
  }catch(err){
    if(!state._ephemeralWorkspace)state._ephemeralWorkspace=secureWorkspaceToken();
    return state._ephemeralWorkspace;
  }
}
function hasNum(v){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));}
function fmt(v,d=1){return hasNum(v)?Number(v).toFixed(d):'n/a';}
function fmtInt(v){return hasNum(v)?Math.round(Number(v)).toLocaleString():'n/a';}
function fmtPct(v){return hasNum(v)?Math.round(Number(v))+'%':'n/a';}
function fmtDate(v){if(!v)return'—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'—';}
function gameTimestampMs(v){const n=Number(v);return Number.isFinite(n)&&n>0?(n<1e12?n*1000:n):null;}
function shortGameDate(v){const ms=gameTimestampMs(v);return ms?new Date(ms).toLocaleDateString(undefined,{day:'numeric',month:'short'}):'';}
function fmtDuration(v){const n=Number(v);if(!Number.isFinite(n))return'n/a';const m=Math.floor(n),s=Math.round((n-m)*60);return m+':'+String(s).padStart(2,'0');}
function signed(v,d=0){if(!hasNum(v))return'n/a';const n=Number(v);return(n>0?'+':'')+n.toFixed(d);}
function rankText(r){return r&&r.tier?[String(r.tier).toUpperCase(),String(r.rank||'').toUpperCase(),hasNum(r.leaguePoints)?String(r.leaguePoints)+' LP':''].filter(Boolean).join(' '):'Unranked / unknown';}
function readinessReason(v){
  const key=String(v||'');
  const labels={
    recipe_or_combine_cost_unavailable:'recipe / combine-cost data unavailable',
    direct_components_not_observed:'recipe components not observed',
    direct_components_not_simultaneously_observed:'recipe components were not simultaneously owned',
    no_supported_affordability_frame:'no supported pre-purchase affordability frame'
  };
  return labels[key]||key.replaceAll('_',' ');
}
function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

function leagueApiHeaders(){
  const headers={'Content-Type':'application/json','apikey':KEY,'x-league-workspace':workspaceId()};
  // Supabase's opaque publishable keys belong on apikey, not as a synthetic
  // bearer token. Keep Authorization only for legacy JWT anon-key compatibility.
  if(/^[^.]+\.[^.]+\.[^.]+$/.test(String(KEY||'')))headers.Authorization='Bearer '+KEY;
  if(state.riotApiKey)headers['x-riot-api-key']=state.riotApiKey;
  return headers;
}
async function api(action,payload={}){
  if(!API||!KEY)throw new Error('League backend configuration is missing.');
  const res=await fetch(API,{
    method:'POST',mode:'cors',cache:'no-store',
    headers:leagueApiHeaders(),
    body:JSON.stringify(Object.assign({action},payload))
  });
  const raw=await res.text();let data=null;
  try{data=raw?JSON.parse(raw):{};}catch(_){throw new Error(raw||('HTTP '+res.status));}
  if(!res.ok||data?.ok===false){
    const code=String(data?.error||'');
    if(code==='public_workspace_profile_limit')throw new Error('The internal League cache is full for this browser workspace.');
    if(code==='league_workspace_invalid'||code==='league_workspace_required')throw new Error('The public League workspace identity is invalid. Reload the page to create a fresh isolated workspace.');
    if(/^riot_http_(401|403)/.test(code))throw new Error('Riot rejected the API key. Development keys expire regularly; paste a fresh RGAPI key and try again.');
    if(/^riot_http_404/.test(code))throw new Error('Riot could not find that account or match. Check the game name, tag and region.');
    if(/^riot_http_429/.test(code))throw new Error('Riot rate-limited the request. Wait briefly and try again; already fetched matches remain cached.');
    throw new Error(code||('HTTP '+res.status));
  }
  return data;
}

function setBusy(on,label){
  state.busy=!!on;
  for(const id of ['savedProfileSelect','newSavedProfileBtn','forgetSavedProfileBtn','saveProfileBtn','openSavedReportBtn','requestRole','requestGameName','requestTagLine','requestRegion','profileLabel','riotApiKey'])if($(id))$(id).disabled=!!on;
  document.querySelectorAll('[data-select-profile],[data-pin-profile]').forEach(n=>n.disabled=!!on);
  const run=$('loadRecentBtn');if(run)run.disabled=!!on||!directRequestComplete();
  if(on&&$('progressPanel'))$('progressPanel').hidden=false;
  if(label)$('progressState').textContent=label;
  if(!on)syncButtons();
}
function setProgress(current,total){
  const p=total>0?Math.max(0,Math.min(100,current/total*100)):0;
  $('progressBar').style.width=p+'%';
}
function log(message,type=''){
  const line=document.createElement('div');line.className='log-line '+type;line.textContent='['+new Date().toLocaleTimeString()+'] '+message;
  $('progressLog').appendChild(line);$('progressLog').scrollTop=$('progressLog').scrollHeight;
  const summary=$('progressSummary');if(summary)summary.textContent=message;
}
function clearLog(){
  $('progressLog').innerHTML='';
  const summary=$('progressSummary');if(summary)summary.textContent='Ready to request recent matches.';
  setProgress(0,1);
}
function statusPill(textValue,kind='neutral'){
  $('progressState').textContent=textValue;
  $('progressState').className='pill '+kind;
}
async function getDdragonVersion(){
  if(state.ddVersion)return state.ddVersion;
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),3000);
  try{
    const r=await fetch('https://ddragon.leagueoflegends.com/api/versions.json',{cache:'force-cache',signal:controller.signal});
    const list=await r.json();state.ddVersion=Array.isArray(list)&&list[0]?String(list[0]):'';
  }catch(_){}finally{clearTimeout(timer);}
  return state.ddVersion;
}
function championIcon(name){
  if(!name||!state.ddVersion)return'';
  return 'https://ddragon.leagueoflegends.com/cdn/'+encodeURIComponent(state.ddVersion)+'/img/champion/'+encodeURIComponent(name)+'.png';
}
function itemIcon(itemId){
  const id=Number(itemId||0);if(!id||!state.ddVersion)return'';
  return 'https://ddragon.leagueoflegends.com/cdn/'+encodeURIComponent(state.ddVersion)+'/img/item/'+encodeURIComponent(String(id))+'.png';
}
function itemDetailCard(label,item){
  if(!item)return detailCard(label,'n/a');
  const src=itemIcon(item.itemId);
  return '<div class="detail-card visual-detail-card"><span>'+esc(label)+'</span><div class="visual-detail-value">'+
    (src?'<img loading="lazy" src="'+esc(src)+'" alt="'+esc(item.name||'Item')+'">':'')+
    '<strong>'+esc(item.name||('Item '+String(item.itemId||'')))+'</strong></div>'+
    (hasNum(item.time)?'<small>'+esc(fmt(item.time,1))+' min</small>':'')+'</div>';
}
function purchaseItemStrip(items){
  const xs=(Array.isArray(items)?items:[]).filter(x=>x?.itemId);
  if(!xs.length)return'';
  return '<div class="purchase-item-strip">'+xs.slice(0,6).map(x=>{
    const src=itemIcon(x.itemId);
    return '<span title="'+esc((x.name||'Item')+(hasNum(x.cost)?' · '+fmtInt(x.cost)+'g cash estimate':''))+'">'+
      (src?'<img loading="lazy" src="'+esc(src)+'" alt="'+esc(x.name||'Item')+'">':'')+
      '<b>'+esc(x.name||String(x.itemId))+'</b></span>';
  }).join('')+'</div>';
}
function matchVisualHeader(g){
  const peerOk=trustedDirectPeer(g),peerChampion=peerOk?String(g.peer?.champion||''):'',mine=championIcon(g.champion),opp=peerChampion?championIcon(peerChampion):'',items=Array.isArray(g.finalItems)?g.finalItems:[];
  return '<div class="match-visual-header"><div class="match-champion">'+
    (mine?'<img loading="lazy" src="'+esc(mine)+'" alt="'+esc(g.champion||'Champion')+'">':'')+
    '<div><span>Your champion</span><strong>'+esc(g.champion||'Unknown')+'</strong></div></div>'+
    '<div class="final-build"><span>Final build</span><div>'+(
      items.length?items.slice(0,7).map(x=>{const src=itemIcon(x.itemId);return src?'<img loading="lazy" src="'+esc(src)+'" alt="'+esc(x.name||'Item')+'" title="'+esc(x.name||'Item')+'">':'';}).join(''):'<small>No final build data</small>'
    )+'</div></div>'+
    '<div class="match-champion opponent">'+
    (opp?'<img loading="lazy" src="'+esc(opp)+'" alt="'+esc(peerChampion||'Opponent')+'">':'')+
    '<div><span>Role opponent</span><strong>'+esc(peerOk?(peerChampion||'Unknown'):'Comparison withheld')+'</strong></div></div></div>';
}

function clamp(n,min,max){return Math.max(min,Math.min(max,n));}
function deltaTone(value,neutral=0,goodThreshold=0,inverse=false){
  if(!hasNum(value))return'neutral';
  const n=Number(value)-Number(neutral||0),v=inverse?-n:n;
  if(Math.abs(v)<Math.max(1e-9,Number(goodThreshold||0)))return'neutral';
  return v>0?'good':'bad';
}
function plainDelta(value,unit='',digits=0,inverse=false){
  if(!hasNum(value))return{value:'n/a',tone:'neutral',word:'Not enough evidence'};
  const n=Number(value),tone=deltaTone(n,0,unit==='gold'?100:unit==='csmin'?0.15:unit==='dpm'?50:unit==='minutes'?0.2:unit==='vpm'?0.15:unit==='wards'?0.5:0.01,inverse);
  const magnitude=Math.abs(n);
  let formatted;
  if(unit==='gold')formatted=signed(n,0)+'g';
  else if(unit==='csmin')formatted=signed(n,2)+' CS/min';
  else if(unit==='dpm')formatted=signed(n,0)+' DPM';
  else if(unit==='minutes')formatted=signed(n,1)+' min';
  else if(unit==='vpm')formatted=signed(n,2)+' VPM';
  else if(unit==='wards')formatted=signed(n,1)+' wards';
  else if(unit==='pp')formatted=signed(n,1)+' points';
  else formatted=signed(n,digits);
  const favorable=inverse?n<0:n>0;
  const word=tone==='neutral'?'Essentially even':favorable?'Favorable':'Unfavorable';
  return{value:formatted,tone,word};
}
function contextBar(value,scale,inverse=false){
  if(!hasNum(value))return'<div class="context-bar is-empty"><span></span><i></i></div>';
  const normalized=clamp(Number(value)/Math.max(1e-9,Number(scale||1)),-1,1)*(inverse?-1:1);
  const pct=Math.abs(normalized)*50;
  const left=normalized<0?50-pct:50;
  return '<div class="context-bar '+(normalized>0?'positive':normalized<0?'negative':'neutral')+'"><i class="zero"></i><span style="left:'+left+'%;width:'+pct+'%"></span></div>';
}

const SR_MAP_BOUNDS={minX:-120,minY:-120,maxX:14870,maxY:14980,size:512};
function worldToMapPoint(x,y){
  if(!hasNum(x)||!hasNum(y))return null;
  const bx=SR_MAP_BOUNDS,xx=Number(x),yy=Number(y);
  if(xx<bx.minX-500||xx>bx.maxX+500||yy<bx.minY-500||yy>bx.maxY+500)return null;
  const px=(xx-bx.minX)/(bx.maxX-bx.minX)*bx.size;
  const py=(bx.maxY-yy)/(bx.maxY-bx.minY)*bx.size;
  return{x:Math.max(0,Math.min(bx.size,px)),y:Math.max(0,Math.min(bx.size,py))};
}
const VERIFIED_DDRAGON_FALLBACK='16.19.1';
function map11ImageForVersion(version){
  return 'https://ddragon.leagueoflegends.com/cdn/'+encodeURIComponent(version||VERIFIED_DDRAGON_FALLBACK)+'/img/map/map11.png';
}
function map11Image(){
  return map11ImageForVersion(state.ddVersion||VERIFIED_DDRAGON_FALLBACK);
}
function map11FallbackImage(){
  return map11ImageForVersion(VERIFIED_DDRAGON_FALLBACK);
}
function mapPointSvg(point,kind,index=null){
  const p=worldToMapPoint(point.x,point.y);if(!p)return'';
  const highRisk=kind==='death'&&!!point.highRisk;
  const lead=kind==='death'&&(!!point.lead||(hasNum(point.goldDiffAtDeath)&&Number(point.goldDiffAtDeath)>=500));
  const cls=kind==='death'?('map-point death'+(highRisk?' high-risk':'')+(lead?' lead':'')):('map-point ward '+String(point.territory||'unknown').replace(/[^a-z0-9_-]/gi,'')+(point.objectiveSetup?' setup':''));
  const radius=kind==='death'?(lead?8:highRisk?7:5):3.6;
  const title=kind==='death'
    ?[(hasNum(point.time)?fmt(point.time,1)+'m':''),point.zone||'',highRisk?'high-risk death':'death',Array.isArray(point.tags)&&point.tags.length?point.tags.join(', '):'',lead&&hasNum(point.goldDiffAtDeath)?'ahead '+signed(point.goldDiffAtDeath,0)+'g vs role':''].filter(Boolean).join(' · ')
    :[(hasNum(point.time)?fmt(point.time,1)+'m':''),point.territory||'unknown',point.wardType||'ward',point.objectiveSetup?'objective setup':''].filter(Boolean).join(' · ');
  const circle='<circle class="'+esc(cls)+'" cx="'+p.x.toFixed(2)+'" cy="'+p.y.toFixed(2)+'" r="'+radius+'"><title>'+esc(title)+'</title></circle>';
  if(kind!=='death'||!Number.isInteger(index))return circle;
  return '<g class="map-death-marker">'+circle+'<text class="map-marker-label" x="'+p.x.toFixed(2)+'" y="'+p.y.toFixed(2)+'">'+esc(String(Number(index)+1))+'</text></g>';
}
function bindMapFallbacks(root=document){
  root.querySelectorAll('.map-stage img[data-map-fallback]').forEach(img=>img.addEventListener('error',()=>{const fallback=img.dataset.mapFallback;if(fallback&&img.src!==fallback)img.src=fallback;},{once:true}));
}
function perGameDeathPoints(g){
  const deaths=(Array.isArray(g.deathPositions)?g.deathPositions:[]).filter(x=>hasNum(x.x)&&hasNum(x.y)).slice().sort((a,b)=>Number(a.time||0)-Number(b.time||0));
  const bad=Array.isArray(g.badDeaths)?g.badDeaths:[],lead=Array.isArray(g.leadDeaths)?g.leadDeaths:[];
  const byTime=(xs,t)=>xs.find(x=>hasNum(x.time)&&hasNum(t)&&Math.abs(Number(x.time)-Number(t))<=0.03)||null;
  return deaths.map(d=>{const b=byTime(bad,d.time),l=byTime(lead,d.time);return{...d,highRisk:!!b,lead:!!l,goldDiffAtDeath:l?.goldDiffAtDeath??b?.goldDiffAtDeath??null,tags:b?.tags||[]};});
}
function perGameRoamPaths(g){
  return (Array.isArray(g?.roams?.events)?g.roams.events:[]).map((r,i)=>{
    const points=(Array.isArray(r.pathPoints)?r.pathPoints:[]).filter(p=>hasNum(p.x)&&hasNum(p.y)).map(p=>({...p,projected:worldToMapPoint(p.x,p.y)})).filter(p=>p.projected);
    return{...r,index:i,points};
  }).filter(r=>r.points.length>=2);
}
function roamPathSvg(roam){
  const pts=roam.points||[];if(pts.length<2)return'';
  const d=pts.map((p,i)=>(i?'L':'M')+p.projected.x.toFixed(2)+' '+p.projected.y.toFixed(2)).join(' ');
  const a=pts[0].projected,b=pts[pts.length-1].projected;
  const title='Roam '+String(Number(roam.index)+1)+' · '+fmt(roam.startMin,1)+'–'+fmt(roam.endMin,1)+'m · '+String(roam.targetZone||'map')+' · '+String(roam.outcome||'neutral');
  return '<g class="map-roam-path"><path d="'+d+'"><title>'+esc(title)+'</title></path><circle class="roam-start" cx="'+a.x.toFixed(2)+'" cy="'+a.y.toFixed(2)+'" r="4"><title>'+esc(title+' · start')+'</title></circle><circle class="roam-end" cx="'+b.x.toFixed(2)+'" cy="'+b.y.toFixed(2)+'" r="5"><title>'+esc(title+' · end')+'</title></circle><text class="map-marker-label roam-label" x="'+b.x.toFixed(2)+'" y="'+b.y.toFixed(2)+'">'+esc(String(Number(roam.index)+1))+'</text></g>';
}
function roamEvidenceText(r){
  const bits=[
    String(r.playerKillAssists??(r.killOrAssist?1:0))+' K/A',
    String(r.playerDeaths??(r.death?1:0))+' deaths',
    hasNum(r.teamKills)?String(r.teamKills)+' team kills':null,
    hasNum(r.objectivePresent)?String(r.objectivePresent)+' objectives joined':(r.objective?'objective joined':null),
    hasNum(r.teamObjectivesWithoutPlayer??r.objectiveAway)&&Number(r.teamObjectivesWithoutPlayer??r.objectiveAway)>0?String(r.teamObjectivesWithoutPlayer??r.objectiveAway)+' team objectives while away':null,
    hasNum(r.enemyObjectivesDuringRoam??r.objectiveLost)&&Number(r.enemyObjectivesDuringRoam??r.objectiveLost)>0?String(r.enemyObjectivesDuringRoam??r.objectiveLost)+' enemy objectives during roam':null,
    hasNum(r.structureInvolvements)&&Number(r.structureInvolvements)>0?String(r.structureInvolvements)+' structure involvements':null,
    hasNum(r.platesGained)&&Number(r.platesGained)>0?String(r.platesGained)+' plates gained':null,
    hasNum(r.platesLost)&&Number(r.platesLost)>0?String(r.platesLost)+' home-lane plates lost while away':null,
    hasNum(r.homeLaneStructuresLost)&&Number(r.homeLaneStructuresLost)>0?String(r.homeLaneStructuresLost)+' home-lane turrets lost while away':null,
    hasNum(r.coachingLaneCostCs??r.laneCostCs)?((r.laneCostBasis==='allied_adc_vs_enemy_adc'?'ADC-vs-ADC lane movement':'direct-role lane movement')+' '+signed(r.coachingLaneCostCs??r.laneCostCs,0)+' CS'):null
  ].filter(Boolean);
  return bits.join(' · ');
}
function perGameSpatialHtml(g){
  const mapId=Number(g.mapId||0);
  if(mapId!==11){
    return '<div class="detail-map-grid"><div class="detail-note map-unavailable"><strong>Map renderer unavailable for mapId '+esc(String(mapId||'unknown'))+'.</strong><br>Raw Riot coordinates remain preserved, but this match is not forced onto the Summoner’s Rift projection.</div></div>';
  }
  const deaths=perGameDeathPoints(g),wards=(Array.isArray(g.wards)?g.wards:[]).filter(x=>hasNum(x.x)&&hasNum(x.y)).slice().sort((a,b)=>Number(a.time||0)-Number(b.time||0)),roams=perGameRoamPaths(g);
  const image=map11Image(),fallback=map11FallbackImage();
  const map=(points,kind,empty,numbered)=>points.length
    ?'<div class="map-stage"><img src="'+esc(image)+'" data-map-fallback="'+esc(fallback)+'" alt="Summoner’s Rift '+esc(kind==='death'?'death':'ward')+' map for this match"><svg viewBox="0 0 512 512" preserveAspectRatio="none" aria-label="'+esc(kind==='death'?'Chronological death positions':'Ward positions')+'">'+points.map((p,i)=>mapPointSvg(p,kind,numbered?i:null)).join('')+'</svg></div>'
    :'<div class="spatial-empty">'+esc(empty)+'</div>';
  const highRisk=deaths.filter(x=>x.highRisk).length,ahead=deaths.filter(x=>x.lead).length,offensive=wards.filter(x=>x.territory==='offensive').length,river=wards.filter(x=>x.territory==='river').length,defensive=wards.filter(x=>x.territory==='defensive').length,setup=wards.filter(x=>x.objectiveSetup).length;
  return '<div class="detail-map-grid">'+
    '<article class="spatial-card"><div class="spatial-card-head"><div><strong>Deaths · this match</strong><small>All player deaths, numbered chronologically</small></div><span>'+esc(String(deaths.length))+' total · '+esc(String(highRisk))+' high-risk · '+esc(String(ahead))+' while ≥500g ahead</span></div>'+
      map(deaths,'death','No player death coordinates are available for this match.',true)+
      '<div class="map-legend"><span><i class="legend-dot death"></i>death</span><span><i class="legend-dot death high-risk"></i>high-risk</span><span><i class="legend-dot death lead"></i>while ≥500g ahead</span></div></article>'+
    '<article class="spatial-card"><div class="spatial-card-head"><div><strong>Wards · this match</strong><small>Placement territory from the same shared projection</small></div><span>'+esc(String(wards.length))+' total · '+esc(String(setup))+' objective setup</span></div>'+
      map(wards,'ward','No ward coordinates are available for this match.',false)+
      '<div class="map-legend"><span><i class="legend-dot ward offensive"></i>'+esc(String(offensive))+' offensive</span><span><i class="legend-dot ward river"></i>'+esc(String(river))+' river</span><span><i class="legend-dot ward defensive"></i>'+esc(String(defensive))+' defensive</span><span><i class="legend-dot ward setup"></i>'+esc(String(setup))+' objective setup</span></div></article>'+
    '<article class="spatial-card roam-spatial-card"><div class="spatial-card-head"><div><strong>Roam paths · this match</strong><small>Server-derived departures from the home-lane corridor</small></div><span>'+esc(String(roams.length))+' mapped</span></div>'+
      (roams.length?'<div class="map-stage"><img src="'+esc(image)+'" data-map-fallback="'+esc(fallback)+'" alt="Summoner’s Rift roam paths for this match"><svg viewBox="0 0 512 512" preserveAspectRatio="none" aria-label="Roam paths">'+roams.map(roamPathSvg).join('')+'</svg></div>':'<div class="spatial-empty">No qualifying roam path has enough Riot frame coordinates to draw.</div>')+
      '<div class="map-legend"><span>Number = roam endpoint · line = sampled movement path</span></div></article>'+
    '<div class="detail-map-note">Summoner’s Rift mapId 11 · x −120→14870 · y −120→14980 · Y inverted. Deaths, wards and roam paths use the same projection.</div>'+
  '</div>';
}

const DEATH_PATTERN_DEFS={
  objective_side_lane:{label:'Side-lane death before team-contested objective',why:'You died isolated in a side lane within 90 seconds before a neutral objective with supported team-contest evidence.',action:'Collect the side wave earlier, then leave enough time to reset and reconnect before the likely contest window.'},
  vision_facecheck:{label:'Vision action without cover',why:'A ward placement/clear was followed quickly by a high-risk death without nearby allied cover.',action:'Keep the vision goal, but take the route with a teammate or use safer information before entering contested fog.'},
  post_play_giveback:{label:'Give-back after your own play',why:'You died soon after your own kill/assist impact and the death was both high-risk and untraded.',action:'After winning a play, pause the chase: bank gold, reset threat ranges, and convert the advantage before re-entering danger.'},
  outnumbered_catch:{label:'Caught while locally outnumbered',why:'The death occurred with at least two more nearby enemies than allies.',action:'Count who can actually arrive in the next few seconds; leave before the map collapses rather than when enemies are already on screen.'},
  deep_isolation:{label:'Deep + isolated overextension',why:'You were both on the enemy side of the map and separated from nearby allies.',action:'Push only to the last point where you still have an exit route; when information disappears, rotate back through controlled space.'},
  pre_objective_death:{label:'Death before enemy objective conversion',why:'The death was followed shortly by an enemy contested neutral objective.',action:'Treat the minute before a likely objective as protected time: reset earlier, move with information, and avoid low-value fights.'},
  high_unspent_overstay:{label:'Overstay with spendable gold',why:'The death occurred while carrying at least 1000 unspent gold together with another risk signal.',action:'Convert stored gold into combat stats before extending for another wave or contest.'},
  lead_protection:{label:'Risky death while materially ahead',why:'You died in a high-risk state while at least +500g versus the direct role opponent.',action:'When ahead, lower the acceptable risk: preserve the purchase and tempo advantage until it becomes objective or fight control.'},
  isolated_catch:{label:'Isolated catch',why:'You died without an allied champion within the supported 3000-unit proximity window.',action:'Track ally distance as part of the decision, not only enemy visibility; pressure is valuable only if a teammate can reconnect or you can exit.'},
  multi_signal:{label:'Other repeated multi-signal risk',why:'The death crossed the analyzer’s high-risk threshold through multiple supported signals but does not fit a stronger recurring pattern.',action:'Review the 10–15 seconds before the death and identify the first information, spacing, reset, or numbers signal that should have changed the decision.'}
};
function sameMoment(a,b,eps=.06){return a&&b&&hasNum(a.time)&&hasNum(b.time)&&Math.abs(Number(a.time)-Number(b.time))<=eps;}
function deathPatternEntries(r){
  const out=[];
  for(const g of reportCoachingGames(r)){
    if(Number(g.mapId)!==11)continue;
    for(const d of (g.badDeaths||[])){
      const tags=new Set(Array.isArray(d.tags)?d.tags:[]),side=(g.sideLaneRisk?.events||[]).find(x=>sameMoment(x,d)),vision=(g.visionMission?.events||[]).find(x=>sameMoment(x,d)),post=(g.postImpactRisk?.events||[]).find(x=>hasNum(x.deathTime)&&Math.abs(Number(x.deathTime)-Number(d.time))<=.06),consequence=(g.deathConsequences?.events||[]).find(x=>sameMoment(x,d));
      let key='multi_signal';
      if(side?.isolated&&side?.neutralObjectiveSoon)key='objective_side_lane';
      else if(vision?.unsupported&&vision?.highRisk)key='vision_facecheck';
      else if(post?.highRisk&&!post?.traded)key='post_play_giveback';
      else if(tags.has('outnumbered'))key='outnumbered_catch';
      else if(tags.has('deep_enemy_side')&&tags.has('isolated'))key='deep_isolation';
      else if(tags.has('enemy_contested_objective_after'))key='pre_objective_death';
      else if(tags.has('high_unspent_gold'))key='high_unspent_overstay';
      else if(hasNum(d.goldDiffAtDeath)&&Number(d.goldDiffAtDeath)>=500)key='lead_protection';
      else if(tags.has('isolated'))key='isolated_catch';
      const def=DEATH_PATTERN_DEFS[key],bits=[];
      if(side?.neutralObjectiveSoon)bits.push((side.neutralObjectiveType||'objective')+' in '+String(side.secondsBeforeNeutralObjective||'?')+'s');
      if(vision)bits.push((vision.action||'vision action')+' '+String(vision.secondsAfterAction||'?')+'s before death');
      if(post)bits.push('died '+String(post.secondsAfterImpact||'?')+'s after own impact');
      if(hasNum(d.goldDiffAtDeath))bits.push(signed(d.goldDiffAtDeath,0)+'g vs role');
      if(hasNum(d.currentGold)&&Number(d.currentGold)>=1000)bits.push(fmtInt(d.currentGold)+'g unspent');
      if(consequence?.enemyObjectiveAfter)bits.push('enemy objective followed');
      if(consequence?.severe)bits.push('severe follow-on loss');
      out.push({...d,patternKey:key,patternLabel:def.label,patternWhy:def.why,patternAction:def.action,champion:g.champion,matchId:g.matchId,gameStartTimestamp:g.gameStartTimestamp,opponentChampion:trustedDirectPeer(g)?g.peer?.champion||null:null,detail:bits.join(' · '),consequenceMeasured:!!consequence,costly:!!consequence?.costly,severe:!!consequence?.severe,consequenceTraded:consequence?consequence.traded:null,economyWindowContaminatedByRepeatDeath:!!consequence?.economyWindowContaminatedByRepeatDeath,consequenceSignals:Array.isArray(consequence?.signals)?consequence.signals:[]});
    }
  }
  return out;
}
function deathPatternMap(entries){
  const image=map11Image(),fallback=map11FallbackImage(),points=entries.filter(x=>hasNum(x.x)&&hasNum(x.y));
  return points.length?'<div class="map-stage"><img src="'+esc(image)+'" data-map-fallback="'+esc(fallback)+'" alt="Summoner’s Rift map for '+esc(entries[0]?.patternLabel||'death pattern')+'"><svg viewBox="0 0 512 512" preserveAspectRatio="none" aria-label="'+esc(entries[0]?.patternLabel||'death pattern')+' positions">'+points.map((p,i)=>mapPointSvg({...p,tags:[p.patternLabel,p.detail].filter(Boolean)},'death',i)).join('')+'</svg></div>':'<div class="spatial-empty">No coordinate evidence is available for this pattern.</div>';
}

function deathPatternGroupStats(entries){
  const measured=entries.filter(x=>x.consequenceMeasured),costly=entries.filter(x=>x.costly),severe=entries.filter(x=>x.severe),untradedCostly=entries.filter(x=>x.costly&&x.consequenceTraded===false),contaminated=entries.filter(x=>x.economyWindowContaminatedByRepeatDeath);
  return{count:entries.length,measured:measured.length,costly:costly.length,severe:severe.length,untradedCostly:untradedCostly.length,contaminated:contaminated.length};
}
function deathPatternGroupCompare(a,b){
  const as=deathPatternGroupStats(a[1]),bs=deathPatternGroupStats(b[1]);
  return bs.severe-as.severe||bs.costly-as.costly||bs.untradedCostly-as.untradedCostly||bs.count-as.count||String(a[0]).localeCompare(String(b[0]));
}
function deathPatternCardHtml(key,entries){
  const def=DEATH_PATTERN_DEFS[key]||DEATH_PATTERN_DEFS.multi_signal,examples=entries.slice().sort((a,b)=>Number(b.gameStartTimestamp||0)-Number(a.gameStartTimestamp||0)),stats=deathPatternGroupStats(entries);
  const priority=stats.severe?'Severe consequence evidence':stats.costly?'Costly consequence evidence':entries.length>=2?'Repeated high-risk pattern':'One-off high-risk pattern';
  return '<article class="death-pattern-card '+(stats.severe?'priority-severe':stats.costly?'priority-costly':'')+'">'+
    '<div class="death-pattern-head"><div><span>'+esc(def.label)+'</span><strong>'+entries.length+' death'+(entries.length===1?'':'s')+'</strong></div><p>'+esc(def.why)+'</p></div>'+
    '<div class="death-pattern-impact"><span>'+esc(priority)+'</span><div><b>'+stats.measured+'/'+stats.count+' aftermath measured</b><b>'+stats.costly+' costly</b><b>'+stats.severe+' severe</b><b>'+stats.untradedCostly+' untraded costly</b></div>'+(stats.contaminated?'<small>'+stats.contaminated+' economy aftermath sample'+(stats.contaminated===1?' was':'s were')+' repeat-death contaminated; contaminated economy swings are not treated as clean loss evidence.</small>':'')+'</div>'+
    deathPatternMap(examples)+
    '<div class="death-pattern-action"><b>Do differently:</b> '+esc(def.action)+'</div>'+
    '<details><summary>Explain these deaths · map numbers match this list</summary><div class="death-pattern-events">'+examples.map((x,i)=>'<div><b>#'+(i+1)+' · '+esc(x.champion||'Unknown')+' · '+esc(fmt(x.time,1))+'m</b><span>'+esc(x.detail||((x.tags||[]).join(', '))||'Multi-signal high-risk death')+(x.costly?' · measured costly aftermath':'')+(x.severe?' · severe aftermath':'')+'</span><small>'+esc(shortGameDate(x.gameStartTimestamp)+(x.opponentChampion?' · vs '+x.opponentChampion:''))+'</small></div>').join('')+'</div></details>'+
  '</article>';
}

function renderSpatial(r){
  const games=reportCoachingGames(r),patterns=deathPatternEntries(r),wardEvents=games.flatMap(g=>(g.wards||[])),wardPoints=wardEvents.filter(w=>hasNum(w.x)&&hasNum(w.y));
  const grouped=new Map();for(const d of patterns){if(!grouped.has(d.patternKey))grouped.set(d.patternKey,[]);grouped.get(d.patternKey).push(d);}
  const groups=[...grouped.entries()].sort(deathPatternGroupCompare),repeated=groups.filter(([,xs])=>xs.length>=2),oneOff=groups.filter(([,xs])=>xs.length===1);
  const repeatedHtml=repeated.length?'<div class="death-pattern-grid">'+repeated.map(([key,entries])=>deathPatternCardHtml(key,entries)).join('')+'</div>':'<div class="spatial-empty">No high-risk death pattern repeats at least twice in this role-selected sample.</div>';
  const oneOffHtml=oneOff.length?'<details class="death-pattern-oneoffs"><summary>One-off high-risk patterns · '+oneOff.length+'</summary><p>Kept for traceability, but not promoted as recurring behavior.</p><div class="death-pattern-grid">'+oneOff.map(([key,entries])=>deathPatternCardHtml(key,entries)).join('')+'</div></details>':'';
  $('deathMap').innerHTML=repeatedHtml+oneOffHtml;
  const image=map11Image(),fallback=map11FallbackImage();
  $('wardMap').innerHTML=wardPoints.length?'<div class="map-stage"><img src="'+esc(image)+'" data-map-fallback="'+esc(fallback)+'" alt="Summoner’s Rift ward placement map"><svg viewBox="0 0 512 512" preserveAspectRatio="none" aria-label="Ward positions">'+wardPoints.map(p=>mapPointSvg(p,'ward')).join('')+'</svg></div>':'<div class="spatial-empty">Ward events were counted, but none have event or ≤35s frame coordinates to project.</div>';
  bindMapFallbacks($('spatialReview')||document);
  const classified=patterns.length,repeatGroups=repeated.length,leadDeaths=patterns.filter(x=>hasNum(x.goldDiffAtDeath)&&Number(x.goldDiffAtDeath)>=500).length,costly=patterns.filter(x=>x.costly).length,severe=patterns.filter(x=>x.severe).length;
  $('deathMapMeta').textContent=classified+' high-risk deaths · '+repeatGroups+' repeated pattern'+(repeatGroups===1?'':'s')+' · '+costly+' costly · '+severe+' severe'+(leadDeaths?' · '+leadDeaths+' while ≥500g ahead':'');
  const offensive=wardEvents.filter(x=>x.territory==='offensive').length,river=wardEvents.filter(x=>x.territory==='river').length,defensive=wardEvents.filter(x=>x.territory==='defensive').length,setup=wardEvents.filter(x=>x.objectiveSetup).length,offPct=wardEvents.length?Math.round(offensive/wardEvents.length*100):0,projected=wardPoints.length;
  $('wardMapMeta').textContent=wardEvents.length+' ward events · '+projected+' mapped · '+offPct+'% offensive · '+river+' river · '+defensive+' defensive · '+setup+' objective setup';
  $('spatialProjectionNote').textContent='Repeated death patterns use the current mechanics-filtered coaching cohort and are ordered by bounded consequence evidence first (severe, then costly), then recurrence. This is a review-priority ordering, not a causal severity score. One-offs remain available for traceability. Ward events without Riot coordinates use the player’s nearest timeline-frame position only when it is within 35 seconds; projected versus direct evidence is disclosed in Trust & coverage.';
}
function renderSavedProfiles(){
  const select=$('savedProfileSelect');if(!select)return;
  const prefs=profilePreferences(),profiles=[...(state.savedProfiles||[])].sort((a,b)=>Number(prefs.pins.includes(String(b.id)))-Number(prefs.pins.includes(String(a.id)))||String(a.display_name||a.game_name).localeCompare(String(b.display_name||b.game_name)));
  select.innerHTML='<option value="">Add a new Riot profile</option>'+profiles.map(p=>'<option value="'+esc(p.id)+'">'+esc((prefs.pins.includes(String(p.id))?'★ ':'')+(p.display_name||p.game_name+'#'+p.tag_line)+' · '+String(p.platform_region||'euw1').toUpperCase())+'</option>').join('');
  select.value=profiles.some(p=>String(p.id)===String(state.selectedProfileId))?String(state.selectedProfileId):'';
  const current=profiles.find(p=>String(p.id)===String(state.selectedProfileId))||null;
  $('savedProfileTitle').textContent=current?(current.display_name||current.game_name+'#'+current.tag_line):'Add a Riot profile';
  $('savedProfileMeta').textContent=current?current.game_name+'#'+current.tag_line+' · '+String(current.platform_region||'euw1').toUpperCase()+' · preferred '+roleLabel(profileRole(current))+' · saved in this browser’s workspace':'Save a Riot ID to return to it later. The Riot API key is never saved.';
  const query=String($('profileSearch')?.value||'').trim().toLowerCase(),visible=profiles.filter(p=>[p.display_name,p.game_name,p.tag_line,p.platform_region,roleLabel(profileRole(p))].join(' ').toLowerCase().includes(query)),cards=$('profileCards');
  if(cards){
    cards.innerHTML=visible.length?visible.map(p=>{const active=String(p.id)===String(state.selectedProfileId),pinned=prefs.pins.includes(String(p.id));return '<article class="profile-card'+(active?' selected':'')+'"><button type="button" class="profile-card-select" data-select-profile="'+esc(p.id)+'" aria-pressed="'+active+'"><strong>'+esc(p.display_name||p.game_name+'#'+p.tag_line)+'</strong><span>'+esc(p.game_name+'#'+p.tag_line)+'</span><small>'+esc(String(p.platform_region||'euw1').toUpperCase()+' · '+roleLabel(profileRole(p)))+' · '+(active?'Selected':'Open saved report')+'</small></button><button type="button" class="profile-pin" data-pin-profile="'+esc(p.id)+'" aria-pressed="'+pinned+'" aria-label="'+(pinned?'Unpin ':'Pin ')+esc(p.display_name||p.game_name)+'">'+(pinned?'★':'☆')+'</button></article>';}).join(''):'<p class="profile-empty">'+(query?'No saved profile matches your search.':'Save your first Riot ID below. You can name and pin profiles for quick access.')+'</p>';
    cards.querySelectorAll('[data-select-profile]').forEach(n=>n.onclick=()=>applySavedProfile(n.dataset.selectProfile));
    cards.querySelectorAll('[data-pin-profile]').forEach(n=>n.onclick=()=>toggleProfilePin(n.dataset.pinProfile));
  }
  syncButtons();
}
function rememberProfileSelection(id){
  state.selectedProfileId=String(id||'');
  try{if(state.selectedProfileId)localStorage.setItem(LEAGUE_SLOT_SELECTION_KEY,state.selectedProfileId);else localStorage.removeItem(LEAGUE_SLOT_SELECTION_KEY);}catch(_){}
  renderSavedProfiles();
}
async function rebuildSavedRoleReportFromCache(profile,selectedRole,reason='',isActive=()=>true){
  let cache=null;
  try{cache=await api('cache_status',{profile_id:profile.id,target_role:selectedRole});}catch(_){}
  if(!isActive())return null;
  const cachedRoleGames=Number(cache?.selected_role_cached_games??cache?.role_counts?.[selectedRole]??0);
  if(cachedRoleGames<=0)return null;
  $('analysisState').textContent='Rebuilding saved '+roleLabel(selectedRole)+' report';
  $('sourceState').textContent='Using cached Riot data'+(reason?' · '+reason:'');
  statusPill('Rebuilding '+roleLabel(selectedRole)+' report','warn');
  const rebuilt=await api('analyze_basic',{profile_id:profile.id,target_role:selectedRole});
  if(!isActive())return null;
  if(!rebuilt?.analysis_id)throw new Error('Cache rebuild returned no saved analysis ID.');
  const report=rebuilt?.report||null,scope=reportRoleScopeViolations(report,selectedRole);
  if(scope.total)throw new Error('Role-selection safety check failed during saved-report rebuild: '+scope.total+' other-role game(s) detected.');
  if(!report?.games?.length)return null;
  let history=null;
  try{history=await api('report_latest',{profile_id:profile.id,target_role:selectedRole});}catch(_){}
  if(!isActive())return null;
  return{report,cachedRoleGames,previous:history?.previous?.report_data||null,previousAt:history?.previous?.created_at||null};
}
async function loadSavedReport(profile){
  if(!profile?.id)return;
  const selectedRole=selectedAnalysisRole(),epoch=state.profileLoadEpoch;
  const isActive=()=>epoch===state.profileLoadEpoch&&String(state.profile?.id)===String(profile.id)&&selectedAnalysisRole()===selectedRole;
  try{
    const d=await api('report_latest',{profile_id:profile.id,target_role:selectedRole});
    if(!isActive())return;
    const current=d.analysis?.report_data||null,previous=d.previous?.report_data||null,liveAnalyzer=String(state.backendAnalyzerVersion||''),savedAnalyzer=String(current?.analyzerVersion||'');
    if(current){
      const staleAnalyzer=!!liveAnalyzer&&savedAnalyzer!==liveAnalyzer,scope=reportRoleScopeViolations(current,selectedRole),roleContaminated=scope.total>0;
      if(staleAnalyzer||roleContaminated){
        try{
          const rebuilt=await rebuildSavedRoleReportFromCache(profile,selectedRole,roleContaminated?('role-scope repair: '+scope.total+' other-role game(s)'):('analyzer '+(savedAnalyzer||'unknown')+' → '+liveAnalyzer),isActive);
          if(!isActive())return;
          if(rebuilt){
            renderReport(rebuilt.report,'saved_server');
            renderProgressComparison(rebuilt.report,rebuilt.previous,rebuilt.previousAt);
            $('analysisState').textContent=rebuilt.report.games.length+' saved '+roleLabel(selectedRole)+' games';
            $('sourceState').textContent='Saved Kalenel analysis · refreshed to '+liveAnalyzer;
            statusPill('Saved '+roleLabel(selectedRole)+' report refreshed');
            log('Refreshed the saved '+roleLabel(selectedRole)+' report from analyzer '+(savedAnalyzer||'unknown')+' to '+liveAnalyzer+' using '+rebuilt.cachedRoleGames+' cached role game(s); no Riot refetch or API key was needed.','ok');
            return;
          }
          if(roleContaminated)throw new Error('Saved '+roleLabel(selectedRole)+' report contains '+scope.total+' other-role game(s) and could not be rebuilt safely.');
          log('Saved '+roleLabel(selectedRole)+' report uses analyzer '+(savedAnalyzer||'unknown')+' while the backend is '+liveAnalyzer+', but no cached role games were available for an automatic rebuild. Showing the saved report as stale context.','bad');
        }catch(rebuildError){
          if(!isActive())return;
          if(roleContaminated)throw rebuildError;
          log('Automatic cached rebuild for analyzer '+(savedAnalyzer||'unknown')+' → '+liveAnalyzer+' failed: '+rebuildError.message+'. Showing the existing saved report instead.','bad');
        }
      }
      if(roleContaminated)throw new Error('Unsafe saved report role scope; rebuild required before display.');
      renderReport(current,'saved_server');
      renderProgressComparison(current,previous,d.previous?.created_at||null);
      $('analysisState').textContent=(current.games?.length||0)+' saved '+roleLabel(selectedRole)+' games';
      $('sourceState').textContent=staleAnalyzer?'Saved Kalenel analysis · older analyzer '+(savedAnalyzer||'unknown'):'Saved Kalenel analysis';
      statusPill(staleAnalyzer?'Saved report · analyzer refresh pending':'Saved '+roleLabel(selectedRole)+' report loaded',staleAnalyzer?'warn':undefined);
    }else{
      // A role-pure report may be absent even though the Riot match/timeline cache
      // is already complete. Rebuild deterministically from cache with no Riot key.
      try{
        const rebuilt=await rebuildSavedRoleReportFromCache(profile,selectedRole,'role report missing',isActive);
        if(!isActive())return;
        if(rebuilt){
          renderReport(rebuilt.report,'saved_server');
          renderProgressComparison(rebuilt.report,rebuilt.previous,rebuilt.previousAt);
          $('analysisState').textContent=rebuilt.report.games.length+' saved '+roleLabel(selectedRole)+' games';
          $('sourceState').textContent='Saved Kalenel analysis · rebuilt from cache';
          statusPill('Saved '+roleLabel(selectedRole)+' report rebuilt');
          log('Rebuilt a role-pure '+roleLabel(selectedRole)+' report from '+rebuilt.cachedRoleGames+' cached '+roleLabel(selectedRole)+' game(s); no Riot refetch was needed.','ok');
          return;
        }
      }catch(rebuildError){if(!isActive())return;log('Cached '+roleLabel(selectedRole)+' report rebuild: '+rebuildError.message,'bad');}
      clearSelectedReport('No saved '+roleLabel(selectedRole)+' report yet');
      profileFeedback('Profile saved. Add a Riot key to fetch new '+roleLabel(selectedRole)+' games.');
      $('analysisState').textContent='No saved '+roleLabel(selectedRole)+' report yet';
      $('sourceState').textContent='Profile saved · analyze this role';
    }
  }catch(e){if(!isActive())return;clearSelectedReport('Could not open the saved report');profileFeedback('Could not open this report: '+e.message,'bad');log('Saved report: '+e.message,'bad');}
}
async function applySavedProfile(id,{loadReport=true}={}){
  if(state.busy)return;
  const p=(state.savedProfiles||[]).find(x=>String(x.id)===String(id));if(!p)return;
  const epoch=++state.profileLoadEpoch;clearSelectedReport('Opening saved profile…');
  state.profile=p;rememberProfileSelection(p.id);
  $('requestGameName').value=p.game_name||'';$('requestTagLine').value=p.tag_line||'';$('requestRegion').value=p.platform_region||'euw1';
  if($('profileLabel'))$('profileLabel').value=p.display_name||'';
  state.selectedRole=profileRole(p);$('requestRole').value=state.selectedRole;
  if($('profileEditor'))$('profileEditor').open=false;
  profileFeedback('Opening '+(p.display_name||p.game_name)+' · '+roleLabel(state.selectedRole)+'…');
  syncButtons();
  await Promise.all([loadCacheStatus(),loadReport?loadSavedReport(p):Promise.resolve()]);
  if(epoch!==state.profileLoadEpoch)return;
  if(state.report)profileFeedback('Saved '+roleLabel(state.selectedRole)+' report opened. Add a Riot key only when you want new matches.','ok');
}
async function refreshSavedProfiles({restore=false}={}){
  try{
    const d=await api('profiles_list');let profiles=Array.isArray(d.profiles)?d.profiles:[];
    const legacy=profiles.find(p=>String(p.profile_key||'')==='recent-request'&&p.game_name&&p.tag_line)||null;
    const duplicate=legacy?profiles.find(p=>String(p.id)!==String(legacy.id)&&sameRiotIdentity(p,legacy.game_name,legacy.tag_line,legacy.platform_region)):null;
    if(legacy&&!duplicate){
      try{
        let inferredRole=profileRole(legacy);
        try{
          const oldHistory=await api('report_latest',{profile_id:legacy.id});
          inferredRole=canonicalRole(oldHistory.analysis?.report_data?.dataQuality?.selectedRole||oldHistory.analysis?.report_data?.summary?.primaryRole||inferredRole);
        }catch(_){}
        const migrated=await api('profile_save',{profile:{id:legacy.id,profile_key:generatedProfileKey(legacy.game_name,legacy.tag_line,legacy.platform_region),display_name:legacy.display_name||legacy.game_name+'#'+legacy.tag_line,game_name:legacy.game_name,tag_line:legacy.tag_line,platform_region:legacy.platform_region||'euw1',notes:profileNotes(inferredRole)}});
        if(migrated.profile){
          profiles=profiles.map(p=>String(p.id)===String(legacy.id)?migrated.profile:p);
          try{
            const rebuilt=await api('analyze_basic',{profile_id:migrated.profile.id,target_role:inferredRole});
            log('Your previous Riot identity was upgraded in place and '+String(rebuilt.report?.games?.length||0)+' cached '+roleLabel(inferredRole)+' game(s) were rebuilt into a role-pure saved report.','ok');
          }catch(rebuildError){log('Profile migrated; cached role report can be rebuilt on the next analysis: '+rebuildError.message,'bad');}
        }
      }catch(e){log('Legacy Riot profile migration was skipped: '+e.message,'bad');}
    }
    state.savedProfiles=profiles.filter(p=>String(p.profile_key||'')!=='recent-request');
    let wanted=state.selectedProfileId;
    if(restore&&!wanted){try{wanted=String(localStorage.getItem(LEAGUE_SLOT_SELECTION_KEY)||'');}catch(_){}}
    if(restore&&!state.savedProfiles.some(p=>String(p.id)===String(wanted))&&state.savedProfiles.length)wanted=String(state.savedProfiles[0].id);
    state.selectedProfileId=state.savedProfiles.some(p=>String(p.id)===String(wanted))?String(wanted||''):'';
    renderSavedProfiles();
    if(restore&&state.selectedProfileId)await applySavedProfile(state.selectedProfileId,{loadReport:true});
  }catch(e){log('Saved profiles: '+e.message,'bad');}
}
function startNewProfile(){
  if(state.busy)return;
  state.profileLoadEpoch++;clearSelectedReport();profileFeedback('');
  if($('profileEditor'))$('profileEditor').open=true;
  if($('profileLabel'))$('profileLabel').value='';
  $('cacheState').textContent='0 games';$('latestGameState').textContent='—';
  state.profile=null;rememberProfileSelection('');
  if($('requestGameName'))$('requestGameName').value='';
  if($('requestTagLine'))$('requestTagLine').value='';
  if($('requestRole'))$('requestRole').value='ADC';
  state.selectedRole='ADC';
  $('report').hidden=true;$('reportEmpty').hidden=false;
  $('analysisState').textContent='Not run yet';$('sourceState').textContent='Waiting for request';syncButtons();
  $('requestGameName')?.focus();
}
async function forgetSavedProfile(){
  const id=state.selectedProfileId;if(!id)return;
  const p=state.savedProfiles.find(x=>String(x.id)===String(id));if(!p)return;
  if(!globalThis.confirm('Delete the saved League profile '+String(p.display_name||'')+' and its server-side profile record?'))return;
  try{await api('profile_delete',{profile_id:id});state.savedProfiles=state.savedProfiles.filter(x=>String(x.id)!==String(id));startNewProfile();renderSavedProfiles();log('Saved League profile deleted.','ok');}
  catch(e){log('Could not delete saved profile: '+e.message,'bad');}
}
function directRequestComplete(){
  const game=String($('requestGameName')?.value||'').trim();
  const tag=String($('requestTagLine')?.value||'').trim();
  const region=String($('requestRegion')?.value||'').trim();
  return !!game&&!!tag&&!!region&&(state.serverRiotKey||!!state.riotApiKey);
}
async function ensureDirectRequestProfile({requireResolved=true}={}){
  const gameName=String($('requestGameName')?.value||'').trim(),tagLine=String($('requestTagLine')?.value||'').trim(),platformRegion=String($('requestRegion')?.value||'euw1'),targetRole=selectedAnalysisRole();
  if(!gameName||!tagLine)throw new Error('Enter a Riot game name and tag.');
  const existing=(state.savedProfiles||[]).find(p=>sameRiotIdentity(p,gameName,tagLine,platformRegion))||null;
  const d=await api('profile_save',{
    profile:{
      ...(existing?.id?{id:existing.id}:{}),
      profile_key:existing?.profile_key||generatedProfileKey(gameName,tagLine,platformRegion),
      display_name:String($('profileLabel')?.value||'').trim()||existing?.display_name||gameName+'#'+tagLine,
      game_name:gameName,
      tag_line:tagLine,
      platform_region:platformRegion,
      notes:profileNotes(targetRole)
    }
  });
  if(requireResolved&&d.resolve_warning)throw new Error('Riot account lookup failed: '+d.resolve_warning);
  if(requireResolved&&!d.profile?.puuid)throw new Error('Riot account lookup did not return a PUUID.');
  if(!d.profile?.id)throw new Error('Profile save did not return a saved profile.');
  state.profile=d.profile;state.selectedRole=targetRole;saveProfilePreference(d.profile.id,targetRole);
  const idx=state.savedProfiles.findIndex(p=>String(p.id)===String(d.profile.id));if(idx>=0)state.savedProfiles[idx]=d.profile;else state.savedProfiles.unshift(d.profile);
  rememberProfileSelection(d.profile.id);
  $('sourceState').textContent=d.profile?.puuid?'Riot profile saved + resolved':'Riot ID saved · resolve when fetching matches';
  return d.profile;
}
async function saveProfileOnly(){
  if(state.busy)return;
  const oldId=state.profile?.id;state.profileLoadEpoch++;setBusy(true,'Saving profile');profileFeedback('Saving profile…');
  try{
    const p=await ensureDirectRequestProfile({requireResolved:false});
    if(String(oldId)!==String(p.id))clearSelectedReport('Profile saved · fetch matches when ready');
    if($('profileEditor'))$('profileEditor').open=false;
    $('profileLabel').value=p.display_name||'';
    profileFeedback('Saved '+p.display_name+' · preferred '+roleLabel(state.selectedRole)+'.','ok');
    statusPill('Profile saved');
    await Promise.all([loadCacheStatus(),loadSavedReport(p)]);
  }catch(e){profileFeedback('Could not save profile: '+e.message,'bad');statusPill('Profile save failed','error');}
  finally{setBusy(false);renderSavedProfiles();}
}
async function boot(){
  bindGameSortControls();
  bindGameFilterControls();
  clearLog();log('Ready. Enter a Riot ID, region and Riot API key, then load recent matches.');
  const dragonPromise=getDdragonVersion();
  try{
    const health=await api('health');
    await dragonPromise;
    state.serverRiotKey=!!health.server_riot_key;
    state.backendAnalyzerVersion=String(health.analyzer_version||'');
    state.publicWorkspace=health.public_workspace!==false;
    $('backendState').textContent=health.riot_configured?'Backend + Riot ready':'Backend ready · add Riot key';
    $('backendState').className='pill '+(health.riot_configured?'':'warn');
    $('riotKeyStatus').textContent=state.serverRiotKey?'Server Riot key available':'Your Riot key stays only in this browser tab.';
    log('League backend ready. Riot profiles and analysis history can be stored in this isolated Kalenel workspace; the API key remains session-only.','ok');
    await refreshSavedProfiles({restore:true});
    if($('progressPanel'))$('progressPanel').hidden=true;
  }catch(e){
    $('backendState').textContent='Backend unavailable';$('backendState').className='pill error';log(e.message,'bad');
  }
  syncButtons();
}
function syncButtons(){
  const run=$('loadRecentBtn');if(run)run.disabled=state.busy||!directRequestComplete();
  if($('saveProfileBtn'))$('saveProfileBtn').disabled=state.busy||!String($('requestGameName')?.value||'').trim()||!String($('requestTagLine')?.value||'').trim();
  if($('openSavedReportBtn'))$('openSavedReportBtn').disabled=state.busy||!state.profile;
  if($('forgetSavedProfileBtn'))$('forgetSavedProfileBtn').disabled=state.busy||!state.selectedProfileId;
}
async function loadCacheStatus(){
  if(!state.profile)return;
  try{
    const targetRole=selectedAnalysisRole(),id=state.profile.id,epoch=state.profileLoadEpoch,d=await api('cache_status',{profile_id:id,target_role:targetRole});
    if(epoch!==state.profileLoadEpoch||String(state.profile?.id)!==String(id)||selectedAnalysisRole()!==targetRole)return;
    const roleCount=Number(d.selected_role_cached_games??d.role_counts?.[targetRole]??0);
    $('cacheState').textContent=(d.cached_games||0)+' cached · '+roleCount+' '+roleLabel(targetRole);
    $('latestGameState').textContent=d.last_game_at?fmtDate(d.last_game_at):'None yet';
  }catch(e){
    $('cacheState').textContent='Unavailable';
    log('Cache status: '+e.message,'bad');
  }
}

async function fetchProfileData(profile,requestedCount,progressStart=8,progressEnd=82,targetRole=selectedAnalysisRole()){
  log('Scanning up to '+requestedCount+' recent Riot matches for '+profile.display_name+' · '+roleLabel(targetRole)+'. Match metadata is cached first; expensive timelines are then limited to the final selected-role Last-20 cohort.');
  const prep=await api('fetch_prepare',{profile_id:profile.id,count:requestedCount,target_role:targetRole});
  const ids=prep.match_ids||[],cached=new Set(prep.cached_match_ids||[]);
  if(!ids.length)throw new Error('Riot returned no recent match IDs.');
  let scanned=cached.size,failed=0,newMetadata=0,done=0;
  for(const id of ids){
    done++;
    if(!cached.has(id)){try{const one=await api('fetch_one',{run_id:prep.run_id,match_id:id,target_role:targetRole,fetch_depth:'metadata'});if(one.metadata_available){scanned++;newMetadata++;}}catch(e){failed++;log('Metadata scan '+id+' · '+e.message,'bad');}await sleep(70);}
    setProgress(progressStart+(progressEnd-progressStart)*.68*(done/Math.max(1,ids.length)),100);
    if(done%10===0||done===ids.length)log('Scanned '+done+'/'+ids.length+' recent matches · '+scanned+' metadata rows available · '+failed+' failed.',failed?'bad':'ok');
  }
  let plan=null,deepFetched=0,deepFailed=0,deepAttempted=0;
  for(let round=0;round<4;round++){
    plan=await api('fetch_finish',{run_id:prep.run_id,target_role:targetRole,plan_only:true});
    const deepIds=Array.isArray(plan.timeline_target_ids)?plan.timeline_target_ids:[];
    if(round===0)log(roleLabel(targetRole)+' cohort selected from the 100-game scan: '+String(plan.comparable_cached_games||0)+' same-role + queue games found; '+String(plan.timeline_available_count||0)+' deep timelines already cached and '+deepIds.length+' need fetch.','ok');
    if(!deepIds.length)break;
    for(const id of deepIds){
      deepAttempted++;
      try{const one=await api('fetch_one',{run_id:prep.run_id,match_id:id,target_role:targetRole,fetch_depth:'deep'});if(one.timeline_available)deepFetched++;else{deepFailed++;log('Timeline '+id+' unavailable; an older comparable game will be tried instead: '+(one.timeline_error||'unknown'),'bad');}}catch(e){deepFailed++;log('Timeline '+id+' · '+e.message,'bad');}
      setProgress(progressStart+(progressEnd-progressStart)*(.68+.32*Math.min(1,deepAttempted/20)),100);await sleep(90);
    }
  }
  const finish=await api('fetch_finish',{run_id:prep.run_id,target_role:targetRole});
  if(hasNum(finish?.dominant_queue_id))log(profile.display_name+' · '+roleLabel(targetRole)+' queue '+String(finish.dominant_queue_id)+' selected · '+String(finish.comparable_cached_games??0)+' comparable history games · '+String(finish.timeline_available_count??0)+' deep timeline slots ready · '+String(deepFailed)+' timeline failure'+(deepFailed===1?'':'s')+' replaced where possible · '+String(finish.peer_rank_backfilled??0)+' peer-rank snapshots added.','ok');
  const usable=Number(finish?.comparable_cached_games||0);if(usable===0)throw new Error('The 100-game scan found no eligible '+roleLabel(targetRole)+' games in a supported Summoner’s Rift queue.');
  return{prep,plan,finish,usable,failed:failed+deepFailed,newMetadata,deepFetched};
}
async function analyzeProfileData(profile,targetRole=selectedAnalysisRole()){
  log(profile.display_name+' · building the '+roleLabel(targetRole)+' Last-20 analysis from the matches just fetched/cached.');
  const d=await api('analyze_basic',{profile_id:profile.id,target_role:targetRole});
  if(!d?.analysis_id)throw new Error('Analyzer returned a report without a saved analysis ID.');
  log(profile.display_name+' · deterministic '+roleLabel(targetRole)+' analysis generated for '+(d.report?.dataQuality?.analyzedGames||0)+' games and assigned saved analysis '+String(d.analysis_id).slice(0,8)+'.','ok');
  return d;
}
async function runRecentAnalysis(){
  if(state.busy)return;
  if(!directRequestComplete()){
    statusPill('Missing details','error');
    log('Enter game name, tag, region and a Riot API key first.','bad');
    return;
  }
  const targetRole=selectedAnalysisRole();state.selectedRole=targetRole;state.profileLoadEpoch++;
  clearLog();setBusy(true,'Resolving Riot ID');statusPill('Resolving Riot ID','warn');
  $('report').hidden=true;$('reportEmpty').hidden=false;
  try{
    const profile=await ensureDirectRequestProfile();
    $('riotKeyStatus').textContent='Riot access verified for this request';
    log('Resolved '+profile.display_name+'. Fetching recent Riot matches for a '+roleLabel(targetRole)+'-only report.','ok');
    statusPill('Fetching '+roleLabel(targetRole)+' matches','warn');
    setProgress(4,100);
    const result=await fetchProfileData(profile,100,8,84,targetRole);
    setProgress(84,100);
    await loadCacheStatus();
    statusPill('Analyzing '+roleLabel(targetRole)+' Last 20','warn');
    setProgress(90,100);
    const d=await analyzeProfileData(profile,targetRole);
    const analyzed=Number(d.report?.dataQuality?.analyzedGames??d.report?.games?.length??0);
    if(analyzed<=0)throw new Error('No '+roleLabel(targetRole)+' games were eligible after queue/map/duration filtering. Try another role or fetch again after more matches.');
    const scope=reportRoleScopeViolations(d.report,targetRole);
    if(scope.total)throw new Error('Role-selection safety check failed: '+scope.deep+' deep and '+scope.history+' history game(s) outside '+targetRole+' entered the report.');
    renderReport(d.report,'web_behavior');
    let saveVerified=false;
    try{
      const history=await api('report_latest',{profile_id:profile.id,target_role:targetRole});
      saveVerified=String(history?.analysis?.id||'')===String(d.analysis_id||'');
      if(!saveVerified)log('Analysis rendered, but saved-report verification did not return the new analysis ID yet. The cache is preserved and the page will retry from cache on the next load.','bad');
      renderProgressComparison(d.report,history.previous?.report_data||null,history.previous?.created_at||null);
    }catch(e){
      $('progressComparisonPanel').hidden=true;
      log('Analysis rendered, but saved-report verification failed: '+e.message+'. The cached Riot data remains available for an automatic rebuild.','bad');
    }
    $('analysisState').textContent=analyzed+' '+roleLabel(targetRole)+' games analyzed';
    $('sourceState').textContent=saveVerified?'Saved Kalenel report · Riot + behavioral analyzer':'Generated report · save verification pending';
    setProgress(100,100);
    statusPill(roleLabel(targetRole)+' Last 20 ready');
    log(saveVerified?'Done — '+analyzed+' eligible '+roleLabel(targetRole)+' games analyzed and persistence verified on this Kalenel League profile.':'Done — '+analyzed+' eligible '+roleLabel(targetRole)+' games analyzed; saved-report verification is pending but the Riot cache is intact.',saveVerified?'ok':'bad');
  }catch(e){
    $('analysisState').textContent='Request failed';
    statusPill('Request failed','error');
    log('Request failed: '+e.message,'bad');
  }finally{setBusy(false);syncButtons();}
}

function normalizeReport(r){
  const out=(r&&typeof r==='object')?r:{};
  if(!Array.isArray(out.games))out.games=Array.isArray(out.last20)?out.last20:Array.isArray(out.PERGAME)?out.PERGAME:Array.isArray(out.perGame)?out.perGame:[];
  out.summary=out.summary||out.aggregates||{};
  out.byRole=out.byRole||{};
  out.byChampion=out.byChampion||out.byChamp||{};
  out.recentFocus=Array.isArray(out.recentFocus)?out.recentFocus:Array.isArray(out.tips20)?out.tips20:[];
  out.overallHighlights=Array.isArray(out.overallHighlights)?out.overallHighlights:Array.isArray(out.tips)?out.tips:[];
  out.priorityThemes=Array.isArray(out.priorityThemes)?out.priorityThemes:[];
  out.practiceTargets=Array.isArray(out.practiceTargets)?out.practiceTargets:[];
  out.advanced=out.advanced||{};
  out.benchmarks=out.benchmarks||{};
  out.externalBenchmarks=out.externalBenchmarks||{};
  out.dataQuality=out.dataQuality||{};
  out.longHorizon=out.longHorizon||{};
  out.historySummary=out.historySummary||out.lifetime||null;
  out.sourceStatus=out.sourceStatus||{};
  out.charts=out.charts||{};
  return out;
}
function reportSelectedRole(r,fallback=state.selectedRole){
  return canonicalRole(r?.dataQuality?.selectedRole||r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||fallback);
}
function reportRoleScopeViolations(report,requestedRole){
  const selected=canonicalRole(requestedRole)||reportSelectedRole(report);
  if(!selected)return{selectedRole:null,deep:0,history:0,total:0};
  const deep=(Array.isArray(report?.games)?report.games:[]).filter(g=>explicitGameRole(g?.role)!==selected).length;
  const counts=report?.longHorizon?.roleCounts&&typeof report.longHorizon.roleCounts==='object'?report.longHorizon.roleCounts:{};
  const historyFromCounts=Object.entries(counts).reduce((n,[roleKey,count])=>n+(canonicalRole(roleKey)!==selected?Number(count||0):0),0);
  const history=Math.max(historyFromCounts,Number(report?.dataQuality?.historyRoleScopeViolations||0));
  return{selectedRole:selected,deep,history,total:deep+history};
}
let heavyRenderTicket=0;
let heavyObservers=[];
function clearHeavyObservers(){
  for(const observer of heavyObservers)try{observer.disconnect();}catch(_){}
  heavyObservers=[];
}
function renderWhenNear(elementId,callback,rootMargin='700px'){
  const node=$(elementId);if(!node)return;
  if(typeof IntersectionObserver!=='function'){setTimeout(callback,40);return;}
  const observer=new IntersectionObserver(entries=>{
    if(entries.some(entry=>entry.isIntersecting)){
      observer.disconnect();
      callback();
    }
  },{root:null,rootMargin,threshold:0});
  observer.observe(node);heavyObservers.push(observer);
}
function prepareDecisionIntelligence(r){
  const panel=$('decisionIntelligencePanel'),box=$('decisionIntelligence');if(!panel||!box)return;
  const analytics=Array.isArray(r?.decisionIntelligence?.analytics)?r.decisionIntelligence.analytics:[];
  if(!analytics.length){panel.hidden=true;box.innerHTML='';return;}
  panel.hidden=false;box.innerHTML='<div class="deferred-report-placeholder"><strong>25-part decision review</strong><span>The detailed graphs and maps render when this section approaches the viewport.</span></div>';
}
function prepareMatchHistory(r){
  const list=$('matchHistoryList'),summary=$('matchHistorySummary');if(!list||!summary)return;
  const n=reportCoachingGames(r).filter(g=>gameIsCoachingContext(r,g)).length;
  summary.innerHTML='<span><b>'+n+'</b> comparable matches</span><small>Rows render when this section approaches the viewport.</small>';
  list.innerHTML='<div class="deferred-report-placeholder"><strong>Recent match stories</strong><span>Deferred to keep the report’s first paint responsive.</span></div>';
}
function measuredDeferredRender(name,fn){
  const started=typeof performance!=='undefined'&&performance.now?performance.now():0;
  fn();
  const ended=typeof performance!=='undefined'&&performance.now?performance.now():0;
  state.reportRenderPerformance=state.reportRenderPerformance||{};
  if(started&&ended)state.reportRenderPerformance[name+'Ms']=Math.round((ended-started)*10)/10;
}
function scheduleHeavyReportRender(r){
  const ticket=++heavyRenderTicket;clearHeavyObservers();
  const safe=(name,fn)=>()=>{if(ticket===heavyRenderTicket&&state.report===r)measuredDeferredRender(name,fn);};
  renderWhenNear('decisionIntelligencePanel',safe('decisionIntelligence',()=>window.renderDecisionIntelligence?.(r)),'1200px');
  renderWhenNear('match-history',safe('matchHistory',()=>renderMatchHistory(r)),'1100px');
  renderWhenNear('lane-economy',safe('economyCharts',()=>renderCharts(r)),'900px');
  renderWhenNear('spatialReview',safe('spatialReview',()=>renderSpatial(r)),'650px');
}
function bindTechnicalMetrics(r){
  const details=$('technicalMetricsDetails');if(!details)return;
  details.dataset.rendered='0';
  const render=()=>{
    if(details.dataset.rendered==='1'||state.report!==r)return;
    details.dataset.rendered='1';
    renderAdvanced(r);
  };
  details.onToggle=null;
  details.addEventListener('toggle',()=>{if(details.open)render();},{once:true});
}
function renderReport(raw,sourceKind){
  const renderStarted=typeof performance!=='undefined'&&performance.now?performance.now():0;
  const r=normalizeReport(raw);state.report=r;
  $('reportEmpty').hidden=true;$('report').hidden=false;
  const p=r.profile||{},s=r.summary||{};
  $('reportTitle').textContent=p.displayName||p.display_name||state.profile?.display_name||'League account';
  const riotId=[p.gameName||p.game_name,p.tagLine||p.tag_line].filter(Boolean).join('#');
  const rank=p.rank&&p.rank.tier?[p.rank.tier,p.rank.rank,p.rank.leaguePoints!=null?String(p.rank.leaguePoints)+' LP':''].filter(Boolean).join(' '):'';
  const coachingN=reportCoachingGames(r).length,reportRole=reportSelectedRole(r,s.primaryRole);
  const reportTimes=(r.games||[]).map(g=>gameTimestampMs(g.gameStartTimestamp)).filter(Boolean).sort((a,b)=>a-b),historyN=Number(r?.longHorizon?.sampleGames||0);
  const reportRange=reportTimes.length?(new Date(reportTimes[0]).toLocaleDateString(undefined,{day:'numeric',month:'short'})+' → '+new Date(reportTimes[reportTimes.length-1]).toLocaleDateString(undefined,{day:'numeric',month:'short'})):'';
  $('reportSubtitle').textContent=(riotId?riotId+' · ':'')+(rank?rank+' · ':'')+(s.games??r.games.length)+' '+roleLabel(reportRole)+' deep games · '+coachingN+' coaching-comparable'+(historyN>Number(s.games??r.games.length)?' · '+historyN+'-game history':'')+(reportRange?' · '+reportRange:'');
  if($('rankRadarPanel'))$('rankRadarPanel').hidden=reportRole!=='ADC';
  $('reportSourceBadge').textContent=sourceKind==='legacy_import'?'Imported current report':sourceKind==='saved_server'?'Saved Kalenel report':(r.analyzerVersion||'Web analysis');
  renderQuickRead(r);
  renderRecentPulse(r);
  renderLongHorizon(r);
  renderReportDrivers(r);
  renderCurrentStrengths(r);
  renderCoachingSynthesis(r);
  renderEvidenceHealth(r);
  renderKpis(r);
  renderMatchRhythm(r);
  if($('glanceScope'))$('glanceScope').textContent=coachingN+' '+roleLabel(reportRole)+' coaching games · '+(r.games||[]).length+' deep games';
  if($('historyScope'))$('historyScope').textContent=historyN+' '+roleLabel(reportRole)+' history games · same selected queue';
  renderSupportRoleLens(r);
  renderRoleSpecificLens(r);
  renderRoleSectionCopy(r);
  renderOutcomeFingerprint(r);
  renderLearningReview(r);
  renderRankRadar(r);
  renderVisualSummary(r);
  renderBullets('recentFocus',r.priorityThemes?.length?r.priorityThemes:r.recentFocus,'No grounded improvement priority has enough evidence yet.');
  renderPracticePlan(r);
  renderDecisionMetrics(r);
  renderSpendingFightComparison(r);
  renderVisualAnalytics(r);
  renderObjectiveFamilyOverview(r);
  renderTeamfightDecisionOverview(r);
  prepareDecisionIntelligence(r);
  renderPhaseDiagnostic(r);
  renderCompoundSignals(r);
  renderSessionHabits(r);
  renderGameArcs(r);
  renderPlayerReview(r);
  prepareMatchHistory(r);
  renderGames(r);
  renderReplayReviewQueue(r);
  renderBreakdowns(r);
  renderSupportSynergy(r);
  renderQuality(r);
  $('advancedMetrics').innerHTML='<div class="technical-placeholder">Open this section to render the full metric set.</div>';
  $('benchmarkMetrics').innerHTML='<div class="technical-placeholder">Open this section to render the full benchmark set.</div>';
  bindTechnicalMetrics(r);
  $('chartGrid').innerHTML='<div class="chart-empty">Charts load when this section approaches the viewport.</div>';
  $('deathMap').innerHTML='<div class="spatial-empty">Map loads when this section approaches the viewport.</div>';
  $('wardMap').innerHTML='<div class="spatial-empty">Map loads when this section approaches the viewport.</div>';
  if(renderStarted&&typeof performance!=='undefined'&&performance.now){
    state.reportRenderPerformance={initialMs:Math.round((performance.now()-renderStarted)*10)/10};
    $('report').dataset.initialRenderMs=String(state.reportRenderPerformance.initialMs);
  }
  scheduleHeavyReportRender(r);
}

function adcBenchmarkSummary(r){
  const role=canonicalRole(r?.dataQuality?.selectedRole||r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||state.selectedRole),ext=r?.externalBenchmarks||{};
  return role==='ADC'&&ext.eligible===true?(r.coachingSummary||r.summary||null):null;
}
function adcBenchmarkUnavailableReason(r){
  const role=canonicalRole(r?.dataQuality?.selectedRole||r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||state.selectedRole),ext=r?.externalBenchmarks||{};
  if(role!=='ADC'||ext.eligibilityReason==='selected_role_not_adc')return 'The external benchmark is ADC-specific and is withheld because ADC is not this report’s selected coaching role.';
  if(ext.eligibilityReason==='selected_cohort_not_ranked')return 'The selected Last-20 cohort is not Ranked Solo/Flex, while the external reference corpus is ranked games. The population spider is withheld to avoid an apples-to-oranges comparison.';
  if(ext.eligibilityReason==='matching_rank_queue_tier_unavailable')return 'Riot did not return a ranked tier for the same ranked queue as this report cohort, so the population benchmark is withheld.';
  return 'The ranked ADC population benchmark is unavailable for this report.';
}
function benchmarkKpi(label,value,benchmark,unit,inverse=false,extra=''){
  const delta=hasNum(value)&&hasNum(benchmark)?Number(value)-Number(benchmark):null;
  const tone=delta==null?'neutral':deltaTone(delta,0,unit==='csmin'?.15:unit==='percent'?2:unit==='dpm'?50:unit==='kda'?.2:unit==='deaths'?.25:.01,inverse);
  const formatted=unit==='percent'?fmtPct(value):unit==='csmin'?fmt(value,2):unit==='dpm'?fmtInt(value):unit==='deaths'?fmt(value,1):fmt(value,2);
  const benchmarkText=unit==='percent'?fmtPct(benchmark):unit==='csmin'?fmt(benchmark,2):unit==='dpm'?fmtInt(benchmark):unit==='deaths'?fmt(benchmark,1):fmt(benchmark,2);
  const deltaText=delta==null?'benchmark unavailable':unit==='percent'?signed(delta,1)+' points':unit==='csmin'?signed(delta,2):unit==='dpm'?signed(delta,0):unit==='deaths'?signed(delta,1):signed(delta,2);
  return{label,value:formatted,tone,sub:'External ref '+benchmarkText+' · '+deltaText+(extra?' · '+extra:''),bar:delta==null?'':contextBar(delta,unit==='dpm'?500:unit==='csmin'?2:unit==='percent'?15:unit==='deaths'?3:2,inverse)};
}

function reportInsightParts(x,fallback){
  if(typeof x==='string'){
    const copy=x.trim();return copy?{present:true,title:fallback,copy,action:'',meta:'',confidence:'',supportCount:0,independentSupportCount:0}:{present:false,title:'Not enough evidence',copy:'No supported '+fallback.toLowerCase()+' has crossed the report threshold yet.',action:'',meta:'',confidence:'',supportCount:0,independentSupportCount:0};
  }
  if(!x||typeof x!=='object')return {present:false,title:'Not enough evidence',copy:'No supported '+fallback.toLowerCase()+' has crossed the report threshold yet.',action:'',meta:'',confidence:'',supportCount:0,independentSupportCount:0};
  const sourceTitle=String(x.title||x.label||x.category||'').trim(),copy=String(x.evidence||x.text||x.comparison||'').trim(),action=String(x.action||'').trim(),present=Boolean(sourceTitle||copy||action),confidence=String(x.confidence||'').trim().toLowerCase(),supportCount=Number(x.supportCount||0),independentSupportCount=Number(x.independentSupportCount||0);
  const meta=[confidence?confidence+' confidence':'',independentSupportCount>0?String(independentSupportCount)+' additional evidence view'+(independentSupportCount===1?'':'s'):'',supportCount>1?String(supportCount)+' related findings total':'',x.comparison?'vs '+String(x.comparison):''].filter(Boolean).join(' · ');
  return {present,title:present?(sourceTitle||fallback):'Not enough evidence',copy:present?copy:'No supported '+fallback.toLowerCase()+' has crossed the report threshold yet.',action:present?action:'',meta:present?meta:'',confidence,supportCount,independentSupportCount};
}
function roleRecentTrendSpecs(r){
  const t=r.recentTrend||{},role=canonicalRole(r?.dataQuality?.selectedRole||r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||state.selectedRole);
  const spec=(label,obj,unit,inverse,threshold,minRecentEvents=0,minPriorEvents=0,minRecentGames=3,minPriorGames=5)=>({label,obj,unit,inverse,threshold,minRecentEvents,minPriorEvents,minRecentGames,minPriorGames});
  if(role==='SUPPORT')return[
    spec('Roam conversion',t.roamConversion,'percent',false,15,4,5,3,5),
    spec('ADC lane movement during roams',t.supportAdcLaneCost,'cs',false,2,4,5,3,5),
    spec('Vision-action death rate',t.visionActionDeath,'percent',true,5,12,12,4,5),
    spec('Prior objective setup',t.objectiveSetup,'percent',false,10,5,5,3,5),
    spec('Contested objective presence',t.objectiveJoin,'percent',false,10,5,5,3,5)
  ];
  if(role==='JUNGLE')return[
    spec('CS/min vs JUNGLE peer',t.peerCsMinDelta,'csmin',false,.15),
    spec('First impact vs JUNGLE peer',t.impactDelta,'minutes',true,1),
    spec('First major vs JUNGLE peer',t.itemDelta,'minutes',true,.5),
    spec('Prior objective setup',t.objectiveSetup,'percent',false,10,5,5,3,5),
    spec('Contested objective presence',t.objectiveJoin,'percent',false,10,5,5,3,5)
  ];
  if(role==='MID')return[
    spec('Gold @15 vs MID peer',t.goldDiff15,'gold',false,150),
    spec('First impact vs MID peer',t.impactDelta,'minutes',true,1),
    spec('Roam conversion',t.roamConversion,'percent',false,15,4,5,3,5),
    spec('Prior objective setup',t.objectiveSetup,'percent',false,10,5,5,3,5),
    spec('High-risk deaths',t.badDeaths,'num',true,.2)
  ];
  if(role==='TOP')return[
    spec('Gold @15 vs TOP peer',t.goldDiff15,'gold',false,150),
    spec('CS/min vs TOP peer',t.peerCsMinDelta,'csmin',false,.15),
    spec('Early-lead give-back',t.earlyLeadGiveback,'percent',true,15,2,4),
    spec('Pre-objective side-lane deaths',t.preObjectiveSideLaneDeaths,'num',true,.2),
    spec('High-risk deaths',t.badDeaths,'num',true,.2)
  ];
  return[
    spec('Gold @15 vs ADC peer',t.goldDiff15,'gold',false,150),
    spec('CS/min vs ADC peer',t.peerCsMinDelta,'csmin',false,.15),
    spec('DPM vs ADC peer',t.peerDpmDelta,'dpm',false,50),
    spec('Deaths vs ADC peer',t.peerDeathsDelta,'num',true,.25),
    spec('High-risk deaths',t.badDeaths,'num',true,.2)
  ];
}
function recentTrendSpecReady(spec){
  const o=spec?.obj;
  if(!o||!hasNum(o.recent)||!hasNum(o.prior)||Number(o.recentN||0)<Number(spec.minRecentGames||3)||Number(o.priorN||0)<Number(spec.minPriorGames||5))return false;
  if(Number(spec.minRecentEvents||0)>0&&Number(o.recentEvents||0)<Number(spec.minRecentEvents))return false;
  if(Number(spec.minPriorEvents||0)>0&&Number(o.priorEvents||0)<Number(spec.minPriorEvents))return false;
  return true;
}
function recentDirectionSummary(r){
  const defs=roleRecentTrendSpecs(r),format=(v,unit)=>unit==='percent'?fmtPct(v):unit==='gold'?signed(v,0)+'g':unit==='dpm'?fmtInt(v):unit==='csmin'||unit==='csminRaw'?fmt(v,2):unit==='minutes'?fmt(v,1)+'m':unit==='cs'?signed(v,1)+' CS':fmt(v,2);
  const rows=[];
  for(const spec of defs){
    if(!recentTrendSpecReady(spec))continue;
    const recent=Number(spec.obj.recent),prior=Number(spec.obj.prior),delta=recent-prior,threshold=Math.max(.0001,Number(spec.threshold||0)),signal=(spec.inverse?-1:1)*delta;
    rows.push({...spec,recent,prior,delta,signal,strength:Math.abs(delta)/threshold,state:Math.abs(delta)<threshold?'stable':signal>0?'good':'bad'});
  }
  if(!rows.length)return{tone:'neutral',value:'No reliable latest-5 comparison yet',copy:'The latest-five window does not yet have enough valid role-relevant observations to compare with the previous games.',meta:'No directional claim is made until each metric clears its own game/event evidence floor.'};
  const moved=[...rows].filter(x=>x.state!=='stable').sort((a,b)=>b.strength-a.strength),good=rows.filter(x=>x.state==='good'),bad=rows.filter(x=>x.state==='bad'),stable=rows.filter(x=>x.state==='stable');
  const primary=moved[0]||[...rows].sort((a,b)=>b.strength-a.strength)[0],secondary=moved.find(x=>x!==primary&&x.state!==primary.state)||moved.find(x=>x!==primary)||null;
  const describe=x=>x?x.label+': '+format(x.recent,x.unit)+' latest 5 vs '+format(x.prior,x.unit)+' previous sample':'';
  const tone=bad.length>good.length?'bad':good.length>bad.length?'good':'neutral';
  const value=primary?(primary.label+' · '+(primary.state==='good'?'improving':primary.state==='bad'?'slipping':'stable')):'Latest 5 stable';
  const copy=[describe(primary),secondary?describe(secondary):''].filter(Boolean).join('. ')+'.';
  return{tone,value,copy,meta:good.length+' improving · '+bad.length+' slipping · '+stable.length+' inside practical-change bands · latest 5 versus the preceding valid sample'};
}


function decisionAnalytic(r,id){
  return (Array.isArray(r?.decisionIntelligence?.analytics)?r.decisionIntelligence.analytics:[]).find(x=>String(x?.id||'')===String(id))||null;
}
function evidenceValue(value,unit='num'){
  if(!hasNum(value))return'n/a';
  const v=Number(value);
  if(unit==='gold')return signed(v,0)+'g';
  if(unit==='dpm')return signed(v,0)+' DPM';
  if(unit==='csmin')return signed(v,2)+' CS/min';
  if(unit==='percent')return signed(v,1)+' pp';
  if(unit==='minutes')return signed(v,1)+'m';
  return signed(v,2);
}
function directionalEvidence(label,value,n,unit,threshold,inverse,href,detail,minN=5){
  if(!hasNum(value)||Number(n||0)<minN)return null;
  const v=Number(value),signal=(inverse?-1:1)*v,tone=Math.abs(v)<Number(threshold||0)?'neutral':signal>0?'good':'bad';
  return{label,value:evidenceValue(v,unit),raw:v,n:Number(n),tone,href,detail};
}
function boundedEvidence(label,value,n,goodMax,badMin,unit,href,detail,minN=5){
  if(!hasNum(value)||Number(n||0)<minN)return null;
  const v=Number(value),tone=v<=goodMax?'good':v>=badMin?'bad':'neutral';
  return{label,value:unit==='percent'?fmtPct(v):fmt(v,2),raw:v,n:Number(n),tone,href,detail};
}
function playerStyleEvidence(r){
  const role=reportSelectedRole(r),p=r.peerComparison||{},b=r.behaviorSummary||{},rows=[];
  if(['ADC','MID','TOP'].includes(role)){
    rows.push(directionalEvidence('Gold @15 vs role opponent',p.avgGoldDiff15,p.laneGames15,'gold',150,false,'#lane-economy','Direct same-role Gold@15; ±150g is the practical-change band used elsewhere on the report.'));
    rows.push(directionalEvidence('CS/min vs role opponent',p.avgCsMinDelta,p.csMinGames,'csmin',.15,false,'#long-horizon','Match-level farm pace relative to the actual same-role opponent.'));
    rows.push(directionalEvidence('DPM vs role opponent',p.avgDpmDelta,p.dpmGames,'dpm',50,false,'#long-horizon','Champion damage per minute relative to the actual same-role opponent.'));
  }else if(role==='JUNGLE'){
    rows.push(directionalEvidence('CS/min vs Jungle opponent',p.avgCsMinDelta,p.csMinGames,'csmin',.15,false,'#long-horizon','Farm pace relative to the actual enemy Jungler.'));
    rows.push(directionalEvidence('First impact vs Jungle opponent',p.avgImpactDeltaMin,p.impactGames,'minutes',1,true,'#decisions','Negative timing means the reviewed player reached the first tracked impact earlier.'));
    rows.push(directionalEvidence('DPM vs Jungle opponent',p.avgDpmDelta,p.dpmGames,'dpm',50,false,'#long-horizon','Champion damage per minute relative to the actual enemy Jungler.'));
  }else if(role==='SUPPORT'){
    rows.push(directionalEvidence('Vision/min vs Support opponent',p.avgVpmDelta,p.vpmGames,'num',.15,false,'#long-horizon','Vision score per minute relative to the actual opposing Support.'));
    rows.push(directionalEvidence('Objective-setup wards vs Support opponent',p.avgObjectiveSetupDelta,p.visionSetupGames,'num',.5,false,'#decisions','Supported pre-objective setup-ward difference versus the opposing Support.'));
  }
  rows.push(boundedEvidence('High-risk deaths / timeline game',b.badDeathsPerTimelineGame,b.timelineGames,.75,1.5,'num','#decisions','Analyzer-classified high-risk deaths per timeline-complete coaching game.'));
  return rows.filter(Boolean);
}
function recentEvidenceBalance(r){
  const rows=[];
  for(const spec of roleRecentTrendSpecs(r)){
    if(!recentTrendSpecReady(spec))continue;
    const delta=Number(spec.obj.recent)-Number(spec.obj.prior),signal=(spec.inverse?-1:1)*delta,threshold=Math.max(.0001,Number(spec.threshold||0));
    rows.push({label:spec.label,state:Math.abs(delta)<threshold?'stable':signal>0?'good':'bad'});
  }
  const good=rows.filter(x=>x.state==='good').length,bad=rows.filter(x=>x.state==='bad').length,stable=rows.filter(x=>x.state==='stable').length;
  const state=!rows.length?'thin':good&&bad?'mixed':good?'good':bad?'bad':'stable';
  return{state,good,bad,stable,total:rows.length,rows};
}
function longitudinalMetricSpecs(role){
  if(role==='SUPPORT')return[
    {key:'peerVpmDelta',label:'Vision/min vs Support',unit:'num',threshold:.12,inverse:false},
    {key:'peerKpDelta',label:'KP vs Support',unit:'percent',threshold:3,inverse:false},
    {key:'peerGpmDelta',label:'Gold/min vs Support',unit:'num',threshold:18,inverse:false},
    {key:'peerDeathsDelta',label:'Deaths vs Support',unit:'num',threshold:.35,inverse:true}
  ];
  return[
    {key:'peerCsMinDelta',label:'CS/min vs role opponent',unit:'csmin',threshold:.15,inverse:false},
    {key:'peerDpmDelta',label:'DPM vs role opponent',unit:'dpm',threshold:60,inverse:false},
    {key:'peerGpmDelta',label:'Gold/min vs role opponent',unit:'num',threshold:20,inverse:false},
    {key:'peerDeathsDelta',label:'Deaths vs role opponent',unit:'num',threshold:.35,inverse:true}
  ];
}
function trajectoryMetricReady(w,spec){
  return hasNum(w?.[spec.key]?.value)&&Number(w?.[spec.key]?.n||0)>=5;
}
function trajectoryComparison(windows,spec){
  const latest=windows[0],complete=windows.filter(w=>Number(w?.games||0)===20&&trajectoryMetricReady(w,spec));
  if(Number(latest?.games||0)!==20||!trajectoryMetricReady(latest,spec)||complete.length<2)return null;
  const oldest=complete[complete.length-1];if(latest===oldest)return null;
  const delta=Number(latest[spec.key].value)-Number(oldest[spec.key].value),signal=(spec.inverse?-1:1)*delta;
  return {...spec,latest,oldest,delta,state:Math.abs(delta)<spec.threshold?'stable':signal>0?'good':'bad'};
}
function longitudinalTrajectoryRead(r){
  const windows=Array.isArray(r?.longHorizon?.trajectoryWindows)?r.longHorizon.trajectoryWindows:[],reads=longitudinalMetricSpecs(reportSelectedRole(r)).map(spec=>trajectoryComparison(windows,spec)).filter(Boolean);
  const good=reads.filter(x=>x.state==='good').length,bad=reads.filter(x=>x.state==='bad').length,stable=reads.filter(x=>x.state==='stable').length;
  const state=!reads.length?'thin':good&&bad?'mixed':good?'good':bad?'bad':'stable';
  return{state,good,bad,stable,reads,windows,completeWindows:windows.filter(w=>Number(w?.games||0)===20).length};
}
function synthesisAgreementModel(r){
  const priority=topPracticeThemes(r)[0]||null,independent=Number(priority?.independentSupportCount||0),support=Number(priority?.supportCount||0),recent=recentEvidenceBalance(r),long=longitudinalTrajectoryRead(r);
  return[
    {label:'Main coaching priority',state:!priority?'thin':independent>=1?'converging':priority?'single':'thin',value:priority?(independent>=2?independent+' additional evidence views':independent===1?'1 additional evidence view':support+' supporting finding'+(support===1?'':'s')):'No promoted priority',copy:priority?String(priority.title||priority.label||'Priority'):'More evidence is needed before one theme should lead the plan.'},
    {label:'Latest-five direction',state:recent.state==='mixed'?'mixed':recent.state==='thin'?'thin':'converging',value:recent.total?(recent.good+' better · '+recent.bad+' worse · '+recent.stable+' stable'):'Not enough evidence',copy:recent.state==='mixed'?'Recent metrics point in different directions, so the report should not collapse them into one “form” score.':recent.state==='thin'?'The latest-five comparison does not yet have enough supported components.':'The currently measurable latest-five components are directionally coherent or stable.'},
    {label:'Longer opponent-relative history',state:long.state==='mixed'?'mixed':long.state==='thin'?'thin':'converging',value:long.reads.length?(long.good+' better · '+long.bad+' worse · '+long.stable+' stable'):'Need ≥2 valid windows',copy:long.state==='mixed'?'Long-run opponent-relative components disagree; this is a mixed development profile.':long.state==='thin'?'The history does not yet contain two sufficiently sampled 20-game windows for multiple comparable metrics.':'The longer-history components mostly point the same way or stay inside practical-change bands.'}
  ];
}
function renderCoachingSynthesis(r){
  const lead=$('coachingSynthesisLead'),box=$('coachingSynthesis'),agreement=$('evidenceAgreement');if(!lead||!box||!agreement)return;
  const priority=topPracticeThemes(r)[0]||null,strengths=currentStrengthFindings(r),strength=strengths[0]||null,recent=recentDirectionSummary(r),long=longitudinalTrajectoryRead(r),agreements=synthesisAgreementModel(r);
  const independent=Number(priority?.independentSupportCount||0);
  const longPhrase=long.state==='mixed'?'The latest-20 versus older-history comparison is mixed.':long.state==='good'?'Latest-20 metrics are more favorable than the oldest complete reference.':long.state==='bad'?'Latest-20 metrics are less favorable than the oldest complete reference.':long.state==='stable'?'Latest-20 metrics are close to the oldest complete reference.':'Longer-history direction is still thin.';
  lead.innerHTML='<div><span>Current working model</span><strong>'+esc(priority?.title||priority?.label||'No single priority is established yet')+'</strong><p>'+esc(priority?String(priority.evidence||priority.summary||'This is the highest-ranked supported coaching theme in the current report.'):'The report does not yet have enough converging evidence to promote one improvement theme.')+'</p></div><div class="synthesis-lead-meta"><b>'+(priority?esc((independent>=2?independent+' additional evidence views':'Evidence still developing')):'Evidence still developing')+'</b><span>'+esc(longPhrase)+'</span></div>';
  const cards=[
    {k:'act',label:'Act on this',title:priority?.title||priority?.label||'Keep gathering evidence',copy:priority?.action||'Do not manufacture a coaching target until a supported pattern repeats.',meta:priority?(Number(priority.supportCount||0)+' supporting finding'+(Number(priority.supportCount||0)===1?'':'s')):'No promoted theme',tone:priority?'bad':'neutral'},
    {k:'keep',label:'Preserve this',title:strength?.title||'No established strength card yet',copy:strength?strength.keep:'Treat neutral evidence as neutral rather than inventing a positive story.',meta:strength?(strength.value+' · n='+strength.n):'Strength threshold not met',tone:strength?'good':'neutral'},
    {k:'direction',label:'Recent direction',title:recent.value,copy:recent.copy,meta:recent.meta,tone:recent.tone},
    {k:'history',label:'Earlier-history comparison',title:longPhrase,copy:long.reads.length?'Latest 20 versus the oldest complete reference among '+long.completeWindows+' complete non-overlapping history windows, using direct-role opponent-relative metrics.':'More selected-role history is needed for a multi-window read.',meta:long.reads.length?(long.good+' better · '+long.bad+' worse · '+long.stable+' stable components'):'No multi-window comparison',tone:long.state==='good'?'good':long.state==='bad'?'bad':'neutral'}
  ];
  box.innerHTML=cards.map(x=>'<article class="coaching-synthesis-card tone-'+x.tone+'"><span>'+esc(x.label)+'</span><strong>'+esc(x.title)+'</strong><p>'+esc(x.copy||'')+'</p><small>'+esc(x.meta||'')+'</small></article>').join('');
  agreement.innerHTML='<div class="section-subhead"><div><span>Evidence agreement</span><strong>Do the evidence views point toward the same review theme?</strong></div><small>Views can overlap in games and events. Agreement does not establish statistical independence.</small></div><div class="evidence-agreement-grid">'+agreements.map(x=>'<article class="evidence-agreement-card state-'+esc(x.state)+'"><span>'+esc(x.state==='converging'?'Converging':x.state==='mixed'?'Mixed evidence':x.state==='single'?'Single channel':'Thin evidence')+'</span><strong>'+esc(x.label)+'</strong><b>'+esc(x.value)+'</b><p>'+esc(x.copy)+'</p></article>').join('')+'</div>';
}
function playerStyleModel(r){
  const role=reportSelectedRole(r),signals=playerStyleEvidence(r),good=signals.filter(x=>x.tone==='good'),bad=signals.filter(x=>x.tone==='bad'),neutral=signals.filter(x=>x.tone==='neutral');
  const find=label=>signals.find(x=>x.label.toLowerCase().includes(label));
  const farm=find('cs/min'),damage=find('dpm'),lane=find('gold @15'),risk=find('high-risk'),vision=find('vision/min'),impact=find('first impact');
  const parts=[];
  if(role==='SUPPORT'){
    if(vision?.tone==='good')parts.push('more vision per minute');
    else if(vision?.tone==='bad')parts.push('less vision per minute');
  }else{
    if(farm?.tone==='good')parts.push('stronger farm pace');
    else if(farm?.tone==='bad')parts.push('lower farm pace');
    if(damage?.tone==='good')parts.push('more champion damage per minute');
    else if(damage?.tone==='bad')parts.push('less champion damage per minute');
    if(lane?.tone==='good')parts.push('an early gold advantage');
    else if(lane?.tone==='bad')parts.push('an early gold deficit');
    if(impact?.tone==='good')parts.push('earlier tracked impact');
  }
  if(risk?.tone==='good')parts.push('fewer classified risky deaths');
  else if(risk?.tone==='bad')parts.push('frequent classified risky deaths');
  const headline=parts.length?(roleLabel(role)+' sample: '+parts.slice(0,3).join(', ')):'No stable playstyle shorthand clears the evidence floor yet';
  return{role,signals,good,bad,neutral,headline};
}
function reviewEvidenceChip(x){
  if(!x)return'';
  return '<a class="player-review-evidence tone-'+esc(x.tone||'neutral')+'" href="'+esc(x.href||'#overview')+'"><span>'+esc(x.label)+'</span><strong>'+esc(x.value)+'</strong><small>n='+esc(String(x.n??''))+'</small></a>';
}
function decisionEvidenceChip(a,label,value,detail){
  if(!a||a.status==='unavailable'||!value)return'';
  return '<a class="player-review-evidence tone-neutral" href="#decisionIntelligencePanel"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(detail||('n='+String(a.sample||0)))+'</small></a>';
}
function renderPlayerReview(r){
  const box=$('playerReview');if(!box)return;
  const style=playerStyleModel(r),priority=topPracticeThemes(r)[0]||null,strength=currentStrengthFindings(r)[0]||null,recent=recentDirectionSummary(r),long=longitudinalTrajectoryRead(r);
  const lead=decisionAnalytic(r,'lead_utilisation'),deficit=decisionAnalytic(r,'deficit_recovery'),chains=decisionAnalytic(r,'death_chains'),follow=decisionAnalytic(r,'fight_lead_conversion'),loss=decisionAnalytic(r,'fight_loss_containment');
  const le=lead?.evidence||{},de=deficit?.evidence||{},ce=chains?.evidence||{},fe=follow?.evidence||{},loe=loss?.evidence||{};
  const contextual=[];
  if(lead&&Number(lead.sample||0)>=2)contextual.push(decisionEvidenceChip(lead,'Large-lead state at 25',String(le.stillAheadAt25??0)+' / '+String(lead.sample||0)+' still ahead','paired ≥500g leads'));
  if(deficit&&Number(deficit.sample||0)>=2)contextual.push(decisionEvidenceChip(deficit,'Large-deficit recovery',String(de.narrowedGames??0)+' / '+String(deficit.sample||0)+' narrowed','median movement '+(hasNum(de.medianMovement)?signed(de.medianMovement,0)+'g':'n/a')));
  if(chains&&Number(ce.totalOpportunities||0)>=5&&Number(ce.opponentOpportunities||0)>=5&&hasNum(ce.repeatRateDeltaPp))contextual.push(decisionEvidenceChip(chains,'Repeat-death pace vs peer',signed(ce.repeatRateDeltaPp,1)+' pp','same 4-minute rule'));
  if(follow&&Number(follow.sample||0)>=5&&hasNum(fe.followUpRate))contextual.push(decisionEvidenceChip(follow,'Fight-win follow-up',fmtPct(fe.followUpRate),'before next fight / 90s'));
  if(loss&&Number(loss.sample||0)>=5&&hasNum(loe.noExtraRiskDeathRate))contextual.push(decisionEvidenceChip(loss,'After-loss extra-risk avoidance',fmtPct(loe.noExtraRiskDeathRate),'before next fight / 90s'));
  const signalChips=style.signals.map(reviewEvidenceChip).join(''),contextChips=contextual.filter(Boolean).join('');
  const styleCopy=style.signals.length
    ?'The shorthand above is built only from role-relative or evidence-gated signals. It describes this sample, not a fixed personality. '+(style.good.length?'Favorable signals currently include '+style.good.map(x=>x.label.toLowerCase()).join(', ')+'. ':'')+(style.bad.length?'The main friction signals include '+style.bad.map(x=>x.label.toLowerCase()).join(', ')+'.':'')
    :'There are not enough comparable role-relative signals to assign a useful playstyle shorthand. The review therefore stays focused on the promoted coaching evidence rather than guessing.';
  const strengthCopy=strength?strength.copy+' '+strength.keep:'No positive pattern currently meets the page’s strength threshold, so the review does not invent one.';
  const leakCopy=priority?(String(priority.evidence||'The highest-ranked supported theme is the current development focus.')+' '+String(priority.action||'')):'No recurring weakness has enough converging evidence to become a primary coaching claim.';
  const trajectoryCopy=recent.copy+' '+(long.state==='mixed'?'The latest-20 comparison with the oldest complete reference is mixed; it is not a current-form score.':long.state==='good'?'The latest 20 are more favorable than the oldest complete history reference. Historical improvement and the latest-five direction describe different time spans.':long.state==='bad'?'The latest 20 are less favorable than the oldest complete history reference; the separate latest-five read describes the more recent direction.':long.state==='stable'?'The latest 20 are close to the oldest complete reference on these components.':'The longer history is still too thin for a multi-window direction claim.');
  const practice=topPracticeThemes(r).slice(0,3);
  const practiceHtml=practice.length?'<ol>'+practice.map((x,i)=>'<li><b>'+esc(String(x.title||x.label||('Priority '+(i+1))))+'</b><span>'+esc(String(x.action||x.evidence||'Review the supported examples and keep the intervention narrow.'))+'</span></li>').join('')+'</ol>':'<p>No evidence-backed three-part practice hierarchy is available yet.</p>';
  const conclusion=priority
    ?'The useful way to read this player is not as a collection of 25 scores. The highest-ranked supported practice theme is '+String(priority.title||priority.label||'the promoted coaching theme')+'. '+(strength?'Preserve the measured strength: '+String(strength.title)+'. ':'')+'Test that one change over the next measured games. '+(recent.tone==='neutral'?'Because recent signals are mixed or stable, judge the intervention by the individual tracked components rather than win rate alone.':'Use the next measured window to see whether the specific supporting metrics move, not merely whether the result column improves.')
    :'The report is not yet justified in forcing a single playstyle conclusion. Keep collecting comparable games and use the evidence cards as review prompts until one theme has enough supported evidence views.';
  box.innerHTML=
    '<article class="player-review-section playstyle"><span>Playstyle read</span><h3>'+esc(style.headline)+'</h3><p>'+esc(styleCopy)+'</p><div class="player-review-evidence-row">'+(signalChips||'<span class="muted">No role-relative style evidence clears the minimum sample floor.</span>')+'</div></article>'+
    '<div class="player-review-columns"><article class="player-review-section strength"><span>Where this style helps</span><h3>'+esc(strength?.title||'No promoted strength yet')+'</h3><p>'+esc(strengthCopy)+'</p>'+(strength?'<a class="button secondary small" href="#current-strengths">See measured strengths</a>':'')+'</article>'+
    '<article class="player-review-section leak"><span>Where value leaks</span><h3>'+esc(priority?.title||priority?.label||'No promoted leak yet')+'</h3><p>'+esc(leakCopy)+'</p>'+(priority?'<a class="button secondary small" href="#practice-plan">Open Next-5 plan</a>':'')+'</article></div>'+
    '<article class="player-review-section context"><span>How the game-state evidence changes the story</span><h3>Conversion, recovery and risk context</h3><p>These measurements qualify the playstyle read rather than being blended into a fake composite score. A player can be strong in one state and weak in another.</p><div class="player-review-evidence-row">'+(contextChips||'<span class="muted">No decision-state context currently clears the display floor.</span>')+'</div></article>'+
    '<article class="player-review-section trajectory"><span>Development over time</span><h3>'+esc(recent.value)+'</h3><p>'+esc(trajectoryCopy)+'</p><a class="button secondary small" href="#long-horizon">Open history evidence</a></article>'+
    '<article class="player-review-section plan"><span>Development direction</span><h3>Keep the intervention narrow</h3>'+practiceHtml+'<p class="player-review-caveat">These are evidence-backed practice cues, not causal diagnoses. Matchup, champion, draft, team state and Riot timeline resolution still constrain what can be inferred.</p></article>'+
    '<article class="player-review-conclusion"><span>Overall conclusion</span><p>'+esc(conclusion)+'</p></article>';
}

function renderPriorityEvidenceChain(r){
  const box=$('priorityEvidenceChain');if(!box)return;
  const theme=topPracticeThemes(r)[0]||null;
  if(!theme){box.innerHTML='<div class="priority-chain-empty">No top priority has enough supported evidence to build a coaching chain yet.</div>';return;}
  const targets=Array.isArray(r.practiceTargets)?r.practiceTargets:[],target=targets.find(t=>practiceThemeKey(t)===practiceThemeKey(theme))||targets.find(t=>String(t.themeKey||'')===String(theme.key||''))||null;
  const replay=practiceReplayItems(r,theme)[0]||null,supporting=(Array.isArray(theme.supportingTitles)?theme.supportingTitles:[]).filter(x=>String(x||'').trim()&&String(x)!==String(theme.title||'')).slice(0,3),independentSupportCount=Number(theme.independentSupportCount||0);
  const supportText=supporting.length?supporting.join(' · '):(independentSupportCount>0?String(independentSupportCount)+' additional evidence view'+(independentSupportCount===1?'':'s')+' reinforce this theme':'No additional evidence view crossed the display threshold.');
  const targetText=target?(String(target.label||target.metricPath)+' · '+practiceTargetValue(target.baseline,target.unit)+' → '+practiceTargetValue(target.goal,target.unit)+' over '+String(target.windowGames||5)+' new games'):'No denominator-safe Next-5 metric is available for this theme yet.';
  const replayText=replay?(String(replay.champion||'Unknown')+' · '+fmt(replay.minute,1)+'m · '+String(replay.title||'Replay moment')):'No ranked replay moment currently maps to this theme.';
  const stage=(step,label,value,copy,cls='')=>'<article class="priority-chain-stage '+cls+'"><span>'+step+' · '+esc(label)+'</span><strong>'+esc(value)+'</strong><p>'+esc(copy||'')+'</p></article>';
  box.innerHTML='<div class="priority-chain-head"><strong>Why this is the main focus</strong><span>What repeats → where to verify it → what to change next</span></div><div class="priority-chain-grid">'+
    stage('1','What keeps repeating',String(theme.title||theme.label||'Primary limiter'),String(theme.evidence||'Supported report finding.'),'signal')+
    stage('2','Why it ranks first',independentSupportCount?independentSupportCount+' additional evidence view'+(independentSupportCount===1?'':'s'):'Strongest available supported theme',supportText,'support')+
    stage('3','Game to review',replayText,replay?'Open this moment and check the decision immediately before the flagged event.':'No replay moment is strong enough yet; keep the theme as a measured practice cue, not a guessed cause.','replay')+
    stage('4','What to do next',String(theme.action||'Keep the practice plan narrow.'),targetText,'action')+
  '</div><small class="priority-chain-caveat">This row explains why the analyzer chose the focus. It is evidence-backed coaching context, not proof that one behavior caused a win or loss.</small>';
  if(replay)box.querySelector('.priority-chain-stage.replay')?.insertAdjacentHTML('beforeend','<button class="button secondary small" type="button" data-chain-replay>Open replay evidence</button>');
  const btn=box.querySelector('[data-chain-replay]');if(btn&&replay)btn.addEventListener('click',()=>openReplayReviewMatch(replay.matchId,replay.tab||'macro'));
}
function renderReportDrivers(r){
  const box=$('reportDrivers');if(!box)return;
  const priorities=topPracticeThemes(r),strengths=Array.isArray(r.overallHighlights)?r.overallHighlights:[],establishedStrength=strengths.find(x=>String(x?.confidence||'').toLowerCase()!=='low')||strengths[0]||null;
  const weak=reportInsightParts(priorities[0],'Primary limiter'),strong=reportInsightParts(establishedStrength,'Bankable strength'),direction=recentDirectionSummary(r),priorityIds=currentPriorityReplayIds(r);
  const weakEstablished=weak.present&&(weak.confidence!=='low'||weak.independentSupportCount>=2),strongEstablished=strong.present&&strong.confidence!=='low';
  const positiveFindings=currentStrengthFindings(r);
  const card=(kind,title,value,copy,action,tone,actionLabel='Next',meta='',footer='')=>'<article class="report-driver-card '+kind+' tone-'+tone+'"><span>'+esc(title)+'</span><strong>'+esc(value)+'</strong><p>'+esc(copy||'No high-confidence supporting sentence is available yet.')+'</p>'+(meta?'<small class="driver-evidence-meta">'+esc(meta)+'</small>':'')+(action?'<div><b>'+esc(actionLabel)+':</b> '+esc(action)+'</div>':'')+footer+'</article>';
  const priorityFooter=priorityIds.size?'<button class="button secondary small driver-review-button" type="button" data-open-priority-history>Review '+priorityIds.size+' matching game'+(priorityIds.size===1?'':'s')+'</button>':'';
  box.innerHTML=[
    card('driver-priority',weak.present&&!weakEstablished?'Provisional limiter':'Primary limiter',weak.title,weak.copy,weak.action,weakEstablished?'bad':'neutral',weakEstablished?'Next':'Test next',weak.meta,priorityFooter),
    positiveFindings.length?card('driver-strength','What’s working',positiveFindings.length+' positive patterns to build on','See the measured strengths below, including the counts, comparison and example games. Keep these habits while narrowing your next improvement.','','good','','','<a class="button secondary small driver-review-button" href="#current-strengths">See what’s going well</a>'):card('driver-strength',strong.present&&!strongEstablished?'Emerging strength':'Bankable strength',strong.title,strong.copy,strong.action,strongEstablished?'good':'neutral',strongEstablished?'Preserve':'Keep testing',strong.meta),
    card('driver-direction','Recent form · latest 5 vs prior games',direction.value,direction.copy,'',direction.tone,'',direction.meta)
  ].join('');
  const reviewBtn=box.querySelector('[data-open-priority-history]');
  if(reviewBtn)reviewBtn.addEventListener('click',()=>{
    state.matchHistoryFilter='priority';state.matchHistoryLimit=10;renderMatchHistory(r);
    $('match-history')?.scrollIntoView({behavior:'auto',block:'start'});
  });
  renderPriorityEvidenceChain(r);
}

function currentStrengthFindings(r){
  const seen=new Set(),role=reportSelectedRole(r),games=reportCoachingGames(r).filter(g=>{
    const id=String(g?.matchId||'');if(!id||seen.has(id)||explicitGameRole(g.role)!==role)return false;seen.add(id);return true;
  }),peers=games.filter(trustedDirectPeer),timeline=peers.filter(g=>g.timelineAvailable===true),rows=[];
  const mean=(xs,get)=>xs.reduce((n,g)=>n+Number(get(g)),0)/xs.length;
  const ids=xs=>[...new Set(xs.map(g=>String(g.matchId)))];
  const add=(key,title,value,unit,copy,keep,measured,examples,method,extra={})=>rows.push({key,title,value,unit,copy,keep,n:measured.length,matchIds:ids(measured),exampleMatchIds:ids(examples).slice(0,2),method,smallSample:measured.length<10,sourceTitles:[],...extra});
  const farm=['ADC','MID','TOP','JUNGLE'].includes(role)?peers.filter(g=>hasNum(g.peer?.csMinDelta)):[],farmWins=farm.filter(g=>Number(g.peer.csMinDelta)>0),farmMean=farm.length?mean(farm,g=>g.peer.csMinDelta):null;
  if(farm.length>=5&&farmMean>=.15&&farmWins.length/farm.length>=.6){
    const latest=games.every(g=>gameTimestampMs(g.gameStartTimestamp))?games.slice().sort((a,b)=>gameTimestampMs(b.gameStartTimestamp)-gameTimestampMs(a.gameStartTimestamp)).slice(0,5).filter(g=>trustedDirectPeer(g)&&hasNum(g.peer?.csMinDelta)):[],latestMean=latest.length?mean(latest,g=>g.peer.csMinDelta):null;
    const recent=latest.length>=3&&latestMean>=.15?' Latest 5: '+signed(latestMean,2)+' CS/min versus the opponent ('+latest.length+' measured games).':'';
    add('farm-edge','You outfarm your role opponent',signed(farmMean,2),'CS per minute versus opponent',farmWins.length+' of '+farm.length+' measured games finished with a higher CS/min.'+recent,'Keep the wave collection that maintains this farming edge.',farm,farmWins.slice().sort((a,b)=>Number(b.peer.csMinDelta)-Number(a.peer.csMinDelta)),'The average uses every measured same-role comparison, including games you were out-farmed. CS means minions and monsters killed. A positive recent level does not mean your form is improving.',{rate:100*farmWins.length/farm.length,rateLabel:farmWins.length+'/'+farm.length+' games out-farming the opponent'});
  }
  const lane=timeline.filter(g=>g.phaseRules?.lane15Comparable!==false&&hasNum(g.goldDiff15)),laneLeads=lane.filter(g=>Number(g.goldDiff15)>=250&&g.outcomeCompromised!==true&&typeof g.win==='boolean'),laneWins=laneLeads.filter(g=>g.win);
  if(laneLeads.length>=5&&laneWins.length/laneLeads.length>=.75)add('lane-lead-wins','Lane leads often end in wins',laneWins.length+'/'+laneLeads.length,'wins when ahead at 15 minutes','You won '+laneWins.length+' of '+laneLeads.length+' games with at least +250 gold versus your role opponent at 15.','Review the wins and preserve the decisions that follow the lane lead.',laneLeads,laneWins,'Only games with a valid 15-minute checkpoint and a known final result count. AFK/early-surrender outcomes are excluded. A perfect observed run is not a guaranteed future win rate.',{rate:100*laneWins.length/laneLeads.length,rateLabel:fmtPct(100*laneWins.length/laneLeads.length)+' observed win rate',sourceTitles:['You convert lane leads into wins well']});
  const mid=timeline.filter(g=>g.phaseRules?.lane15Comparable!==false&&g.phaseRules?.closing25Comparable!==false&&g.phaseRules?.fixed15to25Comparable!==false),midFarm=['ADC','MID','TOP'].includes(role)?mid.filter(g=>hasNum(g.csDiff15)&&hasNum(g.csDiff25)):[],midFarmMean=midFarm.length?mean(midFarm,g=>Number(g.csDiff25)-Number(g.csDiff15)):null;
  if(midFarm.length>=5&&midFarmMean>=8)add('mid-farm','Your farm advantage grows after lane',signed(midFarmMean,1),'CS gained versus opponent · 15 → 25','Your CS difference improved by this amount on average across '+midFarm.length+' games with both checkpoints.','Keep collecting waves, while checking that the extra farm leaves time for important objectives.',midFarm,midFarm.filter(g=>Number(g.csDiff25)>Number(g.csDiff15)).sort((a,b)=>(Number(b.csDiff25)-Number(b.csDiff15))-(Number(a.csDiff25)-Number(a.csDiff15))),'This measures the change in your CS difference versus the same-role opponent, not your total farm. Only comparable 15- and 25-minute checkpoints count. Farming gains alone do not establish good objective timing.',{sourceTitles:['Your 15→25 farm routing gains ground on the role opponent']});
  const resets=timeline.filter(g=>{const x=g.firstResetSequence;return x?.measured===true&&x.deathInWindow===false&&typeof x.economyGain==='boolean'&&typeof x.economyLoss==='boolean'&&!(x.economyGain&&x.economyLoss)&&hasNum(x.csSwingAfter)&&hasNum(x.goldSwingAfter);}),resetGains=resets.filter(g=>g.firstResetSequence.economyGain),resetLosses=resets.filter(g=>g.firstResetSequence.economyLoss),resetNeutral=resets.length-resetGains.length-resetLosses.length;
  if(resets.length>=5&&resetGains.length>0&&resetLosses.length/resets.length<=.2&&mean(resets,g=>g.firstResetSequence.csSwingAfter)>=0)add('first-recalls','Your first recalls stay stable',resetLosses.length+'/'+resets.length,'flagged economy losses after first shop',resetGains.length+' gains · '+resetNeutral+' neutral · '+resetLosses.length+' losses in the measured, death-free windows.','Keep preparing the wave and returning after the first shop.',resets,resetGains,'A gain requires at least +150 gold and +4 CS in role-relative economy; a loss means at least −350 gold or −6 CS. Neutral means neither threshold was met. Missing data and windows with a death are excluded; “no flagged loss” does not mean every recall gained economy.',{resetMix:{gains:resetGains.length,neutral:resetNeutral,losses:resetLosses.length},sourceTitles:['Your first shop sequencing is usually clean']});
  const spikes=timeline.filter(g=>g.itemSpikeWindow?.eligible===true&&typeof g.itemSpikeWindow.used==='boolean'),used=spikes.filter(g=>g.itemSpikeWindow.used);
  if(spikes.length>=5&&used.length/spikes.length>=.75)add('item-windows','You use your early item advantages',used.length+'/'+spikes.length,'earlier major-item windows used','These windows recorded a kill, assist or supported objective contribution before your role opponent caught up in items.','Keep turning the earlier purchase into timely pressure.',spikes,used,'Only measurable first-major-item advantage windows count. Tracked impact does not prove a fight was safe, profitable or caused by the item.',{rate:100*used.length/spikes.length,rateLabel:fmtPct(100*used.length/spikes.length)+' windows with tracked impact',sourceTitles:['You reliably use earlier major-item windows']});
  const leadGrowth=mid.filter(g=>hasNum(g.goldDiff15)&&hasNum(g.goldDiff25)&&Number(g.goldDiff15)>=250),growthMean=leadGrowth.length?mean(leadGrowth,g=>Number(g.goldDiff25)-Number(g.goldDiff15)):null;
  if(leadGrowth.length>=5&&growthMean>=300)add('lead-growth','You build on your early gold leads',signed(growthMean,0),'extra gold versus opponent · 15 → 25','When at least +250 gold ahead at 15, your role-relative lead grew by this amount on average in '+leadGrowth.length+' games.','Review the wave, shop and rotation sequences that kept the advantage growing.',leadGrowth,leadGrowth.filter(g=>Number(g.goldDiff25)>Number(g.goldDiff15)).sort((a,b)=>(Number(b.goldDiff25)-Number(b.goldDiff15))-(Number(a.goldDiff25)-Number(a.goldDiff15))),'This is the average additional gold difference, not your total gold or a guaranteed lead. Only games reaching both comparable checkpoints count. Compromised outcomes may still provide economy observations.',{sourceTitles:['You tend to extend lane leads through the first rotations']});
  const lateLeads=timeline.filter(g=>g.phaseRules?.closing25Comparable!==false&&hasNum(g.goldDiff25)&&Number(g.goldDiff25)>=500&&g.outcomeCompromised!==true&&typeof g.win==='boolean'),lateWins=lateLeads.filter(g=>g.win);
  if(lateLeads.length>=5&&lateWins.length/lateLeads.length>=.75)add('late-lead-wins','You close many games with a late lead',lateWins.length+'/'+lateLeads.length,'wins when ahead at 25 minutes','You won '+lateWins.length+' of '+lateLeads.length+' games with at least +500 gold versus your role opponent at 25.','Check the winning endgames for decisions worth repeating.',lateLeads,lateWins,'Only valid 25-minute checkpoints with known, uncompromised outcomes count. These games can overlap with the lane-lead card; the two cards are not independent evidence.',{rate:100*lateWins.length/lateLeads.length,rateLabel:fmtPct(100*lateWins.length/lateLeads.length)+' observed win rate',sourceTitles:['You usually close games when the role matchup is ahead at 25']});
  const soloRows=lane.flatMap(g=>(g.laneDuel?.events||[]).filter(e=>e.result==='solo_kill'&&e.conversionEligibleTo15===true&&hasNum(e.goldSwingTo15)).map(e=>({g,e}))),soloGames=[...new Set(soloRows.map(x=>x.g))],converted=soloRows.filter(x=>Number(x.e.goldSwingTo15)>=200);
  if(soloRows.length>=5&&soloGames.length>=3&&converted.length/soloRows.length>=.75&&mean(soloRows,x=>x.e.goldSwingTo15)>=300)add('solo-kill-followup','Promising follow-up after solo kills',converted.length+'/'+soloRows.length,'early solo kills followed by economy gains',converted.length+' of '+soloRows.length+' measured events across '+soloGames.length+' games were followed by at least +200 gold in role-relative economy by 15.','Review the post-kill waves and recalls before treating this as a repeatable habit.',soloGames,converted.map(x=>x.g),'Events in one game can overlap and share the same 15-minute checkpoint. This is an event observation, not independent trials or proof that the kill caused the later gain.',{eventCount:soloRows.length,sourceTitles:['You reliably convert clean solo kills into durable lane economy']});
  return rows;
}
function currentStrengthCardHtml(x,r){
  const sample=(x.smallSample?'Small sample · ':'')+x.n+' measured game'+(x.n===1?'':'s'),meter=x.resetMix?'<div class="strength-reset-mix" role="img" aria-label="'+esc(x.copy)+'"><i class="gain" style="width:'+100*x.resetMix.gains/x.n+'%"></i><i class="neutral" style="width:'+100*x.resetMix.neutral/x.n+'%"></i><i class="loss" style="width:'+100*x.resetMix.losses/x.n+'%"></i></div>':hasNum(x.rate)?'<div class="strength-rate"><span>'+esc(x.rateLabel)+'</span><progress max="100" value="'+x.rate+'" aria-label="'+esc(x.rateLabel)+'"></progress></div>':'';
  const examples=x.exampleMatchIds.map((id,i)=>{const g=(r.games||[]).find(g=>String(g.matchId)===id);return '<button class="strength-game-link" type="button" data-strength-match="'+esc(id)+'" aria-label="'+esc('Review '+x.title+' example: '+(g?.champion||'game')+' '+shortGameDate(g?.gameStartTimestamp))+'">'+esc(g?.champion||'Game')+(g?.gameStartTimestamp?' · '+esc(shortGameDate(g.gameStartTimestamp)):' · example '+(i+1))+'</button>';}).join('');
  return '<article class="current-strength-card'+(x.smallSample?' small-sample':'')+'" data-strength-key="'+esc(x.key)+'"><div class="strength-card-head"><span class="strength-check" aria-hidden="true">✓</span><span>'+esc(sample)+'</span></div><h3>'+esc(x.title)+'</h3><strong class="strength-value">'+esc(x.value)+'</strong><span class="strength-unit">'+esc(x.unit)+'</span>'+meter+'<p>'+esc(x.copy)+'</p><div class="strength-keep"><b>Keep:</b> '+esc(x.keep)+'</div><details class="strength-method"><summary>What counts?</summary><p>'+esc(x.method)+'</p></details>'+(examples?'<div class="strength-examples"><span>Review examples</span>'+examples+'</div>':'')+'</article>';
}
function renderCurrentStrengths(r){
  const box=$('currentStrengthsGrid');if(!box)return;
  const rows=currentStrengthFindings(r),sourceTitles=new Set(rows.flatMap(x=>x.sourceTitles).map(x=>x.toLowerCase())),notes=(r.overallHighlights||[]).filter(x=>!sourceTitles.has(String(x?.title||'').toLowerCase())),more=rows.slice(6),scope=$('currentStrengthsScope');
  box.innerHTML=rows.length?rows.slice(0,6).map(x=>currentStrengthCardHtml(x,r)).join(''):'<div class="strengths-empty"><strong>No measured pattern clears the strengths threshold yet.</strong><p>Each card needs several comparable games and a favorable result. More eligible games may reveal what is working.</p></div>';
  if(scope)scope.textContent=reportCoachingGames(r).length+' '+roleLabel(reportSelectedRole(r))+' coaching games'+(r.generatedAt?' · report generated '+fmtDate(r.generatedAt):'')+'. Counts differ by metric; missing observations are excluded.';
  const additional=$('additionalStrengthsGrid');if(additional){additional.innerHTML=more.map(x=>currentStrengthCardHtml(x,r)).join('');additional.hidden=!more.length;}
  renderBullets('overallHighlights',notes,'');$('overallHighlights').hidden=!notes.length;
  if($('additionalStrengths'))$('additionalStrengths').hidden=!more.length&&!notes.length;
  if($('additionalStrengthsSummary'))$('additionalStrengthsSummary').textContent=[more.length?more.length+' more positive pattern'+(more.length===1?'':'s'):'',notes.length?notes.length+' supporting note'+(notes.length===1?'':'s'):''].filter(Boolean).join(' · ')||'More positive patterns';
  $('current-strengths')?.querySelectorAll('[data-strength-match]').forEach(btn=>btn.onclick=()=>openReplayReviewMatch(btn.dataset.strengthMatch,'macro'));
}
function gameMetricSummary(games,getter,opportunityGetter=null){
  const xs=[],opportunities=[];
  for(const g of games){
    const value=getter(g);
    if(!hasNum(value))continue;
    xs.push(Number(value));
    if(opportunityGetter){
      const opportunity=opportunityGetter(g);
      if(hasNum(opportunity))opportunities.push(Math.max(0,Number(opportunity)));
    }
  }
  const n=xs.length,opportunityCount=opportunityGetter?opportunities.reduce((a,b)=>a+b,0):null;
  if(!n)return {mean:null,n:0,sd:null,opportunities:opportunityCount};
  const mean=xs.reduce((a,b)=>a+b,0)/n;
  const variance=n>1?xs.reduce((sum,x)=>sum+(x-mean)*(x-mean),0)/(n-1):null;
  return {mean,n,sd:variance==null?null:Math.sqrt(Math.max(0,variance)),opportunities:opportunityCount};
}
function standardizedMeanGap(a,b){
  if(!a||!b||a.n<2||b.n<2||!hasNum(a.mean)||!hasNum(b.mean)||!hasNum(a.sd)||!hasNum(b.sd))return null;
  const df=a.n+b.n-2;if(df<=0)return null;
  const pooledVar=((a.n-1)*a.sd*a.sd+(b.n-1)*b.sd*b.sd)/df;
  if(!(pooledVar>0))return Number(a.mean)===Number(b.mean)?0:null;
  const cohenD=Math.abs(Number(a.mean)-Number(b.mean))/Math.sqrt(pooledVar),hedgesCorrection=Math.max(0,1-3/(4*df-1));
  return cohenD*hedgesCorrection;
}
function outcomeFingerprintCard(label,wins,losses,unit,inverse=false,minOpportunities=0,opportunityLabel='opportunities',minPerSide=3){
  const valid=wins?.n>=2&&losses?.n>=2&&hasNum(wins?.mean)&&hasNum(losses?.mean),opportunityReady=!minOpportunities||(Number(wins?.opportunities||0)>=minOpportunities&&Number(losses?.opportunities||0)>=minOpportunities),ready=wins?.n>=minPerSide&&losses?.n>=minPerSide&&opportunityReady;
  const delta=valid?Number(wins.mean)-Number(losses.mean):null,effect=valid?standardizedMeanGap(wins,losses):null;
  const tone=!ready||delta==null?'neutral':(inverse?(delta<0?'good':'bad'):(delta>0?'good':'bad'));
  const fmtValue=v=>unit==='percent'?fmtPct(v):unit==='gold'?(hasNum(v)?signed(v,0)+'g':'n/a'):unit==='dpm'?fmtInt(v):unit==='minutes'?(hasNum(v)?signed(v,1)+'m':'n/a'):unit==='cs'?(hasNum(v)?signed(v,2)+' CS':'n/a'):unit==='csmin'?(hasNum(v)?signed(v,2):'n/a'):unit==='num'?fmt(v,2):fmt(v,2);
  const deltaText=delta==null?'Not enough valid observations.':('Observed mean gap: '+(unit==='percent'?signed(delta,1)+' points':unit==='gold'?signed(delta,0)+'g':unit==='minutes'?signed(delta,1)+'m':unit==='cs'?signed(delta,2)+' CS':unit==='csmin'?signed(delta,2)+' CS/min':signed(delta,unit==='num'?2:0)+(unit==='dpm'?' DPM':'')));
  const opp=x=>minOpportunities?' · '+fmtInt(x?.opportunities||0)+' '+opportunityLabel:'';
  return {label,wins,losses,delta,effect,tone,ready,opportunityReady,minOpportunities,html:'<article class="outcome-fingerprint-card tone-'+tone+(ready?'':' thin-evidence')+'"><span>'+esc(label)+'</span><div><strong>'+esc(fmtValue(wins?.mean))+'</strong><small>in wins · n='+Number(wins?.n||0)+esc(opp(wins))+'</small></div><div><strong>'+esc(fmtValue(losses?.mean))+'</strong><small>in losses · n='+Number(losses?.n||0)+esc(opp(losses))+'</small></div><p>'+esc(deltaText)+(ready&&hasNum(effect)?' · gap size '+fmt(effect,2):ready?'':' · gap size unavailable')+(ready?'':' · thin sample — no directional color')+'</p></article>'};
}

function supportLensCard(label,value,detail,tone='neutral',ready=true,interval=null){
  const effective=ready?tone:'neutral',hasInterval=interval&&hasNum(interval.low)&&hasNum(interval.high);
  return '<article class="support-lens-card tone-'+effective+(ready?'':' thin-evidence')+'"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+
    (hasInterval?'<div class="support-lens-interval"><i style="left:'+clamp(interval.low,0,100)+'%;width:'+(clamp(interval.high,0,100)-clamp(interval.low,0,100))+'%"></i><b style="left:'+clamp(Number(String(value).replace(/[^0-9.-]/g,'')),0,100)+'%"></b></div><small>95% range '+esc(fmtPct(interval.low))+'–'+esc(fmtPct(interval.high))+'</small>':'')+
    '<p>'+esc(detail)+(ready?'':' · thin sample — descriptive only')+'</p></article>';
}
function roleEventCoverage(r){
  const b=r?.behaviorSummary||{},games=reportCoachingGames(r).filter(g=>g.timelineAvailable===true);
  const gameCount=fn=>games.filter(fn).length;
  const laneValues=games.map(perGameSupportAdcLaneCost).filter(hasNum).map(Number);
  const laneMean=laneValues.length?laneValues.reduce((a,b)=>a+b,0)/laneValues.length:null;
  const roamN=Number(b.roamAttempts||0),roamGames=hasNum(b.roamAttemptGames)?Number(b.roamAttemptGames):gameCount(g=>Number(g?.roams?.attempts||0)>0);
  const laneWindows=Number(b.supportRoamAdcLaneMovementWindows??b.supportRoamAdcCostGames??0),laneGames=hasNum(b.supportRoamAdcLaneMovementGames)?Number(b.supportRoamAdcLaneMovementGames):laneValues.length;
  const harmWindows=Number(b.supportRoamsHurtingAdc||0),harmGames=hasNum(b.supportRoamsHurtingAdcGames)?Number(b.supportRoamsHurtingAdcGames):gameCount(g=>(g?.roams?.events||[]).some(x=>hasNum(x?.adcLaneCostCs)&&Number(x.adcLaneCostCs)<=-6));
  const visionN=Number(b.visionActions||0),visionGames=hasNum(b.visionActionGames)?Number(b.visionActionGames):gameCount(g=>Number(g?.visionMission?.actions||0)>0);
  const setupN=Number(b.neutralObjectiveJoins||0),setupGames=hasNum(b.objectiveSetupGames)?Number(b.objectiveSetupGames):gameCount(g=>Number(g?.objectiveReadiness?.contestedJoined||0)>0);
  const contestN=Number(b.objectiveContestEncounters??b.neutralObjectiveEvents??0),contestGames=hasNum(b.objectiveContestGames)?Number(b.objectiveContestGames):gameCount(g=>Number(g?.objectiveReadiness?.contestedObjectives||0)>0);
  return{
    roamN,roamGames,roamReady:roamN>=4&&roamGames>=3,
    laneWindows,laneGames,laneMean:hasNum(b.meanGameSupportRoamAdcLaneMovementCs)?Number(b.meanGameSupportRoamAdcLaneMovementCs):laneMean,laneReady:laneWindows>=4&&laneGames>=3,
    harmWindows,harmGames,harmRepeated:harmWindows>=2&&harmGames>=2,
    visionN,visionGames,visionReady:visionN>=12&&visionGames>=4,
    setupN,setupGames,setupReady:setupN>=5&&setupGames>=3,
    contestN,contestGames,contestReady:contestN>=5&&contestGames>=3
  };
}
function renderSupportRoleLens(r){
  const panel=$('supportRoleLensPanel'),box=$('supportRoleLens'),note=$('supportRoleLensNote');if(!panel||!box)return;
  const role=canonicalRole(r?.dataQuality?.selectedRole||r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||state.selectedRole);
  if(role!=='SUPPORT'){panel.hidden=true;box.innerHTML='';if(note)note.textContent='';return;}
  const b=r.behaviorSummary||{},c=roleEventCoverage(r),roamRate=hasNum(b.roamSuccessRate)?Number(b.roamSuccessRate):null,adcMove=c.laneMean,harmful=c.harmWindows,repeatedHarm=c.harmRepeated;
  const visionDeaths=Number(b.visionActionDeaths||0),visionRate=hasNum(b.visionActionDeathRate)?Number(b.visionActionDeathRate):null,highRiskVision=Number(b.highRiskVisionActionDeaths||0),unsupportedVision=Number(b.unsupportedVisionActionDeaths||0);
  const setupHits=Number(b.earlySetupObjectiveJoins||0),setupRate=hasNum(b.objectiveSetupCoachingRate??b.meanGameEarlySetupObjectiveJoinRate??b.earlySetupObjectiveJoinRate)?Number(b.objectiveSetupCoachingRate??b.meanGameEarlySetupObjectiveJoinRate??b.earlySetupObjectiveJoinRate):null,contestHits=Number(b.objectiveContestJoinedEncounters??b.neutralObjectiveJoins??0),contestRate=hasNum(b.objectiveCoachingPresenceRate??b.meanGameObjectiveContestPresenceRate??b.objectiveContestPresenceRate??b.objectiveJoinRate)?Number(b.objectiveCoachingPresenceRate??b.meanGameObjectiveContestPresenceRate??b.objectiveContestPresenceRate??b.objectiveJoinRate):null;
  const roamTone=roamRate==null?'neutral':roamRate<45?'bad':roamRate>=65?'good':'neutral';
  const moveTone=c.laneReady&&repeatedHarm?'bad':c.laneReady&&adcMove!=null&&adcMove>=-2&&roamRate!=null&&roamRate>=60?'good':'neutral';
  const visionTone=visionDeaths>=3&&(highRiskVision>=2||unsupportedVision>=2)?'bad':c.visionN>=18&&visionDeaths===0?'good':'neutral';
  const setupTone=setupRate==null?'neutral':setupRate<45?'bad':setupRate>=70?'good':'neutral';
  const contestTone=contestRate==null?'neutral':contestRate<50?'bad':contestRate>=70?'good':'neutral';
  box.innerHTML=[
    supportLensCard('Roam conversion',roamRate==null?'n/a':fmtPct(roamRate),c.roamN+' detected early roam departures inside the queue-specific roam window across '+c.roamGames+' games · evidence floor 4 attempts across 3 games',roamTone,c.roamReady),
    supportLensCard('ADC lane movement during roams',adcMove==null?'n/a':signed(adcMove,1)+' CS',c.laneWindows+' measured windows across '+c.laneGames+' games · game-weighted mean · '+harmful+' lost ≥6 CS across '+c.harmGames+' games · floor 4 windows across 3 games; stable harm pattern needs 2 harmful windows across 2 games',moveTone,c.laneReady),
    supportLensCard('Vision-action safety',visionRate==null?'n/a':fmtPct(visionRate),visionDeaths+' deaths after '+c.visionN+' tracked ward placements/clears across '+c.visionGames+' games · '+highRiskVision+' high-risk · '+unsupportedVision+' unsupported · floor 12 actions across 4 games',visionTone,c.visionReady,wilsonInterval(visionDeaths,c.visionN)),
    supportLensCard('Prior objective setup',setupRate==null?'n/a':fmtPct(setupRate),'mean per-game rate · pooled '+setupHits+' / '+c.setupN+' joined encounters across '+c.setupGames+' games with prior position 45–105s before the event · floor 5 encounters across 3 games',setupTone,c.setupReady),
    supportLensCard('Contested objective presence',contestRate==null?'n/a':fmtPct(contestRate),'mean per-game rate · pooled '+contestHits+' / '+c.contestN+' joined team-contested encounters across '+c.contestGames+' games · floor 5 encounters across 3 games',contestTone,c.contestReady)
  ].join('');
  if(note){
    const read=c.laneReady&&repeatedHarm?'Repeated measured support roams are associated with substantial ADC-vs-ADC CS loss across multiple games; review whether the ADC could safely crash, reset or collect before you leave.':harmful>=2&&!repeatedHarm?'Two or more harmful roam windows are visible, but they are concentrated in one game; treat this as a replay cue, not a stable cross-game pattern.':repeatedHarm&&!c.laneReady?'Harmful roam windows repeat across games, but the full lane-movement sample is still below its evidence floor; treat this as a review cue, not a stable pattern.':c.roamReady&&roamRate!=null&&roamRate>=65&&c.laneReady&&adcMove!=null&&adcMove>=-2?'Roams are converting while preserving ADC lane economy across the measured game sample; keep the same wave-preparation rule.':'Use the cards independently: a successful roam can still be expensive for bot lane, and favorable lane movement does not prove the roam created value.';
    note.textContent=read+' Support roam lane movement is the change in ADC-vs-ADC CS differential during the detected support roam. The headline is game-weighted so one roam-heavy game cannot dominate it. Positive favors the allied ADC; negative is lane cost. It is not a claim that every CS change was caused solely by the Support.';
  }
  panel.hidden=false;
}
function roleLensCard(label,value,detail,tone='neutral',ready=true,interval=null){
  const effective=ready?tone:'neutral',hasInterval=interval&&hasNum(interval.low)&&hasNum(interval.high);
  return '<article class="role-specific-lens-card tone-'+effective+(ready?'':' thin-evidence')+'"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+
    (hasInterval?'<div class="role-lens-interval"><i style="left:'+clamp(interval.low,0,100)+'%;width:'+(clamp(interval.high,0,100)-clamp(interval.low,0,100))+'%"></i><b style="left:'+clamp(Number(String(value).replace(/[^0-9.-]/g,'')),0,100)+'%"></b></div><small>95% range '+esc(fmtPct(interval.low))+'–'+esc(fmtPct(interval.high))+'</small>':'')+
    '<p>'+esc(detail)+(ready?'':' · thin sample — descriptive only')+'</p></article>';
}
function renderRoleSpecificLens(r){
  const panel=$('roleSpecificLensPanel'),box=$('roleSpecificLens'),note=$('roleSpecificLensNote'),eyebrow=$('roleSpecificLensEyebrow'),title=$('roleSpecificLensTitle'),hint=$('roleSpecificLensHint');
  if(!panel||!box)return;
  const role=canonicalRole(r?.dataQuality?.selectedRole||r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||state.selectedRole),b=r.behaviorSummary||{},p=r.peerComparison||{},q=r.dataQuality||{},c=roleEventCoverage(r);
  if(!['TOP','MID','JUNGLE'].includes(role)){panel.hidden=true;box.innerHTML='';if(note)note.textContent='';return;}
  const laneN=Number(p.laneGames15||0),peerN=Number(p.sameRoleGames||0),impactN=Number(p.impactGames||0),itemN=Number(p.majorItemGames||0),timelineN=Number(b.timelineGames||0);
  const gold=hasNum(p.avgGoldDiff15)?Number(p.avgGoldDiff15):null,cs=hasNum(p.avgCsMinDelta)?Number(p.avgCsMinDelta):null,impact=hasNum(p.avgImpactDeltaMin)?Number(p.avgImpactDeltaMin):null,item=hasNum(p.avgMajorItemDeltaMin)?Number(p.avgMajorItemDeltaMin):null;
  const goldTone=gold==null?'neutral':gold>=150?'good':gold<=-150?'bad':'neutral',csTone=cs==null?'neutral':cs>=.15?'good':cs<=-.15?'bad':'neutral';
  const cards=[];
  let noteText='';
  if(role==='TOP'){
    const soloK=Number(b.earlyRoleSoloKills||0),soloKGames=Number(b.earlyRoleSoloKillGames||0),soloD=Number(b.earlyRoleSoloDeaths||0),soloDGames=Number(b.earlyRoleSoloDeathGames||0),duels=soloK+soloD,duelGames=Number(b.earlyRoleSoloEventGames||0),duelReady=duels>=3&&duelGames>=2,duelTone=duelReady?(soloK>=soloD+2&&soloKGames>=2?'good':soloD>=soloK+2&&soloDGames>=2?'bad':'neutral'):'neutral',leadN=Number(b.earlyLeadGames||0),givebacks=Number(b.earlyLeadGivebackGames||0),giveRate=hasNum(b.earlyLeadGivebackRate)?Number(b.earlyLeadGivebackRate):null,sideDeaths=Number(b.preNeutralObjectiveSideLaneDeaths||0);
    cards.push(
      roleLensCard('Role gold @15',gold==null?'n/a':signed(gold,0)+'g',laneN+' comparable @15 games versus the actual TOP opponent · evidence floor 5',goldTone,laneN>=5),
      roleLensCard('CS/min vs TOP peer',cs==null?'n/a':signed(cs,2),peerN+' direct-role comparable games · evidence floor 5',csTone,peerN>=5),
      roleLensCard('Early clean duel',soloK+' / '+soloD+' K/D',duels+' clean direct-role solo duel events across '+duelGames+' games before the configured early-phase boundary · floor 3 events across 2 games',duelTone,duelReady),
      roleLensCard('Early-lead give-back',giveRate==null?'n/a':fmtPct(giveRate),givebacks+' / '+leadN+' measured ≥500g pre-15 role leads gave back ≥500g before @15 · evidence floor 4',giveRate==null?'neutral':giveRate<=30?'good':giveRate>=50?'bad':'neutral',leadN>=4,wilsonInterval(givebacks,leadN)),
      roleLensCard('Pre-objective side-lane deaths',String(sideDeaths),sideDeaths+' supported side-lane death'+(sideDeaths===1?'':'s')+' shortly before a contested neutral objective across '+timelineN+' timeline-complete games · evidence floor 5 games',timelineN>=5?(sideDeaths===0&&timelineN>=10?'good':sideDeaths>=2?'bad':'neutral'):'neutral',timelineN>=5)
    );
    if(eyebrow)eyebrow.textContent='Top lens';
    if(title)title.textContent='Are lane leads becoming controlled side-lane pressure?';
    if(hint)hint.textContent='Shown only for TOP reports. It combines direct-lane state, clean duels, lead preservation and objective-adjacent side-lane risk.';
    noteText='TOP interpretation stays role-relative: lane gold/CS compare with the actual TOP opponent, while side-lane deaths are reviewed as timing/risk evidence rather than assuming that side-laning itself was wrong.';
  }else if(role==='MID'){
    const roamN=Number(b.roamAttempts||0),roamSuccess=Number(b.roamSuccesses||0),roamRate=hasNum(b.roamSuccessRate)?Number(b.roamSuccessRate):null,mid=b.midRouting||{},midN=Number(mid.games||0),objRate=hasNum(mid.coachingObjectivePresenceRate??mid.meanGameObjectiveJoinRate??mid.avgObjectiveJoinRate)?Number(mid.coachingObjectivePresenceRate??mid.meanGameObjectiveJoinRate??mid.avgObjectiveJoinRate):null;
    cards.push(
      roleLensCard('Role gold @15',gold==null?'n/a':signed(gold,0)+'g',laneN+' comparable @15 games versus the actual MID opponent · evidence floor 5',goldTone,laneN>=5),
      roleLensCard('CS/min vs MID peer',cs==null?'n/a':signed(cs,2),peerN+' direct-role comparable games · evidence floor 5',csTone,peerN>=5),
      roleLensCard('First tracked impact vs MID',impact==null?'n/a':signed(impact,1)+' min',impactN+' comparable first kill/assist/objective-impact timings · negative means earlier · evidence floor 5',impact==null?'neutral':impact<=-1.5?'good':impact>=1.5?'bad':'neutral',impactN>=5),
      roleLensCard('Early roam conversion',roamRate==null?'n/a':fmtPct(roamRate),roamSuccess+' / '+roamN+' detected early roam departures across '+c.roamGames+' games returned supported kill/assist or objective value · floor 4 attempts across 3 games',roamRate==null?'neutral':roamRate>=65?'good':roamRate<45?'bad':'neutral',c.roamReady,wilsonInterval(roamSuccess,roamN)),
      roleLensCard('15→25 objective reconnect',objRate==null?'n/a':fmtPct(objRate),midN+' comparable mid-routing games; this is supported objective presence alongside the 15→25 farm transition · evidence floor 4',objRate==null?'neutral':objRate>=60?'good':objRate<40?'bad':'neutral',midN>=4)
    );
    if(eyebrow)eyebrow.textContent='Mid lens';
    if(title)title.textContent='Are lane resources turning into earlier map impact?';
    if(hint)hint.textContent='Shown only for MID reports. It combines direct-lane state, impact timing, early roam conversion and 15→25 objective reconnection.';
    noteText='MID roam conversion is event-backed, but a converted roam can still be economically expensive. Read it together with lane gold/CS and the 15→25 routing evidence rather than as “roam more.”';
  }else{
    const setupN=Number(b.neutralObjectiveJoins||0),setupHits=Number(b.earlySetupObjectiveJoins||0),setupRate=hasNum(b.objectiveSetupCoachingRate??b.meanGameEarlySetupObjectiveJoinRate??b.earlySetupObjectiveJoinRate)?Number(b.objectiveSetupCoachingRate??b.meanGameEarlySetupObjectiveJoinRate??b.earlySetupObjectiveJoinRate):null,contestN=Number(b.objectiveContestEncounters??b.neutralObjectiveEvents??0),contestHits=Number(b.objectiveContestJoinedEncounters??b.neutralObjectiveJoins??0),contestRate=hasNum(b.objectiveCoachingPresenceRate??b.meanGameObjectiveContestPresenceRate??b.objectiveContestPresenceRate??b.objectiveJoinRate)?Number(b.objectiveCoachingPresenceRate??b.meanGameObjectiveContestPresenceRate??b.objectiveContestPresenceRate??b.objectiveJoinRate):null;
    cards.push(
      roleLensCard('CS/min vs JUNGLE peer',cs==null?'n/a':signed(cs,2),peerN+' direct-role comparable games versus the actual enemy jungler · evidence floor 5',csTone,peerN>=5),
      roleLensCard('First tracked impact vs JUNGLE',impact==null?'n/a':signed(impact,1)+' min',impactN+' comparable first kill/assist/objective-impact timings · negative means earlier · evidence floor 5',impact==null?'neutral':impact<=-1.5?'good':impact>=1.5?'bad':'neutral',impactN>=5),
      roleLensCard('First major vs JUNGLE peer',item==null?'n/a':signed(item,1)+' min',itemN+' comparable first-major completions · negative means earlier · evidence floor 4',item==null?'neutral':item<=-.75?'good':item>=.75?'bad':'neutral',itemN>=4),
      roleLensCard('Prior objective setup',setupRate==null?'n/a':fmtPct(setupRate),'mean per-game rate · pooled '+setupHits+' / '+setupN+' joined encounters across '+c.setupGames+' games with prior position 45–105s before the event · floor 5 encounters across 3 games',setupRate==null?'neutral':setupRate>=70?'good':setupRate<45?'bad':'neutral',c.setupReady),
      roleLensCard('Contested objective presence',contestRate==null?'n/a':fmtPct(contestRate),'mean per-game rate · pooled '+contestHits+' / '+contestN+' joined team-contested encounters across '+c.contestGames+' games · floor 5 encounters across 3 games',contestRate==null?'neutral':contestRate>=75?'good':contestRate<55?'bad':'neutral',c.contestReady)
    );
    if(eyebrow)eyebrow.textContent='Jungle lens';
    if(title)title.textContent='Are farm and item tempo arriving before the objective window?';
    if(hint)hint.textContent='Shown only for JUNGLE reports. It combines direct-jungle farm/impact timing with prior setup and contested-objective presence.';
    noteText='JUNGLE objective cards measure supported presence/setup, not smite skill and not objective “ownership.” First impact and item timing compare only with the actual enemy jungler in analyzed games.';
  }
  box.innerHTML=cards.join('');
  if(note)note.textContent=noteText;
  panel.hidden=false;
}

function perGamePct(n,d){const den=Number(d||0);return den>0?100*Number(n||0)/den:null;}
function perGameSupportAdcLaneCost(g){
  const xs=(g?.roams?.events||[]).map(x=>x?.adcLaneCostCs).filter(hasNum).map(Number);
  return xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
}
function outcomeFingerprintSpecs(role){
  if(role==='SUPPORT')return[
    {label:'Roam conversion',unit:'percent',inverse:false,get:g=>perGamePct(g?.roams?.successes,g?.roams?.attempts),opportunity:g=>Number(g?.roams?.attempts||0),minOpportunities:4,opportunityLabel:'roam attempts'},
    {label:'ADC lane movement during roams',unit:'cs',inverse:false,get:g=>perGameSupportAdcLaneCost(g),opportunity:g=>(g?.roams?.events||[]).filter(x=>hasNum(x?.adcLaneCostCs)).length,minOpportunities:4,opportunityLabel:'measured windows'},
    {label:'Vision-action death rate',unit:'percent',inverse:true,get:g=>perGamePct(g?.visionMission?.deaths,g?.visionMission?.actions),opportunity:g=>Number(g?.visionMission?.actions||0),minOpportunities:12,opportunityLabel:'vision actions'},
    {label:'Prior objective setup',unit:'percent',inverse:false,get:g=>perGamePct(g?.objectiveReadiness?.earlySetupJoins,g?.objectiveReadiness?.contestedJoined),opportunity:g=>Number(g?.objectiveReadiness?.contestedJoined||0),minOpportunities:5,opportunityLabel:'joined contests'}
  ];
  if(role==='JUNGLE')return[
    {label:'CS/min vs JUNGLE peer',unit:'csmin',inverse:false,get:g=>trustedDirectPeer(g)&&hasNum(g?.peer?.csMinDelta)?Number(g.peer.csMinDelta):null},
    {label:'First impact vs JUNGLE peer',unit:'minutes',inverse:true,get:g=>trustedDirectPeer(g)&&hasNum(g?.impactDeltaVsOpponent)?Number(g.impactDeltaVsOpponent):null},
    {label:'Contested objective presence',unit:'percent',inverse:false,get:g=>perGamePct(g?.objectiveReadiness?.contestedJoined,g?.objectiveReadiness?.contestedObjectives),opportunity:g=>Number(g?.objectiveReadiness?.contestedObjectives||0),minOpportunities:5,opportunityLabel:'contested encounters'},
    {label:'Prior objective setup',unit:'percent',inverse:false,get:g=>perGamePct(g?.objectiveReadiness?.earlySetupJoins,g?.objectiveReadiness?.contestedJoined),opportunity:g=>Number(g?.objectiveReadiness?.contestedJoined||0),minOpportunities:5,opportunityLabel:'joined contests'}
  ];
  if(role==='MID')return[
    {label:'Role gold @15',unit:'gold',inverse:false,get:g=>trustedDirectPeer(g)&&g?.phaseRules?.lane15Comparable!==false&&hasNum(g.goldDiff15)?Number(g.goldDiff15):null},
    {label:'First impact vs MID peer',unit:'minutes',inverse:true,get:g=>trustedDirectPeer(g)&&hasNum(g?.impactDeltaVsOpponent)?Number(g.impactDeltaVsOpponent):null},
    {label:'Roam conversion',unit:'percent',inverse:false,get:g=>perGamePct(g?.roams?.successes,g?.roams?.attempts),opportunity:g=>Number(g?.roams?.attempts||0),minOpportunities:4,opportunityLabel:'roam attempts'},
    {label:'15→25 objective reconnect',unit:'percent',inverse:false,get:g=>hasNum(g?.midRouting?.contestPresenceRate??g?.midRouting?.objectiveJoinRate)?Number(g.midRouting.contestPresenceRate??g.midRouting.objectiveJoinRate):null}
  ];
  if(role==='TOP')return[
    {label:'Role gold @15',unit:'gold',inverse:false,get:g=>trustedDirectPeer(g)&&g?.phaseRules?.lane15Comparable!==false&&hasNum(g.goldDiff15)?Number(g.goldDiff15):null},
    {label:'CS/min vs TOP peer',unit:'csmin',inverse:false,get:g=>trustedDirectPeer(g)&&hasNum(g?.peer?.csMinDelta)?Number(g.peer.csMinDelta):null},
    {label:'Early lead give-back',unit:'percent',inverse:true,get:g=>trustedDirectPeer(g)&&g?.phaseRules?.lane15Comparable!==false&&g?.earlyLeadWindow?.eligible?(g.earlyLeadWindow.giveback?100:0):null},
    {label:'Pre-objective side-lane deaths',unit:'num',inverse:true,get:g=>g.timelineAvailable===true?Number(g?.sideLaneRisk?.preNeutralObjectiveSideLaneDeaths||0):null}
  ];
  return[
    {label:'Role gold @15',unit:'gold',inverse:false,get:g=>trustedDirectPeer(g)&&g?.phaseRules?.lane15Comparable!==false&&hasNum(g.goldDiff15)?Number(g.goldDiff15):null},
    {label:'DPM vs ADC peer',unit:'dpm',inverse:false,get:g=>trustedDirectPeer(g)&&hasNum(g?.peer?.dpmDelta)?Number(g.peer.dpmDelta):null},
    {label:'High-risk deaths / game',unit:'num',inverse:true,get:g=>g.timelineAvailable===true?g.badDeathCount:null},
    {label:'Death downtime',unit:'percent',inverse:true,get:g=>hasNum(g.deadTimePct)?Number(g.deadTimePct):null},
    {label:'Lane minions @10',unit:'num',inverse:false,get:g=>hasNum(g.laneCs10)?Number(g.laneCs10):null},
    {label:'Damage share − gold share',unit:'percent',inverse:false,get:g=>hasNum(g.damageEfficiencyPp)?Number(g.damageEfficiencyPp):null}
  ];
}
function renderOutcomeFingerprint(r){
  const box=$('outcomeFingerprint'),note=$('outcomeFingerprintNote');if(!box)return;
  const allGames=reportCoachingGames(r),cleanGames=allGames.filter(g=>g?.outcomeCompromised!==true),cleanWins=cleanGames.filter(g=>g.win),cleanLosses=cleanGames.filter(g=>!g.win),useClean=cleanWins.length>=2&&cleanLosses.length>=2,games=useClean?cleanGames:allGames,wins=games.filter(g=>g.win),losses=games.filter(g=>!g.win),role=canonicalRole(r?.dataQuality?.selectedRole||r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||state.selectedRole);
  if(wins.length<2||losses.length<2){
    box.innerHTML='<div class="bullet empty">At least two wins and two losses are needed for a useful within-sample outcome comparison.</div>';
    if(note)note.textContent='The report does not force an outcome story from a one-sided '+roleLabel(role)+' coaching cohort. Current comparison sample: '+wins.length+' wins / '+losses.length+' losses.'+(useClean&&allGames.length!==games.length?' Outcome-compromised games were excluded.':'');
    return;
  }
  const cards=outcomeFingerprintSpecs(role).map(spec=>outcomeFingerprintCard(spec.label,gameMetricSummary(wins,spec.get,spec.opportunity),gameMetricSummary(losses,spec.get,spec.opportunity),spec.unit,spec.inverse,spec.minOpportunities||0,spec.opportunityLabel||'opportunities'));
  box.innerHTML=cards.map(x=>x.html).join('');
  const usable=cards.filter(x=>x.ready&&hasNum(x.effect)).sort((a,b)=>Number(b.effect)-Number(a.effect)),lead=usable[0],thin=cards.filter(x=>!x.ready).length;
  if(note)note.innerHTML=lead?'<b>Largest win/loss difference in this sample:</b> '+esc(lead.label)+' (gap size '+esc(fmt(lead.effect,2))+'). The gap scale compares each difference with that metric’s typical spread, but this remains descriptive and is not a causal or significance claim. '+esc(roleLabel(role))+' coaching cohort: '+wins.length+' wins / '+losses.length+' losses.'+(useClean&&allGames.length!==games.length?' '+String(allGames.length-games.length)+' AFK/early-surrender outcome-compromised game(s) excluded.':'')+(thin?' '+thin+' metric'+(thin===1?' is':'s are')+' shown without directional color because one outcome side misses its valid-game or metric-specific opportunity floor.':''):'No role-specific metric has at least three valid observations in both wins and losses with enough variation for a directional standardized comparison.';
}
function learningMatchButton(x,tab,label){
  if(!x?.matchId)return '';
  return '<button class="button secondary learning-open" type="button" data-learning-match="'+esc(x.matchId)+'" data-learning-tab="'+esc(tab)+'">'+esc(label)+'</button>';
}
function learningExampleHtml(x,h,reference,sameChampion){
  if(!x)return '<div class="learning-example unavailable"><span>'+esc(reference?'Comparison game':'Flagged example')+'</span><p>'+esc(reference?'No game without this flag has supported opportunities in the same queue and known mechanics.':'No instance of this cue was observed in the supported sample.')+'</p></div>';
  const result=x.outcomeCompromised?'Outcome excluded':x.win===true?'Win':x.win===false?'Loss':'Result unknown';
  return '<div class="learning-example '+(reference?'reference':'flagged')+'"><span>'+esc(reference?'Game without this flag':'Flagged example')+'</span><strong>'+esc(x.champion)+' · '+esc(result)+'</strong><p>'+x.flagged+'/'+x.opportunities+' tracked instances'+(hasNum(x.minute)?' · start near '+esc(fmt(x.minute,1))+'m':'')+'</p><small>'+esc(shortGameDate(x.gameStartTimestamp))+(reference?' · same queue & mechanics'+(sameChampion?' · same champion':' · different champion'):' · highest observed game rate')+'</small>'+learningMatchButton(x,h.tab,'Open '+(reference?'comparison':'flagged')+' game')+'</div>';
}
function bindLearningMatchButtons(box){
  box?.querySelectorAll('[data-learning-match]').forEach(btn=>btn.addEventListener('click',()=>openReplayReviewMatch(btn.dataset.learningMatch,btn.dataset.learningTab)));
}
function showLearningGames(r,ids,label,tab='macro'){
  const box=$('learningReviewGames');if(!box)return;
  const wanted=new Set(ids),games=reportCoachingGames(r).filter(g=>wanted.has(String(g.matchId)));
  box.hidden=false;
  box.innerHTML='<div class="learning-list-head"><h3>'+esc(label)+' · '+games.length+' games</h3><button class="button secondary small" type="button" data-close-learning-list>Close game list</button></div><div class="learning-match-list">'+games.map(g=>{const src=championIcon(g.champion);return '<article class="learning-match"><div>'+(src?'<img loading="lazy" src="'+esc(src)+'" alt="">':'')+'<div><strong>'+esc(g.champion)+' · '+(g.win?'Win':'Loss')+'</strong><small>'+esc(shortGameDate(g.gameStartTimestamp))+' · '+esc(fmtDuration(g.durationMinutes))+'</small></div></div>'+learningMatchButton(g,tab,'Open match')+'</article>';}).join('')+'</div>';
  box.querySelector('[data-close-learning-list]')?.addEventListener('click',()=>{box.hidden=true;box.innerHTML='';});
  bindLearningMatchButtons(box);box.scrollIntoView({behavior:'auto',block:'start'});
}
function renderLearningReview(r){
  const box=$('learningHabits'),matrixBox=$('learningOutcomeMatrix'),comboBox=$('learningCombinations'),note=$('learningReviewNote'),picker=$('learningHabitSelect');
  if(!box||!matrixBox||!window.LeagueLearningReview)return;
  const model=window.LeagueLearningReview.build(r);r.learningReview=model;
  if(!model.habits.some(h=>h.key===state.learningHabit))state.learningHabit='all';
  if(picker){
    picker.innerHTML='<option value="all">All measured habits</option>'+model.habits.map(h=>'<option value="'+esc(h.key)+'">'+esc(h.label)+' · '+h.affectedGames+'/'+h.eligibleGames+' games</option>').join('');
    picker.value=state.learningHabit;
    picker.onchange=()=>{state.learningHabit=picker.value;renderLearningReview(r);};
  }
  if($('learningReviewGames')){$('learningReviewGames').hidden=true;$('learningReviewGames').innerHTML='';}
  const display=model.habits.filter(h=>state.learningHabit==='all'?h.eligibleGames>0:h.key===state.learningHabit);
  box.innerHTML=display.length?display.map((h,i)=>{
    const incidence=h.eligibleGames?100*h.affectedGames/h.eligibleGames:0,status=!h.ready?'Limited sample':h.repeated?'Repeats across games':h.affectedGames?'Single-game cue':'No tracked instance';
    const outcome=h.outcomeComparisonReady?'<p class="learning-outcome-context"><b>Result context:</b> games with this cue won '+h.flaggedOutcome.wins+'/'+h.flaggedOutcome.games+' ('+fmtPct(h.flaggedOutcome.winRate)+'); games without it won '+h.withoutOutcome.wins+'/'+h.withoutOutcome.games+' ('+fmtPct(h.withoutOutcome.winRate)+'). Different opponents and game states can explain the gap; this is not an effect estimate.</p>':'<p class="learning-outcome-context">Win-rate comparison needs at least 3 uncompromised games in each group. Currently '+h.flaggedOutcome.games+' with this cue and '+h.withoutOutcome.games+' without it.</p>';
    return '<details class="learning-habit-card '+(!h.ready?'thin-sample':'')+'" '+(state.learningHabit!=='all'||i<2?'open':'')+'><summary><div><span>'+esc(status)+'</span><strong>'+esc(h.label)+'</strong></div><div class="learning-game-frequency"><strong>'+h.affectedGames+'/'+h.eligibleGames+' games</strong><span>'+esc(fmtPct(incidence))+' with this cue</span></div></summary><div class="learning-habit-body"><div class="learning-frequency-bar" role="img" aria-label="'+h.affectedGames+' of '+h.eligibleGames+' eligible games contain this cue"><i style="width:'+clamp(incidence,0,100)+'%"></i></div><div class="learning-stat-grid"><div><span>Average within a game</span><strong>'+esc(fmtPct(h.meanGameRate))+'</strong><small>Each supported game has equal weight</small></div><div><span>Tracked instances / opportunities</span><strong>'+h.flaggedEvents+'/'+h.opportunities+'</strong><small>'+esc(h.unit)+' · pooled '+esc(fmtPct(h.pooledEventRate))+'</small></div></div><p>'+esc(h.definition)+'</p><div class="learning-cue"><strong>Try this in your next game</strong><p>'+esc(h.cue)+'</p></div><div class="learning-replay-question"><strong>Ask during the replay</strong><p>'+esc(h.question)+'</p></div><div class="learning-example-grid">'+learningExampleHtml(h.flaggedExample,h,false,false)+learningExampleHtml(h.referenceExample,h,true,h.sameChampionReference)+'</div>'+outcome+'<small class="learning-coverage">'+h.eligibleGames+'/'+model.timelineGames+' timeline games have a supported opportunity for this habit. '+h.unknownOrNoOpportunityGames+' have missing evidence or no applicable opportunity.'+(!h.ready?' This needs at least 3 games and '+(h.key==='first-reset'||h.key==='lead-giveback'?3:h.key==='empty-costly-roam'?4:5)+' opportunities before it enters the result review below.':'')+'</small></div></details>';
  }).join(''):'<div class="bullet empty">No supported habit measurements yet. Load selected-role timelines to build this review.</div>';
  const groups=[['winFlagged','Wins with review cues','A win can still contain a decision worth changing.','review-win'],['lossFlagged','Losses with review cues','Use the replay to test the decision and its context.','review-loss'],['winNoFlag','Wins without tracked cues','No cue in at least 3 measured habits. Other mistakes may exist.','no-cue-win'],['lossNoFlag','Losses without tracked cues','No cue in at least 3 measured habits. Look for unmeasured decisions.','no-cue-loss']];
  matrixBox.innerHTML=groups.map(([key,label,copy,cls])=>'<article class="learning-result-card '+cls+'"><span>'+esc(label)+'</span><strong>'+model.matrix[key].length+'</strong><p>'+esc(copy)+'</p><button class="button secondary small" type="button" data-learning-result="'+key+'" '+(model.matrix[key].length?'':'disabled')+'>Review '+model.matrix[key].length+' games</button></article>').join('');
  matrixBox.querySelectorAll('[data-learning-result]').forEach(btn=>btn.addEventListener('click',()=>{const key=btn.dataset.learningResult;showLearningGames(r,model.matrix[key],groups.find(x=>x[0]===key)[1]);}));
  if(comboBox){
    comboBox.innerHTML=model.combinations.length?'<details class="learning-combination-details"><summary>Habits that appear in the same games · '+model.combinations.length+' repeated pairs</summary><p>These cues co-occur in a game; they may happen at different minutes. This does not establish an event chain or cause.</p><div class="learning-combination-grid">'+model.combinations.map((x,i)=>'<article class="learning-combination-card"><strong>'+esc(x.firstLabel)+' + '+esc(x.secondLabel)+'</strong><p>'+x.games+'/'+x.comparableGames+' games with evidence for both contain both cues.</p><button class="button secondary small" type="button" data-learning-pair="'+i+'">Review '+x.games+' shared games</button></article>').join('')+'</div></details>':'';
    comboBox.querySelectorAll('[data-learning-pair]').forEach(btn=>btn.addEventListener('click',()=>{const x=model.combinations[Number(btn.dataset.learningPair)];showLearningGames(r,x.matchIds,'Both: '+x.firstLabel+' + '+x.secondLabel);}));
  }
  bindLearningMatchButtons(box);
  if(note)note.textContent=model.timelineGames+' '+roleLabel(model.selectedRole)+' timeline games · '+model.supportedHabitCount+' habits meet the review minimum. '+model.missingTimelineGames+' role games lack usable timeline evidence. Result review excludes '+model.matrix.excludedOutcome.length+' unverified/AFK/early-surrender outcomes and '+model.matrix.limitedCoverage.length+' games with no cue and fewer than 3 measured habits. Habits are ordered by affected-game count within supported samples, not severity. These cues can overlap; do not add their event counts. A game without a cue is not proof of good play.';
}

function evidenceHealthCard(label,value,detail,status){
  const stateLabel=status==='ready'?'Ready':status==='limited'?'Limited':'Withheld';
  return '<article class="evidence-health-card evidence-'+status+'"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small><b>'+stateLabel+'</b> · '+esc(detail)+'</small></article>';
}
function renderEvidenceHealth(r){
  const box=$('evidenceHealth'),link=$('evidenceHealthLink');if(!box)return;
  const q=r.dataQuality||{},games=reportCoachingGames(r),n=games.length,role=canonicalRole(q.selectedRole||r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||state.selectedRole);
  const timeline=games.filter(g=>g.timelineAvailable===true).length;
  const peers=games.filter(g=>trustedDirectPeer(g)).length;
  let roleEvidenceLabel='Comparable @15',roleEvidenceDetail='',roleEvidenceCount=0,roleEvidenceFloor=5;
  if(role==='SUPPORT'){
    roleEvidenceLabel='Support vision peer';
    roleEvidenceCount=games.filter(g=>trustedDirectPeer(g)&&hasNum(g?.peer?.vpmDelta)).length;
    roleEvidenceDetail='trusted opposing Support + VPM comparison; timeline not required';
  }else if(role==='JUNGLE'){
    roleEvidenceLabel='Jungle impact peer';
    roleEvidenceCount=games.filter(g=>g.timelineAvailable===true&&trustedDirectPeer(g)&&hasNum(g?.impactDeltaVsOpponent)).length;
    roleEvidenceDetail='timeline + trusted enemy Jungler + first-impact timing';
  }else{
    roleEvidenceCount=games.filter(g=>g.timelineAvailable===true&&trustedDirectPeer(g)&&g?.phaseRules?.lane15Comparable!==false&&hasNum(g.goldDiff15)).length;
    roleEvidenceDetail='timeline + trusted peer + compatible lane checkpoint';
  }
  const exactItems=games.filter(g=>g.timelineAvailable===true&&g.itemCatalogExactPatch===true).length;
  const mechanicsLimited=q.currentMechanicsKnown===false||q.mixedMechanicsFallback===true||q.mechanicsCohortReason==='current_mechanics_unverified';
  const status=(count,min)=>count>=min?'ready':count>0?'limited':'withheld';
  const pct=(count)=>n?fmtPct(100*count/n):'n/a';
  box.innerHTML=[
    evidenceHealthCard('Timeline behavior',timeline+'/'+n,pct(timeline)+' of coaching games · directional behavior floor 5',status(timeline,5)),
    evidenceHealthCard('Trusted role peer',peers+'/'+n,pct(peers)+' of coaching games · direct-peer comparison floor 5',status(peers,5)),
    evidenceHealthCard(roleEvidenceLabel,roleEvidenceCount+'/'+n,pct(roleEvidenceCount)+' with '+roleEvidenceDetail+' · evidence floor '+roleEvidenceFloor,status(roleEvidenceCount,roleEvidenceFloor)),
    evidenceHealthCard('Mechanics cohort',String(q.mechanicsCohortGames ?? n)+' games',mechanicsLimited?(q.mechanicsCohortReason==='current_mechanics_unverified'?'newest mechanics revision unverified':'broader/mixed mechanics fallback in use'):(q.mechanicsCohortApplied?'verified current-mechanics cohort applied':'single compatible mechanics context'),mechanicsLimited?'limited':'ready'),
    evidenceHealthCard('Exact item mechanics',exactItems+'/'+n,pct(exactItems)+' with timeline + exact patch item catalog · item-window floor 4',status(exactItems,4))
  ].join('');
  if(link)link.onclick=()=>{openReportAncestors($('trust-coverage'));$('trust-coverage')?.scrollIntoView({behavior:'auto',block:'start'});};
}

function renderMatchRhythm(r){
  const box=$('matchRhythm');if(!box)return;
  const role=reportSelectedRole(r),games=reportCoachingGames(r).filter(g=>explicitGameRole(g.role)===role).slice().sort((a,b)=>Number(a.gameStartTimestamp||0)-Number(b.gameStartTimestamp||0)),excluded=games.filter(g=>g.outcomeCompromised===true),known=games.filter(g=>typeof g.win==='boolean'),wins=known.filter(g=>g.win).length;
  box.innerHTML=games.map((g,i)=>{const result=typeof g.win!=='boolean'?'?':g.win?'W':'L',isExcluded=g.outcomeCompromised===true,src=championIcon(g.champion),lane=trustedDirectPeer(g)&&g.timelineAvailable===true&&g?.phaseRules?.lane15Comparable!==false&&hasNum(g.goldDiff15)?' · '+signed(g.goldDiff15,0)+' gold at 15 vs role':'';
    const label=g.champion+' · '+(result==='W'?'Win':result==='L'?'Loss':'Unknown outcome')+' · '+shortGameDate(g.gameStartTimestamp)+(isExcluded?' · AFK/early-surrender outcome excluded from comparable result analysis':'')+lane;
    return '<button type="button" class="rhythm-game result-'+(result==='W'?'win':result==='L'?'loss':'unknown')+(isExcluded?' result-compromised':'')+'" data-rhythm-match="'+esc(g.matchId)+'" aria-label="'+esc(label)+'" title="'+esc(label)+'">'+(src?'<img src="'+esc(src)+'" alt="" loading="lazy">':'')+'<strong>'+result+(isExcluded?'*':'')+'</strong><small>'+(i+1)+'</small></button>';
  }).join('');
  box.querySelectorAll('[data-rhythm-match]').forEach(n=>n.onclick=()=>openReplayReviewMatch(n.dataset.rhythmMatch,'macro'));
  const clean=known.filter(g=>g.outcomeCompromised!==true),cleanWins=clean.filter(g=>g.win).length;
  $('matchRhythmNote').textContent=wins+' wins / '+(known.length-wins)+' losses across '+known.length+' known outcomes'+(games.length>known.length?' · '+(games.length-known.length)+' unknown':'')+'. '+(excluded.length?'* '+excluded.length+' AFK/early-surrender game(s) shown; excluded from comparable outcome comparisons. ':'')+'Comparable results: '+cleanWins+'/'+clean.length+' wins'+(clean.length>=3?' ('+fmtPct(100*cleanWins/clean.length)+')':' · too few to estimate a stable rate')+'.';
}
function renderKpis(r){
  const s=r.coachingSummary||r.summary||{},roleKey=canonicalRole(r?.dataQuality?.selectedRole||s.primaryRole||r.summary?.primaryRole||state.selectedRole),role=roleLabel(roleKey),games=Number(s.games||0);
  const common=[
    {label:'Win rate',value:fmtPct(s.winRate),sub:games+' '+role+' coaching games'},
    {label:'KDA',value:fmt(s.kda,2),sub:'Raw selected-role sample'}
  ];
  const roleRows=roleKey==='SUPPORT'
    ?[
      {label:'Kill participation',value:fmtPct(s.kp),sub:'Raw Support sample'},
      {label:'Vision / min',value:fmt(s.vpm,2),sub:'Raw Support sample · vision volume, not vision quality'},
      {label:'Assists / game',value:fmt(s.avgAssists,1),sub:'Raw Support sample'},
      {label:'Deaths / game',value:fmt(s.avgDeaths,1),sub:'Raw Support sample · lower is not automatically better'}
    ]
    :roleKey==='JUNGLE'
      ?[
        {label:'CS / min',value:fmt(s.csMin,2),sub:'Raw Jungle sample'},
        {label:'Kill participation',value:fmtPct(s.kp),sub:'Raw Jungle sample'},
        {label:'Vision / min',value:fmt(s.vpm,2),sub:'Raw Jungle sample · vision volume, not objective control'},
        {label:'Deaths / game',value:fmt(s.avgDeaths,1),sub:'Raw Jungle sample · lower is not automatically better'}
      ]
      :[
        {label:'CS / min',value:fmt(s.csMin,2),sub:'Raw selected-role sample'},
        {label:'Kill participation',value:fmtPct(s.kp),sub:'Raw selected-role sample'},
        {label:'Damage / min',value:fmtInt(s.dpm),sub:'Raw selected-role sample'},
        {label:'Deaths / game',value:fmt(s.avgDeaths,1),sub:'Raw selected-role sample · lower is not automatically better'}
      ];
  const rows=[...common,...roleRows];
  $('kpiGrid').innerHTML=rows.map(x=>'<article class="kpi-card tone-neutral"><span>'+esc(x.label)+'</span><strong>'+esc(x.value)+'</strong><small>'+esc(x.sub)+'</small></article>').join('');
}
function comparisonCard(title,delta,unit,scale,inverse,explanation,sample,evidenceReady=true){
  const d=plainDelta(delta,unit,1,inverse),tone=evidenceReady?d.tone:'neutral',word=evidenceReady?d.word:'Thin sample';
  return '<article class="quick-read-card tone-'+tone+(evidenceReady?'':' thin-evidence')+'"><div class="quick-read-head"><span>'+esc(title)+'</span><strong>'+esc(d.value)+'</strong></div>'+
    contextBar(delta,scale,inverse)+
    '<p><b>'+esc(word)+'.</b> '+esc(explanation)+'</p>'+
    (sample?'<small>'+esc(sample)+(evidenceReady?'':' · descriptive only')+'</small>':'')+'</article>';
}
function renderQuickRead(r){
  const p=r.peerComparison||{},b=r.behaviorSummary||{},role=canonicalRole(r?.dataQuality?.selectedRole||r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||state.selectedRole);
  const laneN=Number(p.laneGames15||0),csN=Number(p.csMinGames??p.sameRoleGames??0),dpmN=Number(p.dpmGames??p.sameRoleGames??0),vpmN=Number(p.vpmGames??0),setupN=Number(p.visionSetupGames||0),itemN=Number(p.majorItemGames||0),impactN=Number(p.impactGames||0),repeatN=Number(b.peerMatchedRepeatDeathOpportunities??0);
  const lane=p.avgGoldDiff15,cs=p.avgCsMinDelta,dpm=p.avgDpmDelta,vpm=p.avgVpmDelta,setup=p.avgObjectiveSetupDelta,item=p.avgMajorItemDeltaMin,impact=p.avgImpactDeltaMin,repeat=p.repeatDeathRateDelta;
  const commonImpact=comparisonCard('First tracked impact vs '+roleLabel(role),impact,'minutes',4,true,
    !hasNum(impact)?'No comparable first-impact timing sample is available.':Number(impact)<-1.5?'Your first tracked kill/assist/objective impact arrives earlier.':Number(impact)>1.5?'The direct role opponent reaches tracked map impact earlier.':'First tracked impact timing is close.',
    impactN+' comparable impact games · threshold 5',impactN>=5);
  const commonItem=comparisonCard('First major timing vs '+roleLabel(role),item,'minutes',3,true,
    !hasNum(item)?'No comparable first-major timing sample is available.':Number(item)<-.75?'Your first major item completes earlier than the direct role opponent on average.':Number(item)>.75?'Your first major item completes later than the direct role opponent on average.':'First-major timing is close to the direct role opponent.',
    itemN+' comparable item games · threshold 4',itemN>=4);
  const commonRecovery=comparisonCard('Repeat-death rate vs '+roleLabel(role),repeat,'pp',35,true,
    !hasNum(repeat)?'No peer-matched death-recovery rate is available.':Number(repeat)<-10?'You are less likely than the direct role opponent sample to die again within four minutes.':Number(repeat)>10?'Rapid repeat deaths occur more often for you than in the peer-matched opponent opportunities.':'Death-recovery recurrence is close to the direct role opponents.',
    repeatN+' peer-matched recovery opportunities · threshold 8',repeatN>=8);
  let cards;
  if(role==='SUPPORT'){
    cards=[
      comparisonCard('Vision/min vs Support',vpm,'vpm',.8,false,
        !hasNum(vpm)?'No same-role vision/min comparison is available.':Number(vpm)>.15?'You generate more vision score per minute than the opposing Support on average.':Number(vpm)<-.15?'You generate less vision score per minute than the opposing Support on average.':'Vision volume is close to the opposing Support.',
        vpmN+' direct-role VPM comparisons · threshold 5',vpmN>=5),
      comparisonCard('Objective setup wards vs Support',setup,'wards',2,false,
        !hasNum(setup)?'No direct-role pre-objective setup-ward comparison is available.':Number(setup)>=.5?'You establish more wards near upcoming objectives than the opposing Support.':Number(setup)<=-.5?'The opposing Support establishes more wards near upcoming objectives.':'Pre-objective setup-ward volume is close.',
        setupN+' peer-comparable timeline games · threshold 5',setupN>=5),
      commonImpact,commonItem,commonRecovery
    ];
  }else if(role==='JUNGLE'){
    cards=[
      comparisonCard('CS/min vs Jungle',cs,'csmin',2,false,
        !hasNum(cs)?'No same-role jungle CS/min comparison is available.':Number(cs)>.15?'You farm faster than the enemy Jungler on average.':Number(cs)<-.15?'You farm slower than the enemy Jungler on average.':'Jungle CS/min is close.',
        csN+' direct-role CS/min comparisons · threshold 5',csN>=5),
      comparisonCard('Vision/min vs Jungle',vpm,'vpm',.8,false,
        !hasNum(vpm)?'No same-role vision/min comparison is available.':Number(vpm)>.15?'You generate more vision score per minute than the enemy Jungler.':Number(vpm)<-.15?'You generate less vision score per minute than the enemy Jungler.':'Vision volume is close to the enemy Jungler.',
        vpmN+' direct-role VPM comparisons · threshold 5',vpmN>=5),
      comparisonCard('Objective setup wards vs Jungle',setup,'wards',2,false,
        !hasNum(setup)?'No direct-role pre-objective setup-ward comparison is available.':Number(setup)>=.5?'You establish more wards near upcoming objectives than the enemy Jungler.':Number(setup)<=-.5?'The enemy Jungler establishes more wards near upcoming objectives.':'Pre-objective setup-ward volume is close.',
        setupN+' peer-comparable timeline games · threshold 5',setupN>=5),
      commonImpact,commonItem,commonRecovery
    ];
  }else{
    cards=[
      comparisonCard('Role gold @15',lane,'gold',1000,false,
        !hasNum(lane)?'No comparable @15 direct-role checkpoint is available.':Number(lane)>150?'You average a meaningful gold lead over the actual same-role opponent at 15.':Number(lane)<-150?'You average a meaningful gold deficit versus the actual same-role opponent at 15.':'Your average direct-role economy is close around 15 minutes.',
        laneN+' comparable @15 games · threshold 5',laneN>=5),
      comparisonCard('CS/min vs '+roleLabel(role),cs,'csmin',2,false,
        !hasNum(cs)?'No same-role CS/min comparison is available.':Number(cs)>.15?'You farm faster than the direct role opponent on average.':Number(cs)<-.15?'You farm slower than the direct role opponent on average.':'Your CS/min is close to the direct role opponent.',
        csN+' direct-role CS/min comparisons · threshold 5',csN>=5),
      comparisonCard('DPM vs '+roleLabel(role),dpm,'dpm',500,false,
        !hasNum(dpm)?'No same-role damage comparison is available.':Number(dpm)>100?'Your champion damage output is materially above the direct role opponent.':Number(dpm)<-100?'Your champion damage output trails the direct role opponent.':'Damage output is close to the direct role opponent.',
        dpmN+' direct-role DPM comparisons · threshold 5',dpmN>=5),
      commonItem,commonImpact,commonRecovery
    ];
  }
  $('quickRead').innerHTML=cards.join('');
}
function pulseFormat(v,unit){
  if(!hasNum(v))return'n/a';
  if(unit==='gold')return signed(v,0)+'g';
  if(unit==='csminRaw')return fmt(v,2);
  if(unit==='csmin')return signed(v,2)+' CS/min';
  if(unit==='cs')return signed(v,1)+' CS';
  if(unit==='dpm')return fmtInt(v);
  if(unit==='percent')return fmtPct(v);
  if(unit==='minutes')return signed(v,1)+'m';
  if(unit==='vpm')return fmt(v,2)+' / min';
  return fmt(v,2);
}

function pulseDeltaFormat(v,unit){
  if(!hasNum(v))return'n/a';
  if(unit==='gold')return signed(v,0)+'g';
  if(unit==='csminRaw'||unit==='csmin')return signed(v,2)+' CS/min';
  if(unit==='cs')return signed(v,1)+' CS';
  if(unit==='dpm')return signed(v,0)+' DPM';
  if(unit==='percent')return signed(v,1)+' points';
  if(unit==='minutes')return signed(v,1)+'m';
  return signed(v,2);
}

function pulseCard(spec){
  const label=spec.label,obj=spec.obj,unit=spec.unit,inverse=!!spec.inverse,threshold=Number(spec.threshold||0),recent=obj&&hasNum(obj.recent)?Number(obj.recent):null,prior=obj&&hasNum(obj.prior)?Number(obj.prior):null;
  const recentN=Number(obj?.recentN||0),priorN=Number(obj?.priorN||0),recentEvents=Number(obj?.recentEvents||0),priorEvents=Number(obj?.priorEvents||0),ready=recentTrendSpecReady(spec);
  const eventNote=(Number(spec.minRecentEvents||0)>0||Number(spec.minPriorEvents||0)>0)?' · '+recentEvents+' recent / '+priorEvents+' prior events':'';
  const aggregation=String(obj?.aggregation||''),aggregationNote=aggregation==='pooled_events'?' · pooled event rate':aggregation==='mean_games_with_event_coverage'?' · equal-weight game mean':'';
  if(!ready){
    return '<article class="pulse-card tone-neutral"><span>'+esc(label)+'</span><strong>Not enough evidence</strong><small>'+recentN+' recent / '+priorN+' prior valid games'+eventNote+aggregationNote+'</small></article>';
  }
  const delta=recent-prior,signal=inverse?-delta:delta;
  const tone=Math.abs(delta)<threshold?'neutral':signal>0?'good':'bad';
  const word=tone==='neutral'?'stable':tone==='good'?'favorable shift':'unfavorable shift';
  return '<article class="pulse-card tone-'+tone+'"><span>'+esc(label)+'</span><strong>'+esc(pulseFormat(recent,unit))+'</strong><p>Previous '+esc(pulseFormat(prior,unit))+' · Δ '+esc(pulseDeltaFormat(delta,unit))+'</p><small>'+esc(word)+' · latest '+recentN+' vs previous '+priorN+' valid games'+eventNote+aggregationNote+'</small></article>';
}
function renderRecentPulse(r){
  const target=$('recentPulse');if(!target)return;
  target.innerHTML=roleRecentTrendSpecs(r).map(pulseCard).join('');
}
function historyTrendCard(label,obj,unit='num',inverse=false,threshold=0){
  const recent=hasNum(obj?.recent)?Number(obj.recent):null,prior=hasNum(obj?.prior)?Number(obj.prior):null,recentN=Number(obj?.recentN||0),priorN=Number(obj?.priorN||0),ready=recentN>=5&&priorN>=5&&recent!=null&&prior!=null;
  if(!ready)return '<article class="pulse-card tone-neutral"><span>'+esc(label)+'</span><strong>Not enough history</strong><small>'+recentN+' recent / '+priorN+' prior valid games · need 5 each</small></article>';
  const delta=recent-prior,signal=inverse?-delta:delta,tone=Math.abs(delta)<threshold?'neutral':signal>0?'good':'bad';
  const format=(v)=>unit==='percent'?fmtPct(v):unit==='pp'?signed(v,1)+' points':unit==='dpm'?fmtInt(v):unit==='cs'?fmt(v,1):unit==='csmin'?fmt(v,2):fmt(v,2);
  const deltaText=unit==='percent'||unit==='pp'?signed(delta,1)+' points':unit==='dpm'?signed(delta,0):unit==='cs'?signed(delta,1):signed(delta,2);
  return '<article class="pulse-card tone-'+tone+'"><span>'+esc(label)+'</span><strong>'+esc(format(recent))+'</strong><p>Previous '+esc(format(prior))+' · Δ '+esc(deltaText)+'</p><small>latest '+recentN+' vs previous '+priorN+' valid games · descriptive history shift</small></article>';
}
function historyDistributionCard(label,obj,unit='num'){
  const n=Number(obj?.n||0);if(!n||!hasNum(obj?.median))return '<article class="quick-read-card tone-neutral thin-evidence"><div class="quick-read-head"><span>'+esc(label)+'</span><strong>n/a</strong></div><p>No stable history distribution is available.</p><small>0 valid games</small></article>';
  const format=(v)=>{
    if(unit==='percent')return fmt(v,1)+'%';
    if(unit==='pp')return signed(v,1)+' points';
    if(unit==='dpm')return fmtInt(v);
    if(unit==='csmin')return fmt(v,2);
    return fmt(v,1);
  };
  return '<article class="quick-read-card tone-neutral"><div class="quick-read-head"><span>'+esc(label)+'</span><strong>'+esc(format(obj.median))+'</strong></div><p>Middle 50%: '+esc(format(obj.q25))+' → '+esc(format(obj.q75))+'</p><small>'+n+' valid games · median + interquartile range</small></article>';
}
function historyStabilityCard(label,obj,unit='num',inverse=false,medianThreshold=0,iqrThreshold=0){
  const recentN=Number(obj?.recentN||0),priorN=Number(obj?.priorN||0),ready=recentN>=5&&priorN>=5&&hasNum(obj?.recentMedian)&&hasNum(obj?.priorMedian)&&hasNum(obj?.recentIqr)&&hasNum(obj?.priorIqr);
  if(!ready)return '<article class="pulse-card tone-neutral"><span>'+esc(label)+'</span><strong>Not enough history</strong><small>'+recentN+' recent / '+priorN+' prior valid games · need 5 each</small></article>';
  const medianDelta=Number(obj.recentMedian)-Number(obj.priorMedian),iqrDelta=Number(obj.recentIqr)-Number(obj.priorIqr),signal=inverse?-medianDelta:medianDelta,tone=Math.abs(medianDelta)<medianThreshold?'neutral':signal>0?'good':'bad';
  const recentTail=inverse?obj?.recentQ75:obj?.recentQ25,priorTail=inverse?obj?.priorQ75:obj?.priorQ25,tailDelta=hasNum(recentTail)&&hasNum(priorTail)?Number(recentTail)-Number(priorTail):null;
  const format=(v)=>{
    if(unit==='percent')return fmt(v,1)+'%';
    if(unit==='pp')return signed(v,1)+' points';
    if(unit==='dpm')return fmtInt(v);
    if(unit==='csmin')return fmt(v,2);
    if(unit==='cs')return fmt(v,1);
    return fmt(v,2);
  };
  const deltaText=unit==='percent'||unit==='pp'?signed(medianDelta,1)+' points':unit==='dpm'?signed(medianDelta,0):unit==='cs'?signed(medianDelta,1):signed(medianDelta,2);
  const rangeText=Math.abs(iqrDelta)<iqrThreshold?'middle-50% spread roughly stable':iqrDelta<0?'middle-50% spread narrowed '+format(Math.abs(iqrDelta)):'middle-50% spread widened '+format(Math.abs(iqrDelta));
  const tailLabel=inverse?'Bad-tail ceiling (Q75)':'Performance floor (Q25)',tailText=hasNum(recentTail)&&hasNum(priorTail)?tailLabel+' '+format(recentTail)+' vs '+format(priorTail)+' · Δ '+(unit==='percent'||unit==='pp'?signed(tailDelta,1)+' points':unit==='dpm'?signed(tailDelta,0):unit==='cs'?signed(tailDelta,1):signed(tailDelta,2)):'Tail comparison unavailable';
  return '<article class="pulse-card tone-'+tone+'"><span>'+esc(label)+'</span><strong>Median '+esc(format(obj.recentMedian))+'</strong><p>Previous median '+esc(format(obj.priorMedian))+' · Δ '+esc(deltaText)+'</p><small>'+esc(tailText)+' · recent IQR '+esc(format(obj.recentIqr))+' vs '+esc(format(obj.priorIqr))+' · '+esc(rangeText)+' · '+recentN+' vs '+priorN+' games</small></article>';
}
function spendingFightPhase(g,e){
  const rules=g?.phaseRules||{};
  if(rules.phaseComparable===false||!hasNum(rules.earlyEndMin)||!hasNum(rules.lateStartMin)||!hasNum(e?.startMin))return null;
  const early=Number(rules.earlyEndMin),late=Number(rules.lateStartMin),time=Number(e.startMin);
  if(early<=0||late<early||time<0)return null;
  return time<early?'early':time<late?'transition':'late';
}
function spendingOutcomeComparison(games,key){
  const average=xs=>xs.length?xs.reduce((a,b)=>a+b,0)/xs.length:null;
  const rate=events=>100*events.filter(e=>e[key]===true).length/events.length;
  const rows=games.map(g=>{
    const high=average(g.phases.map(p=>rate(p.high))),low=average(g.phases.map(p=>rate(p.low)));
    return {matchId:g.matchId,high,low,delta:high-low};
  });
  return {key,games:rows.length,high:average(rows.map(x=>x.high)),low:average(rows.map(x=>x.low)),delta:average(rows.map(x=>x.delta)),higherGames:rows.filter(x=>x.delta>0).length,lowerGames:rows.filter(x=>x.delta<0).length,sameGames:rows.filter(x=>x.delta===0).length,rows};
}
function buildSpendingFightComparison(r){
  const seen=new Set(),source=reportCoachingGames(r).filter(g=>{
    const id=String(g?.matchId||'');if(!id||seen.has(id))return false;seen.add(id);return true;
  }),excluded=source.filter(g=>g.outcomeCompromised===true),timeline=source.filter(g=>g.timelineAvailable===true&&g.outcomeCompromised!==true),pairs=[];
  let measuredStarts=0,excludedStarts=0,phasePairs=0,highStarts=0,lowStarts=0;
  for(const g of timeline){
    const phases=new Map(),seenEvents=new Set();
    for(const e of Array.isArray(g.fightProfile?.events)?g.fightProfile.events:[]){
      if(e?.active!==true)continue;
      const phase=spendingFightPhase(g,e);
      if(!phase||!hasNum(e.currentGoldAtStart)||Number(e.currentGoldAtStart)<0||!hasNum(e.endMin)||Number(e.endMin)<Number(e.startMin)||typeof e.playerDied!=='boolean'||typeof e.diedBeforeContribution!=='boolean'||(e.diedBeforeContribution&&!e.playerDied)){excludedStarts++;continue;}
      const key=String(e.startMin)+'|'+String(e.endMin);if(seenEvents.has(key))continue;seenEvents.add(key);measuredStarts++;
      if(!phases.has(phase))phases.set(phase,{key:phase,high:[],low:[]});
      phases.get(phase)[Number(e.currentGoldAtStart)>=1000?'high':'low'].push(e);
    }
    const common=[...phases.values()].filter(p=>p.high.length&&p.low.length);
    if(!common.length)continue;
    phasePairs+=common.length;highStarts+=common.reduce((n,p)=>n+p.high.length,0);lowStarts+=common.reduce((n,p)=>n+p.low.length,0);
    pairs.push({matchId:String(g.matchId),champion:g.champion,gameStartTimestamp:g.gameStartTimestamp,phases:common});
  }
  const beforeContribution=spendingOutcomeComparison(pairs,'diedBeforeContribution'),fightDeaths=spendingOutcomeComparison(pairs,'playerDied'),ready=pairs.length>=5&&highStarts>=10&&lowStarts>=10;
  const higherRepeats=pairs.length>0&&beforeContribution.higherGames/pairs.length>=.6,lowerRepeats=pairs.length>0&&beforeContribution.lowerGames/pairs.length>=.6;
  const signal=!ready?'thin':beforeContribution.delta>=10&&higherRepeats?'review':beforeContribution.delta<=-10&&lowerRepeats?'reverse':'similar';
  return {ready,signal,role:reportSelectedRole(r),coachingGames:source.length,timelineGames:timeline.length,excludedGames:excluded.length,measuredStarts,excludedStarts,phasePairs,highStarts,lowStarts,pairedGames:pairs.length,beforeContribution,fightDeaths,pairs};
}
function spendingComparisonCard(x,m,label,definition){
  const delta=x.delta>0?fmt(x.delta,1)+' points higher with ≥1,000g':x.delta<0?fmt(Math.abs(x.delta),1)+' points lower with ≥1,000g':'Same observed average';
  const bar=(key,name,value,starts)=>'<div class="spending-rate '+key+'"><div><span>'+esc(name)+'</span><strong>'+esc(fmt(value,1))+'%</strong></div><progress max="100" value="'+value+'" aria-label="'+esc(label+' · '+name+' · '+fmt(value,1)+' percent average game rate')+'"></progress><small>'+m.pairedGames+' matched games · '+starts+' tracked fight starts</small></div>';
  return '<article class="spending-outcome-card"><h4>'+esc(label)+'</h4><p>'+esc(definition)+'</p><span class="spending-average-label">Average game rate · same phases compared</span>'+bar('high','≥1,000 gold unspent',x.high,m.highStarts)+bar('low','Under 1,000 gold unspent',x.low,m.lowStarts)+'<strong class="spending-difference">'+esc(delta)+'</strong></article>';
}
function spendingReplayPairHtml(pair,comparison){
  const gameRow=comparison.rows.find(x=>x.matchId===pair.matchId),rate=es=>100*es.filter(e=>e.diedBeforeContribution).length/es.length;
  const phase=pair.phases.slice().sort((a,b)=>Math.abs((rate(a.high)-rate(a.low))-(gameRow?.delta||0))-Math.abs((rate(b.high)-rate(b.low))-(gameRow?.delta||0)))[0];
  const eventText=(events,kind)=>{const e=events.slice().sort((a,b)=>Number(a.startMin)-Number(b.startMin))[0];return '<div><span>'+esc(kind)+'</span><b>'+fmt(e.startMin,1)+'m · '+fmtInt(e.currentGoldAtStart)+'g unspent</b><small>'+esc(e.diedBeforeContribution?'Died before a recorded kill/assist':e.playerDied?'Died during the fight':'Survived this tracked fight')+'</small></div>';};
  return '<article class="spending-replay-pair"><h4>'+esc(pair.champion||'Game')+' · '+esc(shortGameDate(pair.gameStartTimestamp))+' · '+esc(phase.key)+' phase</h4>'+eventText(phase.high,'≥1,000g start')+eventText(phase.low,'Under 1,000g start')+'<button class="button secondary small" type="button" data-spending-match="'+esc(pair.matchId)+'">Open fight evidence</button></article>';
}
function renderSpendingFightComparison(r){
  const host=$('spendingFightComparison');if(!host)return;
  const m=buildSpendingFightComparison(r),primary=m.beforeContribution;
  const title=m.signal==='review'?'Review your shop timing before fights':m.signal==='reverse'?'Lower-gold starts were rougher in this sample':m.signal==='similar'?'No consistent spending-related difference yet':'Not enough comparable fight starts yet';
  const reading=m.signal==='review'?'Deaths before a recorded kill or assist were higher in '+primary.higherGames+' of '+m.pairedGames+' matched games. Check whether a safe shop was possible before those high-gold fight starts.':m.signal==='reverse'?'This does not mean holding more gold helps. Fight timing, items and the situation can differ; inspect the paired moments before drawing a lesson.':m.signal==='similar'?'The matched games do not show a repeated difference large enough to make shop timing a priority from this comparison alone.':m.pairedGames+' matched games, '+m.highStarts+' starts with ≥1,000g and '+m.lowStarts+' starts with less. A comparison needs at least 5 matched games and 10 tracked starts on each side.';
  const rates=m.ready?'<div class="spending-outcome-grid">'+spendingComparisonCard(primary,m,'Death before a recorded kill or assist','You died before the timeline recorded a kill or assist in that fight. This does not measure how much champion damage you dealt.')+spendingComparisonCard(m.fightDeaths,m,'Death during the fight','You died inside this tracked multi-kill fight. This overlaps with the first outcome; it is not a second independent confirmation.')+'</div>':'';
  const examples=m.ready?m.pairs.slice().sort((a,b)=>Math.abs(primary.rows.find(x=>x.matchId===a.matchId).delta-primary.delta)-Math.abs(primary.rows.find(x=>x.matchId===b.matchId).delta-primary.delta)).slice(0,2):[];
  host.innerHTML='<div class="section-subhead"><div><span>Spending before fighting</span><h3>Does unspent gold show up in your rougher fights?</h3></div><small>Your current '+esc(roleLabel(m.role))+' coaching sample · fight starts compared within the same game and phase.</small></div>'+
    '<div class="spending-reading '+(m.signal==='review'?'review':'neutral')+'"><strong>'+esc(title)+'</strong><p>'+esc(reading)+'</p></div>'+
    '<div class="spending-coverage"><span><b>'+m.pairedGames+'</b> matched games</span><span><b>'+m.phasePairs+'</b> paired game phases</span><span><b>'+m.highStarts+' / '+m.lowStarts+'</b> tracked starts · higher / lower unspent gold</span></div>'+rates+
    (m.ready?'<p class="source-note">Compare ≥1,000g unspent with under 1,000g. Each game counts once; only phases with both start types enter its average. These are observed associations, not proof that shopping would have changed a fight.</p>':'')+
    (examples.length?'<div class="spending-replays"><h4>Compare two moments from the same game</h4><p>Check the wave, available purchases, objective timing and whether the fight was forced. These examples are from games closest to the average difference, not the largest outliers.</p><div class="spending-replay-grid">'+examples.map(x=>spendingReplayPairHtml(x,primary)).join('')+'</div></div>':'')+
    '<details class="report-disclosure spending-method"><summary>What counts, and how is this compared?</summary><div><p>A tracked active fight is a multi-kill cluster where you died or had a recorded kill/assist. Proximity alone does not count. Gold comes from the latest timeline frame at the cluster’s first kill, rather than the exact moment combat began; missing gold or unknown outcomes are excluded.</p><p>The 1,000g cutoff marks potentially spendable gold, not proof that a useful purchase or safe recall was available. “Under 1,000g” does not mean you just shopped.</p><p>For each game, compare only its phases containing both kinds of start. Average the fight-outcome rates over those shared phases, then average the game rates with each game weighted equally. This limits game-length and broad phase differences, but does not control champion state, exact timing, item costs or fight difficulty.</p><p>'+m.highStarts+' higher-gold and '+m.lowStarts+' lower-gold starts are used from '+m.measuredStarts+' measured starts across '+m.timelineGames+' timeline games. '+m.excludedGames+' AFK/early-surrender game(s) excluded; '+m.excludedStarts+' active starts lack valid comparison data. Counts support the average game rates; the percentages are not pooled event fractions.</p><p>A review cue needs at least 5 matched games, 10 starts on each side, a 10-point average difference and the same direction in at least 60% of matched games. These are display rules, not a significance test. Both outcomes can refer to the same death.</p></div></details>';
  host.querySelectorAll('[data-spending-match]').forEach(btn=>btn.onclick=()=>openReplayReviewMatch(btn.dataset.spendingMatch,'fights'));
}
function renderLongOutcomeFingerprint(h,role){
  const box=$('longOutcomeFingerprint'),note=$('longOutcomeFingerprintNote');if(!box)return;
  const m=h?.longOutcomeFingerprint||{},metrics=Array.isArray(m.metrics)?m.metrics:[],wins=Number(m.wins||0),losses=Number(m.losses||0),directional=m.directionalEligible===true,minSide=Math.max(5,Number(m.minPerSideForDirectional||5));
  if(!metrics.length||wins<2||losses<2){
    box.innerHTML='<div class="bullet empty">Long-horizon outcome context needs at least two wins and two losses.</div>';
    if(note)note.textContent='The 100-game role history does not yet support a useful result split.';
    return;
  }
  const cards=metrics.map(spec=>outcomeFingerprintCard(spec.label,spec.wins,spec.losses,spec.unit,!!spec.inverse,0,'opportunities',directional?minSide:999));
  box.innerHTML=cards.map(x=>x.html).join('');
  const usable=cards.filter(x=>x.ready&&hasNum(x.effect)).sort((a,b)=>Number(b.effect)-Number(a.effect)),lead=usable[0],thin=cards.filter(x=>!x.ready).length;
  if(note){
    if(directional&&lead)note.innerHTML='<b>Largest win/loss difference in your history:</b> '+esc(lead.label)+' (gap size '+esc(fmt(lead.effect,2))+'). '+esc(String(wins))+' clean wins / '+esc(String(losses))+' clean losses across the selected '+esc(roleLabel(role))+' history'+(Number(m.excludedCompromised||0)?' · '+esc(String(m.excludedCompromised))+' outcome-compromised game(s) excluded':'')+'. Descriptive association only; it is not a causal or significance claim.'+(thin?' '+thin+' metric'+(thin===1?' is':'s are')+' neutral because one side has fewer than '+minSide+' valid observations.':'');
    else note.innerHTML='<b>Context only:</b> clean outcomes do not yet provide at least '+minSide+' wins and '+minSide+' losses. The cards show the broader result split without directional color so AFK/early-surrender contamination is not promoted into a coaching conclusion.';
  }
}

function trajectoryValueLabel(v,unit){
  if(!hasNum(v))return'n/a';
  if(unit==='dpm')return signed(v,0)+' DPM';
  if(unit==='percent')return signed(v,1)+' pp';
  if(unit==='csmin')return signed(v,2)+' CS/min';
  return signed(v,2);
}
function trajectoryDateRange(w){
  const a=gameTimestampMs(w?.oldestGameStartTimestamp),b=gameTimestampMs(w?.newestGameStartTimestamp);
  if(!a||!b)return'Dates unavailable';
  const label=t=>new Date(t).toLocaleDateString(undefined,{day:'numeric',month:'short',year:'numeric'});
  return label(a)+' → '+label(b);
}
function trajectorySparkline(windows,spec){
  const ordered=windows.slice().reverse(),valid=ordered.filter(w=>trajectoryMetricReady(w,spec));
  if(valid.length<2)return'<div class="trajectory-empty">Need two history windows with ≥5 valid direct-role observations. Partial windows remain context only.</div>';
  const width=700,height=186,left=74,right=38,top=22,bottom=40,plotW=width-left-right,plotH=height-top-bottom,maxAbs=Math.max(Number(spec.threshold||1)*2,...valid.map(w=>Math.abs(Number(w[spec.key].value))))*1.12;
  const x=i=>left+i*plotW/Math.max(1,ordered.length-1),y=v=>top+(maxAbs-Number(v))/(maxAbs*2)*plotH,zero=y(0),segments=[];let run=[];
  ordered.forEach((w,i)=>{if(trajectoryMetricReady(w,spec))run.push(x(i).toFixed(1)+','+y(w[spec.key].value).toFixed(1));else{if(run.length>1)segments.push(run);run=[];}});if(run.length>1)segments.push(run);
  const lines=segments.map(points=>'<polyline class="trajectory-line" points="'+points.join(' ')+'"></polyline>').join('');
  const dots=ordered.map((w,i)=>trajectoryMetricReady(w,spec)?'<g><circle class="'+(Number(w.games)===20?'complete':'partial')+'" cx="'+x(i).toFixed(1)+'" cy="'+y(w[spec.key].value).toFixed(1)+'" r="5"></circle><title>'+esc(w.label)+' · '+Number(w.games||0)+' games · '+esc(trajectoryValueLabel(w[spec.key].value,spec.unit))+' · n='+Number(w[spec.key].n||0)+'</title></g>':'<g class="trajectory-missing"><text x="'+x(i).toFixed(1)+'" y="'+(zero-8).toFixed(1)+'" text-anchor="middle">n/a</text><title>'+esc(w.label)+' lacks five supported observations; no value is plotted.</title></g>').join('');
  const labels=ordered.map((w,i)=>'<text x="'+x(i).toFixed(1)+'" y="'+(height-10)+'" text-anchor="'+(i===0?'start':i===ordered.length-1?'end':'middle')+'">'+esc(w.label.replace('Games ','G'))+(Number(w.games)===20?'':' *')+'</text>').join('');
  const ticks=[maxAbs,0,-maxAbs].map(v=>'<text class="trajectory-axis-value" x="'+(left-9)+'" y="'+(y(v)+4).toFixed(1)+'" text-anchor="end">'+esc(trajectoryValueLabel(v,spec.unit))+'</text>').join('');
  return '<div class="trajectory-plot" tabindex="0" role="region" aria-label="Scrollable history metric graph"><svg class="trajectory-svg" viewBox="0 0 '+width+' '+height+'" role="img" aria-label="'+esc(spec.label+' across non-overlapping history windows; missing samples break the line; starred partial windows are context only')+'"><line class="trajectory-zero" x1="'+left+'" x2="'+(width-right)+'" y1="'+zero.toFixed(1)+'" y2="'+zero.toFixed(1)+'"></line>'+ticks+lines+dots+labels+'</svg></div>';
}
function renderLongitudinalProgress(r){
  const box=$('longitudinalProgress');if(!box)return;
  const windows=Array.isArray(r?.longHorizon?.trajectoryWindows)?r.longHorizon.trajectoryWindows:[],specs=longitudinalMetricSpecs(reportSelectedRole(r));
  if(windows.length<2){box.innerHTML='<div class="trajectory-empty">The selected-role history does not yet span two non-overlapping windows. No long-run direction is inferred.</div>';return;}
  box.innerHTML='<div class="trajectory-grid">'+specs.map(spec=>{
    const comparison=trajectoryComparison(windows,spec),delta=comparison?.delta,state=comparison?.state||'thin';
    const verdict=state==='good'?'More favorable vs oldest complete window':state==='bad'?'Less favorable vs oldest complete window':state==='stable'?'Inside the practical-change band':'Need two complete supported windows';
    const values=windows.slice().reverse().map(w=>'<span><b>'+esc(w.label)+(Number(w.games)===20?'':' · partial')+'</b> '+esc(trajectoryMetricReady(w,spec)?trajectoryValueLabel(w[spec.key].value,spec.unit):'not enough evidence')+' <small>'+Number(w.games||0)+' games · n='+Number(w?.[spec.key]?.n||0)+' · '+esc(trajectoryDateRange(w))+'</small></span>').join('');
    const change=comparison?'Latest 20 minus '+comparison.oldest.label+': '+trajectoryValueLabel(delta,spec.unit)+'.':'Directional comparison withheld; the latest complete window and an older complete window each need five observations.';
    return '<article class="trajectory-card state-'+state+'"><div class="trajectory-card-head"><span>'+esc(spec.label)+'</span><strong>'+esc(verdict)+'</strong></div>'+trajectorySparkline(windows,spec)+'<div class="trajectory-values">'+values+'</div><p>'+esc(change)+' The oldest complete window is a historical reference, not the immediately preceding window or a fitted trend. Matchup, champion and team context can still affect the difference.</p></article>';
  }).join('')+'</div><p class="trajectory-note"><b>How to read this:</b> each point averages reviewed-player minus the actual same-role opponent. * Partial windows are shown as context and never determine the long-run verdict. Missing or thin observations keep their chronological position and break the line. Comparing with the role opponent reduces raw-output bias; it does not fully adjust for MMR, champion or matchup. Timeline-only metrics stay in the deep-game sections.</p>';
}
function renderLongHorizon(r){
  const h=r.longHorizon||{},kpi=$('longHorizonKpis'),trend=$('longHorizonTrend'),stability=$('historyStabilityTrend'),consistency=$('historyConsistency'),champions=$('historyChampionMix'),outcome=$('longOutcomeFingerprint'),outcomeNote=$('longOutcomeFingerprintNote'),note=$('longHorizonNote');if(!kpi||!trend)return;
  const s=h.summary||{},role=canonicalRole(h.selectedRole||r?.dataQuality?.selectedRole||state.selectedRole),games=Number(h.sampleGames||0);
  if(!games){kpi.innerHTML='<div class="bullet empty">No longer-horizon selected-role history is available yet.</div>';trend.innerHTML='';if($('longHorizonTrendGraph'))$('longHorizonTrendGraph').innerHTML='';if($('longitudinalProgress'))$('longitudinalProgress').innerHTML='<div class="trajectory-empty">Run the 100-game scan to populate longer-history direction.</div>';if(stability)stability.innerHTML='';if(consistency)consistency.innerHTML='';if(champions)champions.innerHTML='';if(outcome)outcome.innerHTML='';if(outcomeNote)outcomeNote.textContent='';if(note)note.textContent='Run the 100-game scan to populate this section.';return;}
  const laner=['ADC','MID','TOP'].includes(role),roleCounts=h.roleCounts||{},otherRoleGames=Object.entries(roleCounts).reduce((n,[rk,count])=>n+(canonicalRole(rk)!==role?Number(count||0):0),0);
  const roleVolume=laner
    ?{label:'Lane minions @10',value:hasNum(s?.laneCs10?.value)?fmt(s.laneCs10.value,1):'n/a',sub:String(s?.laneCs10?.n||0)+' Riot match-level lane observations'}
    :role==='SUPPORT'
      ?{label:'Vision actions / min',value:hasNum(s?.visionActionsPerMin?.value)?fmt(s.visionActionsPerMin.value,2):'n/a',sub:'wards placed + wards cleared per minute'}
      :{label:'Enemy-jungle monsters / game',value:hasNum(s?.enemyJungleMonsters?.value)?fmt(s.enemyJungleMonsters.value,1):'n/a',sub:'counter-jungle pressure context · not proof an invade was safe or valuable'};
  const roleContext=laner
    ?{label:'Solo kills / game',value:hasNum(s?.soloKills?.value)?fmt(s.soloKills.value,2):'n/a',sub:(hasNum(s?.soloKillsPer30?.value)?fmt(s.soloKillsPer30.value,2)+' per 30 min · ':'')+'Riot soloKills challenge; per-game is the primary unit'}
    :role==='SUPPORT'
      ?{label:'Control wards / game',value:hasNum(s?.controlWardsPlaced?.value)?fmt(s.controlWardsPlaced.value,2):'n/a',sub:String(s?.controlWardsPlaced?.n||0)+' Riot challenge observations'}
      :{label:'Epic damage / min',value:hasNum(s?.epicDamagePerMin?.value)?fmtInt(s.epicDamagePerMin.value):'n/a',sub:'epic-monster pressure context · not objective credit'};
  const roleExtra=laner
    ?{label:'First-turret participation',value:hasNum(s?.firstTurretParticipationRate?.value)?fmtPct(s.firstTurretParticipationRate.value):'n/a',sub:'Riot firstTower kill/assist flag · descriptive team structure involvement'}
    :role==='SUPPORT'
      ?{label:'Team vision share',value:hasNum(s?.visionShare?.value)?fmtPct(s.visionShare.value):'n/a',sub:(hasNum(s?.visionLeaderRate?.value)?fmtPct(s.visionLeaderRate.value)+' of games #1 on team vision · ':'')+'share of team vision score · composition-sensitive'}
      :{label:'Vision actions / min',value:hasNum(s?.visionActionsPerMin?.value)?fmt(s.visionActionsPerMin.value,2):'n/a',sub:'wards placed + wards cleared per minute'};
  const rows=[
    {label:'History depth',value:games+' '+roleLabel(role)+' games',sub:'selected role + selected queue from the latest 100 account matches · '+otherRoleGames+' other-role games included'},
    roleVolume,roleContext,roleExtra,
    {label:'Death downtime',value:hasNum(s?.deadTimePct?.value)?fmt(s.deadTimePct.value,1)+'%':'n/a',sub:'share of game time spent dead · timing-sensitive'},
    {label:'Damage share − gold share',value:hasNum(s?.damageEfficiencyPp?.value)?signed(s.damageEfficiencyPp.value,1)+' points':'n/a',sub:'team champion-damage share minus team gold share · composition-sensitive'},
    {label:'Turret damage / min',value:hasNum(s?.turretDamagePerMin?.value)?fmtInt(s.turretDamagePerMin.value):'n/a',sub:'direct structure pressure from match data'}
  ];
  kpi.innerHTML=rows.map(x=>'<article class="kpi-card tone-neutral"><span>'+esc(x.label)+'</span><strong>'+esc(x.value)+'</strong><small>'+esc(x.sub)+'</small></article>').join('');
  const opponentLabel=roleLabel(role)+' opponent';
  const specs=role==='SUPPORT'?[
    {label:'Vision/min vs '+opponentLabel,obj:h?.trend?.peerVpmDelta,unit:'num',inverse:false,threshold:.12},
    {label:'Kill participation vs '+opponentLabel,obj:h?.trend?.peerKpDelta,unit:'pp',inverse:false,threshold:3},
    {label:'Deaths vs '+opponentLabel,obj:h?.trend?.peerDeathsDelta,unit:'num',inverse:true,threshold:.35},
    {label:'Gold/min vs '+opponentLabel,obj:h?.trend?.peerGpmDelta,unit:'num',inverse:false,threshold:18}
  ]:[
    {label:'CS/min vs '+opponentLabel,obj:h?.trend?.peerCsMinDelta,unit:'csmin',inverse:false,threshold:.15},
    {label:'Damage/min vs '+opponentLabel,obj:h?.trend?.peerDpmDelta,unit:'dpm',inverse:false,threshold:60},
    {label:'Gold/min vs '+opponentLabel,obj:h?.trend?.peerGpmDelta,unit:'num',inverse:false,threshold:20},
    {label:'Deaths vs '+opponentLabel,obj:h?.trend?.peerDeathsDelta,unit:'num',inverse:true,threshold:.35}
  ];
  renderLongHorizonDirectionGraph(specs);
  trend.innerHTML=specs.map(x=>historyTrendCard(x.label,x.obj,x.unit,x.inverse,x.threshold)).join('');
  renderLongitudinalProgress(r);
  if(stability){
    const st=h.stabilityTrend||{},stabilitySpecs=role==='SUPPORT'?[
      {label:'Vision/min vs '+opponentLabel,obj:st.peerVpmDelta,unit:'num',inverse:false,medianThreshold:.12,iqrThreshold:.15},
      {label:'KP vs '+opponentLabel,obj:st.peerKpDelta,unit:'pp',inverse:false,medianThreshold:3,iqrThreshold:4},
      {label:'Deaths vs '+opponentLabel,obj:st.peerDeathsDelta,unit:'num',inverse:true,medianThreshold:.35,iqrThreshold:.5}
    ]:[
      {label:'CS/min vs '+opponentLabel,obj:st.peerCsMinDelta,unit:'csmin',inverse:false,medianThreshold:.15,iqrThreshold:.2},
      {label:'Damage/min vs '+opponentLabel,obj:st.peerDpmDelta,unit:'dpm',inverse:false,medianThreshold:60,iqrThreshold:80},
      {label:'Deaths vs '+opponentLabel,obj:st.peerDeathsDelta,unit:'num',inverse:true,medianThreshold:.35,iqrThreshold:.5}
    ];
    stability.innerHTML=stabilitySpecs.map(x=>historyStabilityCard(x.label,x.obj,x.unit,x.inverse,x.medianThreshold,x.iqrThreshold)).join('');
  }
  if(consistency){
    const c=h.consistency||{},specs=[
      {label:'CS / min',obj:c.csMin,unit:'csmin'},
      ...(laner?[{label:'Lane minions @10',obj:c.laneCs10,unit:'num'},{label:'Solo kills / game',obj:c.soloKills,unit:'num'}]:role==='SUPPORT'?[{label:'Vision actions / min',obj:c.visionActionsPerMin,unit:'num'},{label:'Team vision share',obj:c.visionShare,unit:'percent'},{label:'Control wards / game',obj:c.controlWardsPlaced,unit:'num'}]:[{label:'Enemy-jungle monsters / game',obj:c.enemyJungleMonsters,unit:'num'},{label:'Epic damage / min',obj:c.epicDamagePerMin,unit:'dpm'}]),
      {label:'Deaths / game',obj:c.deaths,unit:'num'},
      {label:'Death downtime',obj:c.deadTimePct,unit:'percent'},
      {label:'Turret damage / min',obj:c.turretDamagePerMin,unit:'dpm'}
    ];
    consistency.innerHTML=specs.map(x=>historyDistributionCard(x.label,x.obj,x.unit)).join('');
  }
  renderLongOutcomeFingerprint(h,role);
  const top=Array.isArray(h.topChampions)?h.topChampions.slice(0,6):[],historyChamps=Array.isArray(h.championHistory)?h.championHistory.slice(0,6):[];
  if(champions)champions.innerHTML=historyChamps.length?historyChamps.map(x=>{
    const src=championIcon(x.champion),cleanN=Number(x.cleanGames||0),cleanReady=cleanN>=3,share=hasNum(x.historyShare)?Number(x.historyShare):(games?Number(x.games||0)/games*100:null);
    const roleMetric=laner?{label:'Lane minions @10',obj:x.laneCs10,fmt:v=>fmt(v,1)}:role==='SUPPORT'?{label:'Team vision share',obj:x.visionShare,fmt:v=>fmtPct(v)}:{label:'Enemy jungle / game',obj:x.enemyJungleMonsters,fmt:v=>fmt(v,1)};
    const recentDpm=x?.recentDpm,priorDpm=x?.priorDpm,recentDelta=Number(recentDpm?.n||0)>=3&&Number(priorDpm?.n||0)>=3&&hasNum(recentDpm?.value)&&hasNum(priorDpm?.value)?Number(recentDpm.value)-Number(priorDpm.value):null;
    return '<article class="history-champion-card">'+
      '<div class="history-champion-head">'+(src?'<img loading="lazy" src="'+esc(src)+'" alt="'+esc(x.champion)+' portrait">':'')+'<div><strong>'+esc(x.champion)+'</strong><span>'+String(x.games||0)+' games · '+esc(fmtPct(share))+' of '+roleLabel(role)+' history</span></div></div>'+
      '<div class="history-champion-stats">'+
        '<div><span>Clean WR</span><strong>'+(cleanReady?esc(fmtPct(x.cleanWinRate)):'withheld')+'</strong><small>'+cleanN+' clean outcomes</small></div>'+
        '<div><span>CS / min</span><strong>'+esc(hasNum(x?.csMin?.value)?fmt(x.csMin.value,2):'n/a')+'</strong><small>n='+String(x?.csMin?.n||0)+'</small></div>'+
        '<div><span>DPM</span><strong>'+esc(hasNum(x?.dpm?.value)?fmtInt(x.dpm.value):'n/a')+'</strong><small>n='+String(x?.dpm?.n||0)+'</small></div>'+
        '<div><span>Deaths / game</span><strong>'+esc(hasNum(x?.deaths?.value)?fmt(x.deaths.value,1):'n/a')+'</strong><small>n='+String(x?.deaths?.n||0)+'</small></div>'+
        '<div><span>'+esc(roleMetric.label)+'</span><strong>'+esc(hasNum(roleMetric.obj?.value)?roleMetric.fmt(roleMetric.obj.value):'n/a')+'</strong><small>n='+String(roleMetric.obj?.n||0)+'</small></div>'+
      '</div>'+
      '<small class="history-champion-note">'+(hasNum(recentDelta)?'Latest-20 vs previous-window DPM '+esc(signed(recentDelta,0))+'. ':'Recent-vs-prior champion split needs at least 3 measurable games on both sides. ')+'Descriptive within-account champion context, not proof the champion caused the result.</small>'+
    '</article>';
  }).join(''):top.length?top.map(x=>{
    const src=championIcon(x.champion),share=games?Number(x.games||0)/games*100:null;
    return '<article class="game-visual-card">'+(src?'<img loading="lazy" src="'+esc(src)+'" alt="'+esc(x.champion)+' portrait">':'')+'<div><strong>'+esc(x.champion)+'</strong><span>'+String(x.games||0)+' game'+(Number(x.games)===1?'':'s')+' · '+esc(fmtPct(share))+' of '+roleLabel(role)+' history</span></div></article>';
  }).join(''):'<p class="muted">No champion-conditioned history available.</p>';
  const leader=top[0]||null,leaderShare=leader&&games?Number(leader.games||0)/games*100:null,patches=Array.isArray(h.patches)?h.patches.filter(Boolean):[];
  let mixNote='';
  if(leader&&hasNum(leaderShare)){
    if(Number(leaderShare)>=90)mixNote=' Champion mix is essentially controlled: '+esc(leader.champion)+' is '+esc(fmtPct(leaderShare))+' of this '+roleLabel(role)+' history. Within-sample trends are less confounded by champion swaps, but they should not be generalized to other champions.';
    else if(Number(leaderShare)>=50)mixNote=' History is heavily shaped by '+esc(leader.champion)+' ('+esc(fmtPct(leaderShare))+'), so output changes can reflect champion mix as well as play changes.';
    else mixNote=' Champion mix is spread across several picks, so DPM/resource-output shifts can partly reflect champion composition.';
  }
  if(note)note.innerHTML='<b>Role integrity:</b> '+games+' '+esc(roleLabel(role))+' history game(s), '+otherRoleGames+' other-role game(s) included.'+(otherRoleGames?' <b>Warning: role scope is contaminated.</b>':' Role scope is clean.')+' <b>Evidence depth:</b> '+String(h.deepTimelineGames||0)+' game(s) carry deep timeline evidence; older games provide match-level history only. '+String(s.compromisedOutcomeGames||0)+' history game(s) are tagged as AFK/early-surrender outcome-compromised.'+(patches.length?' Patches represented: '+esc(patches.join(', '))+'.':'')+mixNote;
}

function renderVisualSummary(r){
  const games=reportCoachingGames(r);
  const champs=new Map(),items=new Map();
  for(const g of games){
    const champ=String(g.champion||'').trim();
    if(champ){
      const row=champs.get(champ)||{name:champ,games:0,wins:0};row.games++;if(g.win)row.wins++;champs.set(champ,row);
    }
    const first=g.firstMajorItem;
    if(first?.itemId){
      const key=String(first.itemId),row=items.get(key)||{itemId:first.itemId,name:first.name||('Item '+key),games:0,totalTime:0};row.games++;row.totalTime+=Number(first.time||0);items.set(key,row);
    }
  }
  const topChamps=[...champs.values()].sort((a,b)=>b.games-a.games||b.wins-a.wins||a.name.localeCompare(b.name)).slice(0,6);
  const topItems=[...items.values()].sort((a,b)=>b.games-a.games||a.name.localeCompare(b.name)).slice(0,6);
  $('championVisuals').innerHTML=topChamps.length?topChamps.map(x=>{
    const src=championIcon(x.name);
    return '<article class="game-visual-card">'+(src?'<img loading="lazy" src="'+esc(src)+'" alt="'+esc(x.name)+' portrait">':'')+'<div><strong>'+esc(x.name)+'</strong><span>'+x.games+' game'+(x.games===1?'':'s')+' · '+esc(fmtPct(x.games?x.wins/x.games*100:null))+' WR</span></div></article>';
  }).join(''):'<p class="muted">No champion sample available.</p>';
  $('itemVisuals').innerHTML=topItems.length?topItems.map(x=>{
    const src=itemIcon(x.itemId);
    return '<article class="game-visual-card">'+(src?'<img loading="lazy" src="'+esc(src)+'" alt="'+esc(x.name)+' item icon">':'')+'<div><strong>'+esc(x.name)+'</strong><span>'+x.games+' first-major game'+(x.games===1?'':'s')+' · avg '+esc(fmt(x.totalTime/x.games,1))+'m</span></div></article>';
  }).join(''):'<p class="muted">No measurable first-major item sample available.</p>';
}
function radarNormalize(metric,value){
  if(!hasNum(value))return null;
  const v=Number(value),domains={csMin:[3,11],kp:[25,70],dpm:[300,1400],kda:[1,6],survival:[10,3]},d=domains[metric];
  if(!d)return null;
  if(metric==='survival')return clamp((d[0]-v)/(d[0]-d[1])*100,0,100);
  return clamp((v-d[0])/(d[1]-d[0])*100,0,100);
}
function radarPolygon(values,cx,cy,radius){
  return values.map((v,i)=>{
    const angle=-Math.PI/2+(Math.PI*2*i/values.length),rr=radius*(Number(v)/100);
    return (cx+Math.cos(angle)*rr).toFixed(1)+','+(cy+Math.sin(angle)*rr).toFixed(1);
  }).join(' ');
}
function benchmarkFreshnessHtml(ext){
  const age=hasNum(ext?.calibrationAgeDays)?Number(ext.calibrationAgeDays):null,historical=ext?.freshnessStatus==='historical_reference'||(age!=null&&age>90);
  const captured=ext?.sourceCapturedAt?fmtDate(ext.sourceCapturedAt):'unknown date',patch=ext?.sourceCapturedPatch?' · patch '+String(ext.sourceCapturedPatch):'',ageText=age!=null?' · '+String(age)+' days old':'';
  return '<span class="benchmark-freshness '+(historical?'historical':'recent')+'">'+(historical?'Historical reference':'Recent reference')+' · captured '+esc(captured)+esc(patch+ageText)+'</span>';
}

function renderRankRadar(r){
  const ext=r.externalBenchmarks||{},summary=adcBenchmarkSummary(r);
  if(!summary){
    const reason=adcBenchmarkUnavailableReason(r);
    $('radarChart').innerHTML='<div class="radar-empty">'+esc(reason)+'</div>';
    $('radarLegend').innerHTML='';
    $('radarNote').innerHTML='<strong>Comparison withheld.</strong> '+esc(reason);
    renderRankBridge(r);
    return;
  }
  const axes=[
    {key:'csMin',label:'CS/min',format:v=>fmt(v,2)},
    {key:'kp',label:'KP',format:v=>fmtPct(v)},
    {key:'dpm',label:'DPM',format:v=>fmtInt(v)},
    {key:'kda',label:'KDA',format:v=>fmt(v,2)},
    {key:'survival',sourceKey:'deaths',label:'Fewer deaths',format:v=>fmt(v,1)+' deaths/g'}
  ];
  const userRaw={csMin:summary.csMin,kp:summary.kp,dpm:summary.dpm,kda:summary.kda,deaths:summary.avgDeaths};
  const defs=[
    {key:'you',label:'You · '+String(summary.games||0)+' ADC games',cls:'you',raw:userRaw},
    {key:'same',label:ext.same?.tier?('Same tier · '+ext.same.tier):'Same tier',cls:'same',raw:ext.same||null},
    {key:'plus1',label:ext.plus1?.tier?('+1 tier · '+ext.plus1.tier):'+1 tier',cls:'plus1',raw:ext.plus1||null},
    {key:'plus2',label:ext.plus2?.tier?('+2 tiers · '+ext.plus2.tier):'+2 tiers',cls:'plus2',raw:ext.plus2||null}
  ];
  const series=defs.map(d=>{
    const values=axes.map(a=>radarNormalize(a.key,a.key==='survival'?d.raw?.deaths:d.raw?.[a.key]));
    return{...d,values:values.map(v=>hasNum(v)?Number(v):0),known:values.filter(hasNum).length,usable:!!d.raw&&values.filter(hasNum).length===axes.length};
  });
  const cx=260,cy=250,radius=176,ringLevels=[25,50,75,100];
  const rings=ringLevels.map(level=>'<circle class="radar-ring" cx="'+cx+'" cy="'+cy+'" r="'+(radius*level/100).toFixed(1)+'"/>').join('');
  const spokes=axes.map((a,i)=>{
    const angle=-Math.PI/2+Math.PI*2*i/axes.length,x=cx+Math.cos(angle)*radius,y=cy+Math.sin(angle)*radius,lx=cx+Math.cos(angle)*(radius+42),ly=cy+Math.sin(angle)*(radius+42);
    return '<line class="radar-spoke" x1="'+cx+'" y1="'+cy+'" x2="'+x.toFixed(1)+'" y2="'+y.toFixed(1)+'"/><text class="radar-axis-label" x="'+lx.toFixed(1)+'" y="'+(ly+4).toFixed(1)+'" text-anchor="middle">'+esc(a.label)+'</text>';
  }).join('');
  const polygons=series.filter(x=>x.usable).map(x=>'<polygon class="radar-series '+x.cls+'" points="'+radarPolygon(x.values,cx,cy,radius)+'"><title>'+esc(x.label)+'</title></polygon>').join('');
  $('radarChart').innerHTML=polygons?'<svg viewBox="0 0 520 505" role="img" aria-label="Your ADC sample compared with externally sourced rank-reference values">'+rings+spokes+polygons+'</svg>':'<div class="radar-empty">A ranked ADC benchmark cannot be built until Riot returns your ranked tier and the report has the five required metrics.</div>';
  $('radarLegend').innerHTML=series.map(x=>'<div class="radar-legend-row '+x.cls+' '+(x.usable?'':'unavailable')+'"><i></i><div><strong>'+esc(x.label)+'</strong><span>'+(
    x.usable?axes.map(a=>esc(a.label)+' '+esc(a.format(a.key==='survival'?x.raw?.deaths:x.raw?.[a.key]))).join(' · '):'Benchmark unavailable'
  )+'</span></div></div>').join('');
  const tableSeries=series.filter(x=>x.usable);
  const table=tableSeries.length?'<div class="radar-values"><table><thead><tr><th>Metric</th>'+tableSeries.map(x=>'<th>'+esc(x.label)+'</th>').join('')+'</tr></thead><tbody>'+
    axes.map(a=>'<tr><th>'+esc(a.label)+(a.key==='survival'?'<small>lower deaths is better</small>':'')+'</th>'+tableSeries.map(x=>'<td>'+esc(a.format(a.key==='survival'?x.raw?.deaths:x.raw?.[a.key]))+'</td>').join('')+'</tr>').join('')+
    '</tbody></table></div>':'';
  $('radarLegend').insertAdjacentHTML('beforeend',table);
  const source=ext.source||'External rank benchmark',captured=ext.sourceCapturedAt?' · corpus captured '+ext.sourceCapturedAt:'',corpus=ext.sourceCorpus?' · '+ext.sourceCorpus:'';
  $('radarNote').innerHTML=benchmarkFreshnessHtml(ext)+' <strong>Population benchmark, not your opponents.</strong> '+esc(ext.methodology||'')+' '+(ext.currentTier?'<b>Tier mapping:</b> '+esc(ext.currentTier)+' → '+esc(ext.plus1?.tier||'n/a')+' → '+esc(ext.plus2?.tier||'n/a')+'. ':'')+'<a href="'+esc(ext.sourceUrl||'https://legendstracker.fr/methodologie')+'" target="_blank" rel="noopener noreferrer">'+esc(source)+'</a>'+esc(captured+corpus)+'. The source publishes tier-level rank averages; CS/min, KP and DPM are then Bot/ADC-adjusted with the published ×1.1 multipliers, so these are role-adjusted benchmarks rather than directly measured rank×ADC population means. KDA and deaths/game remain a raw rank reference and are not ADC-adjusted because the source does not publish ADC-specific multipliers for those fields. This reference was captured on '+esc(ext.sourceCapturedAt||'an earlier patch')+(ext.sourceCapturedPatch?' during patch '+esc(ext.sourceCapturedPatch):'')+' and is intentionally treated as historical cross-patch context, not a current-patch expected value. The spider uses fixed display ranges only to put different units on one shape; the adjacent table shows the real values.';
  renderRankBridge(r);
}
function bridgeFormat(v,unit){
  if(!hasNum(v))return'n/a';
  if(unit==='percent')return fmtPct(v);
  if(unit==='dpm')return fmtInt(v);
  if(unit==='deaths')return fmt(v,1)+'/g';
  return fmt(v,2);
}
function bridgeDifference(value,target,unit,inverse=false){
  if(!hasNum(value)||!hasNum(target))return{tone:'neutral',text:'n/a'};
  const you=Number(value),ref=Number(target),raw=you-ref,abs=Math.abs(raw),digits=unit==='dpm'?0:unit==='percent'?1:2;
  const suffix=unit==='percent'?' points':unit==='dpm'?' DPM':unit==='deaths'?' deaths/g':'';
  if(abs<1e-9)return{tone:'neutral',text:'matches reference'};
  if(inverse)return{tone:raw<0?'good':'bad',text:fmt(abs,digits)+(raw<0?' fewer':' more')+suffix+' than reference'};
  return{tone:raw>0?'good':'bad',text:fmt(abs,digits)+(raw>0?' above':' below')+suffix+' reference'};
}
function renderRankBridge(r){
  const target=$('rankBridge');if(!target)return;
  const ext=r.externalBenchmarks||{},s=adcBenchmarkSummary(r),plus1=ext.plus1||null,plus2=ext.plus2||null;
  if(!s){target.innerHTML='<div class="rank-bridge-empty">'+esc(adcBenchmarkUnavailableReason(r))+'</div>';return;}
  if(!plus1&&!plus2){target.innerHTML='<div class="rank-bridge-empty">No higher-tier benchmark is available above the current rank.</div>';return;}
  const metrics=[
    {key:'csMin',label:'CS / min',unit:'num'},
    {key:'kp',label:'Kill participation',unit:'percent'},
    {key:'dpm',label:'Damage / min',unit:'dpm'},
    {key:'kda',label:'KDA',unit:'num'},
    {key:'deaths',sourceKey:'avgDeaths',label:'Deaths / game',unit:'deaths',inverse:true}
  ];
  target.innerHTML='<div class="rank-bridge-head"><div><span>Benchmark bridge</span><strong>How does this ADC sample differ from higher-tier reference values?</strong></div><div class="rank-bridge-meta">'+benchmarkFreshnessHtml(ext)+'<small>Descriptive cross-patch context only — higher-tier averages are not targets, causes, or promotion predictors.</small></div></div><div class="rank-bridge-grid">'+metrics.map(m=>{
    const value=s[m.sourceKey||m.key],g1=bridgeDifference(value,plus1?.[m.key],m.unit,m.inverse),g2=bridgeDifference(value,plus2?.[m.key],m.unit,m.inverse);
    return '<article class="rank-bridge-card"><span>'+esc(m.label)+'</span><strong>'+esc(bridgeFormat(value,m.unit))+'</strong><div><b>'+(plus1?.tier?esc(plus1.tier):'+1 tier')+'</b><em>'+esc(bridgeFormat(plus1?.[m.key],m.unit))+'</em><small class="tone-'+g1.tone+'">'+esc(g1.text)+'</small></div><div><b>'+(plus2?.tier?esc(plus2.tier):'+2 tiers')+'</b><em>'+esc(bridgeFormat(plus2?.[m.key],m.unit))+'</em><small class="tone-'+g2.tone+'">'+esc(g2.text)+'</small></div></article>';
  }).join('')+'</div>';
}
function wilsonInterval(successes,total,z=1.96){
  const n=Number(total||0),k=Number(successes||0);
  if(!(n>0)||!Number.isFinite(k)||k<0||k>n)return null;
  const p=k/n,z2=z*z,den=1+z2/n,center=(p+z2/(2*n))/den,half=z*Math.sqrt((p*(1-p)+z2/(4*n))/n)/den;
  return{low:100*Math.max(0,center-half),high:100*Math.min(1,center+half)};
}
function decisionCard(title,value,tone,explanation,sub,percent=null,evidenceReady=true,interval=null){
  const effectiveTone=evidenceReady?tone:'neutral',hasInterval=interval&&hasNum(interval.low)&&hasNum(interval.high),pct=hasNum(percent)?clamp(Number(percent),0,100):null;
  const meter=pct==null?'':hasInterval?
    '<div class="decision-meter uncertainty-meter" aria-label="Point estimate '+esc(fmtPct(pct))+'; 95% interval '+esc(fmtPct(interval.low))+' to '+esc(fmtPct(interval.high))+'"><span class="decision-fill" style="width:'+pct+'%"></span><i class="decision-interval" style="left:'+clamp(Number(interval.low),0,100)+'%;width:'+(clamp(Number(interval.high),0,100)-clamp(Number(interval.low),0,100))+'%"></i><b class="decision-point" style="left:'+pct+'%"></b></div>':
    '<div class="decision-meter"><span class="decision-fill" style="width:'+pct+'%"></span></div>';
  const intervalText=hasInterval?' · 95% range '+fmtPct(interval.low)+'–'+fmtPct(interval.high):'';
  return '<article class="decision-card tone-'+effectiveTone+(evidenceReady?'':' thin-evidence')+'"><div><span>'+esc(title)+'</span><strong>'+esc(value)+'</strong></div>'+
    meter+'<p>'+esc(explanation)+'</p><small>'+esc(sub||'')+esc(intervalText)+(evidenceReady?'':' · thin sample — descriptive only')+'</small></article>';
}
function renderDecisionMetrics(r){
  const b=r.behaviorSummary||{},p=r.peerComparison||{},q=r.dataQuality||{},reportRole=canonicalRole(q.selectedRole||r.coachingSummary?.primaryRole||r.summary?.primaryRole||state.selectedRole),roleCoverage=roleEventCoverage(r);
  const objectiveGameWeighted=hasNum(b.objectiveCoachingPresenceRate??b.meanGameObjectiveContestPresenceRate),objective=hasNum(b.objectiveCoachingPresenceRate??b.meanGameObjectiveContestPresenceRate??b.objectiveContestPresenceRate??b.objectiveJoinRate)?Number(b.objectiveCoachingPresenceRate??b.meanGameObjectiveContestPresenceRate??b.objectiveContestPresenceRate??b.objectiveJoinRate):null,objDiagnosis=b.objectiveDiagnosis||{},objDiagnosed=!!objDiagnosis.presenceLow||(Array.isArray(objDiagnosis.causes)&&objDiagnosis.causes.length>0),objectiveN=roleCoverage.contestN,objectiveGames=roleCoverage.contestGames,objectiveReady=roleCoverage.contestReady;
  const fight=hasNum(b.fightSurvivalRate)?Number(b.fightSurvivalRate):null,fightN=Number(b.fightSamples||0),timelineN=Number(b.timelineGames||0),deaths=hasNum(b.badDeathsPerTimelineGame)?Number(b.badDeathsPerTimelineGame):null;
  const tonePct=(v,good,bad,inverse=false)=>v==null?'neutral':inverse?(v<=good?'good':v>=bad?'bad':'neutral'):(v>=good?'good':v<=bad?'bad':'neutral');
  const thin=(isReady,normal)=>isReady?normal:'Current value is shown for context, but the sample is below the analyzer threshold for a directional judgment.';
  const cards=[
    decisionCard('Contested objective presence',fmtPct(objective),objective==null?'neutral':objDiagnosed?tonePct(objective,70,45,false):'neutral',
      objective==null?'Not enough contested-objective evidence.':thin(objectiveReady,objDiagnosed?(objective>=70?'Supported presence is high in the diagnosed objective sample.':objective<45?'Supported death/setup evidence or a shop-timing association accompanies missed contest windows.':'Presence is mixed; use the supported clues below rather than the headline alone.'):(roleLabel(reportRole)+' is not graded against a generic objective-attendance threshold here. Treat supported contest presence as context and inspect only event-level reasons.')),
      (objectiveGameWeighted?'mean per-game rate · ':'legacy pooled rate · ')+String(b.objectiveContestJoinedEncounters??0)+' / '+String(objectiveN)+' contested encounters across '+String(objectiveGames)+' games · floor 5 encounters across 3 games',objective,objectiveReady,null),
    decisionCard('Fight survival · active involvement',fmtPct(fight),tonePct(fight,70,50,false),
      fight==null?'Not enough active fight involvements.':thin(fightN>=8,fight>=70?'You usually stay alive through actively involved fight clusters.':fight<50?'You die in more than half of measured active fight clusters.':'Survival is mixed; review whether deaths happen before or after meaningful contribution.'),
      String(fightN)+' active fights · '+String(b.fightPresenceSamples??fightN)+' supported-presence clusters · '+String(b.fightProximityOnlySamples??0)+' proximity-only · analyzer coaching threshold 8 active fights',fight,fightN>=8,wilsonInterval(Number(b.survivedFightSamples??0),fightN)),
    decisionCard('High-risk deaths / game',deaths==null?'n/a':fmt(deaths,2),deaths==null?'neutral':deaths<=.75?'good':deaths>=1.5?'bad':'neutral',
      deaths==null?'Not enough timeline-complete games.':thin(timelineN>=5,deaths<=.75?'Risky deaths are contained.':deaths>=1.5?'This is frequent enough to materially distort otherwise good games.':'Risky deaths exist but are not the dominant signal.'),
      String(timelineN)+' timeline-complete games · analyzer coaching threshold 5',null,timelineN>=5)
  ];

  if(reportRole==='SUPPORT'){
    const c=roleCoverage,vision=hasNum(b.visionActionDeathRate)?Number(b.visionActionDeathRate):null,setup=hasNum(b.objectiveSetupCoachingRate??b.meanGameEarlySetupObjectiveJoinRate??b.earlySetupObjectiveJoinRate)?Number(b.objectiveSetupCoachingRate??b.meanGameEarlySetupObjectiveJoinRate??b.earlySetupObjectiveJoinRate):null,roam=hasNum(b.roamSuccessRate)?Number(b.roamSuccessRate):null,move=c.laneMean,harm=c.harmWindows,roamReady=c.roamReady&&c.laneReady;
    const roamTone=!roamReady?'neutral':c.harmRepeated?'bad':roam!=null&&roam>=65&&move!=null&&move>=-2?'good':'neutral';
    cards.push(
      decisionCard('Vision-action death rate',fmtPct(vision),tonePct(vision,8,20,true),
        vision==null?'No measured vision-action safety sample.':thin(c.visionReady,vision<=8?'Vision work is usually completed without dying shortly afterwards.':vision>=20?'Vision actions are too often followed by death; review route, timing and ally proximity.':'Vision-action safety is mixed.'),
        String(b.visionActionDeaths??0)+' / '+String(c.visionN)+' tracked vision actions across '+c.visionGames+' games · floor 12 actions across 4 games',vision,c.visionReady,wilsonInterval(Number(b.visionActionDeaths??0),c.visionN)),
      decisionCard('Prior objective setup',fmtPct(setup),tonePct(setup,70,45,false),
        setup==null?'No joined-objective setup sample.':thin(c.setupReady,setup>=70?'You are often established near the objective before the event frame.':setup<45?'Objective arrival is often reactive rather than pre-established.':'Prior setup is mixed.'),
        'mean per-game rate · pooled '+String(b.earlySetupObjectiveJoins??0)+' / '+String(c.setupN)+' joined encounters across '+c.setupGames+' games · floor 5 encounters across 3 games',setup,c.setupReady,null),
      decisionCard('Roam return ↔ ADC lane movement',roam==null?'n/a':fmtPct(roam),roamTone,
        roam==null?'No measured early-roam sample.':thin(roamReady,'Supported roam conversion is '+fmtPct(roam)+(move!=null?' while game-weighted ADC-vs-ADC lane movement averages '+signed(move,1)+' CS.':'')+(harm?' '+harm+' roam window(s) across '+c.harmGames+' game(s) lost at least 6 ADC CS.':'')+' Treat the lane-movement link as association evidence, not sole causation.'),
        c.roamN+' roam attempts across '+c.roamGames+' games · '+c.laneWindows+' lane-movement windows across '+c.laneGames+' games · floors 4/3 and 4/3',roam,roamReady,wilsonInterval(Number(b.roamSuccesses??0),c.roamN))
    );
  }else if(reportRole==='JUNGLE'){
    const c=roleCoverage,impact=hasNum(p.avgImpactDeltaMin)?Number(p.avgImpactDeltaMin):null,impactN=Number(p.impactGames||0),setup=hasNum(b.objectiveSetupCoachingRate??b.meanGameEarlySetupObjectiveJoinRate??b.earlySetupObjectiveJoinRate)?Number(b.objectiveSetupCoachingRate??b.meanGameEarlySetupObjectiveJoinRate??b.earlySetupObjectiveJoinRate):null,setupN=c.setupN,item=hasNum(p.avgMajorItemDeltaMin)?Number(p.avgMajorItemDeltaMin):null,itemN=Number(p.majorItemGames||0);
    cards.push(
      decisionCard('First impact vs Jungle',impact==null?'n/a':signed(impact,1)+'m',impact==null?'neutral':impact<=-1.5?'good':impact>=1.5?'bad':'neutral',
        impact==null?'No comparable first-impact timing sample.':thin(impactN>=5,impact<=-1.5?'Your first tracked impact arrives meaningfully earlier than the enemy Jungler.':impact>=1.5?'The enemy Jungler reaches tracked impact meaningfully earlier.':'First-impact timing is close.'),
        String(impactN)+' comparable impact games · analyzer threshold 5',null,impactN>=5),
      decisionCard('Prior objective setup',fmtPct(setup),tonePct(setup,70,45,false),
        setup==null?'No joined-objective setup sample.':thin(c.setupReady,setup>=70?'You are often established before neutral objectives.':setup<45?'Objective arrival is often reactive rather than pre-established.':'Prior setup is mixed.'),
        'mean per-game rate · pooled '+String(b.earlySetupObjectiveJoins??0)+' / '+String(setupN)+' joined encounters across '+c.setupGames+' games · floor 5 encounters across 3 games',setup,c.setupReady,null),
      decisionCard('First major timing vs Jungle',item==null?'n/a':signed(item,1)+'m',item==null?'neutral':item<=-.75?'good':item>=.75?'bad':'neutral',
        item==null?'No comparable first-major timing sample.':thin(itemN>=4,item<=-.75?'Your first major item completes meaningfully earlier than the enemy Jungler.':item>=.75?'Your first major item completes meaningfully later than the enemy Jungler.':'First-major timing is close.'),
        String(itemN)+' comparable first-major games · analyzer threshold 4',null,itemN>=4)
    );
  }else{
    const reset=hasNum(b.firstResetLossRate)?Number(b.firstResetLossRate):null,resetN=Number(b.firstResetCleanGames||0),spike=hasNum(p.itemSpikeUtilizationRate)?Number(p.itemSpikeUtilizationRate):null,spikeN=Number(p.itemSpikeEligibleWindows||0),giveback=hasNum(b.earlyLeadGivebackRate)?Number(b.earlyLeadGivebackRate):null,leadN=Number(b.earlyLeadGames||0);
    cards.push(
      decisionCard('First-reset economy loss',fmtPct(reset),tonePct(reset,25,50,true),
        reset==null?'Not enough clean first-reset measurements.':thin(resetN>=4,reset<=25?'Most measured first resets preserve or improve lane economy.':reset>=50?'At least half of clean measured first resets lose economy afterwards.':'Reset outcomes are mixed.'),
        String(resetN)+' clean first-reset measurements · analyzer coaching threshold 4',reset,resetN>=4,wilsonInterval(Number(b.firstResetLossGames??0),resetN)),
      decisionCard('Earlier-item windows used',fmtPct(spike),tonePct(spike,60,35,false),
        spike==null?'No reliable first-major advantage windows.':thin(spikeN>=4,spike>=60?'You usually turn an earlier major item into tracked impact.':spike<35?'Earlier item completions often expire without a tracked kill/assist/objective impact.':'Item-spike conversion is mixed.'),
        String(p.itemSpikeUtilizedWindows??0)+' / '+String(spikeN)+' eligible windows · analyzer coaching threshold 4',spike,spikeN>=4,wilsonInterval(Number(p.itemSpikeUtilizedWindows??0),spikeN)),
      decisionCard('Early leads given back',fmtPct(giveback),tonePct(giveback,30,50,true),
        giveback==null?'No meaningful ≥500g pre-15 lead sample.':thin(leadN>=4,giveback<=30?'Most measured early leads are preserved into the 15-minute checkpoint.':giveback>=50?'At least half of measured early leads erode substantially before 15.':'Lead preservation is inconsistent.'),
        String(b.earlyLeadGivebackGames??0)+' / '+String(leadN)+' lead games · analyzer coaching threshold 4',giveback,leadN>=4,wilsonInterval(Number(b.earlyLeadGivebackGames??0),leadN))
    );
  }
  $('decisionMetrics').innerHTML=cards.join('');
  $('objectiveDiagnosisSummary').innerHTML=objectiveDiagnosisHtml(r);
}
function objectiveFamilyLabel(key){
  const k=String(key||'').toUpperCase();
  if(k==='DRAGON')return'Dragon';
  if(k==='ELDER_DRAGON'||k==='ELDER')return'Elder Dragon';
  if(k==='BARON_NASHOR'||k==='BARON')return'Baron Nashor';
  if(k==='RIFT_HERALD'||k==='RIFTHERALD'||k==='HERALD')return'Rift Herald';
  if(k==='VOID_GRUBS'||k==='VOID_GRUB'||k==='HORDE')return'Void Grubs';
  return String(key||'Objective').replaceAll('_',' ').toLowerCase().replace(/\b\w/g,c=>c.toUpperCase());
}
function gameObjectiveFamilyRow(g,key){
  const rows=g?.objectiveFamilyStats||{},wanted=String(key||'');
  if(!wanted)return null;
  if(rows[wanted])return rows[wanted];
  const upper=wanted.toUpperCase();
  const found=Object.keys(rows).find(k=>String(k).toUpperCase()===upper);
  return found?rows[found]:null;
}
function objectiveFamilyMatchIds(r,key){
  return new Set(reportCoachingGames(r).filter(g=>Number(gameObjectiveFamilyRow(g,key)?.contestedEncounters||0)>0).map(g=>String(g.matchId||'')).filter(Boolean));
}
function renderObjectiveFamilyOverview(r){
  const box=$('objectiveFamilyOverview');if(!box)return;
  const summary=r?.behaviorSummary?.objectiveFamilySummary||{},rows=Object.entries(summary).map(([key,x])=>({
    key,label:objectiveFamilyLabel(key),encounters:Number(x?.encounters||0),team:Number(x?.teamEncounters||0),enemy:Number(x?.enemyEncounters||0),
    teamUnits:Number(x?.teamUnitsSecured||0),enemyUnits:Number(x?.enemyUnitsSecured||0),contested:Number(x?.contestedEncounters||0),
    joined:Number(x?.joinedContestedEncounters||0),presence:hasNum(x?.contestPresenceRate)?Number(x.contestPresenceRate):null,
    teamJoined:Number(x?.joinedTeamEncounters||0),teamJoinRate:hasNum(x?.teamJoinRate)?Number(x.teamJoinRate):null
  })).filter(x=>x.encounters>0||x.contested>0).sort((a,b)=>b.contested-a.contested||b.encounters-a.encounters||a.label.localeCompare(b.label));
  if(!rows.length){box.innerHTML='';return;}
  const reviewable=rows.filter(x=>x.contested>=3),mostMissed=reviewable.slice().sort((a,b)=>(a.presence??101)-(b.presence??101)||b.contested-a.contested)[0]||null;
  box.innerHTML='<div class="section-subhead objective-family-head"><div><span>Objective families</span><strong>Which objective types create contested windows?</strong></div><small>This answers objective type. Teamfight map location is analyzed separately below.</small></div>'+
    '<div class="objective-family-grid">'+rows.map(x=>{
      const interval=wilsonInterval(x.joined,x.contested),thin=x.contested<3,matchCount=objectiveFamilyMatchIds(r,x.key).size;
      return '<article class="objective-family-card '+(thin?'thin-evidence':'')+'"><span>'+esc(x.label)+'</span><strong>'+(x.presence==null?'n/a':esc(fmtPct(x.presence)))+' contested presence</strong>'+
        '<div class="objective-family-statline"><b>'+x.joined+'/'+x.contested+'</b><small>contested joins</small></div>'+
        (interval?'<div class="objective-family-interval"><i style="left:'+clamp(interval.low,0,100)+'%;width:'+(clamp(interval.high,0,100)-clamp(interval.low,0,100))+'%"></i><b style="left:'+clamp(x.presence,0,100)+'%"></b></div><small class="objective-family-ci">95% range '+esc(fmtPct(interval.low))+'–'+esc(fmtPct(interval.high))+'</small>':'')+
        '<p>Team-controlled encounters '+x.team+' · enemy-controlled '+x.enemy+' · secured units '+x.teamUnits+' vs '+x.enemyUnits+(hasNum(x.teamJoinRate)?' · present for '+fmtPct(x.teamJoinRate)+' of team-secured encounters':'')+'.</p>'+
        (thin?'<small class="objective-family-thin">Fewer than 3 contested encounters — context only.</small>':'<button class="button secondary tiny objective-family-review" type="button" data-objective-family-review="'+esc(x.key)+'">Review '+matchCount+' matching game'+(matchCount===1?'':'s')+'</button>')+
      '</article>';
    }).join('')+'</div>'+
    (mostMissed?'<div class="objective-family-note"><b>Review clue:</b> '+esc(mostMissed.label)+' has the lowest contested-presence point estimate among families with at least 3 contested encounters ('+esc(fmtPct(mostMissed.presence))+' across '+mostMissed.contested+'). Treat this as a replay-priority clue, not proof that objective attendance caused results.</div>':'');
  box.querySelectorAll('[data-objective-family-review]').forEach(btn=>btn.addEventListener('click',()=>{
    state.matchHistoryObjectiveFamilyKey=String(btn.dataset.objectiveFamilyReview||'');
    state.matchHistoryFilter='objective-family';state.matchHistoryLimit=10;renderMatchHistory(r);
    $('match-history')?.scrollIntoView({behavior:'auto',block:'start'});
  }));
}

function renderTeamfightDecisionOverview(r){
  const box=$('teamfightDecisionOverview'),panel=$('teamfightDecisionPanel');if(!box||!panel)return;
  const windows=[];
  for(const g of reportCoachingGames(r)){
    for(const ev of g?.fightProfile?.events||[])if(ev?.fightZone&&ev.fightZone!=='unknown')windows.push({...ev,matchId:g.matchId,champion:g.champion,joined:true});
    for(const ev of g?.fightProfile?.absenceEvents||[])if(ev?.fightZone&&ev.fightZone!=='unknown')windows.push({...ev,matchId:g.matchId,champion:g.champion,joined:false});
  }
  if(!windows.length){panel.hidden=true;box.innerHTML='';return;}
  const groups=new Map();
  for(const x of windows){const k=String(x.fightZone),row=groups.get(k)||{zone:k,total:0,joined:0,absent:0,trades:0,joinReview:0};row.total++;if(x.joined)row.joined++;else{row.absent++;if(x.crossMapTradeSupported===true)row.trades++;if(x.joinReviewPriority==='high')row.joinReview++;}groups.set(k,row);}
  const zones=[...groups.values()].sort((a,b)=>b.total-a.total||b.absent-a.absent||a.zone.localeCompare(b.zone));
  const absences=windows.filter(x=>!x.joined).sort((a,b)=>(a.joinReviewPriority==='high'?0:a.crossMapTradeSupported?2:1)-(b.joinReviewPriority==='high'?0:b.crossMapTradeSupported?2:1)||Number(b.startMin||0)-Number(a.startMin||0)).slice(0,10);
  const verdict=x=>x.crossMapTradeSupported===true?{tone:'good',label:'Measurable cross-map trade'}:x.decisionReview==='team_won_without_player'?{tone:'neutral',label:'Team won without you'}:x.joinReviewPriority==='high'?{tone:'bad',label:'Review whether you should join'}:x.lostFight?{tone:'neutral',label:'Lost fight · joinability unclear'}:{tone:'neutral',label:'No automatic join claim'};
  const tradeEvidence=x=>[
    hasNum(x.crossMapGoldSwingVsPeer)?signed(x.crossMapGoldSwingVsPeer,0)+'g vs role':'',
    hasNum(x.crossMapCsSwingVsPeer)?signed(x.crossMapCsSwingVsPeer,1)+' CS vs role':'',
    Number(x.playerStructureGains||0)?Number(x.playerStructureGains)+' structure gain'+(Number(x.playerStructureGains)===1?'':'s'):'',
    Number(x.playerNeutralObjectiveGains||0)?Number(x.playerNeutralObjectiveGains)+' neutral objective gain'+(Number(x.playerNeutralObjectiveGains)===1?'':'s'):''
  ].filter(Boolean).join(' · ')||'No supported 90s compensation tracked';
  box.innerHTML='<div class="teamfight-zone-grid">'+zones.map(x=>'<article class="teamfight-zone-card"><span>'+esc(x.zone)+'</span><strong>'+x.total+' fight window'+(x.total===1?'':'s')+'</strong><p>Joined '+x.joined+' · away '+x.absent+(x.absent?' · '+x.trades+' away window'+(x.trades===1?'':'s')+' with measurable trade':'')+'.</p>'+(x.joinReview?'<small>'+x.joinReview+' high-priority skipped-fight review'+(x.joinReview===1?'':'s')+'</small>':'<small>No high-priority skipped-fight call in this area.</small>')+'</article>').join('')+'</div>'+
    (absences.length?'<div class="teamfight-absence-list"><div class="section-subhead"><div><span>When you were elsewhere</span><strong>Did staying cross-map buy anything?</strong></div><small>Fight outcome + direct-role economy/structure/objective compensation.</small></div>'+absences.map(x=>{const v=verdict(x);return '<article class="teamfight-decision-card tone-'+v.tone+'"><div><span>'+esc(x.fightZone)+' · '+esc(fmt(x.startMin,1))+'m</span><strong>'+esc(v.label)+'</strong><p>Fight kills '+Number(x.teamFightKills||0)+'–'+Number(x.enemyFightKills||0)+(hasNum(x.playerDistanceToFight)?' · ~'+fmt(Number(x.playerDistanceToFight)/1000,1)+'k map units away':'')+(hasNum(x.numbersDelta)?' · local numbers '+signed(x.numbersDelta,0):'')+'</p><small>'+esc(tradeEvidence(x))+'</small></div><button class="button secondary tiny" type="button" data-fight-review="'+esc(x.matchId||'')+'">Open match</button></article>';}).join('')+'</div>':'<div class="teamfight-decision-empty">No position-supported skipped teamfight windows in the current deep sample.</div>')+
    '<p class="source-note"><b>How this works:</b> fights are Riot multi-kill clusters grouped by time and coordinates. Map names are coarse, team-relative coordinate zones—not exact turret detection. A skipped fight gets “measurable cross-map trade” only when the next ~90 seconds show a supported structure/neutral-objective gain or at least +250g / +6 CS movement versus the direct role opponent. “Review whether you should join” additionally requires a lost fight, no supported compensation and a roughly reachable start position. These labels rank replay questions; they do not prove the counterfactual.</p>';
  box.querySelectorAll('[data-fight-review]').forEach(btn=>btn.addEventListener('click',()=>{const id=btn.dataset.fightReview;if(id)openReplayReviewMatch(id,'fights');}));
  panel.hidden=false;
}

function renderPhaseDiagnostic(r){
  const box=$('phaseDiagnostic'),note=$('phaseDiagnosticNote');if(!box)return;
  const b=r.behaviorSummary||{},p=r.peerComparison||{},phase=b.phaseRisk||{},mid=b.midRouting||{},closing=b.closing25||{},role=canonicalRole(r?.dataQuality?.selectedRole||r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||state.selectedRole);
  const defs=[['early','Early phase'],['mid','Transition phase'],['late','Late strategic phase']];
  const rows=defs.map(([key,label])=>{const x=phase[key]||{};return{key,label,games:Number(x.games||0),exposure:Number(x.exposureMinutes||0),high:hasNum(x.highRiskDeathsPer10Min)?Number(x.highRiskDeathsPer10Min):null,costly:hasNum(x.costlyDeathsPer10Min)?Number(x.costlyDeathsPer10Min):null,severe:hasNum(x.severeDeathsPer10Min)?Number(x.severeDeathsPer10Min):null,fights:Number(x.fightClusters||0),first:hasNum(x.firstAllyFightDeathRate)?Number(x.firstAllyFightDeathRate):null,raw:x,ready:Number(x.games||0)>=5&&Number(x.exposureMinutes||0)>=20};});
  const highEligible=rows.filter(x=>x.ready&&hasNum(x.high)).sort((a,b)=>Number(b.high)-Number(a.high)),highTop=highEligible[0]||null,highNext=highEligible[1]||null,highGap=highTop?(Number(highTop.high)-Number(highNext?.high||0)):0,highHot=!!highTop&&Number(highTop.high)>=.35&&highGap>=.15;
  const costlyEligible=rows.filter(x=>x.ready&&hasNum(x.costly)).sort((a,b)=>Number(b.costly)-Number(a.costly)),costTop=costlyEligible[0]||null,costNext=costlyEligible[1]||null,costGap=costTop?(Number(costTop.costly)-Number(costNext?.costly||0)):0,costHot=!!costTop&&Number(costTop.costly)>=.30&&costGap>=.12;
  const context=x=>{
    const contest=hasNum(b.objectiveCoachingPresenceRate??b.meanGameObjectiveContestPresenceRate??b.objectiveContestPresenceRate??b.objectiveJoinRate)?fmtPct(b.objectiveCoachingPresenceRate??b.meanGameObjectiveContestPresenceRate??b.objectiveContestPresenceRate??b.objectiveJoinRate):'n/a',setup=hasNum(b.objectiveSetupCoachingRate??b.meanGameEarlySetupObjectiveJoinRate??b.earlySetupObjectiveJoinRate)?fmtPct(b.objectiveSetupCoachingRate??b.meanGameEarlySetupObjectiveJoinRate??b.earlySetupObjectiveJoinRate):'n/a',fight=hasNum(b.fightSurvivalRate)?fmtPct(b.fightSurvivalRate):'n/a';
    if(x.key==='early'){
      if(role==='JUNGLE'){const impact=hasNum(p.avgImpactDeltaMin)?signed(p.avgImpactDeltaMin,1)+'m':'n/a',item=hasNum(p.avgMajorItemDeltaMin)?signed(p.avgMajorItemDeltaMin,1)+'m':'n/a';return 'first impact vs jungler '+impact+' · first major vs jungler '+item;}
      if(role==='SUPPORT'){const roam=hasNum(b.roamSuccessRate)?fmtPct(b.roamSuccessRate):'n/a',vision=hasNum(b.visionActionDeathRate)?fmtPct(b.visionActionDeathRate):'n/a';return 'early roam conversion '+roam+' · vision-action death rate '+vision;}
      const lane=hasNum(p.avgGoldDiff15)?'Role gold @15 '+signed(p.avgGoldDiff15,0)+'g':'Role gold @15 n/a',reset=hasNum(b.firstResetLossRate)?'first-reset loss '+fmtPct(b.firstResetLossRate):'first-reset loss n/a';return lane+' · '+reset;
    }
    if(x.key==='mid'){
      if(role==='JUNGLE')return 'prior objective setup '+setup+' · contested presence '+contest;
      if(role==='SUPPORT')return 'prior objective setup '+setup+' · vision-action death rate '+(hasNum(b.visionActionDeathRate)?fmtPct(b.visionActionDeathRate):'n/a');
      const cs=hasNum(mid.avgCsSwing15to25)?'CS swing '+signed(mid.avgCsSwing15to25,1):'CS swing n/a',obj=hasNum(mid.coachingObjectivePresenceRate??mid.meanGameObjectiveJoinRate??mid.avgObjectiveJoinRate)?'objective presence '+fmtPct(mid.coachingObjectivePresenceRate??mid.meanGameObjectiveJoinRate??mid.avgObjectiveJoinRate):'objective presence n/a';return cs+' · '+obj;
    }
    if(role==='JUNGLE')return 'fight survival '+fight+' · contested objective presence '+contest;
    if(role==='SUPPORT')return 'fight survival '+fight+' · prior objective setup '+setup;
    const lead=hasNum(closing.leadWinRate)?'lead@25 win '+fmtPct(closing.leadWinRate):'lead@25 win n/a',def=hasNum(closing.deficitWinRate)?'deficit@25 win '+fmtPct(closing.deficitWinRate):'deficit@25 win n/a';return lead+' · '+def;
  };
  box.innerHTML=rows.map(x=>{
    const isHighHot=highHot&&highTop?.key===x.key,isCostHot=costHot&&costTop?.key===x.key,tone=isHighHot||isCostHot?'bad':'neutral';
    const headline=!x.ready?'Thin phase sample':(isHighHot&&isCostHot?'High-risk + costly hotspot':isHighHot?'High-risk hotspot':isCostHot?'Costly-death hotspot':'No hotspot call');
    return '<article class="phase-diagnostic-card tone-'+tone+(x.ready?'':' thin-evidence')+'"><span>'+esc(x.label)+'</span><strong>'+esc(headline)+'</strong><div class="phase-rate-row"><b>'+esc(hasNum(x.high)?fmt(x.high,2):'n/a')+'</b><small>high-risk /10m</small><b>'+esc(hasNum(x.costly)?fmt(x.costly,2):'n/a')+'</b><small>costly /10m</small></div><p>'+esc(context(x))+'</p><small>'+x.games+' eligible games · '+fmtInt(x.exposure)+' exposure-min · '+x.fights+' active fight clusters'+(hasNum(x.first)?' · first allied death '+fmtPct(x.first):'')+'</small></article>';
  }).join('');
  const messages=[];
  if(highHot)messages.push('High-risk hotspot: '+highTop.label+' at '+fmt(highTop.high,2)+'/10m, '+signed(highGap,2)+'/10m above the next phase.');
  if(costHot)messages.push('Costly-death hotspot: '+costTop.label+' at '+fmt(costTop.costly,2)+'/10m, '+signed(costGap,2)+'/10m above the next phase.');
  if(!messages.length){const top=highTop;messages.push(top?'No phase clears the hotspot rule. Highest supported high-risk rate is '+top.label+' at '+fmt(top.high,2)+'/10m; either the absolute rate or separation is below threshold.':'Not enough phase exposure to compare risk concentration.');}
  if(note)note.textContent=messages.join(' ')+' Hotspot rule: ≥5 eligible games, ≥20 exposure-minutes, high-risk rate ≥0.35/10m with ≥0.15 gap; costly rate ≥0.30/10m with ≥0.12 gap. Phase boundaries follow each game’s verified rules profile rather than assuming one fixed timer.';
}
function intelligenceCard(title,value,tone,body,evidence,evidenceReady=true){
  return '<article class="intelligence-card tone-'+(evidenceReady?tone:'neutral')+(evidenceReady?'':' thin-evidence')+'"><div><span>'+esc(title)+'</span><strong>'+esc(value)+'</strong></div><p>'+esc(body)+'</p><small>'+esc(evidence||'')+(evidenceReady?'':' · thin sample — descriptive only')+'</small></article>';
}
function renderCompoundSignals(r){
  const target=$('compoundSignals'),panel=$('compoundIntelligencePanel');if(!target||!panel)return;
  const b=r.behaviorSummary||{},p=r.peerComparison||{},rows=[],sampleGames=Number(r.coachingSummary?.games??r.summary?.games??0),role=canonicalRole(r?.dataQuality?.selectedRole||r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||state.selectedRole);
  if(role!=='SUPPORT'&&(hasNum(p.avgGoldDiff15)||hasNum(b.earlyLeadGivebackRate))){
    const lead=Number(p.avgGoldDiff15||0),give=hasNum(b.earlyLeadGivebackRate)?Number(b.earlyLeadGivebackRate):null,leadDeaths=Number(b.highRiskLeadDeaths||0),n=Number(b.earlyLeadGames||0),ready=n>=4;
    const tone=give==null?'neutral':give<=30?'good':give>=50?'bad':'neutral';
    rows.push(intelligenceCard('Lead → preservation',hasNum(p.avgGoldDiff15)?signed(p.avgGoldDiff15,0)+'g @15':'Lead sample',tone,(lead>150?'You usually create a role lead. ':'')+(give==null?'There is not yet enough lead-preservation evidence.':give.toFixed(0)+'% of measured ≥500g early leads were given back by 15.')+(leadDeaths?' '+leadDeaths+' high-risk death(s) occurred while materially ahead.':''),n+' lead games · analyzer threshold 4 · combines role state + subsequent risk',ready));
  }
  const mid=b.midRouting||{};
  if(['ADC','MID','TOP'].includes(role)&&(hasNum(mid.avgCsSwing15to25)||hasNum(mid.coachingObjectivePresenceRate??mid.meanGameObjectiveJoinRate??mid.avgObjectiveJoinRate))){
    const cs=hasNum(mid.avgCsSwing15to25)?Number(mid.avgCsSwing15to25):null,obj=hasNum(mid.coachingObjectivePresenceRate??mid.meanGameObjectiveJoinRate??mid.avgObjectiveJoinRate)?Number(mid.coachingObjectivePresenceRate??mid.meanGameObjectiveJoinRate??mid.avgObjectiveJoinRate):null,side=Number(b.preNeutralObjectiveSideLaneDeaths||0),n=Number(mid.games||0),ready=n>=4;
    const tone=side>=3?'bad':cs!=null&&cs>=0&&obj!=null&&obj>=50?'good':'neutral';
    rows.push(intelligenceCard('Farm ↔ map trade-off',(cs!=null?signed(cs,1)+' CS 15→25':'Routing sample'),tone,(cs!=null?'Your direct-role CS differential changes '+signed(cs,1)+' between 15 and 25. ':'')+(obj!=null?'Supported objective presence in comparable routing games is '+fmtPct(obj)+'. ':'')+(side?side+' isolated side-lane death(s) happened shortly before a neutral objective.':'No repeated pre-objective side-lane death pattern is currently measured.'),n+' comparable routing games · analyzer threshold 4 · combines farm gain + objective reconnect timing',ready));
  }
  if(role!=='SUPPORT'&&(hasNum(p.avgMajorItemDeltaMin)||hasNum(p.itemSpikeUtilizationRate))){
    const delta=hasNum(p.avgMajorItemDeltaMin)?Number(p.avgMajorItemDeltaMin):null,use=hasNum(p.itemSpikeUtilizationRate)?Number(p.itemSpikeUtilizationRate):null,died=Number(p.itemSpikeDeathsBeforeImpact||0),timingN=Number(p.majorItemGames||0),windowN=Number(p.itemSpikeEligibleWindows||0),ready=use==null?timingN>=4:windowN>=4;
    const tone=use==null?'neutral':use>=60?'good':use<35?'bad':'neutral';
    rows.push(intelligenceCard('Item timing → impact',(delta!=null?signed(delta,1)+' min vs role':'Power window'),tone,(delta!=null?(delta<0?'Your first major usually arrives earlier. ':'Your first major usually arrives later. '):'')+(use!=null?fmtPct(use)+' of measurable earlier-item windows produced tracked impact before role-opponent parity. ':'')+(died?died+' window(s) ended in death before tracked impact.':''),timingN+' timing games · '+windowN+' usable power windows · analyzer threshold 4',ready));
  }
  if(['ADC','MID','TOP'].includes(role)&&(hasNum(b.damageGoldEfficiency)||hasNum(b.preContributionFightDeathRate))){
    const eff=hasNum(b.damageGoldEfficiency)?Number(b.damageGoldEfficiency):null,pre=hasNum(b.preContributionFightDeathRate)?Number(b.preContributionFightDeathRate):null,surv=hasNum(b.fightSurvivalRate)?Number(b.fightSurvivalRate):null,fights=Number(b.fightSamples||0),ready=fights>=8&&sampleGames>=5;
    const tone=pre!=null&&pre>=30?'bad':eff!=null&&eff>=2&&surv!=null&&surv>=60?'good':'neutral';
    rows.push(intelligenceCard('Resources → fight uptime',eff!=null?signed(eff,1)+' points damage−gold':'Fight conversion',tone,(eff!=null?'Damage share minus gold share is '+signed(eff,1)+' percentage points. ':'')+(pre!=null?'You die before tracked contribution in '+fmtPct(pre)+' of active fight clusters. ':'')+(surv!=null?'Active-fight survival is '+fmtPct(surv)+'.':''),fights+' active fight clusters · '+String(b.fightProximityOnlySamples??0)+' proximity-only clusters excluded · '+sampleGames+' coaching games · thresholds 8 active fights / 5 games',ready));
  }
  if(role==='JUNGLE'){
    const c=roleEventCoverage(r),impact=hasNum(p.avgImpactDeltaMin)?Number(p.avgImpactDeltaMin):null,item=hasNum(p.avgMajorItemDeltaMin)?Number(p.avgMajorItemDeltaMin):null,setup=hasNum(b.objectiveSetupCoachingRate??b.meanGameEarlySetupObjectiveJoinRate??b.earlySetupObjectiveJoinRate)?Number(b.objectiveSetupCoachingRate??b.meanGameEarlySetupObjectiveJoinRate??b.earlySetupObjectiveJoinRate):null,contest=hasNum(b.objectiveCoachingPresenceRate??b.meanGameObjectiveContestPresenceRate??b.objectiveContestPresenceRate??b.objectiveJoinRate)?Number(b.objectiveCoachingPresenceRate??b.meanGameObjectiveContestPresenceRate??b.objectiveContestPresenceRate??b.objectiveJoinRate):null,impactN=Number(p.impactGames||0),itemN=Number(p.majorItemGames||0),setupN=c.setupN,contestN=c.contestN,ready=impactN>=5&&c.setupReady&&c.contestReady;
    const tone=!ready?'neutral':impact!=null&&impact<=-1&&setup!=null&&setup>=65&&contest!=null&&contest>=70?'good':impact!=null&&impact>=1.5&&setup!=null&&setup<45?'bad':'neutral';
    rows.push(intelligenceCard('Tempo → objective readiness',impact==null?'Jungle tempo sample':signed(impact,1)+'m first impact vs peer',tone,(impact!=null?'First tracked impact is '+(impact<0?fmt(Math.abs(impact),1)+'m earlier':impact>0?fmt(Math.abs(impact),1)+'m later':'even')+' versus the enemy jungler. ':'')+(item!=null?'First major timing is '+signed(item,1)+'m vs peer. ':'')+(setup!=null?'Mean per-game prior setup is '+fmtPct(setup)+'. ':'')+(contest!=null?'Mean per-game contested-objective presence is '+fmtPct(contest)+'.':''),impactN+' impact games · '+itemN+' item games · '+setupN+' setup joins across '+c.setupGames+' games · '+contestN+' contested encounters across '+c.contestGames+' games · event floors 5/5 plus 3-game spread',ready));
  }
  if(role==='SUPPORT'){
    const c=roleEventCoverage(r),roam=hasNum(b.roamSuccessRate)?Number(b.roamSuccessRate):null,move=c.laneMean,harm=c.harmWindows,roamReady=c.roamReady&&c.laneReady,roamTone=!roamReady?'neutral':c.harmRepeated?'bad':roam!=null&&roam>=60&&move!=null&&move>=-2?'good':'neutral';
    rows.push(intelligenceCard('Roam value ↔ ADC lane movement',roam==null?'Support roam sample':fmtPct(roam)+' conversion',roamTone,(roam!=null?'Detected roam conversion is '+fmtPct(roam)+'. ':'')+(move!=null?'Game-weighted ADC-vs-ADC CS movement across measured roam games averages '+signed(move,1)+' CS. ':'')+(harm?harm+' roam window(s) across '+c.harmGames+' game(s) lost ≥6 CS.':''),c.roamN+' roam attempts across '+c.roamGames+' games · '+c.laneWindows+' lane-movement windows across '+c.laneGames+' games · floors 4/3 and 4/3 · association evidence, not sole causation',roamReady));
    const visionRate=hasNum(b.visionActionDeathRate)?Number(b.visionActionDeathRate):null,setup=hasNum(b.objectiveSetupCoachingRate??b.meanGameEarlySetupObjectiveJoinRate??b.earlySetupObjectiveJoinRate)?Number(b.objectiveSetupCoachingRate??b.meanGameEarlySetupObjectiveJoinRate??b.earlySetupObjectiveJoinRate):null,ready=c.visionReady&&c.setupReady,tone=!ready?'neutral':visionRate!=null&&visionRate<=8&&setup!=null&&setup>=70?'good':visionRate!=null&&visionRate>=20&&setup!=null&&setup<45?'bad':'neutral';
    rows.push(intelligenceCard('Vision safety → objective setup',setup==null?'Support setup sample':fmtPct(setup)+' prior setup',tone,(visionRate!=null?'Vision-action death rate is '+fmtPct(visionRate)+'. ':'')+(setup!=null?'Prior objective setup is '+fmtPct(setup)+'. ':'')+'These signals are paired to distinguish productive setup work from risky information gathering.',c.visionN+' vision actions across '+c.visionGames+' games · '+c.setupN+' joined objective encounters across '+c.setupGames+' games · event floors 12/5 plus game-spread floors 4/3',ready));
  }
  if(hasNum(b.repeatDeathRate)){
    const mine=Number(b.repeatDeathRate),matchedMine=hasNum(b.peerMatchedRepeatDeathRate)?Number(b.peerMatchedRepeatDeathRate):null,peer=hasNum(b.opponentRepeatDeathRate)?Number(b.opponentRepeatDeathRate):null,costly=Number(b.costlyRepeatDeaths||0),n=Number(b.repeatDeathOpportunities||0),matchedN=Number(b.peerMatchedRepeatDeathOpportunities||0),ready=n>=8,tone=mine>=60?'bad':mine<=30?'good':'neutral';
    const peerText=matchedMine!=null&&peer!=null?' In the trusted matched-peer subset, you are at '+fmtPct(matchedMine)+' versus '+fmtPct(peer)+' for the direct role opponents.':'';
    rows.push(intelligenceCard('Death → recovery stability',fmtPct(mine)+' repeat-death rate',tone,'Across all valid games, '+fmtPct(mine)+' of measured recovery opportunities become another death within four minutes.'+peerText+(costly?' '+costly+' repeat death(s) also had measurable costly aftermath.':''),n+' all-game recovery opportunities'+(matchedN?' · '+matchedN+' matched-peer opportunities':'')+' · analyzer threshold 8',ready));
  }
  panel.hidden=!rows.length;target.innerHTML=rows.join('');
}
function renderBullets(id,items,empty){
  const list=(items||[]).filter(Boolean);
  $(id).innerHTML=list.length?list.map(x=>{
    if(typeof x==='string')return '<div class="bullet">'+esc(x)+'</div>';
    const title=x.title||x.label||x.category||'Insight',evidence=x.evidence||x.text||'',action=x.action||'',confidence=x.confidence||'',supportCount=Number(x.supportCount||0);
    return '<div class="bullet coaching-bullet priority-'+esc(String(x.priority||3))+'">'+
      '<div class="coaching-head"><strong>'+esc(title)+'</strong>'+(x.category?'<span>'+esc(x.category)+'</span>':'')+(x.priority?'<em>Priority '+esc(String(x.priority))+'</em>':'')+(confidence?'<small>'+esc(confidence)+' confidence'+(supportCount?' · '+supportCount+' supporting finding'+(supportCount===1?'':'s'):'')+'</small>':'')+'</div>'+
      (evidence?'<p>'+esc(evidence)+'</p>':'')+
      (x.comparison?'<p class="coaching-source"><b>Compared with:</b> '+esc(x.comparison)+'</p>':'')+
      (action?'<p class="coaching-action"><b>Improve:</b> '+esc(action)+'</p>':'')+
      '</div>';
  }).join(''):'<div class="bullet empty">'+esc(empty)+'</div>';
}

function pathValue(obj,path){
  return String(path||'').split('.').reduce((v,k)=>v==null?null:v[k],obj);
}

const PRACTICE_TARGET_SAMPLE_PATHS={
  'behaviorSummary.earlyLeadGivebackRate':['behaviorSummary.earlyLeadGames'],
  'summary.csMin':['coachingSummary.games'],
  'summary.goldDiff15':['peerComparison.laneGames15'],
  'coachingSummary.csMin':['coachingSummary.games'],
  'coachingSummary.goldDiff15':['peerComparison.laneGames15'],
  'peerComparison.avgGoldDiff15':['peerComparison.laneGames15'],
  'peerComparison.avgImpactDeltaMin':['peerComparison.impactGames'],
  'peerComparison.avgVpmDelta':['peerComparison.vpmGames'],
  'peerComparison.avgObjectiveSetupDelta':['peerComparison.visionSetupGames'],
  'peerComparison.objectiveSetupWardRateDelta':['peerComparison.visionSetupGames'],
  'peerComparison.higherRankAvgMajorItemDeltaMin':['peerComparison.higherRankMajorItemGames'],
  'peerComparison.rankBands.higher.avgGoldDiff15':['peerComparison.rankBands.higher.laneGames'],
  'peerComparison.rankBands.lower.avgGoldDiff15':['peerComparison.rankBands.lower.laneGames'],
  'behaviorSummary.highRiskUntradedPostImpactPerGame':['behaviorSummary.timelineGames'],
  'behaviorSummary.highRiskBehindDeathsPerGame':['behaviorSummary.directPeerTimelineGames'],
  'behaviorSummary.highRiskLeadDeathsPerGame':['behaviorSummary.directPeerTimelineGames'],
  'behaviorSummary.repeatDeathRate':['behaviorSummary.repeatDeathOpportunities'],
  'behaviorSummary.repeatDeathsPerTimelineGame':['behaviorSummary.timelineGames'],
  'behaviorSummary.costlyDeathsPerTimelineGame':['behaviorSummary.timelineGames'],
  'behaviorSummary.badDeathsPerTimelineGame':['behaviorSummary.timelineGames'],
  'behaviorSummary.firstResetLossRate':['behaviorSummary.firstResetCleanGames'],
  'behaviorSummary.greedyStaysPerTimelineGame':['behaviorSummary.timelineGames'],
  'behaviorSummary.soloKillDeathsBeforeShopRate':['behaviorSummary.soloKillResetEvents'],
  'behaviorSummary.itemSpikeUtilizationRate':['behaviorSummary.itemSpikeEligibleWindows'],
  'behaviorSummary.highUnspentFightRate':['behaviorSummary.highUnspentFightSamples'],
  'behaviorSummary.preNeutralObjectiveSideLaneDeathsPerGame':['behaviorSummary.timelineGames'],
  'behaviorSummary.midRouting.avgCsSwing15to25':['behaviorSummary.midRouting.games'],
  'behaviorSummary.midRouting.avgObjectiveJoinRate':['behaviorSummary.midRouting.games'],
  'behaviorSummary.midRouting.coachingObjectivePresenceRate':['behaviorSummary.midRouting.games'],
  'behaviorSummary.recentShopObjectiveAbsenceRate':['behaviorSummary.neutralObjectiveEvents'],
  'behaviorSummary.preObjectiveDeathPct':['behaviorSummary.classifiedTimelineDeaths'],
  'behaviorSummary.preObjectiveDeathsPerTimelineGame':['behaviorSummary.timelineGames'],
  'behaviorSummary.objectiveSetupWardRate':['behaviorSummary.visionWardTotal'],
  'behaviorSummary.earlySetupObjectiveJoinRate':['behaviorSummary.neutralObjectiveJoins'],
  'behaviorSummary.objectiveSetupCoachingRate':['behaviorSummary.objectiveSetupGames'],
  'behaviorSummary.killConversionRate':['behaviorSummary.killConversionWindows'],
  'behaviorSummary.closing25.leadLateRiskLossRate':['behaviorSummary.closing25.leadLosses'],
  'behaviorSummary.closing25.leadLateRiskPerLeadGameRate':['behaviorSummary.closing25.leadGames'],
  'behaviorSummary.objectiveJoinRate':['behaviorSummary.neutralObjectiveEvents'],
  'behaviorSummary.objectiveCoachingPresenceRate':['behaviorSummary.objectiveContestGames'],
  'behaviorSummary.firstAllyFightDeathRate':['behaviorSummary.fightSamples'],
  'behaviorSummary.preContributionFightDeathRate':['behaviorSummary.fightSamples'],
  'behaviorSummary.damageGoldEfficiency':['coachingSummary.games'],
  'behaviorSummary.highRiskBehindDeathRate':['behaviorSummary.behindStateDeaths'],
  'behaviorSummary.visionActionDeathRate':['behaviorSummary.visionActions'],
  'behaviorSummary.roamSuccessRate':['behaviorSummary.roamAttempts'],
  'behaviorSummary.avgRoamLaneCostCs':['behaviorSummary.roamLaneCostGames'],
  'behaviorSummary.meanGameRoamLaneMovementCs':['behaviorSummary.roamLaneCostMeasuredGames'],
  'behaviorSummary.meanGameSupportRoamAdcLaneMovementCs':['behaviorSummary.supportRoamAdcLaneMovementGames'],
  'sessionBehavior.game3PlusGoldDelta':['sessionBehavior.firstGame.lane15Games','sessionBehavior.game3Plus.lane15Games'],
  'sessionBehavior.postLossGoldDelta':['sessionBehavior.quickAfterLoss.lane15Games','sessionBehavior.quickAfterWin.lane15Games'],
  'sessionBehavior.game3PlusPeerVpmDelta':['sessionBehavior.firstGame.peerVpmGames','sessionBehavior.game3Plus.peerVpmGames'],
  'sessionBehavior.postLossPeerVpmDelta':['sessionBehavior.quickAfterLoss.peerVpmGames','sessionBehavior.quickAfterWin.peerVpmGames'],
  'sessionBehavior.game3PlusPeerKpDelta':['sessionBehavior.firstGame.peerKpGames','sessionBehavior.game3Plus.peerKpGames'],
  'sessionBehavior.postLossPeerKpDelta':['sessionBehavior.quickAfterLoss.peerKpGames','sessionBehavior.quickAfterWin.peerKpGames'],
  'sessionBehavior.game3PlusPeerCsMinDelta':['sessionBehavior.firstGame.peerCsMinGames','sessionBehavior.game3Plus.peerCsMinGames'],
  'sessionBehavior.postLossPeerCsMinDelta':['sessionBehavior.quickAfterLoss.peerCsMinGames','sessionBehavior.quickAfterWin.peerCsMinGames']
};
function practiceTargetMetricPath(t){
  const p=String(t?.metricPath||'');
  if(p==='summary.csMin')return'coachingSummary.csMin';
  if(p==='summary.goldDiff15')return'coachingSummary.goldDiff15';
  return p;
}
function practiceTargetSamplePaths(t){
  const xs=Array.isArray(t?.samplePaths)?t.samplePaths.map(String).filter(Boolean):[];
  const metricPath=String(t?.metricPath||'');
  return xs.length?xs:(PRACTICE_TARGET_SAMPLE_PATHS[metricPath]||PRACTICE_TARGET_SAMPLE_PATHS[practiceTargetMetricPath(t)]||['coachingSummary.games']);
}
function practiceTargetSampleRequirements(t){
  const explicit=Array.isArray(t?.sampleRequirements)?t.sampleRequirements.filter(x=>x&&String(x.path||'').trim()).map(x=>({path:String(x.path),min:Math.max(1,Number(x.min||1)),value:hasNum(x.value)?Number(x.value):null})):[];
  if(explicit.length)return explicit;
  const metricPath=practiceTargetMetricPath(t),min=Math.max(1,Number(t?.minSample||1)),legacySafe={
    'behaviorSummary.roamSuccessRate':[
      {path:'behaviorSummary.roamAttempts',min:Math.max(4,min),value:null},
      {path:'behaviorSummary.roamAttemptGames',min:3,value:null}
    ],
    'behaviorSummary.avgRoamLaneCostCs':[
      {path:'behaviorSummary.roamLaneCostGames',min:Math.max(4,min),value:null},
      {path:'behaviorSummary.roamLaneCostMeasuredGames',min:3,value:null}
    ],
    'behaviorSummary.meanGameRoamLaneMovementCs':[
      {path:'behaviorSummary.roamLaneCostGames',min:Math.max(4,min),value:null},
      {path:'behaviorSummary.roamLaneCostMeasuredGames',min:3,value:null}
    ],
    'behaviorSummary.meanGameSupportRoamAdcLaneMovementCs':[
      {path:'behaviorSummary.supportRoamAdcLaneMovementWindows',min:Math.max(4,min),value:null},
      {path:'behaviorSummary.supportRoamAdcLaneMovementGames',min:3,value:null}
    ],
    'behaviorSummary.preObjectiveDeathPct':[
      {path:'behaviorSummary.classifiedTimelineDeaths',min:Math.max(5,min),value:null},
      {path:'behaviorSummary.timelineGames',min:3,value:null}
    ],
    'behaviorSummary.objectiveSetupWardRate':[
      {path:'behaviorSummary.visionWardTotal',min:Math.max(12,min),value:null},
      {path:'peerComparison.visionSetupGames',min:5,value:null}
    ],
    'behaviorSummary.visionActionDeathRate':[
      {path:'behaviorSummary.visionActions',min:Math.max(12,min),value:null},
      {path:'behaviorSummary.visionActionGames',min:4,value:null}
    ],
    'behaviorSummary.earlySetupObjectiveJoinRate':[
      {path:'behaviorSummary.neutralObjectiveJoins',min:Math.max(5,min),value:null},
      {path:'behaviorSummary.objectiveSetupGames',min:3,value:null}
    ],
    'behaviorSummary.objectiveSetupCoachingRate':[
      {path:'behaviorSummary.neutralObjectiveJoins',min:Math.max(5,min),value:null},
      {path:'behaviorSummary.objectiveSetupGames',min:3,value:null}
    ],
    'behaviorSummary.recentShopObjectiveAbsenceRate':[
      {path:'behaviorSummary.neutralObjectiveEvents',min:Math.max(5,min),value:null},
      {path:'behaviorSummary.objectiveContestGames',min:3,value:null}
    ],
    'behaviorSummary.objectiveJoinRate':[
      {path:'behaviorSummary.neutralObjectiveEvents',min:Math.max(5,min),value:null},
      {path:'behaviorSummary.objectiveContestGames',min:3,value:null}
    ],
    'behaviorSummary.objectiveCoachingPresenceRate':[
      {path:'behaviorSummary.neutralObjectiveEvents',min:Math.max(5,min),value:null},
      {path:'behaviorSummary.objectiveContestGames',min:3,value:null}
    ]
  };
  if(legacySafe[metricPath])return legacySafe[metricPath];
  return practiceTargetSamplePaths(t).map(path=>({path,min,value:null}));
}
function practiceRequirementLabel(path){
  const labels={
    'behaviorSummary.roamAttempts':'roam attempts',
    'behaviorSummary.roamAttemptGames':'roam games',
    'behaviorSummary.roamLaneCostGames':'measured roam windows',
    'behaviorSummary.roamLaneCostMeasuredGames':'measured roam games',
    'behaviorSummary.supportRoamAdcLaneMovementWindows':'ADC lane-movement windows',
    'behaviorSummary.supportRoamAdcLaneMovementGames':'ADC lane-movement games',
    'behaviorSummary.visionActions':'vision actions',
    'behaviorSummary.visionActionGames':'vision-action games',
    'behaviorSummary.neutralObjectiveJoins':'joined objective encounters',
    'behaviorSummary.objectiveSetupGames':'objective-setup games',
    'behaviorSummary.neutralObjectiveEvents':'contested objective encounters',
    'behaviorSummary.objectiveContestGames':'contested-objective games',
    'behaviorSummary.timelineGames':'timeline games',
    'behaviorSummary.directPeerTimelineGames':'trusted peer timeline games',
    'behaviorSummary.greedyStayGames':'games with high-gold stays',
    'peerComparison.impactGames':'first-impact peer games',
    'peerComparison.vpmGames':'direct-peer VPM games',
    'peerComparison.visionSetupGames':'comparable setup games',
    'peerComparison.higherRankMajorItemGames':'higher-rank item games',
    'peerComparison.rankBands.higher.laneGames':'higher-rank @15 games',
    'peerComparison.rankBands.lower.laneGames':'lower-rank @15 games',
    'behaviorSummary.classifiedTimelineDeaths':'classified deaths',
    'sessionBehavior.firstGame.lane15Games':'opener @15 games',
    'sessionBehavior.game3Plus.lane15Games':'game 3+ @15 games',
    'sessionBehavior.quickAfterLoss.lane15Games':'post-loss @15 games',
    'sessionBehavior.quickAfterWin.lane15Games':'post-win @15 games',
    'sessionBehavior.firstGame.vpmGames':'opener VPM games',
    'sessionBehavior.game3Plus.vpmGames':'game 3+ VPM games',
    'sessionBehavior.quickAfterLoss.vpmGames':'post-loss VPM games',
    'sessionBehavior.quickAfterWin.vpmGames':'post-win VPM games',
    'sessionBehavior.firstGame.kpGames':'opener KP games',
    'sessionBehavior.game3Plus.kpGames':'game 3+ KP games',
    'sessionBehavior.quickAfterLoss.kpGames':'post-loss KP games',
    'sessionBehavior.quickAfterWin.kpGames':'post-win KP games',
    'sessionBehavior.firstGame.csMinGames':'opener CS/min games',
    'sessionBehavior.game3Plus.csMinGames':'game 3+ CS/min games',
    'sessionBehavior.quickAfterLoss.csMinGames':'post-loss CS/min games',
    'sessionBehavior.quickAfterWin.csMinGames':'post-win CS/min games'
  };
  return labels[String(path||'')]||String(path||'sample').split('.').pop().replace(/([a-z])([A-Z])/g,'$1 $2').toLowerCase();
}
function practiceTargetEvidence(report,t){
  const rows=practiceTargetSampleRequirements(t).map(req=>{
    const raw=pathValue(report,req.path),value=hasNum(raw)?Number(raw):null;
    return{...req,value,ready:value!=null&&value>=Number(req.min||1)};
  });
  const ready=rows.length>0&&rows.every(x=>x.ready),finite=rows.filter(x=>x.value!=null).map(x=>Number(x.value)),currentSample=finite.length===rows.length&&finite.length?Math.min(...finite):0,minSample=rows.length?Math.min(...rows.map(x=>Number(x.min||1))):Math.max(1,Number(t?.minSample||1));
  const summary=rows.map(x=>practiceRequirementLabel(x.path)+' '+(x.value==null?'n/a':fmtInt(x.value))+'/'+fmtInt(x.min)).join(' · ');
  return{ready,rows,currentSample,minSample,summary};
}
function practiceTargetCurrentSample(report,t){
  return practiceTargetEvidence(report,t).currentSample;
}
function practiceTargetBaselineEvidenceText(t){
  const reqs=practiceTargetSampleRequirements(t),explicit=reqs.some(x=>x.value!=null);
  if(explicit)return reqs.map(x=>practiceRequirementLabel(x.path)+' '+(x.value==null?'n/a':fmtInt(x.value))+'/'+fmtInt(x.min)).join(' · ');
  return 'based on '+String(t?.sampleSize||0)+' relevant observation'+(Number(t?.sampleSize||0)===1?'':'s');
}
function coachingMatchIds(report){
  return [...new Set(reportCoachingGames(report).map(g=>String(g.matchId||'')).filter(Boolean))];
}
function reportNewMatchCount(current,previous){
  const prev=new Set(coachingMatchIds(previous));
  return coachingMatchIds(current).filter(id=>!prev.has(id)).length;
}
function practiceTargetOriginIds(target,previous){
  const xs=Array.isArray(target?.originMatchIds)?target.originMatchIds.map(String).filter(Boolean):[];
  return xs.length?new Set(xs):new Set(coachingMatchIds(previous));
}
function practiceTargetNewGames(current,previous,target){
  const origin=practiceTargetOriginIds(target,previous);
  return reportCoachingGames(current).filter(g=>{const id=String(g?.matchId||'');return id&&!origin.has(id);});
}
function practiceFreshSessionRequirement(rows,path){
  const m=String(path||'').match(/^sessionBehavior\.(firstGame|game3Plus|quickAfterLoss|quickAfterWin)\.(lane15Games|vpmGames|kpGames|csMinGames)$/);if(!m)return null;
  const cohort=m[1],metric=m[2],subset=rows.filter(g=>{
    const s=g?.sessionContext||{},n=Number(s.sessionGameNumber||0),gap=Number(s.gapAfterPreviousMin);
    if(cohort==='firstGame')return n===1;
    if(cohort==='game3Plus')return n>=3;
    if(cohort==='quickAfterLoss')return s.previousWin===false&&Number.isFinite(gap)&&gap<=45;
    return s.previousWin===true&&Number.isFinite(gap)&&gap<=45;
  });
  if(metric==='lane15Games')return subset.filter(g=>trustedDirectPeer(g)&&g?.phaseRules?.lane15Comparable!==false&&hasNum(g.goldDiff15)).length;
  if(metric==='vpmGames')return subset.filter(g=>hasNum(g.vpm)).length;
  if(metric==='kpGames')return subset.filter(g=>hasNum(g.kp)).length;
  if(metric==='csMinGames')return subset.filter(g=>hasNum(g.csMin)).length;
  return null;
}
function practiceFreshRequirementValue(rows,path){
  const timeline=rows.filter(g=>g?.timelineAvailable===true),directTimeline=timeline.filter(trustedDirectPeer),p=String(path||'');
  const session=practiceFreshSessionRequirement(rows,p);if(session!=null)return session;
  const count=(xs,fn)=>xs.filter(fn).length,sum=(xs,fn)=>xs.reduce((n,g)=>n+Number(fn(g)||0),0);
  const closingLead=(g)=>trustedDirectPeer(g)&&g?.phaseRules?.closing25Comparable!==false&&g?.outcomeCompromised!==true&&hasNum(g.goldDiff25)&&Number(g.goldDiff25)>=500;
  switch(p){
    case'coachingSummary.games':return rows.length;
    case'behaviorSummary.timelineGames':return timeline.length;
    case'behaviorSummary.directPeerTimelineGames':return directTimeline.length;
    case'peerComparison.laneGames15':return count(rows,g=>trustedDirectPeer(g)&&g?.phaseRules?.lane15Comparable!==false&&hasNum(g.goldDiff15));
    case'peerComparison.impactGames':return count(directTimeline,g=>hasNum(g.impactDeltaVsOpponent));
    case'peerComparison.vpmGames':return count(rows,g=>trustedDirectPeer(g)&&hasNum(g?.peer?.vpmDelta));
    case'peerComparison.visionSetupGames':return count(directTimeline,g=>hasNum(g?.vision?.objectiveSetupDeltaVsOpponent));
    case'behaviorSummary.earlyLeadGames':return count(directTimeline,g=>g?.phaseRules?.lane15Comparable!==false&&g?.earlyLeadWindow?.eligible===true);
    case'behaviorSummary.repeatDeathOpportunities':return sum(timeline,g=>g?.deathRecovery?.opportunities);
    case'behaviorSummary.firstResetCleanGames':return count(directTimeline,g=>g?.firstResetSequence?.measured===true&&!g?.firstResetSequence?.deathInWindow);
    case'behaviorSummary.soloKillResetEvents':return sum(directTimeline,g=>(g?.laneDuel?.events||[]).filter(x=>x?.result==='solo_kill'&&x?.early&&hasNum(x?.nextShopDelaySec)).length);
    case'behaviorSummary.itemSpikeEligibleWindows':return count(directTimeline,g=>g?.itemSpikeWindow?.eligible===true);
    case'behaviorSummary.highUnspentFightSamples':return sum(timeline,g=>g?.fightProfile?.highUnspentFightSamples);
    case'behaviorSummary.fightSamples':return sum(timeline,g=>g?.fightProfile?.active??g?.fightProfile?.attended);
    case'behaviorSummary.classifiedTimelineDeaths':return sum(timeline,g=>g?.deathRecovery?.deaths??g?.deathPositions?.length);
    case'behaviorSummary.behindStateDeaths':return sum(directTimeline,g=>g?.riskStateDeaths?.behind);
    case'behaviorSummary.visionActions':return sum(timeline,g=>g?.visionMission?.actions);
    case'behaviorSummary.visionActionGames':return count(timeline,g=>Number(g?.visionMission?.actions||0)>0);
    case'behaviorSummary.visionWardTotal':return sum(timeline,g=>g?.vision?.wardCount);
    case'behaviorSummary.neutralObjectiveJoins':return sum(timeline,g=>g?.objectiveReadiness?.contestedJoined);
    case'behaviorSummary.objectiveSetupGames':return count(timeline,g=>Number(g?.objectiveReadiness?.contestedJoined||0)>0);
    case'behaviorSummary.neutralObjectiveEvents':return sum(timeline,g=>g?.objectiveReadiness?.contestedObjectives);
    case'behaviorSummary.objectiveContestGames':return count(timeline,g=>Number(g?.objectiveReadiness?.contestedObjectives||0)>0);
    case'behaviorSummary.killConversionWindows':return sum(timeline,g=>g?.killConversion?.windows);
    case'behaviorSummary.closing25.leadGames':return count(rows,closingLead);
    case'behaviorSummary.closing25.leadLosses':return count(rows,g=>closingLead(g)&&g?.win===false);
    case'behaviorSummary.roamAttempts':return sum(timeline,g=>g?.roams?.attempts);
    case'behaviorSummary.roamAttemptGames':return count(timeline,g=>Number(g?.roams?.attempts||0)>0);
    case'behaviorSummary.roamLaneCostGames':return sum(timeline,g=>(g?.roams?.events||[]).filter(x=>hasNum(x?.coachingLaneCostCs??x?.laneCostCs)).length);
    case'behaviorSummary.roamLaneCostMeasuredGames':return count(timeline,g=>(g?.roams?.events||[]).some(x=>hasNum(x?.coachingLaneCostCs??x?.laneCostCs)));
    case'behaviorSummary.supportRoamAdcLaneMovementWindows':return sum(timeline,g=>(g?.roams?.events||[]).filter(x=>hasNum(x?.adcLaneCostCs)).length);
    case'behaviorSummary.supportRoamAdcLaneMovementGames':return count(timeline,g=>(g?.roams?.events||[]).some(x=>hasNum(x?.adcLaneCostCs)));
    case'behaviorSummary.midRouting.games':return count(rows,g=>['ADC','MID','TOP'].includes(explicitGameRole(g?.role)||'')&&trustedDirectPeer(g)&&g?.timelineAvailable===true&&g?.phaseRules?.fixed15to25Comparable!==false&&g?.phaseRules?.midRoutingComparable!==false&&hasNum(g.csDiff15)&&hasNum(g.csDiff25)&&Number(g?.midRouting?.contestedObjectives||0)>=1);
    default:return null;
  }
}
function practiceTargetFreshEvidence(current,previous,target){
  const rows=practiceTargetNewGames(current,previous,target),requirements=practiceTargetSampleRequirements(target).map(req=>{
    const value=practiceFreshRequirementValue(rows,req.path),supported=value!=null,min=Math.max(1,Number(req.min||1));
    return{...req,value,supported,ready:supported&&Number(value)>=min};
  }),supported=requirements.length>0&&requirements.every(x=>x.supported),ready=supported&&requirements.every(x=>x.ready);
  const summary=supported?requirements.map(x=>practiceRequirementLabel(x.path)+' '+fmtInt(x.value)+'/'+fmtInt(x.min)).join(' · '):'fresh-game evidence gate unavailable for '+requirements.filter(x=>!x.supported).map(x=>practiceRequirementLabel(x.path)).join(', ');
  return{rows,newGames:rows.length,requirements,supported,ready,summary,currentSample:supported&&requirements.length?Math.min(...requirements.map(x=>Number(x.value||0))):0,minSample:requirements.length?Math.min(...requirements.map(x=>Number(x.min||1))):0};
}

function previousPracticeTargetOutcomes(current,previous){
  const targets=Array.isArray(previous?.practiceTargets)?previous.practiceTargets:[];
  if(!targets.length)return{rows:[],reason:''};
  const curRole=canonicalRole(current?.dataQuality?.selectedRole||current?.coachingSummary?.primaryRole||current?.summary?.primaryRole),prevRole=canonicalRole(previous?.dataQuality?.selectedRole||previous?.coachingSummary?.primaryRole||previous?.summary?.primaryRole);
  const curQueue=current?.dataQuality?.dominantQueueId,prevQueue=previous?.dataQuality?.dominantQueueId;
  const curPatch=String(current?.dataQuality?.currentPatchKey||''),prevPatch=String(previous?.dataQuality?.currentPatchKey||''),curMechanics=String(current?.dataQuality?.currentMechanicsKey||''),prevMechanics=String(previous?.dataQuality?.currentMechanicsKey||'');
  if(curRole!==prevRole)return{rows:[],reason:'Previous practice targets are not scored because the primary role changed.'};
  if(hasNum(curQueue)&&hasNum(prevQueue)&&Number(curQueue)!==Number(prevQueue))return{rows:[],reason:'Previous practice targets are not scored because the comparable queue context changed.'};
  if(curMechanics&&prevMechanics&&curMechanics!==prevMechanics)return{rows:[],reason:'Previous practice targets are not scored because the verified mechanics cohort changed.'};
  if(curPatch&&prevPatch&&curPatch!==prevPatch)return{rows:[],reason:'Previous practice targets are not scored because the patch cohort changed.'};
  const rows=targets.map(t=>{
    const fresh=practiceTargetFreshEvidence(current,previous,t),newGames=fresh.newGames,savedMetricPath=String(t?.metricPath||'');
    if(savedMetricPath==='summary.goldDiff15'||savedMetricPath==='coachingSummary.goldDiff15'){
      const windowGames=Math.max(1,Number(t.windowGames||5));
      return{label:t.label||'Gold differential @15',current:'n/a',baseline:hasNum(t.baseline)?practiceTargetValue(t.baseline,t.unit):'n/a',goal:hasNum(t.goal)?practiceTargetValue(t.goal,t.unit):'n/a',sampleSize:Number(t.sampleSize||0),currentSample:0,minSample:0,sampleSummary:'re-baseline required · saved target predates trusted direct-peer @15 normalization',newGames,windowGames,status:'re-baseline required',cls:'stable',pending:true};
    }
    const currentValue=pathValue(current,practiceTargetMetricPath(t));
    if(!hasNum(currentValue)||!hasNum(t.baseline)||!hasNum(t.goal))return null;
    const cur=Number(currentValue),base=Number(t.baseline),goal=Number(t.goal),higher=t.direction!=='lower',baseWindowGames=Math.max(1,Number(t.baseWindowGames||t.windowGames||5)),maxWindowGames=Math.max(baseWindowGames,Number(t.maxWindowGames||20)),rollingEvidence=practiceTargetEvidence(current,t),adaptive=t?.evidenceWindowBasis==='new_games_only'&&fresh.supported;
    const evidence=adaptive?fresh:rollingEvidence,evidenceBasis=adaptive?'new-games only':'rolling fallback';
    const common={label:t.label||t.metricPath,current:practiceTargetValue(cur,t.unit),baseline:practiceTargetValue(base,t.unit),goal:practiceTargetValue(goal,t.unit),sampleSize:Number(t.sampleSize||0),currentSample:evidence.currentSample,minSample:evidence.minSample,sampleSummary:evidence.summary,newGames,baseWindowGames,maxWindowGames,windowGames:baseWindowGames,evidenceBasis,originGeneratedAt:t?.originGeneratedAt||null,lineageRuns:Number(t?.lineageRuns||1)};
    if(newGames<baseWindowGames){
      const left=baseWindowGames-newGames;
      return{...common,status:'awaiting '+left+' more new game'+(left===1?'':'s'),cls:'stable',pending:true,extended:false};
    }
    if(adaptive&&!fresh.ready){
      if(newGames<maxWindowGames)return{...common,status:'extended for fresh evidence',cls:'stable',pending:true,extended:true,windowGames:maxWindowGames};
      return{...common,status:'inconclusive — fresh evidence floor not reached',cls:'stable',pending:false,extended:true,inconclusive:true,windowGames:maxWindowGames};
    }
    if(!adaptive&&!rollingEvidence.ready)return{...common,status:'inconclusive — rolling evidence unavailable',cls:'stable',pending:false,extended:false,inconclusive:true};
    const met=higher?cur>=goal:cur<=goal,needed=Math.abs(goal-base),toward=(higher?cur-base:base-cur);
    const material=Math.max(needed*.2,1e-9);
    const status=met?'met':toward>=material?'moving closer':toward<=-material?'moved away':'unchanged';
    const cls=met||status==='moving closer'?'improved':status==='moved away'?'worsened':'stable';
    return{...common,status,cls,pending:false,extended:adaptive&&newGames>baseWindowGames};
  }).filter(Boolean);
  return{rows,reason:'',newGames:rows.length?Math.max(...rows.map(x=>Number(x.newGames||0))):0};
}
function progressComparisonContext(current,previous){
  const curRole=canonicalRole(current?.dataQuality?.selectedRole||current?.coachingSummary?.primaryRole||current?.summary?.primaryRole),prevRole=canonicalRole(previous?.dataQuality?.selectedRole||previous?.coachingSummary?.primaryRole||previous?.summary?.primaryRole);
  const curQueue=current?.dataQuality?.dominantQueueId,prevQueue=previous?.dataQuality?.dominantQueueId;
  const curMechanics=String(current?.dataQuality?.currentMechanicsKey||''),prevMechanics=String(previous?.dataQuality?.currentMechanicsKey||'');
  const curPatch=String(current?.dataQuality?.currentPatchKey||''),prevPatch=String(previous?.dataQuality?.currentPatchKey||'');
  const curIds=coachingMatchIds(current),prevIds=coachingMatchIds(previous),prevSet=new Set(prevIds),curSet=new Set(curIds);
  const overlap=curIds.filter(id=>prevSet.has(id)).length,newGames=curIds.filter(id=>!prevSet.has(id)).length,dropped=prevIds.filter(id=>!curSet.has(id)).length,base=Math.max(1,Math.min(curIds.length||1,prevIds.length||1));
  let reason='';
  if(curRole!==prevRole)reason='Primary role changed from '+roleLabel(prevRole)+' to '+roleLabel(curRole)+'.';
  else if(hasNum(curQueue)&&hasNum(prevQueue)&&Number(curQueue)!==Number(prevQueue))reason='Comparable queue context changed.';
  else if(curMechanics&&prevMechanics&&curMechanics!==prevMechanics)reason='Verified mechanics cohort changed.';
  return{comparable:!reason,reason,curRole,prevRole,curQueue,prevQueue,curMechanics,prevMechanics,curPatch,prevPatch,patchChanged:!!curPatch&&!!prevPatch&&curPatch!==prevPatch,analyzerChanged:String(current?.analyzerVersion||'')!==String(previous?.analyzerVersion||''),overlap,newGames,dropped,overlapPct:100*overlap/base,currentGames:curIds.length,previousGames:prevIds.length};
}
function progressSampleCount(report,spec){
  const v=pathValue(report,spec.samplePath||'summary.games');return hasNum(v)?Number(v):0;
}
function progressEvidence(report,spec){
  const reqs=Array.isArray(spec?.sampleRequirements)&&spec.sampleRequirements.length?spec.sampleRequirements:[{path:spec.samplePath||'summary.games',min:Number(spec.min||1)}];
  const rows=reqs.map(req=>{
    const raw=pathValue(report,req.path),value=hasNum(raw)?Number(raw):null,min=Math.max(1,Number(req.min||spec.min||1));
    return{path:req.path,value,min,ready:value!=null&&value>=min};
  });
  const ready=rows.every(x=>x.ready),summary=rows.map(x=>practiceRequirementLabel(x.path)+' '+(x.value==null?'n/a':fmtInt(x.value))+'/'+fmtInt(x.min)).join(' · ');
  return{ready,rows,summary,primary:rows.length===1&&rows[0].value!=null?Number(rows[0].value):null};
}

function practiceThemeKey(x){
  return String(x?.themeKey||x?.key||x?.category||x?.title||'').trim().toLowerCase().replace(/[^a-z0-9]+/g,'_').replace(/^_+|_+$/g,'');
}
function practiceThemeLabel(x){
  return String(x?.title||x?.label||x?.category||x?.themeKey||x?.key||'Practice focus').trim();
}
function orderedPriorityThemes(report){
  const grouped=Array.isArray(report?.priorityThemes)&&report.priorityThemes.length?report.priorityThemes:null;
  if(grouped)return grouped.filter(x=>x&&typeof x==='object'&&x.action);
  return (Array.isArray(report?.recentFocus)?report.recentFocus:[]).filter(x=>x&&typeof x==='object'&&x.action).sort((a,b)=>Number(a.priority||9)-Number(b.priority||9)||Number(b.score||0)-Number(a.score||0));
}
function topPracticeThemes(report){
  return orderedPriorityThemes(report).slice(0,3);
}
function practiceContinuityHtml(current,previous,context,targetOutcome){
  if(!previous)return '';
  if(!context?.comparable)return '<article class="practice-continuity-summary withheld"><span>Practice-plan continuity</span><strong>Comparison withheld</strong><p>'+esc(context?.reason||'The saved reports are not in a comparable coaching context.')+'</p></article>';
  const cur=topPracticeThemes(current),prev=topPracticeThemes(previous),curMap=new Map(cur.map(x=>[practiceThemeKey(x),x])),prevMap=new Map(prev.map(x=>[practiceThemeKey(x),x]));
  const retained=[...curMap.keys()].filter(k=>k&&prevMap.has(k)),added=[...curMap.keys()].filter(k=>k&&!prevMap.has(k)),dropped=[...prevMap.keys()].filter(k=>k&&!curMap.has(k));
  const newGames=reportNewMatchCount(current,previous),window=5,early=newGames<window;
  const rows=Array.isArray(targetOutcome?.rows)?targetOutcome.rows:[],met=rows.filter(x=>x.status==='met').length,closer=rows.filter(x=>x.status==='moving closer').length,away=rows.filter(x=>x.status==='moved away').length,pending=rows.filter(x=>x.pending).length;
  const state=retained.length>=2?'Focus mostly retained':retained.length===1?'Focus partly shifted':'Focus set changed';
  const labels=(keys,map)=>keys.map(k=>practiceThemeLabel(map.get(k))).join(' · ');
  return '<div class="practice-continuity-grid">'+
    '<article class="practice-continuity-summary '+(early?'early':'')+'"><span>Practice-plan continuity</span><strong>'+esc(state)+'</strong><p>'+retained.length+' of '+Math.max(1,Math.min(3,prev.length))+' previous top priorities remain in the current top three.'+(early?' Only '+newGames+' / '+window+' new games have entered, so treat this as an early read.':' The minimum five-game review window has enough new games for a fuller continuity read; rare-opportunity targets can continue collecting evidence.')+'</p></article>'+
    '<article class="practice-continuity-summary"><span>Retained focus</span><strong>'+esc(String(retained.length))+' theme'+(retained.length===1?'':'s')+'</strong><p>'+esc(retained.length?labels(retained,curMap):'No previous top-three priority remains in the current top three.')+'</p></article>'+
    '<article class="practice-continuity-summary"><span>New / dropped focus</span><strong>'+added.length+' new · '+dropped.length+' dropped</strong><p>'+(added.length?'<b>New:</b> '+esc(labels(added,curMap))+'. ':'')+(dropped.length?'<b>Dropped:</b> '+esc(labels(dropped,prevMap))+'.':'No prior top-three focus dropped out.')+'</p></article>'+
    '<article class="practice-continuity-summary"><span>Previous target check</span><strong>'+met+' met · '+closer+' closer</strong><p>'+away+' moved away · '+pending+' pending. Dropping from the top-three plan is not treated as proof that a problem was solved.</p></article>'+
  '</div>';
}

function renderProgressComparison(current,previous,previousAt){
  const note=$('progressComparisonNote');
  if(!previous){
    $('progressComparisonPanel').hidden=true;
    if($('practiceOutcome'))$('practiceOutcome').innerHTML='';
    if($('practiceContinuity'))$('practiceContinuity').innerHTML='';
    if(note)note.textContent='';
    return;
  }
  const role=canonicalRole(current?.dataQuality?.selectedRole||current?.coachingSummary?.primaryRole||current?.summary?.primaryRole),previousScope=reportRoleScopeViolations(previous,role);
  if(previousScope.total){
    $('progressComparison').innerHTML='<div class="target-outcome-note"><strong>Previous report withheld.</strong> It contains '+previousScope.total+' game(s) outside the current '+esc(roleLabel(role))+' role scope, so it is not used for progress comparisons.</div>';
    if($('practiceOutcome'))$('practiceOutcome').innerHTML='';
    if($('practiceContinuity'))$('practiceContinuity').innerHTML='';
    if(note)note.textContent='Cross-role historical comparison is disabled. Rebuild the older report from its role-filtered cache to compare it safely.';
    $('previousAnalysisDate').textContent='Previous report role scope mismatch';
    $('progressComparisonPanel').hidden=false;
    return;
  }
  const context=progressComparisonContext(current,previous);
  const commonRisk=[
    {label:'High-risk deaths / game',path:'behaviorSummary.badDeathsPerTimelineGame',samplePath:'behaviorSummary.timelineGames',min:5,threshold:.3,direction:-1,format:v=>fmt(v,1)},
    {label:'Died before contribution',path:'behaviorSummary.preContributionFightDeathRate',samplePath:'behaviorSummary.fightSamples',min:8,threshold:10,direction:-1,format:v=>fmtPct(v)},
    {label:'Rapid repeat-death rate',path:'behaviorSummary.repeatDeathRate',samplePath:'behaviorSummary.repeatDeathOpportunities',min:8,threshold:10,direction:-1,format:v=>fmtPct(v)}
  ];
  const commonTempo=[
    {label:'First major item vs role peer',path:'peerComparison.avgMajorItemDeltaMin',samplePath:'peerComparison.majorItemGames',min:4,threshold:.4,direction:-1,format:v=>signed(v,1)+' min'},
    {label:'Major-item spike utilization',path:'behaviorSummary.itemSpikeUtilizationRate',samplePath:'behaviorSummary.itemSpikeEligibleWindows',min:4,threshold:15,direction:1,format:v=>fmtPct(v)}
  ];
  let specs;
  if(role==='SUPPORT'){
    specs=[
      {label:'Vision/min vs Support peer',path:'peerComparison.avgVpmDelta',samplePath:'peerComparison.vpmGames',min:5,threshold:.15,direction:1,format:v=>signed(v,2)},
      {label:'Objective setup wards vs Support',path:'peerComparison.avgObjectiveSetupDelta',samplePath:'peerComparison.visionSetupGames',min:5,threshold:.5,direction:1,format:v=>signed(v,1)},
      {label:'Roam conversion',path:'behaviorSummary.roamSuccessRate',sampleRequirements:[{path:'behaviorSummary.roamAttempts',min:4},{path:'behaviorSummary.roamAttemptGames',min:3}],threshold:15,direction:1,format:v=>fmtPct(v)},
      {label:'ADC lane movement during roams',path:'behaviorSummary.meanGameSupportRoamAdcLaneMovementCs',sampleRequirements:[{path:'behaviorSummary.supportRoamAdcLaneMovementWindows',min:4},{path:'behaviorSummary.supportRoamAdcLaneMovementGames',min:3}],threshold:2,direction:1,format:v=>signed(v,1)+' CS'},
      {label:'Vision-action death rate',path:'behaviorSummary.visionActionDeathRate',sampleRequirements:[{path:'behaviorSummary.visionActions',min:12},{path:'behaviorSummary.visionActionGames',min:4}],threshold:5,direction:-1,format:v=>fmtPct(v)},
      {label:'Team-contested objective presence',path:'advanced.objectivePresence',sampleRequirements:[{path:'behaviorSummary.objectiveContestEncounters',min:5},{path:'behaviorSummary.objectiveContestGames',min:3}],threshold:10,direction:1,format:v=>fmtPct(v)},
      ...commonTempo,...commonRisk
    ];
  }else if(role==='JUNGLE'){
    specs=[
      {label:'CS/min vs Jungle peer',path:'peerComparison.avgCsMinDelta',samplePath:'peerComparison.csMinGames',min:5,threshold:.15,direction:1,format:v=>signed(v,2)},
      {label:'First tracked impact vs Jungle',path:'peerComparison.avgImpactDeltaMin',samplePath:'peerComparison.impactGames',min:5,threshold:1,direction:-1,format:v=>signed(v,1)+' min'},
      {label:'Objective setup wards vs Jungle',path:'peerComparison.avgObjectiveSetupDelta',samplePath:'peerComparison.visionSetupGames',min:5,threshold:.5,direction:1,format:v=>signed(v,1)},
      {label:'Team-contested objective presence',path:'advanced.objectivePresence',sampleRequirements:[{path:'behaviorSummary.objectiveContestEncounters',min:5},{path:'behaviorSummary.objectiveContestGames',min:3}],threshold:10,direction:1,format:v=>fmtPct(v)},
      {label:'Recent-shop objective absence rate',path:'behaviorSummary.recentShopObjectiveAbsenceRate',sampleRequirements:[{path:'behaviorSummary.neutralObjectiveEvents',min:5},{path:'behaviorSummary.objectiveContestGames',min:3}],threshold:10,direction:-1,format:v=>fmtPct(v)},
      ...commonTempo,...commonRisk
    ];
  }else if(role==='TOP'){
    specs=[
      {label:'Gold @15 vs role opponent',path:'peerComparison.avgGoldDiff15',samplePath:'peerComparison.laneGames15',min:5,threshold:150,direction:1,format:v=>signed(v,0)+'g'},
      {label:'CS / min',path:'coachingSummary.csMin',samplePath:'coachingSummary.games',min:5,threshold:.3,direction:1,format:v=>fmt(v,2)},
      {label:'Early-lead give-back rate',path:'behaviorSummary.earlyLeadGivebackRate',samplePath:'behaviorSummary.earlyLeadGames',min:4,threshold:15,direction:-1,format:v=>fmtPct(v)},
      {label:'Pre-objective side-lane deaths / game',path:'behaviorSummary.preNeutralObjectiveSideLaneDeathsPerGame',samplePath:'behaviorSummary.timelineGames',min:5,threshold:.2,direction:-1,format:v=>fmt(v,2)},
      {label:'Mid routing objective presence',path:'behaviorSummary.midRouting.coachingObjectivePresenceRate',samplePath:'behaviorSummary.midRouting.games',min:4,threshold:10,direction:1,format:v=>fmtPct(v)},
      {label:'Win rate from role lead @25',path:'behaviorSummary.closing25.leadWinRate',samplePath:'behaviorSummary.closing25.leadGames',min:4,threshold:10,direction:1,format:v=>fmtPct(v)},
      ...commonTempo,...commonRisk
    ];
  }else if(role==='MID'){
    specs=[
      {label:'Gold @15 vs role opponent',path:'peerComparison.avgGoldDiff15',samplePath:'peerComparison.laneGames15',min:5,threshold:150,direction:1,format:v=>signed(v,0)+'g'},
      {label:'CS / min',path:'coachingSummary.csMin',samplePath:'coachingSummary.games',min:5,threshold:.3,direction:1,format:v=>fmt(v,2)},
      {label:'First tracked impact vs Mid',path:'peerComparison.avgImpactDeltaMin',samplePath:'peerComparison.impactGames',min:5,threshold:1,direction:-1,format:v=>signed(v,1)+' min'},
      {label:'Mid routing CS swing 15→25',path:'behaviorSummary.midRouting.avgCsSwing15to25',samplePath:'behaviorSummary.midRouting.games',min:4,threshold:4,direction:1,format:v=>signed(v,1)+' CS'},
      {label:'Mid routing objective presence',path:'behaviorSummary.midRouting.coachingObjectivePresenceRate',samplePath:'behaviorSummary.midRouting.games',min:4,threshold:10,direction:1,format:v=>fmtPct(v)},
      {label:'Recent-shop objective absence rate',path:'behaviorSummary.recentShopObjectiveAbsenceRate',sampleRequirements:[{path:'behaviorSummary.neutralObjectiveEvents',min:5},{path:'behaviorSummary.objectiveContestGames',min:3}],threshold:10,direction:-1,format:v=>fmtPct(v)},
      ...commonTempo,...commonRisk
    ];
  }else{
    specs=[
      {label:'Gold @15 vs role opponent',path:'peerComparison.avgGoldDiff15',samplePath:'peerComparison.laneGames15',min:5,threshold:150,direction:1,format:v=>signed(v,0)+'g'},
      {label:'CS / min',path:'coachingSummary.csMin',samplePath:'coachingSummary.games',min:5,threshold:.3,direction:1,format:v=>fmt(v,2)},
      {label:'Early-lead give-back rate',path:'behaviorSummary.earlyLeadGivebackRate',samplePath:'behaviorSummary.earlyLeadGames',min:4,threshold:15,direction:-1,format:v=>fmtPct(v)},
      {label:'Damage share − gold share',path:'behaviorSummary.damageGoldEfficiency',samplePath:'coachingSummary.games',min:5,threshold:2,direction:1,format:v=>signed(v,1)+' points'},
      {label:'Mid routing CS swing 15→25',path:'behaviorSummary.midRouting.avgCsSwing15to25',samplePath:'behaviorSummary.midRouting.games',min:4,threshold:4,direction:1,format:v=>signed(v,1)+' CS'},
      {label:'Win rate from role lead @25',path:'behaviorSummary.closing25.leadWinRate',samplePath:'behaviorSummary.closing25.leadGames',min:4,threshold:10,direction:1,format:v=>fmtPct(v)},
      ...commonTempo,...commonRisk
    ];
  }
  const allRows=specs.map(spec=>{
    const cur=pathValue(current,spec.path),prev=pathValue(previous,spec.path),curEvidence=progressEvidence(current,spec),prevEvidence=progressEvidence(previous,spec);
    if(!hasNum(cur)||!hasNum(prev)||!curEvidence.ready||!prevEvidence.ready)return null;
    const raw=Number(cur)-Number(prev),effect=raw*spec.direction,score=Math.abs(effect)/spec.threshold,status=effect>=spec.threshold?'improved':effect<=-spec.threshold?'worsened':'stable';
    return{label:spec.label,current:spec.format(cur),previous:spec.format(prev),delta:raw,effect,status,score,curEvidence,prevEvidence};
  }).filter(Boolean);
  const withheld=specs.length-allRows.length,material=allRows.filter(x=>x.status!=='stable').sort((a,b)=>b.score-a.score),stable=allRows.filter(x=>x.status==='stable').sort((a,b)=>b.score-a.score);
  const visible=material.slice(0,8),statusText=x=>x.status==='improved'?'favorable shift':x.status==='worsened'?'unfavorable shift':'within change band';
  const card=x=>'<article class="progress-comparison-card '+x.status+'"><span>'+esc(x.label)+'</span><strong>'+esc(statusText(x))+'</strong><p>Now '+esc(x.current)+' · previous '+esc(x.previous)+'</p><small>now: '+esc(x.curEvidence.summary)+' · previous: '+esc(x.prevEvidence.summary)+' · materiality '+esc(fmt(x.score,1))+'× change band</small></article>';
  if(!context.comparable){
    $('progressComparison').innerHTML='<div class="target-outcome-note"><strong>General progress comparison withheld.</strong> '+esc(context.reason)+' Cross-context metric deltas are not treated as development evidence.</div>';
  }else{
    $('progressComparison').innerHTML=visible.length?visible.map(card).join(''):'<div class="target-outcome-note">No denominator-safe metric moved outside its practical change band.</div>';
    if(stable.length)$('progressComparison').insertAdjacentHTML('beforeend','<details class="progress-stable-details"><summary>Stable / smaller shifts · '+stable.length+' metrics</summary><div class="progress-comparison-grid">'+stable.map(card).join('')+'</div></details>');
  }
  if(note){
    const parts=['Rolling Last-20 comparison: '+context.overlap+' overlapping game'+(context.overlap===1?'':'s')+' ('+fmtPct(context.overlapPct)+') · '+context.newGames+' new · '+context.dropped+' dropped'];
    if(withheld)parts.push(withheld+' headline metric'+(withheld===1?'':'s')+' withheld for missing/thin evidence');
    if(context.patchChanged)parts.push('patch cohort changed '+context.prevPatch+' → '+context.curPatch+'; treat surviving comparisons as context');
    if(context.analyzerChanged)parts.push('analyzer '+String(previous?.analyzerVersion||'unknown')+' → '+String(current?.analyzerVersion||'unknown'));
    parts.push('Favorable/unfavorable means the rolling sample moved beyond a predefined practical change band; it is not an independent before/after experiment.');
    note.textContent=parts.join(' · ')+'.';
  }
  const targetOutcome=context.comparable?previousPracticeTargetOutcomes(current,previous):{rows:[],reason:'Previous Next-5 targets are not scored because '+context.reason.toLowerCase()};
  const targetRows=targetOutcome.rows||[];
  if($('practiceContinuity'))$('practiceContinuity').innerHTML=practiceContinuityHtml(current,previous,context,targetOutcome);
  if($('practiceOutcome')){
    $('practiceOutcome').innerHTML=targetRows.length?'<div class="target-outcome-head"><strong>Previous practice targets</strong><small>Targets keep their original baseline while the same metric remains a priority. The review waits for at least five games since that target origin; supported rare-event denominators use only those new games and may extend to 20. The displayed performance value remains the current rolling selected-role metric.</small></div><div class="progress-comparison-grid">'+
      targetRows.map(x=>'<article class="progress-comparison-card '+x.cls+(x.pending?' pending-target':'')+(x.inconclusive?' inconclusive-target':'')+'"><span>'+esc(x.label)+'</span><strong>'+esc(x.status)+'</strong><p>Now '+esc(x.current)+' · baseline '+esc(x.baseline)+' · target '+esc(x.goal)+'</p><small>'+(x.extended?esc(String(x.newGames))+' new games since target origin · minimum '+esc(String(x.baseWindowGames||5))+' reached · fresh-evidence cap '+esc(String(x.maxWindowGames||20)):esc(String(x.newGames))+' / '+esc(String(x.baseWindowGames||x.windowGames||5))+' new games since target origin')+' · '+esc(x.sampleSummary||('valid n '+String(x.currentSample)+' / '+String(x.minSample)+' required'))+' · '+esc(x.evidenceBasis||'evidence')+(x.lineageRuns>1?' · target held fixed across '+esc(String(x.lineageRuns))+' analyses':'')+'</small></article>').join('')+'</div>':
      (targetOutcome.reason?'<div class="target-outcome-note">'+esc(targetOutcome.reason)+'</div>':'');
  }
  if(!allRows.length&&!targetRows.length&&!targetOutcome.reason&&!context.reason){$('progressComparisonPanel').hidden=true;return;}
  $('previousAnalysisDate').textContent='Rolling comparison with '+fmtDate(previousAt);
  $('progressComparisonPanel').hidden=false;
}
function sessionCard(title,sample,role){
  if(!sample||!Number(sample.games))return '';
  const games=Number(sample.games||0),laneN=Number(sample.lane15Games||0),timelineN=Number(sample.timelineGames||0),dpmN=Number(sample.peerDpmGames||0),csN=Number(sample.peerCsMinGames||0),vpmN=Number(sample.peerVpmGames||0),kpN=Number(sample.peerKpGames||0),thin=games<3,r=canonicalRole(role);
  const risk=timelineN>0&&hasNum(sample.badDeaths)?'Risky deaths '+fmt(sample.badDeaths,1)+'/game · '+timelineN+' timeline games':'Risky deaths n/a';
  let lines=[];
  if(r==='SUPPORT'){
    lines=[
      hasNum(sample.peerVpmDelta)?'Vision/min vs Support opponent '+signed(sample.peerVpmDelta,2)+' · n='+vpmN:'Vision/min vs Support opponent n/a',
      hasNum(sample.peerKpDelta)?'KP vs Support opponent '+signed(sample.peerKpDelta,1)+' points · n='+kpN:'',
      risk
    ];
  }else{
    if(laneN>0&&hasNum(sample.goldDiff15))lines.push('Gold @15 vs '+roleLabel(r)+' opponent '+signed(sample.goldDiff15,0)+'g · n='+laneN);
    lines.push(hasNum(sample.peerDpmDelta)?'DPM vs '+roleLabel(r)+' opponent '+signed(sample.peerDpmDelta,0)+' · n='+dpmN:'DPM vs opponent n/a');
    lines.push(hasNum(sample.peerCsMinDelta)?'CS/min vs '+roleLabel(r)+' opponent '+signed(sample.peerCsMinDelta,2)+' · n='+csN:'CS/min vs opponent n/a');
    if(r==='JUNGLE'&&hasNum(sample.impactDeltaVsOpponent))lines.push('First impact vs Jungle opponent '+signed(sample.impactDeltaVsOpponent,1)+'m · n='+Number(sample.impactGames||0));
    lines.push(risk);
  }
  return '<div class="quality-card session-sample-card '+(thin?'thin-sample':'')+'"><span>'+esc(title)+(thin?' <em>thin sample</em>':'')+'</span><strong>'+esc(String(games))+' games</strong><small>'+lines.filter(Boolean).map(esc).join('<br>')+'</small></div>';
}
function sessionPairReady(a,b,countField='games',min=2){
  return Number(a?.games||0)>=2&&Number(b?.games||0)>=2&&Number(a?.[countField]??a?.games??0)>=min&&Number(b?.[countField]??b?.games??0)>=min;
}
function renderSessionHabits(r){
  const s=r.sessionBehavior||r.sessionModel||{},first=s.firstGame||{},second=s.secondGame||{},late=s.game3Plus||{},afterLoss=s.quickAfterLoss||{},afterWin=s.quickAfterWin||{},role=canonicalRole(r?.dataQuality?.selectedRole||r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||state.selectedRole),answer=s.answer||{};
  const cards=[
    sessionCard('Session-opening game',first,role),
    sessionCard('Game 2 in session',second,role),
    sessionCard('Game 3+ in session',late,role),
    sessionCard('Quick requeue after loss',afterLoss,role),
    sessionCard('Quick requeue after win',afterWin,role)
  ].filter(Boolean);
  if(!cards.length){$('sessionHabitsPanel').hidden=true;return;}
  $('sessionHabits').innerHTML=cards.join('');
  const answerBox=$('sessionHabitsAnswer');
  if(answerBox){
    const tone=answer.status==='better'?'good':answer.status==='worse'?'bad':'neutral',signals=Array.isArray(answer.supportedSignals)?answer.supportedSignals:[];
    const signalText=signals.map(x=>esc(String(x.label||'Signal'))+' '+esc(signed(x.delta,Math.abs(Number(x.delta))<10?2:0))+' <small>n='+Number(x.recentN||0)+' vs '+Number(x.baselineN||0)+'</small>').join('');
    answerBox.innerHTML='<article class="session-answer-card tone-'+tone+'"><span>Direct answer</span><strong>'+esc(answer.headline||'Session-position evidence is still developing')+'</strong><p>'+(answer.status==='insufficient'?'At least two role-relevant metrics need three valid opener and game-3+ observations before this section makes a directional call.':'The call below compares game 3+ with session openers using opponent-adjusted or timeline-risk evidence, not raw scoreboard output.')+'</p>'+(signalText?'<div class="session-answer-signals">'+signalText+'</div>':'')+'<small>Descriptive association only. It does not diagnose fatigue, tilt or causation.</small></article>';
  }
  const deltas=[];
  if(sessionPairReady(late,first,'timelineGames')&&hasNum(s.game3PlusBadDeathDelta))deltas.push('game 3+ risky deaths '+signed(s.game3PlusBadDeathDelta,1)+'/game');
  if(sessionPairReady(late,first,'peerDpmGames')&&hasNum(s.game3PlusPeerDpmDelta))deltas.push('game 3+ DPM-vs-peer '+signed(s.game3PlusPeerDpmDelta,0));
  if(sessionPairReady(late,first,'peerCsMinGames')&&hasNum(s.game3PlusPeerCsMinDelta))deltas.push('game 3+ CS/min-vs-peer '+signed(s.game3PlusPeerCsMinDelta,2));
  if(role==='SUPPORT'&&sessionPairReady(late,first,'peerVpmGames')&&hasNum(s.game3PlusPeerVpmDelta))deltas.push('game 3+ vision/min-vs-peer '+signed(s.game3PlusPeerVpmDelta,2));
  if(['ADC','MID','TOP'].includes(role)&&sessionPairReady(late,first,'lane15Games')&&hasNum(s.game3PlusGoldDelta))deltas.push('game 3+ gold@15-vs-peer '+signed(s.game3PlusGoldDelta,0)+'g');
  if(role==='JUNGLE'&&sessionPairReady(late,first,'impactGames')&&hasNum(s.game3PlusImpactDelta))deltas.push('game 3+ first-impact-vs-peer '+signed(s.game3PlusImpactDelta,1)+'m');
  if(sessionPairReady(afterLoss,afterWin,'peerDpmGames')&&hasNum(s.postLossPeerDpmDelta))deltas.push('quick post-loss DPM-vs-peer '+signed(s.postLossPeerDpmDelta,0)+' vs post-win');
  if(sessionPairReady(afterLoss,afterWin,'peerCsMinGames')&&hasNum(s.postLossPeerCsMinDelta))deltas.push('quick post-loss CS/min-vs-peer '+signed(s.postLossPeerCsMinDelta,2)+' vs post-win');
  const thin=[['opener',first],['game 2',second],['game 3+',late],['post-loss',afterLoss],['post-win',afterWin]].filter(([,x])=>Number(x?.games||0)>0&&Number(x.games)<3).map(([label,x])=>label+' n='+Number(x.games));
  const base=s.definition||'Session grouping uses game timing and opponent-adjusted comparisons.';
  $('sessionHabitsNote').textContent=base+(deltas.length?' Supported observed '+roleLabel(role)+' deltas: '+deltas.join(' · ')+'.':' No role-relevant comparison currently has enough paired evidence for an observed delta.')+(thin.length?' Thin subgroups shown for traceability only: '+thin.join(', ')+'.':'');
  $('sessionHabitsPanel').hidden=false;
}
function practiceTargetValue(v,unit){
  if(!hasNum(v))return'n/a';
  const n=Number(v);
  if(unit==='percent')return Math.round(n)+'%';
  if(unit==='gold')return signed(n,0)+'g';
  if(unit==='per_game')return n.toFixed(2)+'/game';
  if(unit==='cs_per_min')return n.toFixed(2)+' CS/min';
  if(unit==='cs')return signed(n,1)+' CS';
  if(unit==='percentage_points')return signed(n,1)+' points';
  if(unit==='vpm')return signed(n,2)+' VPM';
  if(unit==='minutes')return signed(n,1)+' min';
  if(unit==='wards')return signed(n,1)+' wards';
  return n.toFixed(2);
}
function practiceTargetHtml(target){
  if(!target||!hasNum(target.baseline)||!hasNum(target.goal))return'';
  const relation=target.direction==='lower'?'≤':'≥',evidence=practiceTargetBaselineEvidenceText(target),baseWindow=Math.max(1,Number(target.baseWindowGames||target.windowGames||5)),maxWindow=Math.max(baseWindow,Number(target.maxWindowGames||20));
  return '<div class="practice-target"><span>Minimum '+baseWindow+' comparable games</span><strong>'+esc(practiceTargetValue(target.baseline,target.unit))+' → aim '+esc(relation+' '+practiceTargetValue(target.goal,target.unit))+'</strong>'+
    '<small>'+esc(target.rationale||'Self-relative short-term target')+' · '+esc(evidence)+(maxWindow>baseWindow?' · new-game evidence can extend to '+maxWindow+' games while this target remains active':'')+'</small></div>';
}


function practiceReplayCategories(theme){
  const specific=[theme?.title,...(Array.isArray(theme?.supportingTitles)?theme.supportingTitles:[])].filter(Boolean).join(' ').toLowerCase(),key=String(theme?.key||'').toLowerCase(),out=[];
  const add=x=>{if(!out.includes(x))out.push(x);};
  // Map from the actual supported findings first. Broad grouped keys such as
  // early-lane or objectives-closing are not themselves evidence that a replay
  // category is relevant.
  if(/reset|shop|recall/.test(specific)){add('resets');add('item spike');}
  if(/item|spike|power window|major item/.test(specific))add('item spike');
  if(/side.?lane|mid.?routing|routing|reconnect/.test(specific))add('mid routing');
  if(/solo|duel|matchup|lane death|lane state/.test(specific)){add('early lead');add('matchup');}
  if(/lead|preserv|give.?back|ahead|comeback/.test(specific)){add('early lead');add('lead protection');}
  if(/objective|setup|dragon|baron|herald|grub/.test(specific))add('objective setup');
  if(/fight|combat|damage share|resource conversion|uptime|position/.test(specific)){add('teamfights');add('fight selection');}
  if(/death|recovery|risk|overstay|catch|post.?play/.test(specific)){add('death consequences');add('lead protection');}
  if(/vision|ward|facecheck/.test(specific))add('vision safety');
  if(/roam|rotation/.test(specific))add('roaming');
  // Only use narrow fallback groups when the representative/supporting titles
  // did not expose a replayable event type.
  if(!out.length){
    if(key==='death-risk'){add('death consequences');add('lead protection');}
    else if(key==='reset-power'){add('resets');add('item spike');}
    else if(key==='mid-routing')add('mid routing');
    else if(key==='teamfights'){add('teamfights');add('fight selection');}
    else if(key==='vision')add('vision safety');
    else if(key==='roaming')add('roaming');
    else if(key==='recovery')add('death consequences');
  }
  return out;
}
function practiceReplayItems(r,theme){
  const cats=practiceReplayCategories(theme),items=Array.isArray(r?.replayReviewQueue)?r.replayReviewQueue:[];
  return items.filter(x=>cats.includes(String(x.category||'').toLowerCase())).sort((a,b)=>Number(a.rank||999)-Number(b.rank||999)).slice(0,2);
}
function currentPriorityReplayIds(r){
  const theme=topPracticeThemes(r)[0]||null,cats=practiceReplayCategories(theme),ids=new Set();
  if(!cats.length)return ids;
  (Array.isArray(r?.replayReviewQueue)?r.replayReviewQueue:[]).forEach(x=>{if(cats.includes(String(x.category||'').toLowerCase())&&x.matchId)ids.add(String(x.matchId));});
  return ids;
}
function currentPriorityReplayLabel(r){
  const theme=topPracticeThemes(r)[0]||null;
  return theme?practiceThemeLabel(theme):'Current focus';
}
function practiceReplayHtml(r,theme){
  const items=practiceReplayItems(r,theme);if(!items.length)return'';
  return '<div class="practice-replay-links"><b>Review these moments</b>'+items.map(x=>
    '<div class="practice-replay-link"><span>#'+esc(String(x.rank||''))+' · '+esc(x.champion||'Unknown')+' · '+esc(fmt(x.minute,1))+'m</span><strong>'+esc(x.title||'Replay moment')+'</strong><button class="button secondary small" type="button" data-practice-review-match="'+esc(x.matchId||'')+'" data-practice-review-tab="'+esc(x.tab||'macro')+'">Open evidence</button></div>'
  ).join('')+'</div>';
}


function practiceLiveTrigger(theme){
  const key=String(theme?.key||'').toLowerCase(),textValue=[theme?.title,...(Array.isArray(theme?.supportingTitles)?theme.supportingTitles:[])].filter(Boolean).join(' ').toLowerCase();
  if(key==='early-lane'){
    if(/lead|give.?back|preserv/.test(textValue))return{when:'You create a meaningful direct-role lead',do:'Protect the next wave/reset first; do not re-enter a low-value fight that can hand the lead back.'};
    if(/farm|cs/.test(textValue))return{when:'A lane wave is available and no higher-value supported play is imminent',do:'Take the guaranteed CS, then reconnect before the next objective or fight window.'};
    if(/solo|duel|matchup|lane death/.test(textValue))return{when:'The lane becomes a clean 1v1 decision',do:'Check threat range, cooldowns and your exit before committing; avoid turning an even lane into a solo death.'};
    return{when:'Before the comparable early-lane checkpoint',do:'Choose the wave, reset and trade sequence that protects direct-role economy rather than chasing activity for its own sake.'};
  }
  if(key==='death-risk'){
    if(/repeat|recovery|second death/.test(textValue))return{when:'You die',do:'Spend, route to the safest guaranteed resource and rebuild information before contesting the same area again.'};
    if(/post.?play|give.?back|successful play/.test(textValue))return{when:'Your team just won a kill, fight or objective',do:'Bank the gain first—reset, take the safe resource or leave—before looking for one more low-information play.'};
    if(/ahead|lead protection/.test(textValue))return{when:'You are materially ahead of the direct role opponent',do:'Lower variance: take the high-certainty resource or objective setup instead of offering a catch window.'};
    return{when:'The payoff is unclear but the route extends into fog, isolation or high unspent gold',do:'End the sequence early and reset/reconnect rather than forcing the next action.'};
  }
  if(key==='reset-power'){
    if(/item|spike|power window|major/.test(textValue))return{when:'Your major item completes before the direct role opponent',do:'Leave base with one specific lane, objective or fight to pressure before item parity closes the window.'};
    if(/post.?kill|solo kill/.test(textValue))return{when:'You win a clean lane kill',do:'Check the next wave and shop immediately; do not stay exposed long enough to die before converting the kill.'};
    return{when:'Your first meaningful purchase becomes available',do:'Prepare the wave and recall so the spend does not surrender the next direct-role economy window.'};
  }
  if(key==='mid-routing')return{when:'A neutral objective or major team event is approaching within roughly 90 seconds',do:'Finish the current safe wave, stop extending the side lane and reconnect before the contest becomes urgent.'};
  if(key==='objectives-closing'){
    if(/closing|lead|ahead/.test(textValue))return{when:'You reach the late game with a direct-role lead',do:'Trade only for high-value map progress; do not expose the lead to a low-information catch or extra chase.'};
    return{when:'The next neutral objective is entering its setup window',do:'Resolve shop + wave + pathing early enough to arrive with information instead of reacting after the contest starts.'};
  }
  if(key==='teamfights')return{when:'A fight is about to become committed',do:'Check local numbers, item/level state and the first enemy threat; enter only when you can stay alive long enough to contribute.'};
  if(key==='consistency')return{when:'You are starting game 3+ in a session or quickly requeueing',do:'Reuse the same opening checklist and practice target; do not change the plan just because of the previous result.'};
  if(key==='recovery')return{when:'The direct-role state is already materially behind',do:'Take guaranteed resources and cross-map value first; require a real numbers, vision or cooldown advantage before fighting.'};
  if(key==='vision')return{when:'You are about to enter unwarded fog to place or clear vision',do:'Require ally proximity, known enemy locations or a safe exit path; otherwise delay the vision action.'};
  if(key==='roaming')return{when:'You are about to leave your lane assignment',do:'Estimate the wave/resource cost and the return path first; roam only when the supported payoff justifies what you give up.'};
  return{when:'The same evidence pattern starts to appear again',do:String(theme?.action||'Use the current practice action and keep the decision rule narrow.')};
}
function practiceTriggerHtml(theme){
  const x=practiceLiveTrigger(theme);if(!x?.when||!x?.do)return'';
  return '<div class="practice-trigger"><span>Live trigger</span><div><b>If:</b> '+esc(x.when)+'</div><div><b>Then:</b> '+esc(x.do)+'</div></div>';
}

function renderPracticePlan(r){
  const targets=Array.isArray(r.practiceTargets)?r.practiceTargets:[],focus=topPracticeThemes(r);
  if(!focus.length){
    $('practicePlan').innerHTML='<div class="practice-empty">No strong improvement priority has enough evidence yet. Fetch/analyze more timeline-complete games rather than forcing a conclusion.</div>';
    return;
  }
  $('practicePlan').innerHTML=focus.map((x,i)=>{
    const target=targets.find(t=>String(t.themeKey||'')===String(x.key||''))||targets[i]||null;
    return '<article class="practice-card">'+
      '<div class="practice-number">'+(i+1)+'</div><div><span>'+esc(x.category||'focus')+'</span><strong>'+esc(x.title||'Practice focus')+'</strong>'+
      '<p>'+esc(x.action)+'</p>'+
      practiceTriggerHtml(x)+
      (Array.isArray(x.supportingTitles)&&x.supportingTitles.length>1?'<div class="practice-supporting"><b>Why this is a priority</b>'+x.supportingTitles.slice(0,4).map(t=>'<span>• '+esc(t)+'</span>').join('')+'</div>':'')+
      practiceTargetHtml(target)+practiceReplayHtml(r,x)+
      '<small>'+esc(x.comparison||'Last-20 evidence')+' · '+esc(x.confidence||'medium')+' confidence'+(Number(x.supportCount||0)?' · '+esc(String(x.supportCount))+' supporting finding'+(Number(x.supportCount)===1?'':'s'):'')+'</small></div></article>';
  }).join('');
  $('practicePlan').querySelectorAll('[data-practice-review-match]').forEach(btn=>btn.addEventListener('click',()=>{
    const matchId=btn.dataset.practiceReviewMatch,tab=btn.dataset.practiceReviewTab||'macro';if(matchId)openReplayReviewMatch(matchId,tab);
  }));
}
function openReplayReviewMatch(matchId,tab){
  const games=state.report?.games||[],index=games.findIndex(g=>String(g.matchId)===String(matchId));
  if(index<0)return;
  openReportAncestors($('last20'));
  state.activeDetailTab=tab||'macro';
  state.gameFilter='all';state.gameChampion='all';
  renderGames(state.report);
  if(state.openMatch===index)state.openMatch=null;
  toggleGame(index);
  const row=$('gamesBody')?.querySelector('.game-row[data-match="'+CSS.escape(String(matchId))+'"]');
  if(row)row.scrollIntoView({behavior:'auto',block:'center'});
}
function renderReplayReviewQueue(r){
  const box=$('replayReviewQueue'),panel=$('replayReviewPanel');if(!box||!panel)return;
  const items=Array.isArray(r.replayReviewQueue)?r.replayReviewQueue:[],theme=topPracticeThemes(r)[0]||null,cats=practiceReplayCategories(theme);
  panel.hidden=!items.length;
  if(!items.length){box.innerHTML='';return;}
  const focusItems=cats.length?items.filter(x=>cats.includes(String(x.category||'').toLowerCase())):[],focusKeys=new Set(focusItems.map(x=>String(x.matchId||'')+'|'+String(x.rank||''))),otherItems=items.filter(x=>!focusKeys.has(String(x.matchId||'')+'|'+String(x.rank||'')));
  const card=(x,focusMatch)=>'<article class="review-card '+(focusMatch?'focus-match':'')+'">'+
    '<div class="review-rank">#'+esc(String(x.rank||''))+'</div>'+
    '<div class="review-copy"><div class="review-head"><span>'+esc(x.category||'review')+(focusMatch?' · current focus':'')+'</span><strong>'+esc(x.title||'Replay review')+'</strong></div>'+
    '<p>'+esc(x.evidence||'')+'</p><p class="review-prompt"><b>Look for:</b> '+esc(x.prompt||'')+'</p>'+
    '<small>'+esc(x.champion||'Unknown')+' · '+esc(x.role||'GENERIC')+(x.opponentChampion?' · vs '+esc(x.opponentChampion):'')+' · '+esc(fmt(x.minute,1))+'m · analyzer rank #'+esc(String(x.rank||''))+'</small></div>'+
    '<button class="button secondary small review-open" type="button" data-review-match="'+esc(x.matchId||'')+'" data-review-tab="'+esc(x.tab||'macro')+'">Open match</button>'+
    '</article>';
  const focusLabel=theme?practiceThemeLabel(theme):'Current focus';
  box.innerHTML=(focusItems.length?'<div class="review-queue-group focus-group"><div class="review-group-head"><div><span>Practice-first review</span><strong>'+esc(focusLabel)+'</strong></div><small>'+focusItems.length+' matching moment'+(focusItems.length===1?'':'s')+' · original analyzer ranks preserved</small></div>'+focusItems.map(x=>card(x,true)).join('')+'</div>':'')+
    (otherItems.length?'<div class="review-queue-group"><div class="review-group-head"><div><span>Other high-value evidence</span><strong>Keep after the current focus</strong></div><small>'+otherItems.length+' additional ranked moment'+(otherItems.length===1?'':'s')+'</small></div>'+otherItems.map(x=>card(x,false)).join('')+'</div>':'');
  box.querySelectorAll('.review-open').forEach(btn=>btn.addEventListener('click',()=>openReplayReviewMatch(btn.dataset.reviewMatch,btn.dataset.reviewTab)));
}
function gameSortValue(g,key,index){
  if(key==='champion')return String(g.champion||'').toLowerCase();
  if(key==='opponent')return trustedDirectPeer(g)?String(g.peer?.champion||'').toLowerCase():'';
  if(key==='result')return g.win?1:0;
  if(key==='kda')return (Number(g.kills||0)+Number(g.assists||0))/Math.max(1,Number(g.deaths||0));
  if(key==='kp')return Number(g.kp??-Infinity);
  if(key==='cs')return Number(g.csMin??-Infinity);
  if(key==='dpm')return Number(g.dpm??-Infinity);
  if(key==='gold15')return trustedDirectPeer(g)&&g?.phaseRules?.lane15Comparable!==false&&hasNum(g.goldDiff15)?Number(g.goldDiff15):-Infinity;
  return -Number(index);
}
function bindGameSortControls(){
  document.querySelectorAll('[data-game-sort]').forEach(btn=>btn.onclick=()=>{
    const key=String(btn.dataset.gameSort||'recent');
    if(state.gameSort.key===key)state.gameSort.dir=state.gameSort.dir==='desc'?'asc':'desc';
    else state.gameSort={key,dir:key==='champion'||key==='opponent'?'asc':'desc'};
    if(state.report)renderGames(state.report);
  });
}
function bindGameFilterControls(){
  document.querySelectorAll('[data-game-filter]').forEach(btn=>btn.onclick=()=>{
    state.gameFilter=String(btn.dataset.gameFilter||'all');state.openMatch=null;
    if(state.report)renderGames(state.report);
  });
  const champion=$('gameChampionFilter');if(champion)champion.onchange=()=>{state.gameChampion=String(champion.value||'all');state.openMatch=null;if(state.report)renderGames(state.report);};
  const clear=$('clearGameFilters');if(clear)clear.onclick=()=>{state.gameFilter='all';state.gameChampion='all';state.openMatch=null;if(state.report)renderGames(state.report);};
}
function trustedDirectPeer(g){return g?.directPeerComparable===true;}
function explicitGameRole(v){
  const r=String(v||'').trim().toUpperCase();
  if(r==='BOTTOM'||r==='BOT'||r==='DUO_CARRY'||r==='ADC')return'ADC';
  if(r==='UTILITY'||r==='DUO_SUPPORT'||r==='SUPPORT')return'SUPPORT';
  if(r==='MIDDLE'||r==='MID')return'MID';
  if(r==='JUNGLE')return'JUNGLE';
  if(r==='TOP')return'TOP';
  return null;
}

function gameMatchesNamedFilter(g,key){
  if(key==='win')return!!g.win;
  if(key==='loss')return!g.win;
  if(key==='ahead15')return trustedDirectPeer(g)&&g?.phaseRules?.lane15Comparable!==false&&hasNum(g.goldDiff15)&&Number(g.goldDiff15)>100;
  if(key==='even15')return trustedDirectPeer(g)&&g?.phaseRules?.lane15Comparable!==false&&hasNum(g.goldDiff15)&&Math.abs(Number(g.goldDiff15))<=100;
  if(key==='behind15')return trustedDirectPeer(g)&&g?.phaseRules?.lane15Comparable!==false&&hasNum(g.goldDiff15)&&Number(g.goldDiff15)<-100;
  return true;
}
function gamePassesFilter(g){
  if(state.gameChampion!=='all'&&String(g.champion||'')!==state.gameChampion)return false;
  return gameMatchesNamedFilter(g,state.gameFilter);
}

function gameMechanicsKey(g){
  const rules=String(g?.phaseRules?.key||'').trim()||'unknown',revision=String(g?.roleQuestContext?.revision||'').trim()||'unknown';
  return [rules,revision].join('|');
}
function reportCoachingGames(r){
  const games=Array.isArray(r?.games)?r.games:[],dq=r?.dataQuality||{},selectedRole=reportSelectedRole(r,'');
  const roleGames=selectedRole?games.filter(g=>explicitGameRole(g?.role)===selectedRole):games;
  if(dq.mechanicsCohortApplied===true&&dq.currentMechanicsKey){
    return roleGames.filter(g=>gameMechanicsKey(g)===String(dq.currentMechanicsKey));
  }
  return roleGames;
}
function gameIsCoachingContext(r,g){
  const dq=r?.dataQuality||{},selectedRole=reportSelectedRole(r,'');
  if(selectedRole&&explicitGameRole(g?.role)!==selectedRole)return false;
  return !(dq.mechanicsCohortApplied===true&&dq.currentMechanicsKey&&gameMechanicsKey(g)!==String(dq.currentMechanicsKey));
}

function arcRoleGoldState(g,minute){
  const rules=g?.phaseRules||{},field=minute===15?'goldDiff15':'goldDiff25',v=g?.[field];
  if(!trustedDirectPeer(g))return {key:'unavailable',label:'Role peer withheld',tone:'neutral',value:null};
  if(minute===15&&rules.lane15Comparable===false)return {key:'unavailable',label:'@15 not comparable',tone:'neutral',value:null};
  if(minute===25&&rules.closing25Comparable===false)return {key:'unavailable',label:'@25 not comparable',tone:'neutral',value:null};
  if(!hasNum(v))return {key:'unavailable',label:'No @'+minute+' checkpoint',tone:'neutral',value:null};
  const n=Number(v);
  if(n>100)return {key:'ahead',label:'Ahead',tone:'good',value:n};
  if(n<-100)return {key:'behind',label:'Behind',tone:'bad',value:n};
  return {key:'close',label:'Close',tone:'neutral',value:n};
}
function roleArcObjectiveStage(g){
  if(g?.timelineAvailable!==true)return {key:'objective_unavailable',label:'Objective setup',tone:'neutral',value:'Timeline unavailable',copy:'Objective setup sequencing cannot be reconstructed without timeline evidence.'};
  const obj=g?.objectiveReadiness||{},legacySecuredJoined=Number(obj.joined||0),early=Number(obj.earlySetupJoins||0),contested=Number(obj.contestedObjectives||0),contestedJoined=Number(obj.contestedJoined||0),setupRate=contestedJoined?100*early/contestedJoined:null;
  if(!contestedJoined&&!contested)return {key:'objective_no_sample',label:'Objective setup',tone:'neutral',value:'No supported objective sample',copy:'No joined or team-contested neutral-objective encounter is available for this match.'};
  const presence=contested?100*contestedJoined/contested:null,tone=contestedJoined>=2&&setupRate!=null?(setupRate>=70?'good':setupRate<45?'bad':'neutral'):'neutral';
  return {key:'objective_'+(setupRate==null?'unknown':setupRate>=70?'early':setupRate<45?'late':'mixed'),label:'Objective setup',tone,value:(setupRate==null?'Prior setup n/a':fmtPct(setupRate)+' prior setup')+(presence!=null?' · '+fmtPct(presence)+' contested presence':''),copy:'Prior setup means supported position near the objective 45–105 seconds before a joined team-contested encounter; legacy team-secured joins ('+legacySecuredJoined+') are traceability only.'};
}
function roleArcTeamplayStage(g){
  if(g?.timelineAvailable!==true)return {key:'teamplay_unavailable',label:'Teamplay',tone:'neutral',value:'Timeline unavailable',copy:'Fight/risk sequencing cannot be reconstructed without timeline evidence.'};
  const fight=g?.fightProfile||{},vision=g?.visionMission||{},recovery=g?.deathRecovery||{},pre=Number(fight.diedBeforeContribution||0),visionRisk=Number(vision.highRiskDeaths||0),repeat=Number(recovery.repeatDeaths||0);
  if(pre>0)return {key:'teamplay_preimpact',label:'Teamplay',tone:'bad',value:pre+' pre-contribution fight death'+(pre===1?'':'s'),copy:'Tracked active-fight clusters include death before recorded contribution.'};
  if(visionRisk>0)return {key:'teamplay_vision_risk',label:'Teamplay',tone:'bad',value:visionRisk+' high-risk vision death'+(visionRisk===1?'':'s'),copy:'These deaths occurred shortly after tracked ward placement/clear actions and crossed the high-risk classifier.'};
  if(repeat>0)return {key:'teamplay_repeat',label:'Teamplay',tone:'bad',value:repeat+' rapid repeat death'+(repeat===1?'':'s'),copy:'A measured post-death recovery opportunity became another death inside the repeat-death window.'};
  return {key:'teamplay_clear',label:'Teamplay',tone:'neutral',value:'No dominant risk flag',copy:'No pre-contribution fight death, high-risk vision death or rapid repeat-death sequence dominates this match.'};
}
function roleArcFinishStage(g){
  const lateHigh=Number(g?.closing25?.highRiskDeaths||0),lateCostly=Number(g?.closing25?.costlyDeaths||0),risk=lateHigh>0||lateCostly>0;
  return {key:'finish_'+(g?.win?'win':'loss')+(risk?'_risk':''),label:'Finish',tone:g?.win?(risk?'neutral':'good'):'bad',value:(g?.win?'Win':'Loss')+(risk?' · late risk flagged':''),copy:risk?'Late high-risk/costly death evidence is shown as review context; overlapping categories are not added as unique deaths and are not assumed to cause the result.':'Result is shown without assigning a causal explanation when no stronger supported closing signal exists.'};
}
function supportGameArcStages(g){
  const stages=[],roams=g?.roams||{},attempts=Number(roams.attempts||0),successes=Number(roams.successes||0),rate=attempts?100*successes/attempts:null,laneCost=perGameSupportAdcLaneCost(g);
  let tone='neutral',value='No measured early roam',copy='No supported early roam departure was detected in this match.',key='support_roam_none';
  if(attempts>0){
    if(rate>=65&&(laneCost==null||laneCost>=-2)){tone='good';key='support_roam_value';value=fmtPct(rate)+' roam conversion';}
    else if(rate<45&&laneCost!=null&&laneCost<=-6){tone='bad';key='support_roam_cost';value=fmtPct(rate)+' conversion · '+signed(laneCost,1)+' ADC CS';}
    else{key='support_roam_mixed';value=fmtPct(rate)+' roam conversion'+(laneCost!=null?' · '+signed(laneCost,1)+' ADC CS':'');}
    copy='Roam return and ADC-vs-ADC lane-cost movement are shown together; the CS change is associated with the roam window, not attributed solely to Support movement.';
  }
  stages.push({key,label:'Roam / lane',tone,value,copy});
  const peerOk=trustedDirectPeer(g),vpm=peerOk&&hasNum(g?.peer?.vpmDelta)?Number(g.peer.vpmDelta):null,setup=peerOk&&hasNum(g?.vision?.objectiveSetupDeltaVsOpponent)?Number(g.vision.objectiveSetupDeltaVsOpponent):null;
  let visionTone='neutral';
  if(vpm!=null&&setup!=null){if(vpm>=.15&&setup>=.5)visionTone='good';else if(vpm<=-.15&&setup<=-.5)visionTone='bad';}
  stages.push({key:'support_vision_peer',label:'Vision vs peer',tone:visionTone,value:(vpm==null?'VPM n/a':signed(vpm,2)+' VPM')+' · '+(setup==null?'setup n/a':signed(setup,1)+' setup wards'),copy:peerOk?'Direct-role vision volume and pre-objective setup-ward differences versus the opposing Support.':'Direct-role vision comparison is withheld because the Support peer is not high-confidence.'});
  stages.push(roleArcObjectiveStage(g),roleArcTeamplayStage(g),roleArcFinishStage(g));
  return stages;
}
function jungleGameArcStages(g){
  const stages=[],peerOk=trustedDirectPeer(g),cs=peerOk&&hasNum(g?.peer?.csMinDelta)?Number(g.peer.csMinDelta):null;
  stages.push({key:'jungle_farm_'+(cs==null?'unknown':cs>.15?'ahead':cs<-.15?'behind':'close'),label:'Farm vs Jungle',tone:cs==null?'neutral':cs>.15?'good':cs<-.15?'bad':'neutral',value:cs==null?'Peer evidence unavailable':signed(cs,2)+' CS/min',copy:peerOk?'Direct-jungle farm rate relative to the actual opposing Jungler.':'Direct-jungle farm comparison is withheld because the peer is not high-confidence.'});
  const impact=peerOk&&hasNum(g?.impactDeltaVsOpponent)?Number(g.impactDeltaVsOpponent):null,item=peerOk&&hasNum(g?.itemSpikeDeltaVsOpponent)?Number(g.itemSpikeDeltaVsOpponent):null;
  let tempoTone='neutral';if(impact!=null){if(impact<=-1.5)tempoTone='good';else if(impact>=1.5)tempoTone='bad';}
  stages.push({key:'jungle_tempo_'+(impact==null?'unknown':impact<=-1.5?'early':impact>=1.5?'late':'close'),label:'Tempo vs Jungle',tone:tempoTone,value:(impact==null?'impact n/a':signed(impact,1)+'m first impact')+(item!=null?' · '+signed(item,1)+'m first major':''),copy:'Negative timing means you reached the tracked event/item earlier than the enemy Jungler; timing is contextual rather than proof of better pathing.'});
  stages.push(roleArcObjectiveStage(g),roleArcTeamplayStage(g),roleArcFinishStage(g));
  return stages;
}

function gameArcStages(g){
  const role=canonicalRole(g?.role);
  if(role==='SUPPORT')return supportGameArcStages(g);
  if(role==='JUNGLE')return jungleGameArcStages(g);
  const peerOk=trustedDirectPeer(g),lane=arcRoleGoldState(g,15),at25=arcRoleGoldState(g,25),reset=peerOk?(g.firstResetSequence||null):null,spike=peerOk?(g.itemSpikeWindow||{}):{},fight=g.fightProfile||{},obj=g.objectiveReadiness||{},side=g.sideLaneRisk||{},closing=g.closing25||{};
  const stages=[];
  stages.push({
    key:'lane_'+lane.key,label:'Lane @15',tone:lane.tone,
    value:lane.value==null?lane.label:lane.label+' · '+signed(lane.value,0)+'g',
    copy:lane.key==='unavailable'?'No coaching-safe @15 role-gold state is available.':'Direct same-role gold state using the same ±100g bands as the evidence table.'
  });
  if(g.timelineAvailable!==true){
    stages.push({key:'power_unavailable',label:'Reset / power',tone:'neutral',value:'Timeline unavailable',copy:'Reset and item-window sequencing cannot be reconstructed without timeline evidence.'});
  }else if(!peerOk){
    stages.push({key:'power_peer_withheld',label:'Reset / power',tone:'neutral',value:'Role peer withheld',copy:'Peer-relative reset economy and earlier-item power windows are withheld because the direct role opponent is not high-confidence.'});
  }else if(spike.eligible){
    const delta=hasNum(g.itemSpikeDeltaVsOpponent)?Number(g.itemSpikeDeltaVsOpponent):null;
    if(spike.diedBeforeImpact)stages.push({key:'power_spike_died',label:'Reset / power',tone:'bad',value:'Earlier item → death before impact',copy:(delta!=null?'First major arrived '+fmt(Math.abs(delta),1)+'m earlier; ':'')+'the measurable earlier-item window ended in death before tracked impact.'});
    else if(spike.used)stages.push({key:'power_spike_used',label:'Reset / power',tone:'good',value:'Earlier item → tracked impact',copy:(delta!=null?'First major arrived '+fmt(Math.abs(delta),1)+'m earlier; ':'')+'the power window produced tracked kill/assist or objective impact before role-opponent parity.'});
    else stages.push({key:'power_spike_unused',label:'Reset / power',tone:'neutral',value:'Earlier item window unused',copy:'An earlier first-major window existed, but no tracked impact was recorded before role-opponent item parity.'});
  }else if(reset){
    if(reset.deathInWindow)stages.push({key:'reset_disrupted',label:'Reset / power',tone:'bad',value:'First-reset window disrupted',copy:'A death occurred inside the post-reset measurement window, so economy swing is not treated as clean reset evidence.'});
    else if(reset.economyLoss)stages.push({key:'reset_loss',label:'Reset / power',tone:'bad',value:'Lost ground after first reset',copy:'The clean post-reset window lost at least 350g role differential or 6 CS by the supported next frame.'});
    else if(reset.economyGain)stages.push({key:'reset_gain',label:'Reset / power',tone:'good',value:'Gained ground after first reset',copy:'The clean post-reset window gained at least 150g and 4 CS of direct-role differential.'});
    else stages.push({key:'reset_stable',label:'Reset / power',tone:'neutral',value:'No strong reset swing',copy:'A first return shop was detected, but its supported aftermath did not cross the report’s gain/loss thresholds.'});
  }else{
    stages.push({key:'power_unknown',label:'Reset / power',tone:'neutral',value:'No supported sequence',copy:'No qualifying first-reset or earlier-item power-window sequence is available.'});
  }

  const fixedComparable=g?.phaseRules?.fixed15to25Comparable!==false;
  if(!fixedComparable||lane.key==='unavailable'||at25.key==='unavailable'){
    stages.push({key:'transition_unavailable',label:'15 → 25',tone:'neutral',value:'Transition unavailable',copy:'This rules profile or game length does not support a standard @15→@25 role-state comparison.'});
  }else{
    const swing=Number(at25.value)-Number(lane.value),from=lane.key,to=at25.key;
    let tone='neutral',value=lane.label+' → '+at25.label,copy='Role-gold differential changed '+signed(swing,0)+'g from 15 to 25.';
    if(from==='ahead'&&to==='ahead'){tone=swing<=-500?'neutral':'good';value=swing<=-500?'Lead retained, but eroded':'Role lead preserved';}
    else if(from==='ahead'&&to!=='ahead'){tone='bad';value='Role lead gone by 25';}
    else if(from==='behind'&&to!=='behind'){tone='good';value='Role deficit recovered by 25';}
    else if(from==='behind'&&to==='behind'&&swing>=500){tone='neutral';value='Deficit improved';}
    else if(from==='behind'&&to==='behind'&&swing<=-500){tone='bad';value='Role deficit deepened';}
    else if(from==='close'&&to==='ahead'){tone='good';value='Created role lead';}
    else if(from==='close'&&to==='behind'){tone='bad';value='Fell behind by 25';}
    else if(from==='close'&&to==='close'){value='Stayed close';}
    stages.push({key:'transition_'+from+'_to_'+to,label:'15 → 25',tone,value,copy});
  }

  if(g.timelineAvailable!==true){
    stages.push({key:'teamplay_unavailable',label:'Teamplay',tone:'neutral',value:'Not measurable',copy:'Fight and objective sequencing requires timeline evidence.'});
  }else{
    const preSide=Number(side.preNeutralObjectiveSideLaneDeaths||0),preFight=Number(fight.diedBeforeContribution||0),shopAbs=Number(obj.recentShopAbsences??obj.lateResetMisses??0),contested=Number(obj.contestedObjectives||0),setupRate=hasNum(obj.earlySetupJoinRate)?Number(obj.earlySetupJoinRate):null;
    if(preSide>0)stages.push({key:'teamplay_side_lane',label:'Teamplay',tone:'bad',value:preSide+' pre-objective side-lane death'+(preSide===1?'':'s'),copy:'These deaths occurred in the supported pre-neutral-objective side-lane window.'});
    else if(preFight>0)stages.push({key:'teamplay_preimpact_death',label:'Teamplay',tone:'bad',value:preFight+' fight'+(preFight===1?'':'s')+' died before contribution',copy:'Tracked fight clusters show death before a recorded contribution in the cluster.'});
    else if(shopAbs>0)stages.push({key:'teamplay_recent_shop_absence',label:'Teamplay',tone:'neutral',value:shopAbs+' recent-shop objective absence'+(shopAbs===1?'':'s'),copy:'A detected shop visit occurred within 60 seconds before these contested-objective absences. This is an association, not a proven reset cause.'});
    else if(contested>=2&&setupRate!=null&&setupRate>=70)stages.push({key:'teamplay_setup',label:'Teamplay',tone:'good',value:'Early objective setup '+fmtPct(setupRate),copy:'In contested neutral-objective joins, supported player position was already near the area 45–105 seconds before the event often enough to cross the analyzer’s 70% positive setup band.'});
    else stages.push({key:'teamplay_neutral',label:'Teamplay',tone:'neutral',value:'No dominant teamplay flag',copy:'No single supported side-lane, pre-contribution, recent-shop-absence or strong early-setup signal dominates this game.'});
  }

  const lateHighRisk=Number(closing.highRiskDeaths||0),lateCostly=Number(closing.costlyDeaths||0),hasLateRisk=lateHighRisk>0||lateCostly>0,duration=Number(g.durationMinutes||0);
  const lateRiskText=(lateHighRisk?lateHighRisk+' high-risk':'')+(lateHighRisk&&lateCostly?' · ':'')+(lateCostly?lateCostly+' costly':'')+' late-death flag'+((lateHighRisk===1&&lateCostly===0)||(lateCostly===1&&lateHighRisk===0)?'':'s');
  if(duration<25||at25.key==='unavailable'){
    stages.push({key:'finish_no25_'+(g.win?'win':'loss'),label:'Finish',tone:g.win?'good':'bad',value:(g.win?'Win':'Loss')+' without comparable @25 state',copy:'Result is known, but no standard role-relative @25 closing checkpoint is used for this game.'});
  }else if(at25.key==='ahead'&&g.win){
    stages.push({key:'finish_ahead_win',label:'Finish',tone:hasLateRisk?'neutral':'good',value:hasLateRisk?'Ahead @25 → win with late risk':'Ahead @25 → win',copy:hasLateRisk?lateRiskText+' were recorded after 25. High-risk and costly categories can overlap, so they are not added together as unique deaths.':'No late high-risk/costly death flag was recorded after the ahead-at-25 checkpoint.'});
  }else if(at25.key==='ahead'&&!g.win){
    stages.push({key:'finish_ahead_loss',label:'Finish',tone:'bad',value:hasLateRisk?'Ahead @25 → loss + late risk':'Ahead @25 → loss',copy:hasLateRisk?lateRiskText+' are review evidence. High-risk and costly categories can overlap, and neither category is assumed to be the sole cause of the loss.':'The role lead did not become a win, but the current late-risk model does not identify a supported cause.'});
  }else if(at25.key==='behind'&&g.win){
    stages.push({key:'finish_behind_win',label:'Finish',tone:'good',value:'Behind @25 → win',copy:'The game was won despite a direct-role gold deficit at the comparable 25-minute checkpoint.'});
  }else if(at25.key==='behind'&&!g.win){
    stages.push({key:'finish_behind_loss',label:'Finish',tone:'bad',value:'Behind @25 → loss',copy:'The game remained behind the direct-role opponent at the comparable 25-minute checkpoint and ended in a loss.'});
  }else{
    stages.push({key:'finish_close_'+(g.win?'win':'loss'),label:'Finish',tone:g.win?'good':'bad',value:'Close @25 → '+(g.win?'win':'loss'),copy:'The direct-role gold state was within ±100g at 25; the result is shown without attributing causality to that checkpoint.'});
  }
  return stages;
}
function gameArcStripHtml(g){
  const stages=gameArcStages(g);
  return '<div class="match-game-arc" aria-label="Game arc">'+stages.map((x,i)=>'<div class="game-arc-stage tone-'+x.tone+'"><span>'+esc(x.label)+'</span><strong>'+esc(x.value)+'</strong><small>'+esc(x.copy)+'</small></div>'+(i<stages.length-1?'<i class="game-arc-arrow" aria-hidden="true">→</i>':'')).join('')+'</div>';
}
function gameArcTransition(g){
  const a=arcRoleGoldState(g,15),b=arcRoleGoldState(g,25);
  if(g?.phaseRules?.fixed15to25Comparable!==true||a.key==='unavailable'||b.key==='unavailable')return null;
  return {key:a.key+'>'+b.key,label:a.label+' @15 → '+b.label+' @25',from:a,to:b,swing:Number(b.value)-Number(a.value)};
}
const ARC_TURNING_POINT_DEFS=[
  {key:'early_lead_giveback',label:'Early role lead gave back ≥500g by 15',tone:'bad',test:g=>trustedDirectPeer(g)&&g.earlyLeadWindow?.giveback===true,why:'A measured pre-15 direct-role lead of at least 500g lost at least 500g before the @15 checkpoint.'},
  {key:'first_reset_loss',label:'Clean first-reset aftermath lost economy',tone:'bad',test:g=>trustedDirectPeer(g)&&g.firstResetSequence?.economyLoss===true,why:'The clean post-reset evidence window lost at least 350g role differential or 6 CS.'},
  {key:'first_reset_gain',label:'Clean first-reset aftermath gained economy',tone:'good',test:g=>trustedDirectPeer(g)&&g.firstResetSequence?.economyGain===true,why:'The clean post-reset evidence window gained at least 150g and 4 CS.'},
  {key:'spike_used',label:'Earlier first-major window produced impact',tone:'good',test:g=>trustedDirectPeer(g)&&g.itemSpikeWindow?.eligible===true&&g.itemSpikeWindow?.used===true,why:'An earlier first-major window produced tracked impact before the direct role opponent reached item parity.'},
  {key:'spike_died',label:'Earlier first-major window ended in death first',tone:'bad',test:g=>trustedDirectPeer(g)&&g.itemSpikeWindow?.eligible===true&&g.itemSpikeWindow?.diedBeforeImpact===true,why:'An earlier first-major window ended in death before tracked impact.'},
  {key:'preobj_side',label:'Side-lane death shortly before contested objective',tone:'bad',test:g=>Number(g.sideLaneRisk?.preNeutralObjectiveSideLaneDeaths||0)>0,why:'At least one side-lane death occurred inside the analyzer’s supported pre-neutral-objective window.'},
  {key:'recent_shop_absence',label:'Recent-shop objective absence',tone:'neutral',test:g=>Number(g.objectiveReadiness?.recentShopAbsences??g.objectiveReadiness?.lateResetMisses??0)>0,why:'A shop visit occurred within 60 seconds before at least one contested-objective absence. This is association evidence only.'},
  {key:'preimpact_fight_death',label:'Died before contribution in a tracked fight',tone:'bad',test:g=>Number(g.fightProfile?.diedBeforeContribution||0)>0,why:'At least one attended fight cluster recorded death before tracked contribution.'},
  {key:'repeat_death',label:'Rapid repeat-death sequence',tone:'bad',test:g=>Number(g.deathRecovery?.repeatDeaths||0)>0,why:'At least one measured recovery opportunity became another death inside the repeat-death window.'},
  {key:'late_risk',label:'Late high-risk / costly death evidence',tone:'bad',test:g=>Number(g.closing25?.highRiskDeaths||0)>0||Number(g.closing25?.costlyDeaths||0)>0,why:'At least one high-risk or measured costly death occurred after 25 minutes.'}
];

function arcFunnelCard(kind,label,games,transitions){
  const n=games.length,wins=games.filter(g=>g.win).length,valid=transitions.length,lateRisk=games.filter(g=>Number(g.closing25?.highRiskDeaths||0)>0||Number(g.closing25?.costlyDeaths||0)>0).length;
  if(!n)return '<article class="game-arc-funnel tone-neutral"><span>'+esc(label)+'</span><strong>No games</strong><p>No coaching-cohort game begins in this @15 role-gold band.</p></article>';
  let headline='',facts=[];
  if(kind==='ahead'){
    const retained=transitions.filter(x=>x.t.to.key==='ahead').length,lost=valid-retained;
    headline=valid?fmtPct(100*retained/valid)+' still ahead @25':'No comparable @25 follow-up';
    facts=[wins+'/'+n+' wins',retained+'/'+valid+' retained @25',lost+'/'+valid+' no longer ahead',lateRisk+'/'+n+' late-risk evidence'];
  }else if(kind==='behind'){
    const recovered=transitions.filter(x=>x.t.to.key!=='behind').length;
    headline=valid?fmtPct(100*recovered/valid)+' recovered out of behind':'No comparable @25 follow-up';
    facts=[wins+'/'+n+' wins',recovered+'/'+valid+' recovered by @25',lateRisk+'/'+n+' late-risk evidence'];
  }else{
    const ahead=transitions.filter(x=>x.t.to.key==='ahead').length,behind=transitions.filter(x=>x.t.to.key==='behind').length,close=transitions.filter(x=>x.t.to.key==='close').length;
    headline=valid?(ahead+' ahead · '+close+' close · '+behind+' behind @25'):'No comparable @25 follow-up';
    facts=[wins+'/'+n+' wins',ahead+'/'+valid+' created lead',behind+'/'+valid+' fell behind',lateRisk+'/'+n+' late-risk evidence'];
  }
  return '<article class="game-arc-funnel tone-'+(kind==='ahead'?'good':kind==='behind'?'bad':'neutral')+'"><span>'+esc(label)+' · '+n+' game'+(n===1?'':'s')+'</span><strong>'+esc(headline)+'</strong><div>'+facts.map(x=>'<b>'+esc(x)+'</b>').join('')+'</div><p>Descriptive selected-role state conversion; @15 and @25 refer to direct-role gold, not total team gold.</p></article>';
}

function matchEvidenceLedgerHtml(r,g){
  if(g.timelineAvailable!==true)return '<details class="history-ledger"><summary>Chronological evidence</summary><div class="history-ledger-empty">Timeline evidence is unavailable for this match.</div></details>';
  const peerOk=trustedDirectPeer(g),events=[],add=(time,kind,title,detail,tone='neutral',tab='')=>{
    if(!hasNum(time))return;
    events.push({time:Number(time),kind:String(kind||'evidence'),title:String(title||'Evidence'),detail:String(detail||''),tone,tab});
  };
  const reset=g.firstResetSequence;
  if(reset&&hasNum(reset.time)){
    let detail='Committed spend '+(hasNum(reset.spent)?fmtInt(reset.spent)+'g':'n/a');
    if(reset.spendApproximate)detail+=' · spend estimate approximate';
    if(peerOk&&reset.measured){
      if(reset.deathInWindow)detail+=' · post-reset economy comparison disrupted by death';
      else detail+=' · role gold swing '+(hasNum(reset.goldSwingAfter)?signed(reset.goldSwingAfter,0)+'g':'n/a')+' · CS swing '+(hasNum(reset.csSwingAfter)?signed(reset.csSwingAfter,1):'n/a');
    }else if(!peerOk)detail+=' · direct-role economy comparison withheld';
    add(reset.time,'reset','First meaningful shop',detail,reset.deathInWindow?'bad':reset.economyLoss?'bad':reset.economyGain?'good':'neutral','resets');
  }
  if(g.firstMajorItem&&hasNum(g.firstMajorItem.time)){
    const detail=(g.firstMajorItem.name||'First major item')+(peerOk&&hasNum(g.itemSpikeDeltaVsOpponent)?' · '+(Number(g.itemSpikeDeltaVsOpponent)<0?fmt(Math.abs(Number(g.itemSpikeDeltaVsOpponent)),1)+'m before role peer':Number(g.itemSpikeDeltaVsOpponent)>0?fmt(Math.abs(Number(g.itemSpikeDeltaVsOpponent)),1)+'m after role peer':'same minute as role peer'):'');
    add(g.firstMajorItem.time,'item','First major online',detail,peerOk&&hasNum(g.itemSpikeDeltaVsOpponent)?(Number(g.itemSpikeDeltaVsOpponent)<-.75?'good':Number(g.itemSpikeDeltaVsOpponent)>.75?'bad':'neutral'):'neutral','resets');
  }
  if(g.secondMajorItem&&hasNum(g.secondMajorItem.time)){
    const detail=(g.secondMajorItem.name||'Second major item')+(peerOk&&hasNum(g.secondMajorItemDeltaVsOpponent)?' · '+signed(g.secondMajorItemDeltaVsOpponent,1)+'m vs role peer':'');
    add(g.secondMajorItem.time,'item','Second major online',detail,'neutral','resets');
  }
  if(peerOk&&g.earlyLeadWindow?.eligible&&hasNum(g.earlyLeadWindow.peakMin)){
    const peak=Number(g.earlyLeadWindow.peakGoldDiff||0),give=!!g.earlyLeadWindow.giveback;
    add(g.earlyLeadWindow.peakMin,'lane','Measured early role lead peaked',signed(peak,0)+'g vs role peer'+(give?' · later gave back ≥500g by @15':' · no ≥500g give-back by @15'),give?'bad':'good','macro');
  }
  if(peerOk&&g?.phaseRules?.lane15Comparable!==false&&hasNum(g.goldDiff15)){
    const lane=arcRoleGoldState(g,15);
    add(15,'checkpoint','Role state @15',lane.label+' · '+signed(g.goldDiff15,0)+'g vs role peer',lane.tone,'macro');
  }
  if(hasNum(g.impactTimeMin)){
    const delta=peerOk&&hasNum(g.impactDeltaVsOpponent)?Number(g.impactDeltaVsOpponent):null;
    add(g.impactTimeMin,'impact','First tracked impact',String(g.impactType||'kill / assist / objective').replaceAll('_',' ')+(delta==null?'':delta<0?' · '+fmt(Math.abs(delta),1)+'m before role peer':delta>0?' · '+fmt(Math.abs(delta),1)+'m after role peer':' · same minute as role peer'),delta==null?'neutral':delta<-1.5?'good':delta>1.5?'bad':'neutral','macro');
  }
  if(peerOk&&g.itemSpikeWindow?.eligible){
    for(const ev of (g.itemSpikeWindow.events||[]).slice(0,3)){
      add(ev.time,'power window',ev.type==='objective'?'Earlier-item objective impact':'Earlier-item combat impact',ev.type==='objective'&&ev.objectiveType?String(ev.objectiveType):'Tracked before role-opponent first-major parity','good','resets');
    }
  }
  if(peerOk&&g?.phaseRules?.closing25Comparable!==false&&hasNum(g.goldDiff25)){
    const state25=arcRoleGoldState(g,25);
    add(25,'checkpoint','Role state @25',state25.label+' · '+signed(g.goldDiff25,0)+'g vs role peer',state25.tone,'macro');
  }

  // Risky deaths belong in the same chronological story as economy/item checkpoints.
  for(const d of (Array.isArray(g.badDeaths)?g.badDeaths:[]).slice(0,6)){
    const consequence=(g.deathConsequences?.events||[]).find(x=>hasNum(x.time)&&hasNum(d.time)&&Math.abs(Number(x.time)-Number(d.time))<=.04),tags=Array.isArray(d.tags)?d.tags:[];
    const detail=[
      d.zone?String(d.zone):'unknown zone',
      tags.length?tags.join(', '):'high-risk classification',
      hasNum(d.currentGold)?fmtInt(d.currentGold)+'g unspent':'',
      d.traded?('traded'+(hasNum(d.tradeDelaySec)?' in '+String(d.tradeDelaySec)+'s':'')):'untraded',
      consequence?.severe?'severe aftermath':consequence?.costly?'costly aftermath':'',
      consequence?.enemyObjectiveAfter?'enemy objective followed':'',
      consequence?.enemyStructureAfter?'enemy structure followed':''
    ].filter(Boolean).join(' · ');
    add(d.time,'risk death','High-risk death',detail,'bad','deaths');
  }

  // Show only supported contested-objective windows; fully conceded cross-map objectives are not coaching absences.
  for(const x of (g.objectiveReadiness?.events||[]).filter(x=>x.teamSecured||x.contested||x.present||x.absent).slice(0,8)){
    const result=x.teamSecured?'team secured':x.enemySecured?'enemy secured':'contested';
    const presence=x.earlySetup?'prior setup + present':x.eventFrameOnlyJoin?'event-frame-only join':x.present?'present':x.absent?'absent':'presence unknown';
    const detail=[
      String(x.objectiveType||'neutral objective'),
      result,
      presence,
      hasNum(x.setupLeadSec)&&x.earlySetup?('setup ~'+fmtInt(x.setupLeadSec)+'s before'):'',
      hasNum(x.secondsSinceShop)?('shop ended '+String(x.secondsSinceShop)+'s before'):'',
      x.recentDeath?'recent death before window':'',
      (x.recentShopAbsence??x.lateResetMiss)?'recent-shop absence':'',
      x.freshPurchaseJoin?'fresh purchase + joined':''
    ].filter(Boolean).join(' · ');
    const tone=x.absent&&x.enemySecured?'bad':x.teamSecured&&x.present?'good':'neutral';
    add(x.time,'objective','Contested '+String(x.objectiveType||'objective'),detail,tone,'objectives');
  }

  // Fight ledger uses active involvement only. Proximity-only clusters stay in the fight detail tab but cannot become execution judgments.
  for(const x of (g.fightProfile?.events||[]).filter(x=>x.active).slice(0,8)){
    const signal=x.diedBeforeContribution||x.firstAllyDeath||x.outnumbered||x.highUnspent||x.itemDisadvantage||x.goldDeficit;
    if(!signal&&!x.survived)continue;
    const outcome=x.survived?'survived':x.diedBeforeContribution?'died before contribution':x.firstAllyDeath?'first allied death':'died after contribution';
    const detail=[
      outcome,
      x.outnumbered?'locally outnumbered':'',
      x.highUnspent&&hasNum(x.currentGoldAtStart)?fmtInt(x.currentGoldAtStart)+'g unspent at start':'',
      x.itemDisadvantage?'major-item disadvantage':'',
      x.goldDeficit&&hasNum(x.goldDiffAtStart)?('role gold '+signed(x.goldDiffAtStart,0)+'g at start'):'',
      hasNum(x.kills)?String(x.kills)+' cluster kill'+(Number(x.kills)===1?'':'s'):''
    ].filter(Boolean).join(' · ');
    const tone=x.diedBeforeContribution||x.firstAllyDeath?'bad':x.survived?'good':'neutral';
    add(x.startMin,'fight','Active fight',detail,tone,'fights');
  }

  const reviewItems=(Array.isArray(r?.replayReviewQueue)?r.replayReviewQueue:[]).filter(x=>String(x.matchId||'')===String(g.matchId||''));
  reviewItems.forEach(x=>add(x.minute,'review #'+String(x.rank||''),x.title||'Ranked replay moment',x.evidence||'',Number(x.rank||999)<=3?'bad':'neutral',x.tab||'macro'));
  events.sort((a,b)=>a.time-b.time||String(a.title).localeCompare(String(b.title)));
  const seen=new Set(),unique=events.filter(x=>{const key=Math.round(x.time*20)+'|'+x.title.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).slice(0,20);
  if(!unique.length)return '<details class="history-ledger"><summary>Chronological evidence</summary><div class="history-ledger-empty">No supported key moments are available beyond the summary cards.</div></details>';
  return '<details class="history-ledger"><summary>Chronological evidence · '+unique.length+' key moment'+(unique.length===1?'':'s')+'</summary><div class="history-ledger-list">'+unique.map(x=>
    '<div class="history-ledger-row tone-'+x.tone+'"><time>'+esc(fmt(x.time,1))+'m</time><div><span>'+esc(x.kind)+'</span><strong>'+esc(x.title)+'</strong><p>'+esc(x.detail||'')+'</p></div>'+(x.tab?'<button class="button secondary tiny" type="button" data-ledger-review-match="'+esc(g.matchId||'')+'" data-ledger-review-tab="'+esc(x.tab)+'">Evidence</button>':'')+'</div>'
  ).join('')+'</div></details>';
}

function matchReplayReviewHtml(r,g){
  const items=(Array.isArray(r?.replayReviewQueue)?r.replayReviewQueue:[]).filter(x=>String(x.matchId||'')===String(g.matchId||'')).slice(0,2);
  if(!items.length)return '';
  return '<div class="history-review-cues"><div class="section-subhead"><strong>Best replay moments from this match</strong><span>Ranked by supported consequence</span></div>'+items.map(x=>
    '<article class="history-review-cue"><span>#'+esc(String(x.rank||''))+' overall · '+esc(fmt(x.minute,1))+'m · '+esc(x.category||'review')+'</span><strong>'+esc(x.title||'Replay moment')+'</strong><p>'+esc(x.evidence||'')+'</p><div><b>Question:</b> '+esc(x.prompt||'What decision would improve this sequence next time?')+'</div><button class="button secondary small" type="button" data-open-review-match="'+esc(g.matchId||'')+'" data-review-tab="'+esc(x.tab||'macro')+'">Open '+esc(x.tab||'macro')+' evidence</button></article>'
  ).join('')+'</div>';
}

function roleSequenceArc(g){
  const role=canonicalRole(g?.role),peerOk=trustedDirectPeer(g);
  if(role==='SUPPORT'){
    const roamAttempts=Number(g?.roams?.attempts||0),roamSuccesses=Number(g?.roams?.successes||0),roamRate=roamAttempts?100*roamSuccesses/roamAttempts:null,laneCost=perGameSupportAdcLaneCost(g);
    let roamKey='roam_unknown',roamLabel='Roam evidence thin',known=0;
    if(roamAttempts>0){known++;if(roamRate>=65&&(laneCost==null||laneCost>=-2)){roamKey='roam_value';roamLabel='Roam value preserved';}else if(roamRate<45&&laneCost!=null&&laneCost<=-6){roamKey='roam_cost';roamLabel='Roam cost without return';}else{roamKey='roam_mixed';roamLabel='Mixed roam return';}}
    const joined=Number(g?.objectiveReadiness?.contestedJoined||0),early=Number(g?.objectiveReadiness?.earlySetupJoins||0),setupRate=joined?100*early/joined:null;
    let setupKey='setup_unknown',setupLabel='Setup evidence thin';
    if(joined>0){known++;if(setupRate>=70){setupKey='setup_early';setupLabel='Early objective setup';}else if(setupRate<45){setupKey='setup_late';setupLabel='Late/no prior setup';}else{setupKey='setup_mixed';setupLabel='Mixed setup timing';}}
    const visionActions=Number(g?.visionMission?.actions||0),visionRisk=Number(g?.visionMission?.highRiskDeaths||0);
    let safetyKey='vision_unknown',safetyLabel='Vision safety thin';
    if(visionActions>0){known++;if(visionRisk>0){safetyKey='vision_risk';safetyLabel='High-risk vision death';}else{safetyKey='vision_safe';safetyLabel='No high-risk vision death';}}
    if(known<2)return null;
    return{key:['support',roamKey,setupKey,safetyKey].join('|'),label:[roamLabel,setupLabel,safetyLabel].join(' → '),role,known};
  }
  if(role==='JUNGLE'){
    const cs=peerOk&&hasNum(g?.peer?.csMinDelta)?Number(g.peer.csMinDelta):null,impact=peerOk&&hasNum(g?.impactDeltaVsOpponent)?Number(g.impactDeltaVsOpponent):null,joined=Number(g?.objectiveReadiness?.contestedJoined||0),early=Number(g?.objectiveReadiness?.earlySetupJoins||0),setupRate=joined?100*early/joined:null;
    let known=0,farmKey='farm_unknown',farmLabel='Farm peer evidence thin';
    if(cs!=null){known++;if(cs>.15){farmKey='farm_ahead';farmLabel='Farm ahead of Jungle peer';}else if(cs<-.15){farmKey='farm_behind';farmLabel='Farm behind Jungle peer';}else{farmKey='farm_close';farmLabel='Farm close to Jungle peer';}}
    let impactKey='impact_unknown',impactLabel='Impact timing thin';
    if(impact!=null){known++;if(impact<=-1.5){impactKey='impact_early';impactLabel='Earlier first impact';}else if(impact>=1.5){impactKey='impact_late';impactLabel='Later first impact';}else{impactKey='impact_close';impactLabel='Similar first-impact timing';}}
    let setupKey='setup_unknown',setupLabel='Setup evidence thin';
    if(joined>0){known++;if(setupRate>=70){setupKey='setup_early';setupLabel='Early objective setup';}else if(setupRate<45){setupKey='setup_late';setupLabel='Late/no prior setup';}else{setupKey='setup_mixed';setupLabel='Mixed setup timing';}}
    if(known<2)return null;
    return{key:['jungle',farmKey,impactKey,setupKey].join('|'),label:[farmLabel,impactLabel,setupLabel].join(' → '),role,known};
  }
  return null;
}
function gameArcDescriptor(g){
  return ['SUPPORT','JUNGLE'].includes(canonicalRole(g?.role))?roleSequenceArc(g):gameArcTransition(g);
}
function roleSequenceCoverageHtml(role,games){
  if(role==='SUPPORT'){
    const roam=games.filter(g=>Number(g?.roams?.attempts||0)>0).length,setup=games.filter(g=>Number(g?.objectiveReadiness?.contestedJoined||0)>0).length,vision=games.filter(g=>Number(g?.visionMission?.actions||0)>0).length;
    return '<div class="game-arc-funnel-grid">'+
      '<article class="game-arc-funnel tone-neutral"><span>Roam evidence</span><strong>'+roam+' / '+games.length+' games</strong><p>Detected early roam attempts with supported outcome context.</p></article>'+
      '<article class="game-arc-funnel tone-neutral"><span>Objective setup evidence</span><strong>'+setup+' / '+games.length+' games</strong><p>Games with joined neutral-objective encounters that can support prior-setup timing.</p></article>'+
      '<article class="game-arc-funnel tone-neutral"><span>Vision safety evidence</span><strong>'+vision+' / '+games.length+' games</strong><p>Games with tracked ward placement/clear actions for vision-risk context.</p></article>'+
    '</div>';
  }
  const farm=games.filter(g=>trustedDirectPeer(g)&&hasNum(g?.peer?.csMinDelta)).length,impact=games.filter(g=>trustedDirectPeer(g)&&hasNum(g?.impactDeltaVsOpponent)).length,setup=games.filter(g=>Number(g?.objectiveReadiness?.contestedJoined||0)>0).length;
  return '<div class="game-arc-funnel-grid">'+
    '<article class="game-arc-funnel tone-neutral"><span>Jungle farm peer evidence</span><strong>'+farm+' / '+games.length+' games</strong><p>Games with high-confidence direct-jungle CS/min comparison.</p></article>'+
    '<article class="game-arc-funnel tone-neutral"><span>First-impact evidence</span><strong>'+impact+' / '+games.length+' games</strong><p>Games with comparable first tracked impact timing versus the enemy Jungler.</p></article>'+
    '<article class="game-arc-funnel tone-neutral"><span>Objective setup evidence</span><strong>'+setup+' / '+games.length+' games</strong><p>Games with joined neutral-objective encounters that can support prior-setup timing.</p></article>'+
  '</div>';
}


function transitionWindowSignals(g){
  const out=new Set(),inside=v=>hasNum(v)&&Number(v)>15&&Number(v)<=25;
  const deathInsideFight=e=>(g.deathPositions||[]).some(d=>inside(d?.time)&&hasNum(e?.startMin)&&hasNum(e?.endMin)&&Number(d.time)>=Number(e.startMin)&&Number(d.time)<=Number(e.endMin));
  if((g.badDeaths||[]).some(x=>inside(x?.time)))out.add('High-risk death');
  if((g.deathRecovery?.events||[]).some(x=>inside(x?.secondMin)))out.add('Repeat death within 4m');
  if((g.fightProfile?.events||[]).some(x=>x?.active===true&&x?.diedBeforeContribution===true&&deathInsideFight(x)))out.add('Fight death before contribution');
  if((g.fightProfile?.events||[]).some(x=>x?.active===true&&x?.firstAllyDeath===true&&deathInsideFight(x)))out.add('First allied death in active fight');
  if((g.fightProfile?.events||[]).some(x=>x?.active===true&&hasNum(x?.currentGoldAtStart)&&Number(x.currentGoldAtStart)>=1000&&inside(x?.startMin)))out.add('Fight started with ≥1000g unspent');
  if((g.sideLaneRisk?.events||[]).some(x=>x?.neutralObjectiveSoon===true&&inside(x?.time)))out.add('Side-lane death before neutral objective');
  if((g.objectiveReadiness?.events||[]).some(x=>(x?.recentShopAbsence??x?.lateResetMiss)===true&&inside(x?.time)))out.add('Recent-shop objective absence');
  return out;
}
function transitionQuality(t){
  if(!t)return'neutral';
  const from=t.from?.key,to=t.to?.key,swing=Number(t.swing||0);
  if(from==='ahead'&&to!=='ahead')return'bad';
  if(from==='close'&&to==='behind')return'bad';
  if(from==='behind'&&to==='behind'&&swing<=-500)return'bad';
  if(from==='behind'&&to!=='behind')return'good';
  if(from==='close'&&to==='ahead')return'good';
  if(from==='ahead'&&to==='ahead'&&swing>=-250)return'good';
  return'neutral';
}
function transitionMatrixHtml(rows){
  const states=['ahead','close','behind'],labels={ahead:'Ahead',close:'Close',behind:'Behind'};
  return '<div class="transition-matrix-scroll" tabindex="0" role="region" aria-label="Scrollable 15 to 25 minute transition table"><table class="transition-matrix"><caption>'+rows.length+' paired role-opponent checkpoints · ahead >+100g; close −100g to +100g; behind <−100g</caption><thead><tr><th scope="col">15 → 25</th>'+states.map(s=>'<th scope="col">'+labels[s]+' @25</th>').join('')+'</tr></thead><tbody>'+
    states.map(from=>'<tr><th scope="row">'+labels[from]+' @15</th>'+states.map(to=>{
      const cell=rows.filter(x=>x.t.from.key===from&&x.t.to.key===to),good=cell.filter(x=>transitionQuality(x.t)==='good').length,bad=cell.filter(x=>transitionQuality(x.t)==='bad').length,neutral=cell.length-good-bad;
      const tone=!cell.length?'neutral':good&&bad?'mixed':bad&&!good&&!neutral?'bad':good&&!bad&&!neutral?'good':'neutral';
      return '<td class="transition-matrix-cell tone-'+tone+'"><strong>'+cell.length+'</strong><span>'+labels[from]+' → '+labels[to]+'</span>'+(cell.length?'<small>'+good+' favorable · '+bad+' deteriorating · '+neutral+' other</small>':'<small>No paired games</small>')+'</td>';
    }).join('')+'</tr>').join('')+'</tbody></table></div>';
}
function renderTransitionPrecursors(r){
  const box=$('gameArcPrecursors');if(!box)return;
  const role=reportSelectedRole(r),games=reportCoachingGames(r);
  if(['SUPPORT','JUNGLE'].includes(role)){
    box.innerHTML='<div class="section-subhead"><strong>Transition-window precursors</strong><span>Not forced onto '+esc(roleLabel(role))+'</span></div><div class="bullet empty">The @15→@25 direct-role gold-state precursor model is intentionally withheld for '+esc(roleLabel(role))+' because the role-specific sequence model above is the more defensible frame.</div>';
    return;
  }
  const transitions=games.map(g=>({g,t:gameArcTransition(g)})).filter(x=>x.t),bad=transitions.filter(x=>transitionQuality(x.t)==='bad'),other=transitions.filter(x=>transitionQuality(x.t)!=='bad');
  const labels=['High-risk death','Repeat death within 4m','Fight death before contribution','First allied death in active fight','Fight started with ≥1000g unspent','Side-lane death before neutral objective','Recent-shop objective absence'];
  const rows=labels.map(label=>{
    const badN=bad.filter(x=>transitionWindowSignals(x.g).has(label)).length,otherN=other.filter(x=>transitionWindowSignals(x.g).has(label)).length,badRate=bad.length?100*badN/bad.length:null,otherRate=other.length?100*otherN/other.length:null;
    return{label,badN,otherN,badRate,otherRate,delta:hasNum(badRate)&&hasNum(otherRate)?Number(badRate)-Number(otherRate):null};
  }).filter(x=>x.badN>=2).sort((a,b)=>b.badN-a.badN||Number(b.delta||0)-Number(a.delta||0));
  box.innerHTML='<div class="section-subhead"><div><span>State-transition analysis</span><strong>What happens between the @15 and @25 role states?</strong></div><small>Matrix + 15→25 event-window co-occurrence. Signals are not treated as causes.</small></div>'+
    transitionMatrixHtml(transitions)+
    '<div class="section-subhead transition-precursor-head"><div><span>Deteriorating-transition context</span><strong>Signals that recur inside the 15→25 window</strong></div><small>Deteriorating = lead lost, close→behind, or a behind state that worsens by ≥500g.</small></div>'+
    (bad.length?'<div class="transition-precursor-grid">'+(rows.length?rows.map(x=>'<article class="transition-precursor-card"><span>'+x.badN+' / '+bad.length+' deteriorating transitions</span><strong>'+esc(x.label)+'</strong><p>'+esc(fmtPct(x.badRate))+' of deteriorating-transition games vs '+esc(other.length?fmtPct(x.otherRate):'no comparison cohort')+(hasNum(x.delta)?' · '+esc(signed(x.delta,1))+' pp difference':'')+'.</p><small>Co-occurrence only. Replay the event sequence before attributing the state change to this signal.</small></article>').join(''):'<div class="bullet empty">No single supported 15→25 event signal recurs in at least two deteriorating transitions.</div>')+'</div>':'<div class="bullet empty">No comparable game currently meets the deteriorating-transition definition.</div>')+
    '<p class="source-note">This closes the gap between an aggregate transition and the events worth reviewing. It deliberately excludes after-25 signals and never says a flagged event caused the gold-state movement.</p>';
}

function renderGameArcs(r){
  const funnelBox=$('gameArcFunnels'),patternBox=$('gameArcPatterns'),turnBox=$('gameArcTurningPoints'),note=$('gameArcNote');if(!funnelBox||!patternBox||!turnBox)return;
  const games=reportCoachingGames(r),role=canonicalRole(r?.dataQuality?.selectedRole||r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||state.selectedRole),roleSequence=['SUPPORT','JUNGLE'].includes(role);
  if(roleSequence){
    const descriptors=games.map(g=>({g,t:roleSequenceArc(g)})).filter(x=>x.t),groups=new Map();
    descriptors.forEach(({g,t})=>{const row=groups.get(t.key)||{key:t.key,label:t.label,games:[]};row.games.push(g);groups.set(t.key,row);});
    const repeated=[...groups.values()].filter(x=>x.games.length>=2).sort((a,b)=>b.games.length-a.games.length||String(a.label).localeCompare(String(b.label))).slice(0,6);
    funnelBox.innerHTML='<div class="section-subhead"><strong>'+esc(roleLabel(role))+' sequence coverage</strong><span>Role-relevant evidence replaces the carry-lane @15→@25 gold funnel</span></div>'+roleSequenceCoverageHtml(role,games)+'<div class="section-subhead arc-repeat-head"><strong>Repeated '+esc(roleLabel(role))+' sequences</strong><span>Only shown when the same role-specific sequence appears in at least 2 games</span></div>';
    patternBox.innerHTML=repeated.length?repeated.map(x=>{
      const wins=x.games.filter(g=>g.win).length,wr=100*wins/x.games.length,timeline=x.games.filter(g=>g.timelineAvailable===true).length;
      return '<article class="game-arc-pattern"><span>Repeated role sequence · '+x.games.length+' games</span><strong>'+esc(x.label)+'</strong><div class="arc-pattern-stats"><b>'+esc(fmtPct(wr))+' wins</b><b>'+timeline+'/'+x.games.length+' timelines</b></div><p>This sequence combines role-relevant supported states. Outcome is context only; the sequence is not treated as a cause of the result.</p><button class="button secondary small arc-review-button" type="button" data-review-arc="'+esc(x.key)+'">Review these '+x.games.length+' games</button></article>';
    }).join(''):'<div class="bullet empty">No '+esc(roleLabel(role))+' role sequence repeats at least twice with enough supported components yet.</div>';
    patternBox.querySelectorAll('[data-review-arc]').forEach(btn=>btn.addEventListener('click',()=>{
      state.matchHistoryArcKey=String(btn.dataset.reviewArc||'');state.matchHistoryFilter='arc';state.matchHistoryLimit=10;renderMatchHistory(r);
      $('match-history')?.scrollIntoView({behavior:'auto',block:'start'});
    }));
  }else{
    const transitions=games.map(g=>({g,t:gameArcTransition(g)})).filter(x=>x.t),by15={ahead:games.filter(g=>arcRoleGoldState(g,15).key==='ahead'),close:games.filter(g=>arcRoleGoldState(g,15).key==='close'),behind:games.filter(g=>arcRoleGoldState(g,15).key==='behind')},transFor=key=>transitions.filter(x=>x.t.from.key===key);
    funnelBox.innerHTML='<div class="section-subhead"><strong>Advantage conversion</strong><span>What happens after the @15 role state?</span></div><div class="game-arc-funnel-grid">'+
      arcFunnelCard('ahead','Ahead @15',by15.ahead,transFor('ahead'))+
      arcFunnelCard('close','Close @15',by15.close,transFor('close'))+
      arcFunnelCard('behind','Behind @15',by15.behind,transFor('behind'))+
    '</div><div class="section-subhead arc-repeat-head"><strong>Repeated @15 → @25 transitions</strong><span>Only shown when the same transition appears in at least 2 games</span></div>';
    const groups=new Map();
    transitions.forEach(({g,t})=>{const row=groups.get(t.key)||{key:t.key,label:t.label,games:[],swings:[]};row.games.push(g);row.swings.push(t.swing);groups.set(t.key,row);});
    const repeated=[...groups.values()].filter(x=>x.games.length>=2).sort((a,b)=>b.games.length-a.games.length||String(a.label).localeCompare(String(b.label))).slice(0,6);
    patternBox.innerHTML=repeated.length?repeated.map(x=>{
      const wins=x.games.filter(g=>g.win).length,wr=100*wins/x.games.length,avgSwing=x.swings.reduce((a,b)=>a+b,0)/x.swings.length,lateRiskGames=x.games.filter(g=>Number(g.closing25?.highRiskDeaths||0)>0||Number(g.closing25?.costlyDeaths||0)>0).length;
      return '<article class="game-arc-pattern"><span>Repeated transition · '+x.games.length+' games</span><strong>'+esc(x.label)+'</strong><div class="arc-pattern-stats"><b>'+esc(fmtPct(wr))+' wins</b><b>'+esc(signed(avgSwing,0))+'g avg 15→25 swing</b><b>'+lateRiskGames+' late-risk game'+(lateRiskGames===1?'':'s')+'</b></div><p>Outcome and risk are shown as context. The transition itself is direct-role gold state, not whole-team game state.</p><button class="button secondary small arc-review-button" type="button" data-review-arc="'+esc(x.key)+'">Review these '+x.games.length+' games</button></article>';
    }).join(''):'<div class="bullet empty">No @15→@25 role-state transition repeats at least twice inside the current coaching cohort yet.</div>';
    patternBox.querySelectorAll('[data-review-arc]').forEach(btn=>btn.addEventListener('click',()=>{
      state.matchHistoryArcKey=String(btn.dataset.reviewArc||'');state.matchHistoryFilter='arc';state.matchHistoryLimit=10;renderMatchHistory(r);
      $('match-history')?.scrollIntoView({behavior:'auto',block:'start'});
    }));
  }

  const timelineGames=games.filter(g=>g.timelineAvailable===true);
  const turning=ARC_TURNING_POINT_DEFS.map(d=>{
    const hit=timelineGames.filter(g=>d.test(g)),miss=timelineGames.filter(g=>!d.test(g)),wins=hit.filter(g=>g.win).length,missWins=miss.filter(g=>g.win).length;
    const withWr=hit.length?100*wins/hit.length:null,withoutWr=miss.length?100*missWins/miss.length:null,associationReady=hit.length>=3&&miss.length>=3,winRateDelta=associationReady?Number(withWr)-Number(withoutWr):null;
    return {...d,count:hit.length,wins,withoutCount:miss.length,withoutWins:missWins,withWr,withoutWr,associationReady,winRateDelta};
  }).filter(x=>x.count>=2).sort((a,b)=>b.count-a.count||String(a.label).localeCompare(String(b.label))).slice(0,7);
  turnBox.innerHTML='<div class="section-subhead"><strong>Recurring turning-point evidence</strong><span>Recurring at ≥2 games · outcome association needs ≥3 with and ≥3 without</span></div>'+
    (turning.length?'<div class="arc-turning-grid">'+turning.map(x=>{
      const association=x.associationReady?('Win rate '+fmtPct(x.withWr)+' with vs '+fmtPct(x.withoutWr)+' without · '+signed(x.winRateDelta,1)+' points'):(fmtPct(x.withWr)+' wins in '+x.count+' games with signal · comparison withheld ('+x.withoutCount+' without)');
      return '<article class="arc-turning-card tone-'+x.tone+'"><span>'+x.count+' / '+timelineGames.length+' timeline games</span><strong>'+esc(x.label)+'</strong><p>'+esc(x.why)+'</p><small>'+esc(association)+' · descriptive association only, not causation</small></article>';
    }).join('')+'</div>':'<div class="bullet empty">No defined turning-point signal repeats in at least two coaching-cohort games.</div>');
  renderTransitionPrecursors(r);
  if(note)note.textContent=roleSequence
    ?'Coaching cohort: '+games.length+' '+roleLabel(role)+' games. Aggregate arc patterns use role-specific supported sequences instead of carry-lane gold states. Turning-point counts are games containing supported evidence, not raw event totals.'
    :'Coaching cohort: '+games.length+' games · comparable @15→@25 transitions: '+games.filter(g=>gameArcTransition(g)).length+'. Turning-point counts are games containing supported evidence, not raw event totals. Older-mechanics context-only games are excluded when the backend applies a mechanics cohort.';
}
function matchHistoryRoleMetric(g,role){
  const r=canonicalRole(role||g?.role),peerOk=trustedDirectPeer(g);
  if(r==='SUPPORT'){
    const delta=peerOk&&hasNum(g?.peer?.vpmDelta)?Number(g.peer.vpmDelta):null;
    if(delta!=null){
      const bucket=delta>.15?'positive':delta<-.15?'negative':'neutral';
      return{label:'VPM vs Support',value:signed(delta,2),tone:bucket==='positive'?'good':bucket==='negative'?'bad':'neutral',bucket,known:true,
        copy:'Vision score per minute relative to the actual opposing Support.'};
    }
    return{label:'Vision / min',value:hasNum(g?.vpm)?fmt(g.vpm,2):'n/a',tone:'neutral',bucket:'unknown',known:false,
      copy:'Direct Support peer comparison is unavailable; raw VPM is context only.'};
  }
  if(r==='JUNGLE'){
    const impact=peerOk&&hasNum(g?.impactDeltaVsOpponent)?Number(g.impactDeltaVsOpponent):null;
    if(impact!=null){
      const bucket=impact<=-1.5?'positive':impact>=1.5?'negative':'neutral';
      return{label:'1st impact vs Jungle',value:signed(impact,1)+'m',tone:bucket==='positive'?'good':bucket==='negative'?'bad':'neutral',bucket,known:true,
        copy:'Negative timing means your first tracked kill/assist/objective impact occurred earlier than the enemy Jungler.'};
    }
    const cs=peerOk&&hasNum(g?.peer?.csMinDelta)?Number(g.peer.csMinDelta):null;
    if(cs!=null){
      const bucket=cs>.15?'positive':cs<-.15?'negative':'neutral';
      return{label:'CS/min vs Jungle',value:signed(cs,2),tone:bucket==='positive'?'good':bucket==='negative'?'bad':'neutral',bucket,known:true,
        copy:'Direct-jungle farm rate relative to the actual opposing Jungler.'};
    }
    return{label:'Jungle peer state',value:'n/a',tone:'neutral',bucket:'unknown',known:false,copy:'No trusted direct-jungle comparison is available.'};
  }
  const lane=matchHistoryLaneState(g);
  return{label:'Role gold @15',value:lane.label,tone:lane.tone,bucket:lane.tone==='good'?'positive':lane.tone==='bad'?'negative':lane.label.includes('unavailable')?'unknown':'neutral',known:!lane.label.includes('unavailable'),copy:lane.copy};
}
function matchHistoryRoleFilterLabels(role){
  const r=canonicalRole(role);
  if(r==='SUPPORT')return{positive:'Vision edge',neutral:'Vision close',negative:'Vision behind'};
  if(r==='JUNGLE')return{positive:'Earlier impact',neutral:'Similar impact',negative:'Later impact'};
  return{positive:'Ahead @15',neutral:'Close @15',negative:'Behind @15'};
}
function matchHistoryLaneState(g){
  if(!trustedDirectPeer(g))return {tone:'neutral',label:'Peer withheld',copy:'The direct-role opponent could not be resolved with high-confidence Riot role evidence, so role-relative @15 coaching is withheld.'};
  if(g?.phaseRules?.lane15Comparable===false||!hasNum(g.goldDiff15))return {tone:'neutral',label:'@15 unavailable',copy:'No role-comparable 15-minute gold checkpoint is available for this game.'};
  const d=Number(g.goldDiff15);
  if(gameMatchesNamedFilter(g,'ahead15'))return {tone:'good',label:signed(d,0)+'g @15',copy:'This game is in the same ahead-at-15 band used by the evidence-table filter.'};
  if(gameMatchesNamedFilter(g,'behind15'))return {tone:'bad',label:signed(d,0)+'g @15',copy:'This game is in the same behind-at-15 band used by the evidence-table filter.'};
  return {tone:'neutral',label:signed(d,0)+'g @15',copy:'This game is in the same close-at-15 band used by the evidence-table filter.'};
}
function matchHistorySignals(g){
  const role=canonicalRole(g?.role),roleMetric=matchHistoryRoleMetric(g,role),out=[],fight=g.fightProfile||{},death=g.deathConsequences||{},recovery=g.deathRecovery||{};
  out.push({label:roleMetric.label,value:roleMetric.value,tone:roleMetric.tone,copy:roleMetric.copy});
  if(g.timelineAvailable!==true){
    out.push({label:'Risk cost',value:'Not measurable',tone:'neutral',copy:'Timeline evidence is unavailable, so this game cannot be treated as having zero high-risk deaths.'});
  }else if(Number(g.badDeathCount||0)>0||Number(death.costly||0)>0){
    const n=Number(g.badDeathCount||0),cost=Number(death.costly||0),measured=Number(death.measured||0);
    out.push({label:'Risk cost',value:n+' high-risk · '+cost+' costly',tone:(n>=2||cost>=2)?'bad':'neutral',copy:'High-risk classification uses timeline context; costly aftermath is measured for '+measured+' death'+(measured===1?'':'s')+' in this game.'});
  }else{
    const measured=Number(death.measured||0),deaths=Number(g.deaths||0),coverage=deaths?measured+'/'+deaths+' consequences measured':'no deaths';
    out.push({label:'Risk cost',value:'No flagged high-risk death',tone:deaths===0||measured>=deaths?'good':'neutral',copy:'Timeline review found no high-risk death flags; '+coverage+'. Missing consequence coverage is not treated as proof of no cost.'});
  }
  const activeFights=Number(fight.active??fight.attended??0);
  if(activeFights>0){
    const pre=Number(fight.diedBeforeContribution||0),surv=hasNum(fight.survivalRate)?fmtPct(fight.survivalRate):'n/a';
    out.push({label:'Fight uptime',value:pre+' pre-impact deaths · '+surv+' survival',tone:pre>0?'bad':'good',copy:'Execution rates use active fight involvement only; proximity-only clusters remain positioning context and are excluded from survival/contribution judgments.'});
  }
  if(g.firstMajorItem){
    out.push({label:'First major',value:String(g.firstMajorItem.name||'Item')+' · '+fmt(g.firstMajorItem.time,1)+'m',tone:'neutral',copy:'Item timing is shown as a power-window checkpoint, not treated as good or bad without opponent/context evidence.'});
  }
  if(Number(recovery.opportunities||0)>0){
    out.push({label:'Death recovery',value:String(recovery.repeatDeaths||0)+' / '+String(recovery.opportunities||0)+' rapid repeats',tone:Number(recovery.repeatDeaths||0)>0?'bad':'good',copy:'A repeat death means another death inside the measured recovery window after a prior death.'});
  }
  return out.slice(0,5);
}
function judgmentMatchesPracticeTheme(j,theme){
  if(!j||!theme)return false;
  const wanted=new Set(practiceReplayCategories(theme)),category=String(j.category||'').toLowerCase(),mapped=[];
  const add=x=>mapped.push(x);
  if(category==='resets'){add('resets');add('item spike');}
  if(category==='item spike')add('item spike');
  if(category==='mid routing'||category==='mid game')add('mid routing');
  if(category==='laning'||category==='lane conversion'||category==='map awareness'){add('early lead');add('matchup');}
  if(category==='lead protection'||category==='closing'){add('lead protection');add('early lead');}
  if(category==='objectives'||category==='side-lane timing')add('objective setup');
  if(category==='teamfights'||category==='fighting'||category==='resource conversion')add('teamfights');
  if(category==='fight selection'||category==='fight readiness'){add('fight selection');add('teamfights');}
  if(['deaths','death consequences','death recovery','post-play discipline'].includes(category)){add('death consequences');add('lead protection');}
  if(category==='vision safety')add('vision safety');
  if(category==='roaming')add('roaming');
  return mapped.some(x=>wanted.has(x));
}
function matchHistoryJudgment(g,r){
  const xs=Array.isArray(g.judgments)?g.judgments:[],theme=topPracticeThemes(r)[0]||null,focusMatch=currentPriorityReplayIds(r).has(String(g.matchId||''));
  const focus=focusMatch?xs.filter(x=>judgmentMatchesPracticeTheme(x,theme)).sort((a,b)=>Number(a.priority||99)-Number(b.priority||99))[0]:null;
  const improve=xs.find(x=>x&&x.tone!=='strength'),strength=xs.find(x=>x&&x.tone==='strength'),x=focus||improve||strength||xs[0];
  if(!x)return {tone:'neutral',title:'No high-confidence game judgment',evidence:'The game remains visible, but the analyzer did not have enough supported evidence for a specific action judgment.',action:'',focusMatched:false};
  return {tone:x.tone==='strength'?'good':'bad',title:String(x.title||x.category||'Game insight'),evidence:String(x.evidence||''),action:String(x.action||''),focusMatched:!!focus};
}
function matchHistoryRow(g,index,displayIndex,r){
  const peerOk=trustedDirectPeer(g),icon=championIcon(g.champion),opp=peerOk?championIcon(g.peer?.champion):'',role=canonicalRole(r?.dataQuality?.selectedRole||r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||g?.role||state.selectedRole),roleMetric=matchHistoryRoleMetric(g,role),judge=matchHistoryJudgment(g,r),signals=matchHistorySignals(g),coachingContext=gameIsCoachingContext(r,g),detailId='match-history-detail-'+index,focusMatch=currentPriorityReplayIds(r).has(String(g.matchId||''));
  const reviewItems=(Array.isArray(r?.replayReviewQueue)?r.replayReviewQueue:[]).filter(x=>String(x.matchId||'')===String(g.matchId||'')),reviewRank=reviewItems.length?Math.min(...reviewItems.map(x=>Number(x.rank||999)).filter(Number.isFinite)):null;
  const kda=[g.kills,g.deaths,g.assists].map(x=>hasNum(x)?Number(x):'?').join('/');
  const title=(g.win?'Win':'Loss')+' · '+String(g.champion||'Unknown');
  return '<article class="match-history-row tone-'+(g.win?'good':'bad')+(coachingContext?'':' context-only')+(focusMatch?' focus-match':'')+'" data-history-index="'+index+'">'+
    '<button class="match-history-toggle" type="button" aria-expanded="false" aria-controls="'+detailId+'">'+
      '<span class="history-rank">#'+(displayIndex+1)+'</span>'+
      '<span class="history-champions">'+(icon?'<img loading="lazy" src="'+esc(icon)+'" alt="">':'')+'<span><b>'+esc(title)+(coachingContext?'':' <em class="history-context-badge">context only</em>')+'</b><small>'+esc(shortGameDate(g.gameStartTimestamp))+' · '+esc(g.role||'')+(peerOk&&g.peer?.champion?' · vs '+esc(g.peer.champion):g.peer?.champion?' · role peer withheld':'')+(coachingContext?'':' · older mechanics excluded from coaching aggregates')+'</small></span>'+(opp?'<img class="history-opponent" loading="lazy" src="'+esc(opp)+'" alt="">':'')+'</span>'+
      '<span class="history-stat"><small>K/D/A</small><b>'+esc(kda)+'</b></span>'+
      '<span class="history-stat tone-'+roleMetric.tone+'"><small>'+esc(roleMetric.label)+'</small><b>'+esc(roleMetric.value)+'</b></span>'+
      '<span class="history-judgment tone-'+judge.tone+'"><small>'+(judge.focusMatched?'Current-focus read':'Strongest read')+(reviewRank!=null?' · review #'+esc(String(reviewRank)):'')+(focusMatch&&!judge.focusMatched?' · current focus game':'')+'</small><b>'+esc(judge.title)+'</b></span>'+
      '<span class="history-chevron" aria-hidden="true">▾</span>'+
    '</button>'+
    '<div class="match-history-detail" id="'+detailId+'" hidden>'+
      gameArcStripHtml(g)+
      '<div class="history-signal-grid">'+signals.map(x=>'<div class="history-signal tone-'+x.tone+'"><span>'+esc(x.label)+'</span><strong>'+esc(x.value)+'</strong><p>'+esc(x.copy)+'</p></div>').join('')+'</div>'+
      '<div class="history-coaching-read tone-'+judge.tone+'"><span>'+(judge.focusMatched?'Current-focus coaching read':'Game-level coaching read')+'</span><strong>'+esc(judge.title)+'</strong><p>'+esc(judge.evidence||'No additional evidence sentence was generated.')+'</p>'+(judge.action?'<div><b>Next time:</b> '+esc(judge.action)+'</div>':'')+'</div>'+
      matchEvidenceLedgerHtml(r,g)+
      matchReplayReviewHtml(r,g)+
      '<div class="history-actions"><button class="button secondary small" type="button" data-open-full-match="'+esc(g.matchId||'')+'">Open full match evidence</button><small>Full evidence includes macro, resets, vision, fights, phases, deaths, objectives and map context.</small></div>'+
    '</div>'+
  '</article>';
}
function renderMatchHistory(r){
  const list=$('matchHistoryList'),summary=$('matchHistorySummary'),toggle=$('matchHistoryToggle'),filters=$('matchHistoryFilters'),filterSummary=$('matchHistoryFilterSummary');if(!list||!summary)return;
  const sourceGames=[...reportCoachingGames(r)].filter(g=>gameIsCoachingContext(r,g)),role=canonicalRole(r?.dataQuality?.selectedRole||r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||state.selectedRole),roleFilterLabels=matchHistoryRoleFilterLabels(role),reviewIds=new Set((Array.isArray(r.replayReviewQueue)?r.replayReviewQueue:[]).map(x=>String(x.matchId||'')).filter(Boolean)),priorityIds=currentPriorityReplayIds(r),arcKey=String(state.matchHistoryArcKey||''),arcGames=arcKey?sourceGames.filter(g=>gameArcDescriptor(g)?.key===arcKey):[],arcLabel=arcGames.length?(gameArcDescriptor(arcGames[0])?.label||'Selected game arc'):'Selected game arc',objectiveFamilyKey=String(state.matchHistoryObjectiveFamilyKey||''),objectiveFamilyIds=objectiveFamilyKey?objectiveFamilyMatchIds(r,objectiveFamilyKey):new Set(),objectiveFamilyLabelText=objectiveFamilyKey?objectiveFamilyLabel(objectiveFamilyKey):'Objective family';
  const counts={
    all:sourceGames.length,
    win:sourceGames.filter(g=>g.win).length,
    loss:sourceGames.filter(g=>!g.win).length,
    'role-positive':sourceGames.filter(g=>matchHistoryRoleMetric(g,role).bucket==='positive').length,
    'role-neutral':sourceGames.filter(g=>matchHistoryRoleMetric(g,role).bucket==='neutral').length,
    'role-negative':sourceGames.filter(g=>matchHistoryRoleMetric(g,role).bucket==='negative').length,
    risk:sourceGames.filter(g=>g.timelineAvailable===true&&(Number(g.badDeathCount||0)>0||Number(g.deathConsequences?.costly||0)>0)).length,
    review:sourceGames.filter(g=>reviewIds.has(String(g.matchId||''))).length,
    priority:sourceGames.filter(g=>priorityIds.has(String(g.matchId||''))).length,
    arc:arcGames.length,
    'objective-family':sourceGames.filter(g=>objectiveFamilyIds.has(String(g.matchId||''))).length
  };
  let filter=String(state.matchHistoryFilter||'all');
  if(filter==='ahead15')filter='role-positive';
  if(filter==='even15')filter='role-neutral';
  if(filter==='behind15')filter='role-negative';
  state.matchHistoryFilter=filter;
  if(filter==='priority'&&Number(counts.priority||0)===0){filter='all';state.matchHistoryFilter='all';}
  if(filter==='arc'&&Number(counts.arc||0)===0){filter='all';state.matchHistoryFilter='all';state.matchHistoryArcKey='';}
  if(filter==='objective-family'&&Number(counts['objective-family']||0)===0){filter='all';state.matchHistoryFilter='all';state.matchHistoryObjectiveFamilyKey='';}
  const matchFilter=g=>{
    if(filter==='win')return !!g.win;
    if(filter==='loss')return !g.win;
    if(filter==='role-positive'||filter==='role-neutral'||filter==='role-negative')return matchHistoryRoleMetric(g,role).bucket===filter.replace('role-','');
    if(filter==='risk')return g.timelineAvailable===true&&(Number(g.badDeathCount||0)>0||Number(g.deathConsequences?.costly||0)>0);
    if(filter==='review')return reviewIds.has(String(g.matchId||''));
    if(filter==='priority')return priorityIds.has(String(g.matchId||''));
    if(filter==='arc')return gameArcDescriptor(g)?.key===arcKey;
    if(filter==='objective-family')return objectiveFamilyIds.has(String(g.matchId||''));
    return true;
  };
  const filteredGames=sourceGames.filter(matchFilter),limit=Math.min(Math.max(1,Number(state.matchHistoryLimit||10)),Math.max(1,filteredGames.length)),games=filteredGames.slice(0,limit);
  if(filters){
    filters.querySelectorAll('[data-history-filter]').forEach(btn=>{
      const key=btn.dataset.historyFilter||'all',active=key===filter;
      btn.classList.toggle('active-filter',active);btn.setAttribute('aria-pressed',active?'true':'false');
      const base=key==='all'?'All':key==='win'?'Wins':key==='loss'?'Losses':key==='role-positive'?roleFilterLabels.positive:key==='role-neutral'?roleFilterLabels.neutral:key==='role-negative'?roleFilterLabels.negative:key==='risk'?'Risk flagged':key==='priority'?'Current focus':key==='arc'?'Arc: '+arcLabel:key==='objective-family'?objectiveFamilyLabelText:'Replay priority';
      if(key==='priority')btn.hidden=Number(counts.priority||0)===0;else if(key==='arc')btn.hidden=filter!=='arc'||Number(counts.arc||0)===0;else if(key==='objective-family')btn.hidden=filter!=='objective-family'||Number(counts['objective-family']||0)===0;else btn.hidden=false;
      btn.textContent=base+' · '+String(counts[key]??0);
      btn.onclick=()=>{state.matchHistoryFilter=key;state.matchHistoryLimit=10;renderMatchHistory(r);};
    });
  }
  if(filterSummary){
    const label=filter==='all'?'full recent sample':filter==='risk'?'timeline-supported risk-flagged games':filter==='review'?'games with ranked replay moments':filter==='priority'?'games with ranked replay moments matching '+currentPriorityReplayLabel(r):filter==='arc'?'games matching '+arcLabel:filter==='objective-family'?'games with a contested '+objectiveFamilyLabelText+' window':filter==='win'?'wins':filter==='loss'?'losses':filter==='role-positive'?roleFilterLabels.positive.toLowerCase()+' games':filter==='role-neutral'?roleFilterLabels.neutral.toLowerCase()+' games':roleFilterLabels.negative.toLowerCase()+' games';
    filterSummary.textContent='Showing '+filteredGames.length+' / '+sourceGames.length+' '+label+'. Filters change only visible rows, never report calculations.';
  }
  if(toggle){
    const canExpand=filteredGames.length>10;
    toggle.hidden=!canExpand;
    toggle.textContent=limit>=filteredGames.length?'Show newest 10':'Show all '+Math.min(20,filteredGames.length);
    toggle.onclick=()=>{state.matchHistoryLimit=limit>=filteredGames.length?10:Math.min(20,filteredGames.length);renderMatchHistory(r);};
  }
  if(!games.length){
    summary.innerHTML='<small>No matches in this filter. The underlying report sample is unchanged.</small>';
    list.innerHTML='<div class="bullet empty">No recent comparable matches match this story filter.</div>';
    return;
  }
  const wins=games.filter(g=>g.win).length,positive=games.filter(g=>matchHistoryRoleMetric(g,role).bucket==='positive').length,negative=games.filter(g=>matchHistoryRoleMetric(g,role).bucket==='negative').length;
  const timelineGames=games.filter(g=>g.timelineAvailable===true),risky=timelineGames.reduce((n,g)=>n+Number(g.badDeathCount||0),0),coachingGames=reportCoachingGames(r);
  const mechanicsNote=r.dataQuality?.mechanicsCohortApplied===true?' · coaching aggregates use '+coachingGames.length+'/'+String((r.games||[]).length)+' current-mechanics games':'';
  summary.innerHTML='<span><b>'+wins+'–'+(games.length-wins)+'</b> visible result</span><span><b>'+positive+'</b> '+esc(roleFilterLabels.positive.toLowerCase())+'</span><span><b>'+negative+'</b> '+esc(roleFilterLabels.negative.toLowerCase())+'</span><span><b>'+risky+'</b> flagged high-risk deaths</span><small>Showing newest '+games.length+' of '+filteredGames.length+' filtered · '+sourceGames.length+' total comparable '+esc(roleLabel(role))+' games · risk evidence '+timelineGames.length+'/'+games.length+' visible timelines'+esc(mechanicsNote)+'</small>';
  list.innerHTML=games.map((g,i)=>matchHistoryRow(g,i,i,r)).join('');
  list.querySelectorAll('.match-history-toggle').forEach(btn=>btn.addEventListener('click',()=>{
    const row=btn.closest('.match-history-row'),detail=row?.querySelector('.match-history-detail');if(!detail)return;
    const open=detail.hidden;detail.hidden=!open;btn.setAttribute('aria-expanded',open?'true':'false');row.classList.toggle('open',open);
  }));
  list.querySelectorAll('[data-open-full-match]').forEach(btn=>btn.addEventListener('click',ev=>{
    ev.stopPropagation();const matchId=btn.dataset.openFullMatch;if(matchId)openReplayReviewMatch(matchId,'macro');
  }));
  list.querySelectorAll('[data-open-review-match]').forEach(btn=>btn.addEventListener('click',ev=>{
    ev.stopPropagation();const matchId=btn.dataset.openReviewMatch,tab=btn.dataset.reviewTab||'macro';if(matchId)openReplayReviewMatch(matchId,tab);
  }));
  list.querySelectorAll('[data-ledger-review-match]').forEach(btn=>btn.addEventListener('click',ev=>{
    ev.stopPropagation();const matchId=btn.dataset.ledgerReviewMatch,tab=btn.dataset.ledgerReviewTab||'macro';if(matchId)openReplayReviewMatch(matchId,tab);
  }));
}
function renderGames(r){
  const games=r.games||[],role=canonicalRole(r?.dataQuality?.selectedRole||r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||state.selectedRole),carryGoldRole=['ADC','MID','TOP'].includes(role);
  state.openMatch=null;
  if(!carryGoldRole&&['ahead15','even15','behind15'].includes(state.gameFilter))state.gameFilter='all';
  const goldSortButton=document.querySelector('[data-game-sort="gold15"]');
  if(goldSortButton)goldSortButton.textContent=carryGoldRole?'Gold @15 vs role':'Gold @15 vs role · context';
  const championSelect=$('gameChampionFilter');
  if(championSelect){
    const champions=[...new Set(games.map(g=>String(g.champion||'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    championSelect.innerHTML='<option value="all">All champions</option>'+champions.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');
    if(!champions.includes(state.gameChampion))state.gameChampion='all';
    championSelect.value=state.gameChampion;
  }
  const championScoped=state.gameChampion==='all'?games:games.filter(g=>String(g.champion||'')===state.gameChampion);
  const filterLabels={all:'All',win:'Wins',loss:'Losses',ahead15:'Ahead @15',even15:'Close @15',behind15:'Behind @15'};
  document.querySelectorAll('[data-game-filter]').forEach(btn=>{
    const key=String(btn.dataset.gameFilter||'all'),laneBand=['ahead15','even15','behind15'].includes(key);
    btn.hidden=laneBand&&!carryGoldRole;
    const count=key==='all'?championScoped.length:championScoped.filter(g=>gameMatchesNamedFilter(g,key)).length;
    btn.innerHTML=esc(filterLabels[key]||key)+' <span class="filter-count">'+count+'</span>';
  });
  const filtered=games.map((g,i)=>({g,i})).filter(x=>gamePassesFilter(x.g));
  $('gameCountLabel').textContent=(filtered.length===games.length?games.length+' games':filtered.length+' shown · '+games.length+' eligible');
  const filterSummary=$('gameFilterSummary');if(filterSummary)filterSummary.textContent=filtered.length===games.length?'Showing the full sample.':'Filters narrow the table only; report metrics still use the full eligible sample.';
  const order=filtered.sort((a,b)=>{
    const av=gameSortValue(a.g,state.gameSort.key,a.i),bv=gameSortValue(b.g,state.gameSort.key,b.i),dir=state.gameSort.dir==='asc'?1:-1;
    if(typeof av==='string'||typeof bv==='string')return String(av).localeCompare(String(bv))*dir;
    return (Number(av)-Number(bv))*dir||a.i-b.i;
  });
  $('gamesBody').innerHTML=order.length?order.map(({g,i},displayIndex)=>{
    const kda=[g.kills,g.deaths,g.assists].map(x=>hasNum(x)?Number(x):'?').join('/');
    const icon=championIcon(g.champion),peerTrusted=trustedDirectPeer(g),peerChampion=peerTrusted?String(g.peer?.champion||''):'',peerIcon=peerChampion?championIcon(peerChampion):'',peerOk=peerTrusted&&g?.phaseRules?.lane15Comparable!==false,goldTone=carryGoldRole&&peerOk?deltaTone(g.goldDiff15,0,100,false):'neutral';
    const firstItem=g.firstMajorItem,itemSrc=firstItem?itemIcon(firstItem.itemId):'';
    const goldLabel=!peerOk?'peer withheld':!hasNum(g.goldDiff15)?'n/a':carryGoldRole?(Number(g.goldDiff15)>100?'ahead':Number(g.goldDiff15)<-100?'behind':'even'):'context only';
    const rowLabel=[g.champion||'Unknown',peerChampion?'vs '+peerChampion:'',g.win?'win':'loss',shortGameDate(g.gameStartTimestamp)].filter(Boolean).join(' · ');
    return '<tr class="game-row" data-match="'+esc(g.matchId||String(i))+'" data-index="'+i+'" tabindex="0" role="button" aria-expanded="false" aria-label="Open match details · '+esc(rowLabel)+'">'+
      '<td class="caret"><span class="caret-arrow" aria-hidden="true">▸</span> <small>'+(displayIndex+1)+'</small></td>'+
      '<td><div class="champion-cell">'+(icon?'<img class="champion-icon" loading="lazy" src="'+esc(icon)+'" alt="">':'')+
        '<span><b>'+esc(g.champion||'Unknown')+'</b>'+(firstItem?'<small class="table-item">'+(itemSrc?'<img loading="lazy" src="'+esc(itemSrc)+'" alt="">':'')+esc(firstItem.name||'First major')+' · '+esc(fmt(firstItem.time,1))+'m</small>':'')+'</span></div></td>'+
      '<td><div class="champion-cell opponent-cell">'+(peerIcon?'<img class="champion-icon" loading="lazy" src="'+esc(peerIcon)+'" alt="">':'')+'<span><b>'+esc(peerChampion||'Peer unavailable')+'</b><small>'+(peerTrusted?'same-role opponent':'comparison withheld')+'</small></span></div></td>'+
      '<td class="result '+(g.win?'win':'loss')+'"><b>'+(g.win?'WIN':'LOSS')+'</b></td>'+
      '<td><strong>'+esc(kda)+'</strong></td>'+
      '<td>'+esc(fmtPct(g.kp))+'</td>'+
      '<td>'+esc(fmt(g.csMin,2))+'</td>'+
      '<td>'+esc(fmtInt(g.dpm))+'</td>'+
      '<td><div class="table-delta tone-'+goldTone+'"><strong>'+esc(peerOk&&hasNum(g.goldDiff15)?signed(g.goldDiff15,0)+'g':'n/a')+'</strong><small>'+esc(goldLabel)+'</small>'+(peerOk?contextBar(g.goldDiff15,1200):'')+'</div></td></tr>';
  }).join(''):'<tr class="games-empty-row"><td colspan="9">No games match the current filters.</td></tr>';
  $('gamesBody').querySelectorAll('.game-row').forEach(row=>{
    const open=()=>toggleGame(Number(row.dataset.index));
    row.addEventListener('click',open);
    row.addEventListener('keydown',ev=>{if(ev.key==='Enter'||ev.key===' '){ev.preventDefault();open();}});
  });
  document.querySelectorAll('[data-game-filter]').forEach(btn=>{
    const active=String(btn.dataset.gameFilter||'all')===state.gameFilter;
    btn.classList.toggle('active-filter',active);
    btn.setAttribute('aria-pressed',active?'true':'false');
  });
  if($('clearGameFilters'))$('clearGameFilters').disabled=state.gameFilter==='all'&&state.gameChampion==='all';
  document.querySelectorAll('[data-game-sort]').forEach(btn=>{
    const active=String(btn.dataset.gameSort||'')===state.gameSort.key;
    btn.classList.toggle('active-sort',active);
    btn.dataset.sortDir=active?state.gameSort.dir:'';
    btn.setAttribute('aria-sort',active?(state.gameSort.dir==='asc'?'ascending':'descending'):'none');
  });
}

function toggleGame(index){
  const body=$('gamesBody'),rows=[...body.querySelectorAll('.game-row')];
  body.querySelectorAll('.details-row').forEach(n=>n.remove());
  rows.forEach(r=>{const c=r.querySelector('.caret-arrow');if(c)c.textContent='▸';r.setAttribute('aria-expanded','false');});
  if(state.openMatch===index){state.openMatch=null;return;}
  const game=state.report.games[index],row=rows.find(r=>Number(r.dataset.index)===index);if(!game||!row)return;
  state.openMatch=index;const arrow=row.querySelector('.caret-arrow');if(arrow)arrow.textContent='▾';row.setAttribute('aria-expanded','true');
  const tr=document.createElement('tr');tr.className='details-row';const td=document.createElement('td');td.colSpan=9;td.innerHTML=detailsHtml(game,index);tr.appendChild(td);row.insertAdjacentElement('afterend',tr);
  bindDetailTabs(tr,game,index);bindMapFallbacks(tr);
}
function judgmentHtml(g){
  const xs=Array.isArray(g.judgments)?g.judgments:[];
  if(!xs.length)return '<div class="game-judgments empty-judgment">No high-confidence action judgment for this game.</div>';
  return '<div class="game-judgments">'+xs.map(x=>'<article class="game-judgment '+(x.tone==='strength'?'strength':'improve')+'">'+
    '<div class="game-judgment-head"><span>'+esc(x.category||'analysis')+'</span><strong>'+esc(x.title||'Insight')+'</strong></div>'+
    '<p>'+esc(x.evidence||'')+'</p>'+(x.action?'<p class="game-action"><b>Next time:</b> '+esc(x.action)+'</p>':'')+'</article>').join('')+'</div>';
}
function detailsHtml(g,index){
  return '<div class="details-shell">'+matchVisualHeader(g)+judgmentHtml(g)+'<div class="details-tabs">'+['map','macro','resets','vision','roams','fights','phases','deaths','objectives'].map(t=>'<button class="tab-btn '+(state.activeDetailTab===t?'active':'')+'" data-tab="'+t+'" type="button">'+t[0].toUpperCase()+t.slice(1)+'</button>').join('')+'</div><div class="details-content" data-detail-content>'+detailContent(g,state.activeDetailTab)+'</div></div>';
}
function objectiveDiagnosisLabel(key){
  return ({recent_shop_absence:'Recent-shop absence pattern',late_reset:'Recent-shop absence pattern (legacy report)',pre_objective_death:'Death before the contest',setup_vision:'Setup-vision deficit',arrival_pathing:'Arrival / pathing'})[String(key||'')]||'No supported primary explanation';
}
function objectiveEvidenceClassLabel(x){
  const key=String(x?.evidenceClass||'');
  if(key==='direct_event_sequence')return'Direct event sequence';
  if(key==='peer_relative_gap')return'Peer-relative comparison';
  if(key==='timing_association')return'Timing association only';
  return x&&hasNum(x.severity)?'Legacy evidence ranking':'Supported clue';
}
function objectiveDiagnosisHtml(r){
  const d=r?.behaviorSummary?.objectiveDiagnosis||{},causes=Array.isArray(d.causes)?d.causes:[];
  if(!d.presenceLow&&!causes.length)return '<div class="detail-note">Objective presence is not currently flagged low enough for an evidence-based explanation.</div>';
  const primaryKey=d.primaryExplanation??d.primaryCause;
  const primary=primaryKey?objectiveDiagnosisLabel(primaryKey):'Arrival / pathing remains the unresolved hypothesis';
  return '<div class="objective-diagnosis"><div class="diagnosis-primary"><span>Highest-confidence supported clue</span><strong>'+esc(primary)+'</strong></div>'+
    (causes.length?'<ol>'+causes.map(x=>'<li><strong>'+esc(x.label||objectiveDiagnosisLabel(x.key))+'</strong><span>'+esc(x.evidence||'')+'</span><small>'+esc(objectiveEvidenceClassLabel(x))+'</small></li>').join('')+'</ol>':
    '<p>No shop/death/vision signal crossed its evidence threshold. Arrival/pathing remains a hypothesis rather than a proven cause.</p>')+
    '<small class="diagnosis-caveat">Clues are ordered by evidence specificity first, then by magnitude within the same evidence class. Different evidence types are not forced onto one numeric severity scale, and none proves a single cause.</small></div>';
}
function reportPhaseRules(g){
  const r=g?.phaseRules||{};
  return{
    key:r.key||'legacy',
    season:r.season||'unknown',
    phaseComparable:r.phaseComparable!==false,
    lane15Comparable:r.lane15Comparable!==false,
    fixed15to25Comparable:r.fixed15to25Comparable!==false,
    closing25Comparable:r.closing25Comparable!==false,
    earlyEndMin:hasNum(r.earlyEndMin)?Number(r.earlyEndMin):14,
    lateStartMin:hasNum(r.lateStartMin)?Number(r.lateStartMin):20,
    baronSpawnMin:hasNum(r.baronSpawnMin)?Number(r.baronSpawnMin):null,
    elderSpawnMin:hasNum(r.elderSpawnMin)?Number(r.elderSpawnMin):null,
    suddenDeathMin:hasNum(r.suddenDeathMin)?Number(r.suddenDeathMin):null,
    patchMinor:hasNum(r.patchMinor)?Number(r.patchMinor):null,
    publicPatchKey:r.publicPatchKey||null,
    laneRoleQuestsEnabled:r.laneRoleQuestsEnabled,
    roleQuestRevision:r.roleQuestRevision||null,
    sourceBasis:r.sourceBasis||''
  };
}
function roleQuestText(g){
  const q=g?.roleQuestContext||{};
  if(q.enabled===null)return'Unverified future mechanics';
  if(q.enabled===false)return q.known===true?'Not standard lane-role quests in this queue':'Historical / not back-applied';
  return [q.reward||'2026 role quest',q.detail||''].filter(Boolean).join(' · ');
}
function roleQuestNote(g){
  const q=g?.roleQuestContext||{};
  if(!q||(!q.note&&!q.checkpointEffect&&!q.spendEstimateCaveat))return'';
  const parts=[q.note,q.checkpointEffect];
  if(q.spendEstimateCaveat)parts.push('Support Control Ward spend can be approximate after quest completion because the timeline does not expose a universal completion timestamp; static catalog price is not silently rewritten.');
  return '<div class="detail-note"><strong>Role-quest context:</strong> '+esc(parts.filter(Boolean).join(' '))+'</div>';
}
function plateTierText(x){
  const p=x||{};
  return 'outer '+String(p.outer??0)+' · inner '+String(p.inner??0)+' · inhibitor '+String(p.inhibitor??0)+' · nexus '+String(p.nexus??0)+(Number(p.unknown||0)?' · unknown '+String(p.unknown):'');
}
function modernOrLegacy(obj,modernKey,legacyKey,fallback=0){
  const m=obj?.[modernKey];if(m!==null&&m!==undefined)return m;
  const l=obj?.[legacyKey];return l!==null&&l!==undefined?l:fallback;
}
function detailCard(label,value){return'<div class="detail-card"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>';}
function resetSpendText(r){
  if(!r)return'n/a';
  const lo=r.spentLowerBound,hi=r.spentUpperBound,raw=r.spent;
  if(r.spendApproximate&&hasNum(lo)&&hasNum(hi)&&Math.abs(Number(hi)-Number(lo))>.01)return fmtInt(lo)+'–'+fmtInt(hi)+'g est.';
  if(r.spendApproximate)return'~'+fmtInt(hasNum(hi)?hi:raw)+'g est.';
  return fmtInt(raw)+'g';
}
function resetSpendEvidenceText(r){
  if(!r)return'n/a';
  const caveats=String(r.spendEstimateCaveat||'').split('|').filter(Boolean),parts=[];
  if(caveats.includes('support_quest_control_ward_discount_unobserved'))parts.push('Support ward quest-discount timing is not exposed');
  if(caveats.includes('riot_zero_id_item_undo_unresolvable'))parts.push('Riot supplied an undo event without resolvable item IDs');
  if(Number(r.unresolvedUndoCount||0)>0&&!parts.some(x=>x.includes('undo')))parts.push(String(r.unresolvedUndoCount)+' unresolved undo event(s)');
  return parts.length?parts.join(' · '):'Committed purchases + recipe-owned component credit';
}
function detailList(items,empty){
  const xs=(items||[]).filter(Boolean);
  return '<div class="detail-note">'+(xs.length?'<ul>'+xs.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':esc(empty||'No events detected.'))+'</div>';
}
function detailContent(g,tab){
  if(tab==='map')return perGameSpatialHtml(g);
  if(tab==='vision'){
    const v=g.vision||{},peerOk=g.directPeerComparable===true;
    const vm=g.visionMission||{};
    return detailCard('Vision / min',fmt(g.vpm,2))+detailCard('Wards placed',String(v.wardCount??g.wards?.length??0))+detailCard('Control Wards bought',String(v.controlWardPurchases??0))+detailCard('Control Wards placed',String(v.controlWardCount??0))+detailCard('Wards / 30 min',fmt(v.wardsPer30,1))+
      detailCard('Vision actions',String(vm.actions??0))+detailCard('Vision-action deaths',String(vm.deaths??0)+' · '+fmtPct(vm.deathRate))+
      detailCard('High-risk vision deaths',String(vm.highRiskDeaths??0)+' · '+fmtPct(vm.highRiskDeathRate))+detailCard('Unsupported vision deaths',String(vm.unsupportedDeaths??0))+
      detailCard('Untraded vision deaths',String(vm.untradedDeaths??0))+detailCard('Objective-setup vision deaths',String(vm.objectiveSetupDeaths??0))+
      detailCard('Offensive / defensive',String(v.offensive??0)+' / '+String(v.defensive??0))+detailCard('River wards',String(v.river??0))+detailCard('Objective setup wards',String(v.objectiveSetup??0))+detailCard('Objective setup ward clears',String(v.objectiveSetupClears??0))+detailCard('Objective setup share',fmtPct(v.objectiveSetupRate))+
      detailCard('Peer setup wards',peerOk?String(g.opponentVision?.objectiveSetup??0):'n/a')+detailCard('Peer setup share',peerOk?fmtPct(g.opponentVision?.objectiveSetupRate):'n/a')+detailCard('Setup count Δ vs peer',peerOk&&hasNum(v.objectiveSetupDeltaVsOpponent)?signed(v.objectiveSetupDeltaVsOpponent,0):'n/a')+detailCard('Setup share Δ vs peer',peerOk&&hasNum(v.objectiveSetupRateDeltaVsOpponent)?signed(v.objectiveSetupRateDeltaVsOpponent,0)+' points':'n/a')+
      detailList((vm.events||[]).map(x=>(Number(x.time)||0).toFixed(1)+'m death · '+String(x.action||'vision action')+' '+String(x.secondsAfterAction??'?')+'s earlier · '+String(x.wardType||'ward')+(x.territory?' · '+x.territory:'')+(x.objectiveSetup?' · objective setup':'')+(x.unsupported?' · no ally within 3k':'')+(x.highRisk?' · high-risk':'')+(x.traded?' · traded':' · untraded')),'No death occurred within the defined vision-action window.')+
      detailList((g.wards||[]).slice(0,8).map(w=>(Number(w.time)||0).toFixed(1)+'m · '+(w.territory||'unknown')+' · '+(w.wardType||'ward')),'No player ward positions were available.');
  }
  if(tab==='roams'){
    const r=g.roams||{},events=r.events||[];
    const kills=events.reduce((n,x)=>n+Number((x.playerKillAssists??(x.killOrAssist?1:0))||0),0),deaths=events.reduce((n,x)=>n+Number((x.playerDeaths??(x.death?1:0))||0),0),obj=events.reduce((n,x)=>n+Number((x.objectivePresent??(x.objective?1:0))||0),0),away=events.reduce((n,x)=>n+Number(x.objectiveAway||0),0);
    return detailCard('Attempts',String(r.attempts??0))+detailCard('Successful',String(r.successes??0))+detailCard('Failed',String(r.failures??0))+
      detailCard('Roam K/A / deaths',String(kills)+' / '+String(deaths))+detailCard('Objectives joined / while away',String(obj)+' / '+String(away))+
      detailList(events.map((x,i)=>'Roam '+String(i+1)+' · '+(Number(x.startMin)||0).toFixed(1)+'–'+(Number(x.endMin)||0).toFixed(1)+'m · '+(x.targetZone||'map')+' · '+(x.outcome||'neutral')+(roamEvidenceText(x)?' · '+roamEvidenceText(x):'')),'No qualifying early roam departures were detected inside this queue’s configured roam window.')+
      '<div class="detail-note">V21 parity upgrade: each roam keeps its Riot-frame departure/path/return plus kill/assist, death, neutral-objective, structure/plate and lane-cost evidence. Objective success requires supported player presence. Plate/turret losses count as roam cost only when they occur in the player’s home lane, avoiding unrelated map-wide structure losses.</div>';
  }
  if(tab==='fights'){
    const f=g.fightProfile||{},events=f.events||[],active=Number(f.active??f.attended??0),present=Number(f.present??f.attended??0),nearOnly=Number(f.proximityOnly||0);
    return detailCard('Active fight involvements',String(active))+detailCard('Supported fight presence',String(present))+detailCard('Proximity-only presence',String(nearOnly))+
      detailCard('Position-supported teamfight clusters',String(f.positionSupportedTeamFightClusters??0))+detailCard('Tracked teamfight absences',String(f.trackedAbsentTeamFights??0))+
      detailCard('First allied death · active fights',String(f.firstAllyDeaths??0)+' · '+fmtPct(f.firstAllyDeathRate))+
      detailCard('Died before contribution · active fights',String(f.diedBeforeContribution??0)+' · '+fmtPct(f.diedBeforeContributionRate))+detailCard('Fight survival · active fights',fmtPct(f.survivalRate))+
      detailCard('≥1000g unspent active starts',String(f.highUnspentStarts??0)+' · '+fmtPct(f.highUnspentStartRate))+detailCard('Major-item disadvantage active starts',String(f.itemDisadvantageStarts??0)+' · '+fmtPct(f.itemDisadvantageStartRate))+
      detailCard('≥600g role deficit active starts',String(f.goldDeficitStarts??0)+' · '+fmtPct(f.goldDeficitStartRate))+
      detailCard('Locally outnumbered · active starts',String(f.outnumberedStarts??0)+' · '+fmtPct(f.outnumberedStartRate))+detailCard('Loss rate while outnumbered · active fights',fmtPct(f.outnumberedLossRate))+
      detailList(events.slice(0,10).map(x=>(Number(x.startMin)||0).toFixed(1)+'–'+(Number(x.endMin)||0).toFixed(1)+'m · '+String(x.kills||0)+' kills · '+(x.proximityOnly?'nearby only · no tracked contribution/death':x.survived?'active · survived':x.firstAllyDeath?'active · first ally death':x.diedBeforeContribution?'active · died before contribution':'active · died after contribution')+
        (x.active&&hasNum(x.currentGoldAtStart)?' · '+fmtInt(x.currentGoldAtStart)+'g unspent':'')+(x.active&&hasNum(x.goldDiffAtStart)?' · role gold '+signed(x.goldDiffAtStart,0)+'g':'')+(x.active&&x.itemDisadvantage?' · opponent major item first':'')),'No supported multi-kill fight presence was detected.')+
      detailList((f.absenceEvents||[]).slice(0,8).map(x=>(Number(x.startMin)||0).toFixed(1)+'–'+(Number(x.endMin)||0).toFixed(1)+'m · '+String(x.kills||0)+' kill events · position-supported teamfight absence'),'No position-supported teamfight absences were detected.')+
      '<div class="detail-note">Fight presence and fight execution are deliberately separate. Proximity-only clusters remain visible as positioning context, but survival, first-death, readiness, numbers and contribution rates use only active fights where Riot records your death or kill/assist contribution. Tracked teamfight absence requires a team-involved multi-kill cluster, event coordinates, a supported player position frame, no tracked contribution/death and no ≤5000 proximity evidence; it does not claim the player should have joined.</div>';
  }
  if(tab==='phases'){
    const p=g.phaseBehavior||{},rules=reportPhaseRules(g),phase=(key,label)=>{
      const x=p[key]||{};
      return '<div class="detail-note"><strong>'+esc(label)+'</strong><ul>'+
        '<li>'+esc(String(x.deaths??0))+' deaths · '+esc(String(x.highRiskDeaths??0))+' high-risk · '+esc(String(x.costlyDeaths??0))+' costly · '+esc(String(x.severeDeaths??0))+' severe</li>'+
        '<li>'+esc(String(x.killAssistImpacts??0))+' kill/assist impacts · '+esc(String(x.objectiveJoins??0))+' / '+esc(String(x.teamObjectives??0))+' neutral-objective encounters joined'+(Number(x.teamObjectives||0)>0?' · '+esc(fmtPct(100*Number(x.objectiveJoins||0)/Number(x.teamObjectives)))+' presence':'')+'</li>'+
        '<li>'+esc(String(x.fightClusters??0))+' active fight clusters · '+esc(String(x.firstAllyFightDeaths??0))+' first-allied-death events</li>'+
      '</ul></div>';
    };
    const collapsed=rules.earlyEndMin>=rules.lateStartMin;
    const body=phase('early',(collapsed?'Pre-major-objective':'Early')+' · <'+rules.earlyEndMin+':00')+
      (collapsed?'':phase('mid','Transition · '+rules.earlyEndMin+':00–<'+rules.lateStartMin+':00'))+
      phase('late','Late / major-objective era · ≥'+rules.lateStartMin+':00');
    const anchors=[hasNum(rules.baronSpawnMin)?'Baron '+rules.baronSpawnMin+':00':null,hasNum(rules.elderSpawnMin)?'Elder '+rules.elderSpawnMin+':00':null,hasNum(rules.suddenDeathMin)?'Sudden Death '+rules.suddenDeathMin+':00':null].filter(Boolean).join(' · ');
    return body+'<div class="detail-note">Rules profile: '+esc(rules.key)+(anchors?' · '+esc(anchors):'')+'. '+(rules.phaseComparable?'Aggregate phase-risk rates are normalized per 10 minutes of actual phase exposure.':'This historical/future rules profile is kept visible but excluded from current phase-to-phase coaching comparisons.')+'</div>';
  }
  if(tab==='deaths'){
    const bad=g.badDeaths||[];
    const pre=g.preObjectiveDeaths||[];
    const risk=g.riskStateDeaths||{};
    const dq=g.deathQuality||{},legacy=dq.legacyBruisienator||{},evidence=dq.evidence||{};
    return detailCard('Deaths',String(g.deaths??'n/a'))+detailCard('Bruisienator V21 DQI · effective pipeline',hasNum(legacy.effectivePipelineScore??legacy.score)?fmt(legacy.effectivePipelineScore??legacy.score,1)+'/10':'n/a')+detailCard('Death-consequence coverage',hasNum(evidence.consequenceCoveragePct)?String(evidence.measuredConsequences??0)+' / '+String(evidence.deaths??g.deaths??0)+' · '+fmtPct(evidence.consequenceCoveragePct):'n/a')+detailCard('Economy samples suppressed by repeat death',String(g.deathConsequences?.economySamplesContaminated??0))+detailCard('All isolated deaths',String(g.isolatedDeathCount??evidence.isolatedDeaths??0))+detailCard('Flagged high-risk',String(g.badDeathCount??0))+detailCard('Deaths while ≥500g ahead',String(g.leadDeathCount??0))+detailCard('High-risk deaths while ahead',String(g.highRiskLeadDeathCount??0))+
      detailCard('Deaths while ≥500g behind',String(risk.behind??0))+detailCard('High-risk deaths while behind',String(risk.highRiskBehind??0)+' · '+(Number(risk.behind||0)>0?fmtPct(100*Number(risk.highRiskBehind||0)/Number(risk.behind)):'n/a'))+
      detailCard('Post-macro-transition side-lane deaths',String(g.sideLaneRisk?.macroTransitionSideLaneDeaths??g.sideLaneRisk?.postLaneSideLaneDeaths??g.sideLaneRisk?.post15SideLaneDeaths??0))+
      detailCard('Isolated side-lane deaths',String(g.sideLaneRisk?.isolatedSideLaneDeaths??0))+
      detailCard('Pre-objective side-lane deaths',String(g.sideLaneRisk?.preNeutralObjectiveSideLaneDeaths??0))+
      detailCard('Post-impact deaths',String(g.postImpactRisk?.deathsWithin30s??0)+' · '+fmtPct(g.postImpactRisk?.ratePerImpact))+
      detailCard('High-risk untraded post-impact',String(g.postImpactRisk?.highRiskUntradedDeathsWithin30s??0))+
      detailCard('Objective-context deaths',fmtPct(g.objectiveDeathPct))+detailCard('Pre-objective conversions',String(g.preObjectiveDeathCount??0))+detailCard('≥1000 unspent gold deaths',String(g.highUnspentGoldDeaths??0))+
      detailCard('Costly measured deaths',String(g.deathConsequences?.costly??0)+' / '+String(g.deathConsequences?.measured??0)+' · '+fmtPct(g.deathConsequences?.costlyRate))+
      detailCard('Rapid repeat deaths',String(g.deathRecovery?.repeatDeaths??0)+' / '+String(g.deathRecovery?.opportunities??0)+' · '+fmtPct(g.deathRecovery?.rate))+
      detailCard('High-risk repeat deaths',String(g.deathRecovery?.highRiskRepeatDeaths??0))+detailCard('Costly repeat deaths',String(g.deathRecovery?.costlyRepeatDeaths??0))+
      detailCard('Opponent repeat-death rate',fmtPct(g.opponentDeathRecovery?.rate))+
      detailCard('Severe consequence deaths',String(g.deathConsequences?.severe??0))+detailCard('Untraded costly deaths',String(g.deathConsequences?.untradedCostly??0))+
      detailCard('Avg role-gold swing after death',hasNum(g.deathConsequences?.avgGoldSwing)?signed(g.deathConsequences.avgGoldSwing,0)+'g':'n/a')+
      detailCard('Avg role-CS swing after death',hasNum(g.deathConsequences?.avgCsSwing)?signed(g.deathConsequences.avgCsSwing,1):'n/a')+
      detailList(bad.map(x=>(Number(x.time)||0).toFixed(1)+'m · '+String(x.zone||'unknown')+' · '+(x.tags||[]).join(', ')+' · '+fmtInt(x.currentGold)+'g unspent · nearby '+String(x.alliesNear??0)+' ally / '+String(x.enemiesNear??0)+' enemy · '+(x.traded?('traded in '+String(x.tradeDelaySec??'?')+'s'):'untraded')),'No death crossed the multi-signal bad-death threshold.')+
      detailList((g.leadDeaths||[]).map(x=>(Number(x.time)||0).toFixed(1)+'m · '+signed(x.goldDiffAtDeath,0)+'g vs role at death'+(hasNum(x.goldSwingAfter)?' · '+signed(x.goldSwingAfter,0)+'g role-diff swing after':'')+(x.highRisk?' · high-risk':'')+(x.enemyObjectiveAfter?' · enemy objective followed':'')),'No materially-ahead death was recorded.')+
      detailList((risk.events||[]).filter(x=>x.state==='behind').map(x=>(Number(x.time)||0).toFixed(1)+'m · '+signed(x.goldDiffAtDeath,0)+'g vs role · '+(x.highRisk?'high-risk':'not high-risk')+(x.traded?' · traded':' · untraded')+(x.enemyObjectiveAfter?' · enemy objective followed':'')+(hasNum(x.goldSwingAfter)?' · '+signed(x.goldSwingAfter,0)+'g role-diff swing after':'')),'No death was recorded while ≥500g behind the direct role opponent.')+
      detailList((g.postImpactRisk?.events||[]).map(x=>(Number(x.deathTime)||0).toFixed(1)+'m death · '+String(x.secondsAfterImpact??'?')+'s after own kill/assist'+(x.highRisk?' · high-risk':'')+(x.traded?' · traded':' · untraded')+(x.enemyObjectiveAfter?' · enemy objective followed':'')),'No death occurred within 30 seconds after your own kill/assist contribution.')+
      detailList((g.sideLaneRisk?.events||[]).map(x=>(Number(x.time)||0).toFixed(1)+'m · '+String(x.zone||'side lane')+(x.isolated?' · isolated':'')+(x.neutralObjectiveSoon?' · neutral objective '+String(x.secondsBeforeNeutralObjective??'?')+'s later':'')+(x.highRisk?' · high-risk':'')+(x.traded?' · traded':' · untraded')),'No post-macro-transition side-lane death detected.')+
      detailList((g.deathConsequences?.events||[]).filter(x=>x.costly).map(x=>(Number(x.time)||0).toFixed(1)+'m · '+(x.severe?'severe':'costly')+(hasNum(x.goldSwingAfter)?' · role gold '+signed(x.goldSwingAfter,0)+'g':'')+(hasNum(x.csSwingAfter)?' · role CS '+signed(x.csSwingAfter,0):'')+(x.enemyObjectiveAfter?' · enemy objective followed':'')+(x.enemyStructureAfter?' · nearby/same-lane enemy structure followed':'')+(x.economyWindowContaminatedByRepeatDeath?' · economy sample suppressed: repeat death':'')+(x.traded?' · traded':' · untraded')),'No measured death crossed the consequence threshold.')+
      detailList((g.deathRecovery?.events||[]).map(x=>Number(x.firstMin).toFixed(1)+'→'+Number(x.secondMin).toFixed(1)+'m · '+String(x.gapSec)+'s'+(x.phase?' · '+x.phase:'')+(x.highRisk?' · high-risk':'')+(x.costly?' · costly':'')+(x.severe?' · severe':'')+(x.traded?' · traded':' · untraded')),'No second death occurred within four minutes of the previous death.')+
      detailList(pre.map(x=>(Number(x.time)||0).toFixed(1)+'m death → contested '+String(x.objectiveType||'objective')+' '+String(x.secondsBeforeObjective||'?')+'s later'),'No death was followed by an enemy-secured, team-contested objective within 75 seconds.')+
      '<div class="detail-note"><strong>DQI provenance:</strong> the uploaded V21 HTML defines a five-input DQI, but its supplied PowerShell pipeline emits only <code>badDeaths</code>. This compatibility value reproduces the effective generated V21 behavior instead of inventing four missing inputs. Current coaching uses the individual risk and consequence evidence above, not a replacement composite score.</div>';
  }
  if(tab==='objectives'){
    const kc=g.killConversion||{},okc=g.opponentKillConversion||{},families=g.objectiveFamilyStats||{},peerOk=g.directPeerComparable===true;
    const familyRows=Object.entries(families).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))).map(([name,x])=>String(name).replaceAll('_',' ')+' · contested '+String(x.joinedContestedEncounters??0)+' / '+String(x.contestedEncounters??0)+' joined · '+fmtPct(x.contestPresenceRate)+' · secured-presence '+String(x.joinedTeamEncounters??0)+' / '+String(x.teamEncounters??0)+' · secured units '+String(x.teamUnitsSecured??0)+' vs '+String(x.enemyUnitsSecured??0));
    return detailCard('Team-contested objective presence',fmtPct(g.objectiveContestPresenceRate))+detailCard('Joined / contested encounters',String(g.objectiveContestJoined??0)+' / '+String(g.objectiveContestTotal??0))+
      detailCard('Team-secured objective presence',fmtPct(g.objectiveJoinRate))+detailCard('Joined / secured encounters',String(g.objectiveJoined??0)+' / '+String(g.objectiveTeamTotal??0))+detailCard('Early KP',fmtPct(g.earlyKp))+
      detailCard('First impact',hasNum(g.impactTimeMin)?fmt(g.impactTimeMin,1)+' min · '+String(g.impactType||'event'):'n/a')+detailCard('Objective-context death %',fmtPct(g.objectiveDeathPct))+detailCard('Deaths before enemy objective',String(g.preObjectiveDeathCount??0))+
      detailCard('Player-supported kill conversion',String(kc.playerSupportedConverted??kc.converted??0)+' / '+String(kc.windows??0)+' · '+fmtPct(kc.rate))+detailCard('Team conversion after your kill windows',String(kc.teamConverted??kc.converted??0)+' / '+String(kc.windows??0)+' · '+fmtPct(kc.teamRate??kc.rate))+
      detailCard('Peer-supported kill conversion',peerOk?(String(okc.playerSupportedConverted??okc.converted??0)+' / '+String(okc.windows??0)+' · '+fmtPct(okc.rate)):'n/a')+detailCard('Peer team conversion context',peerOk?(String(okc.teamConverted??okc.converted??0)+' / '+String(okc.windows??0)+' · '+fmtPct(okc.teamRate??okc.rate)):'n/a')+
      detailCard('Contested encounters joined',String(g.objectiveReadiness?.contestedJoined??0)+' / '+String(g.objectiveReadiness?.contestedObjectives??0))+
      detailCard('Prior setup presence (45–105s)',String(g.objectiveReadiness?.earlySetupJoins??0)+' · '+fmtPct(g.objectiveReadiness?.earlySetupJoinRate))+
      detailCard('Event-frame-only joins',String(g.objectiveReadiness?.eventFrameOnlyJoins??0))+detailCard('Contested-objective absences',String(g.objectiveReadiness?.contestedAbsent??0))+
      detailCard('Recent-shop objective absences',String(g.objectiveReadiness?.recentShopAbsences??g.objectiveReadiness?.lateResetMisses??0))+detailCard('Fresh-purchase objective joins',String(g.objectiveReadiness?.freshPurchaseJoins??0))+detailCard('Raw objective/structure events',String(Array.isArray(g.objectives)?g.objectives.length:Number(g.objectiveEventCount||0)))+
      detailList((kc.events||[]).map(x=>(Number(x.startMin)||0).toFixed(1)+'–'+(Number(x.endMin)||0).toFixed(1)+'m · '+String(x.kills||0)+' involved kill(s) · '+(x.playerSupportedConverted??x.converted?('supported conversion to '+String(x.objectiveType||'objective')+' in '+String(x.secondsAfter??'?')+'s'):x.teamConverted?('team-only conversion to '+String(x.teamObjectiveType||'objective')+' in '+String(x.teamSecondsAfter??'?')+'s'):'no tracked conversion within 75s')),'No player-involved kill-conversion windows were available.')+
      detailList(familyRows,'No objective-family encounter data were available.')+
      detailList((g.objectiveReadiness?.events||[]).map(x=>(Number(x.time)||0).toFixed(1)+'m · '+String(x.objectiveType||'neutral objective')+(Number(x.rawEventCount||1)>1?' · '+String(x.rawEventCount)+' raw kills grouped':'')+' · '+(x.teamSecured?'team secured':x.enemySecured?'enemy secured':'result unknown')+' · '+String(x.alliedPresentCount??'?')+' ally presence · '+(x.earlySetup?('prior setup evidence'+(hasNum(x.setupLeadSec)?' ~'+fmtInt(x.setupLeadSec)+'s before':'')+' (45–105s band)'):x.eventFrameOnlyJoin?'event-frame-only join':x.present?'present':'absent')+(hasNum(x.secondsSinceShop)?' · shopped '+String(x.secondsSinceShop)+'s before':'')+(x.recentDeath?' · recent death':(x.recentShopAbsence??x.lateResetMiss)?' · recent-shop absence':x.freshPurchaseJoin?' · fresh purchase + joined':'')),'No team-contested neutral-objective readiness events were available.')+
      '<div class="detail-note"><strong>Objective-presence basis:</strong> coaching uses team-contested windows. A team-secured objective is always included; an objective your team loses enters the denominator only when Riot timeline positions support at least one allied champion near the encounter. Fully conceded cross-map objectives are not treated as personal absences. Team-secured presence remains visible separately as outcome context.</div>'+
      '<div class="detail-note"><strong>Setup timing evidence:</strong> “prior setup” requires supported position evidence near the objective 45–105 seconds before the encounter <em>and</em> supported presence at the encounter. “Recent-shop absence” means the last detected shop visit ended within 60 seconds while the player was absent and not recently dead; it is an association, not proof that shopping/reset timing caused the absence.</div>'+
      '<div class="detail-note">Supported conversion is the coaching metric: a tracked objective/structure must follow the player-involved kill window within 75 seconds <em>and</em> Riot timeline evidence must place/credit the player at that conversion. Team conversion is shown separately as context so an objective taken elsewhere on the map does not become individual credit.</div>';
  }
  if(tab==='resets'){
    const peerOk=g.directPeerComparable===true,mine=g.firstMajorItem,opp=g.opponentFirstMajorItem,second=g.secondMajorItem,oppSecond=g.opponentSecondMajorItem,shops=g.shopVisits||[],shopCount=Array.isArray(g.shopVisits)?g.shopVisits.length:Number(g.shopVisitCount||0),greedy=g.greedyStayWindows||[],spike=g.itemSpikeWindow||{},firstReset=g.firstResetSequence||null,ready=g.majorItemReadiness||null,oppReady=g.opponentMajorItemReadiness||null;
    return roleQuestNote(g)+detailCard('Item mechanics catalog',g.itemCatalogExactPatch===true?('exact · '+String(g.itemCatalogVersion||g.patchKey||'patch matched')):(g.itemCatalogExactPatch===false?'fallback display only · spend/item timing withheld':'unverified · item mechanics withheld'))+detailCard('First reset / shop',firstReset?(fmt(firstReset.time,1)+'m · '+resetSpendText(firstReset)):'n/a')+
      detailCard('First-reset spend evidence',firstReset?resetSpendEvidenceText(firstReset):'n/a')+
      detailCard('First reset vs peer',peerOk&&firstReset&&hasNum(firstReset.timingDeltaVsOpponent)?signed(firstReset.timingDeltaVsOpponent,1)+' min':'n/a')+
      detailCard('Post-reset role-gold swing',firstReset&&hasNum(firstReset.goldSwingAfter)?signed(firstReset.goldSwingAfter,0)+'g':'n/a')+
      detailCard('Post-reset role-CS swing',firstReset&&hasNum(firstReset.csSwingAfter)?signed(firstReset.csSwingAfter,1)+' CS':'n/a')+
      detailCard('First-reset outcome',!firstReset?'n/a':firstReset.deathInWindow?'measurement contaminated by death':firstReset.economyLoss?'economy loss':firstReset.economyGain?'economy gain':firstReset.measured?'neutral / mixed':'unmeasured')+
      itemDetailCard('First major item',mine)+
      detailCard('Recipe components ready',ready&&hasNum(ready.ingredientsReadyMin)?fmt(ready.ingredientsReadyMin,1)+'m':'n/a')+
      detailCard('First major affordable',ready&&ready.eligible?(fmt(ready.affordableMin,1)+'m · '+fmtInt(ready.combineCost)+'g combine'):(ready?.reason?'not measurable · '+readinessReason(ready.reason):'n/a'))+
      detailCard('Affordable → purchased',ready&&ready.eligible?(fmt(ready.delayMin,1)+' min · '+(ready.delayed?'delayed':'prompt')):'n/a')+
      itemDetailCard('Opponent major item',peerOk?opp:null)+
      itemDetailCard('Second major item',second)+
      itemDetailCard('Opponent second major',peerOk?oppSecond:null)+
      detailCard('Second-major timing vs peer',peerOk&&hasNum(g.secondMajorItemDeltaVsOpponent)?signed(g.secondMajorItemDeltaVsOpponent,1)+' min':'n/a')+
      detailCard('Opponent affordability delay',peerOk&&oppReady&&oppReady.eligible?fmt(oppReady.delayMin,1)+' min':'n/a')+
      detailCard('Readiness delay vs peer',peerOk&&ready&&hasNum(ready.delayDeltaVsOpponent)?signed(ready.delayDeltaVsOpponent,1)+' min':'n/a')+
      detailCard('Timing vs opponent',peerOk&&hasNum(g.itemSpikeDeltaVsOpponent)?signed(g.itemSpikeDeltaVsOpponent,1)+' min':'n/a')+
      detailCard('Item-spike window',spike.eligible?(fmtInt(spike.leadSec)+'s advantage'):'No ≥45s item window')+
      detailCard('Supported spike-window impact',spike.eligible?(String(spike.totalImpacts||0)+' impact(s) · '+(spike.used?'used':'unused')):'n/a')+
      detailCard('Died before spike impact',spike.eligible?(spike.diedBeforeImpact?'yes':'no'):'n/a')+
      detailCard('Detected shop visits',String(shopCount))+detailCard('Greedy-stay windows',String(greedy.length))+detailCard('Overstay deaths',String(g.overstayCount??0))+
      purchaseItemStrip(firstReset?.items)+detailList(firstReset?[('First shop '+fmt(firstReset.time,1)+'m · '+resetSpendText(firstReset)+' · '+String(firstReset.committedPurchases??firstReset.items?.length??0)+' committed purchase(s)'+(firstReset.items?.length?' · '+firstReset.items.map(x=>x.name||x.id||'item').join(', '):'')+
        (hasNum(firstReset.goldDiffBefore)?' · role gold '+signed(firstReset.goldDiffBefore,0)+'g before':'')+(hasNum(firstReset.goldDiffAfter)?' → '+signed(firstReset.goldDiffAfter,0)+'g after':'')+
        (hasNum(firstReset.csDiffBefore)?' · role CS '+signed(firstReset.csDiffBefore,0)+' before':'')+(hasNum(firstReset.csDiffAfter)?' → '+signed(firstReset.csDiffAfter,0)+' after':'')+
        (firstReset.deathInWindow?' · death in measurement window':firstReset.economyLoss?' · economy loss':firstReset.economyGain?' · economy gain':''))]:[],'No measurable first-reset sequence was available.')+
      detailList((spike.events||[]).map(x=>fmt(x.time,1)+'m · '+(x.type==='kill_or_assist'?'kill/assist impact':'supported objective/structure impact'+(x.objectiveType?' · '+x.objectiveType:'')+(x.supportEvidence?' · '+String(x.supportEvidence).replaceAll('_',' '):''))),'No supported impact occurred inside the measurable first-major-item advantage window.')+
      detailList(greedy.map(x=>(Number(x.startMin)||0).toFixed(1)+'m · '+fmtInt(x.currentGold)+'g held · next shop '+(Number(x.nextShopMin)||0).toFixed(1)+'m ('+fmt(x.delayMin,1)+'m delay)'),'No repeated high-gold stay window detected.')+
      '<div class="detail-note">Shop/reset spend uses committed Riot purchase events: ITEM_UNDO reversals are removed, and cash cost is estimated from the patch item recipe minus owned build components. <strong>Recipe/cost/major-item coaching requires an exact patch-matched Data Dragon item catalog;</strong> a fallback catalog may label item IDs for traceability but cannot qualify a reset threshold, major-item timing, affordability or item-spike window. The first meaningful reset threshold uses the minimum plausible spend, not the optimistic estimate. Dynamic discounts such as the post-support-quest Control Ward price are shown as a range; an unresolvable zero-ID undo makes that shop ineligible for the spend threshold instead of being guessed through.</div>';
  }
  const peer=g.peer||null,peerOk=g.directPeerComparable===true,earlyLead=peerOk?(g.earlyLeadWindow||{}):{},rules=reportPhaseRules(g);
  const checkpointNote=(!rules.lane15Comparable||!rules.fixed15to25Comparable||!rules.closing25Comparable)
    ?'<div class="detail-note"><strong>Checkpoint interpretation:</strong> Raw @15/@25 role-relative frames are shown for traceability, but this rules profile does not treat them as standard lane / 15→25 routing / closing checkpoints. Coaching that depends on those meanings is suppressed.</div>'
    :'';
  return checkpointNote+roleQuestNote(g)+detailCard('Patch',g.publicPatchKey?(String(g.publicPatchKey)+(g.patchKey&&String(g.patchKey)!==String(g.publicPatchKey)?' · build '+String(g.patchKey):'')):(g.patchKey||'n/a'))+detailCard('Role-quest rules',roleQuestText(g))+detailCard('Gold diff @10',peerOk?signed(g.goldDiff10,0):'n/a')+detailCard('Gold diff @15',peerOk?signed(g.goldDiff15,0):'n/a')+detailCard('Gold diff @25',peerOk?signed(g.goldDiff25,0):'n/a')+
    detailCard('Peak pre-15 role lead',earlyLead.eligible?(signed(earlyLead.peakGoldDiff,0)+'g @ '+fmt(earlyLead.peakMin,1)+'m'):'No ≥500g measured peak')+
    detailCard('Peak → 15 gold swing',earlyLead.eligible?(signed(earlyLead.goldSwingTo15,0)+'g · '+(earlyLead.giveback?'give-back':earlyLead.preserved?'preserved':'partial erosion')):'n/a')+
    detailCard('Deaths after early peak',earlyLead.eligible?(String(earlyLead.deathsAfterPeak??0)+' · '+String(earlyLead.highRiskDeathsAfterPeak??0)+' high-risk'):'n/a')+
    detailCard('CS diff @10',peerOk?signed(g.csDiff10,0):'n/a')+detailCard('CS diff @15',peerOk?signed(g.csDiff15,0):'n/a')+detailCard('CS diff @25',peerOk?signed(g.csDiff25,0):'n/a')+
    detailCard('XP diff @10',peerOk?signed(g.xpDiff10,0):'n/a')+detailCard('XP diff @15',peerOk?signed(g.xpDiff15,0):'n/a')+detailCard('XP diff @25',peerOk?signed(g.xpDiff25,0):'n/a')+
    detailCard('Opponent',peerOk&&peer?(peer.champion||'Same-role peer'):'withheld')+detailCard('Opponent rank',peerOk&&peer?rankText(peer.rank):'withheld')+
    detailCard('Early clean duel',peerOk?(String(modernOrLegacy(g.laneDuel,'earlySoloKillsVsRole','pre14SoloKillsVsRole'))+' solo kills / '+String(modernOrLegacy(g.laneDuel,'earlySoloDeathsToRole','pre14SoloDeathsToRole'))+' solo deaths'):'n/a')+
    detailCard('Plate involvement ≤20m · strong',peerOk?(String(modernOrLegacy(g.structurePressure,'first20PlayerPlateInvolvement','first20PlayerPlateCredits'))+' vs '+String(modernOrLegacy(g.structurePressure,'first20OpponentPlateInvolvement','first20OpponentPlateCredits'))+' peer'):'n/a')+
    detailCard('Lane-presence-only plate signals ≤20m',String(g.structurePressure?.first20PlayerPlateLanePresenceSignals??0)+(peerOk?' vs '+String(g.structurePressure?.first20OpponentPlateLanePresenceSignals??0)+' peer':''))+
    detailCard('Plate involvement · full match · strong',peerOk?(String(modernOrLegacy(g.structurePressure,'allGamePlayerPlateInvolvement','allGamePlayerPlateCredits'))+' vs '+String(modernOrLegacy(g.structurePressure,'allGameOpponentPlateInvolvement','allGameOpponentPlateCredits'))+' peer'):'n/a')+
    detailCard('Lane-presence-only plate signals · full match',String(g.structurePressure?.allGamePlayerPlateLanePresenceSignals??0)+(peerOk?' vs '+String(g.structurePressure?.allGameOpponentPlateLanePresenceSignals??0)+' peer':''))+
    detailCard('Your plate tiers',g.structurePressure?.playerPlateByTier?plateTierText(g.structurePressure.playerPlateByTier):'legacy report')+
    detailCard('Peer plate tiers',peerOk&&g.structurePressure?.opponentPlateByTier?plateTierText(g.structurePressure.opponentPlateByTier):'n/a')+
    detailCard('Solo-kill structure conversion',peerOk?(String(g.structurePressure?.soloKillStructureConversions??0)+' / '+String(g.structurePressure?.soloKillWindows??0)+' · '+fmtPct(g.structurePressure?.soloKillStructureConversionRate)):'n/a')+
    detailCard('All-game clean duel',peerOk?(String(g.laneDuel?.soloKillsVsRole??0)+' / '+String(g.laneDuel?.soloDeathsToRole??0)):'n/a')+
    detailCard('Early home-lane deaths',String(modernOrLegacy(g.lanePressure,'earlyHomeLaneDeaths','pre14HomeLaneDeaths')))+
    detailCard('Outside-pressure classified sample',String(g.lanePressure?.earlyClassifiedHomeLaneDeaths??g.lanePressure?.earlyHomeLaneDeaths??g.lanePressure?.pre14ClassifiedHomeLaneDeaths??g.lanePressure?.pre14HomeLaneDeaths??0)+' classified · '+String(g.lanePressure?.earlyUnclassifiedHomeLaneDeaths??g.lanePressure?.pre14UnclassifiedHomeLaneDeaths??0)+' excluded')+
    detailCard('Outside-pressure classified deaths',String(modernOrLegacy(g.lanePressure,'earlyOutsidePressureDeaths','pre14OutsidePressureDeaths'))+' · '+fmtPct(g.lanePressure?.earlyOutsidePressureShare??g.lanePressure?.outsidePressureShare))+
    detailCard('First impact',hasNum(g.impactTimeMin)?fmt(g.impactTimeMin,1)+'m':'n/a')+detailCard('Opponent first impact',peerOk&&hasNum(g.opponentImpactTimeMin)?fmt(g.opponentImpactTimeMin,1)+'m':'n/a')+detailCard('Impact timing vs peer',peerOk&&hasNum(g.impactDeltaVsOpponent)?signed(g.impactDeltaVsOpponent,1)+' min':'n/a')+
    detailCard('DPM vs same-role opponent',peerOk&&peer?signed(peer.dpmDelta,0):'n/a')+detailCard('CS/min vs opponent',peerOk&&peer?signed(peer.csMinDelta,2):'n/a')+detailCard('Team damage rank',hasNum(g.damageRank)?'#'+g.damageRank+' of 5':'n/a')+detailCard('Team gold rank',hasNum(g.goldRank)?'#'+g.goldRank+' of 5':'n/a')+detailCard('Team vision rank',hasNum(g.visionRank)?'#'+g.visionRank+' of 5':'n/a')+
    detailCard('Damage share',fmtPct(g.damageShare))+detailCard('Gold share',fmtPct(g.goldShare))+detailCard('Damage − gold share',hasNum(g.damageShare)&&hasNum(g.goldShare)?signed(Number(g.damageShare)-Number(g.goldShare),1)+' points':'n/a')+
    detailCard('Session game #',g.sessionContext?.sessionGameNumber?String(g.sessionContext.sessionGameNumber):'n/a')+
    detailCard('Gap after previous game',hasNum(g.sessionContext?.gapAfterPreviousMin)?fmt(g.sessionContext.gapAfterPreviousMin,0)+' min':'n/a')+
    detailCard('Previous result',g.sessionContext?.previousWin===true?'WIN':g.sessionContext?.previousWin===false?'LOSS':'n/a')+
    detailList((g.structurePressure?.events||[]).map(x=>(Number(x.killTime)||0).toFixed(1)+'m solo kill · '+(x.converted?('supported structure involvement'+(x.towerType?' · '+x.towerType:'')+(x.laneType?' · '+x.laneType:'')+(x.attribution?' · '+String(x.attribution).replaceAll('_',' '):'')+(hasNum(x.secondsAfter)?' · '+fmtInt(x.secondsAfter)+'s later':'')):'no supported plate/turret involvement within 90s')),'No early clean solo-kill structure window detected.')+
    '<div class="detail-note">2026 turret plates no longer use the old 14:00 expiry assumption and plate-style rewards extend through deeper turret tiers. The ≤20m row is only a fixed coaching slice. <strong>Involvement</strong> now requires direct Riot event credit or supported ≤2200-unit event-position proximity. Same-lane timeline-frame evidence is retained separately as a presence-only signal and never earns plate/turret conversion credit by itself.</div>'+
    detailList((g.laneDuel?.events||[]).map(x=>(Number(x.time)||0).toFixed(1)+'m · '+(x.result==='solo_kill'?'solo kill on role opponent':'solo death to role opponent')+(x.early?' · early phase':'')+(hasNum(x.goldDiffAtEvent)?' · role gold '+signed(x.goldDiffAtEvent,0)+'g at event':'')+(hasNum(x.goldSwingTo15)?' · '+signed(x.goldSwingTo15,0)+'g swing to 15':'')+(hasNum(x.csSwingTo15)?' · '+signed(x.csSwingTo15,0)+' CS swing to 15':'')+(x.result==='solo_kill'&&x.conversionEligibleTo15&&hasNum(x.convertedBy15)?(x.convertedBy15?' · converted by 15':' · not converted by 15'):'')+(x.result==='solo_kill'&&(x.early||x.pre14)&&hasNum(x.nextShopDelaySec)?' · next shop '+fmtInt(x.nextShopDelaySec)+'s':'')+(x.result==='solo_kill'&&(x.early||x.pre14)&&x.diedBeforeNextShop?' · died before shop':'')),'No clean direct-role solo duel event detected.')+
    detailList((g.lanePressure?.events||[]).filter(x=>x.outsidePressure===true).map(x=>(Number(x.time)||0).toFixed(1)+'m · outside pressure'+((x.outsideRoles||[]).length?' from '+x.outsideRoles.join(', '):'')+' · '+String(x.attackerCount||'?')+' attacker(s)'),'No classified early-phase outside-pressure lane death detected.')+
    detailList((g.lanePressure?.events||[]).filter(x=>x.classificationEligible===false).map(x=>(Number(x.time)||0).toFixed(1)+'m · outside-pressure classification withheld · '+String(x.classificationReason||'ordinary lane opposition unresolved').replaceAll('_',' ')),'No early home-lane death was excluded from outside-pressure classification.')+
    '<div class="detail-note">Outside-pressure rates use only deaths where ordinary lane opposition is resolvable. In bot lane, both enemy ADC and Support are ordinary lane opposition; unresolved counterparts are excluded rather than treated as outside pressure or clean pressure.</div>'+
    '<div class="detail-note">Direct-role comparative cards require high-confidence Riot teamPosition/individualPosition evidence for both players. '+(peerOk?'This match passes that evidence gate.':'This match does not pass that gate; fallback opponent context may remain visible, but comparative coaching values are withheld.')+'</div>'+
    '<div class="detail-note">Clean direct-role duel events require the player and actual same-role opponent to be killer/victim with no assisting participants. This separates direct matchup outcomes from outside intervention.</div>';
}
function bindDetailTabs(container,g,index){
  container.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click',(ev)=>{
    ev.stopPropagation();state.activeDetailTab=btn.dataset.tab;
    container.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b===btn));
    container.querySelector('[data-detail-content]').innerHTML=detailContent(g,state.activeDetailTab);bindMapFallbacks(container);
  }));
}

function niceCeil(value,step){
  const x=Math.max(step,Math.abs(Number(value)||0));
  return Math.ceil(x/step)*step;
}
function formatChartValue(value,unit){
  if(!hasNum(value))return'n/a';
  const v=Number(value);
  if(unit==='%')return fmtPct(v);
  if(unit==='int')return fmtInt(v);
  if(unit==='signed')return signed(v,0);
  if(unit==='signed1')return signed(v,1);
  if(unit==='signed2')return signed(v,2);
  return fmt(v,2);
}
function chartSvg(points,spec){
  const vals=points.filter(p=>hasNum(p.value)).map(p=>Number(p.value)).filter(Number.isFinite);if(vals.length<3)return null;
  const rows=points.map((p,i)=>{const value=Number(p.value);return{i,v:value,p,valid:hasNum(p.value)&&Number.isFinite(value)};}),valid=rows.filter(x=>x.valid);
  const w=820,h=300,padL=88,padR=24,padT=30,padB=48,unit=spec.unit||'num',signedAxis=!!spec.signedAxis;
  let min,max;
  if(hasNum(spec.fixedMin)&&hasNum(spec.fixedMax)){min=Number(spec.fixedMin);max=Number(spec.fixedMax);}
  else if(signedAxis){
    const step=unit==='signedGold'?500:unit==='signedCs'?5:1;
    const bound=niceCeil(Math.max(...vals.map(v=>Math.abs(v))),step);
    min=-bound;max=bound;
  }else if(unit==='percent'){min=0;max=100;}
  else if(unit==='cs'){min=0;max=Math.max(10,niceCeil(Math.max(...vals),2));}
  else if(unit==='dpm'){min=0;max=Math.max(1000,niceCeil(Math.max(...vals),250));}
  else{min=Math.min(0,Math.floor(Math.min(...vals)));max=niceCeil(Math.max(...vals),Math.max(1,(Math.max(...vals)-Math.min(...vals))/4));}
  const span=Math.max(1,max-min),plotW=w-padL-padR,plotH=h-padT-padB;
  const xAt=n=>padL+(n/Math.max(1,points.length-1))*plotW;
  const yAt=v=>padT+(max-clamp(v,min,max))/span*plotH;
  const coords=valid.map(x=>({x:xAt(x.i),y:yAt(x.v),v:x.v,p:x.p,i:x.i})),segments=[];
  let segment=[];
  rows.forEach(x=>{if(x.valid){segment.push({x:xAt(x.i),y:yAt(x.v),v:x.v,p:x.p,i:x.i});return;}if(segment.length){segments.push(segment);segment=[];}});
  if(segment.length)segments.push(segment);
  const paths=segments.filter(xs=>xs.length>1).map(xs=>'<path class="chart-line" d="'+xs.map((c,i)=>(i?'L':'M')+c.x.toFixed(1)+' '+c.y.toFixed(1)).join(' ')+'"/>').join('');
  const ticks=5,grid=[];
  for(let i=0;i<ticks;i++){
    const value=max-(span/(ticks-1))*i,y=yAt(value);
    grid.push('<line class="chart-grid-line" x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(w-padR)+'" y2="'+y.toFixed(1)+'"/><text class="chart-axis-label" x="'+(padL-10)+'" y="'+(y+4).toFixed(1)+'" text-anchor="end">'+esc(formatChartValue(value,spec.formatUnit||spec.unit))+'</text>');
  }
  const zeroY=signedAxis?yAt(0):null;
  const upperBand=spec.inverse?'chart-negative-band':'chart-positive-band',lowerBand=spec.inverse?'chart-positive-band':'chart-negative-band';
  const bands=signedAxis?'<rect class="'+upperBand+'" x="'+padL+'" y="'+padT+'" width="'+plotW+'" height="'+Math.max(0,zeroY-padT)+'"/><rect class="'+lowerBand+'" x="'+padL+'" y="'+zeroY+'" width="'+plotW+'" height="'+Math.max(0,padT+plotH-zeroY)+'"/>':'';
  const zero=signedAxis?'<line class="chart-zero-line" x1="'+padL+'" y1="'+zeroY+'" x2="'+(w-padR)+'" y2="'+zeroY+'"/><text class="chart-zero-label" x="'+(w-padR-4)+'" y="'+(zeroY-7)+'" text-anchor="end">'+esc(spec.zeroLabel||'EVEN WITH ROLE OPPONENT')+'</text>':'';
  const refValue=hasNum(spec.reference)?Number(spec.reference):null,refY=refValue!=null&&refValue>=min&&refValue<=max?yAt(refValue):null;
  const reference=refY==null?'':'<line class="chart-reference-line" x1="'+padL+'" y1="'+refY+'" x2="'+(w-padR)+'" y2="'+refY+'"/><text class="chart-reference-label" x="'+(w-padR-4)+'" y="'+(refY-7)+'" text-anchor="end">'+esc(spec.referenceLabel||'REFERENCE')+' · '+esc(formatChartValue(refValue,spec.formatUnit||spec.unit))+'</text>';
  const dots=coords.map(c=>{const when=shortGameDate(c.p?.gameStartTimestamp)||('Game '+String(c.i+1)),champ=c.p?.champion?String(c.p.champion)+' · ':'',signal=c.v*(spec.inverse?-1:1);return '<circle class="chart-dot '+(signedAxis?(signal>0?'positive':signal<0?'negative':'even'):'')+'" cx="'+c.x.toFixed(1)+'" cy="'+c.y.toFixed(1)+'" r="5"><title>'+esc(champ+when+': '+formatChartValue(c.v,spec.formatUnit||spec.unit))+'</title></circle>';}).join('');
  const missing=rows.filter(x=>!x.valid),missingMarks=missing.map(x=>'<g class="chart-missing-mark" aria-hidden="true" transform="translate('+xAt(x.i).toFixed(1)+' '+(h-padB+10)+')"><path d="M-4 -4L4 4M4 -4L-4 4"/></g>').join('');
  const firstTime=rows[0]?.p?.gameStartTimestamp,lastTime=rows[rows.length-1]?.p?.gameStartTimestamp;
  const xLabels=valid.length?'<text class="chart-axis-label x" x="'+padL+'" y="'+(h-12)+'">'+esc(shortGameDate(firstTime)||'older')+'</text><text class="chart-axis-label x" x="'+(w-padR)+'" y="'+(h-12)+'" text-anchor="end">'+esc(shortGameDate(lastTime)||'newer')+'</text>':'';
  const accessibility=(spec.title||'Trend chart')+'. '+valid.length+' valid observations; '+missing.length+' unavailable. Line breaks and x marks show unavailable observations; unavailable is not zero.';
  return '<svg class="chart-svg" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+esc(accessibility)+'">'+bands+grid.join('')+zero+reference+paths+dots+missingMarks+xLabels+'</svg>';
}
function chartSummary(points,spec){
  const vals=points.filter(p=>hasNum(p.value)).map(p=>Number(p.value)).filter(Number.isFinite);if(!vals.length)return'No valid values.';
  const avgV=vals.reduce((a,b)=>a+b,0)/vals.length,recent=vals.slice(-Math.min(5,vals.length)),recentAvg=recent.reduce((a,b)=>a+b,0)/recent.length;
  const unit=spec.formatUnit||spec.unit,recentText='latest '+recent.length+' valid observation'+(recent.length===1?'':'s')+' average ';
  if(spec.signedAxis){
    const delta=recentAvg-avgV,signal=delta*(spec.inverse?-1:1),dir=Math.abs(delta)<(spec.relevance||50)?'similar recently':signal>0?'more favorable recently':'less favorable recently';
    return 'Sample average '+formatChartValue(avgV,unit)+' · '+recentText+formatChartValue(recentAvg,unit)+' · '+dir+'. '+(spec.zeroMeaning||'Zero means even with the direct role opponent.');
  }
  return 'Sample average '+formatChartValue(avgV,unit)+' · '+recentText+formatChartValue(recentAvg,unit)+'.';
}
function chartMeta(points,evidence){
  const valid=points.filter(p=>hasNum(p.value)),dates=valid.map(p=>Number(p.gameStartTimestamp||0)).filter(x=>x>0).sort((a,b)=>a-b);
  const range=dates.length?(shortGameDate(dates[0])+' → '+shortGameDate(dates[dates.length-1])):'date range unavailable';
  const evidenceText=evidence?.summary?(' · evidence floor: '+evidence.summary):'';
  const unavailable=Math.max(0,points.length-valid.length),gapText=unavailable?(' · '+unavailable+' unavailable (shown as line gaps, not zero)'):'';
  return valid.length+' valid plotted observation'+(valid.length===1?'':'s')+gapText+' · '+range+evidenceText;
}
function chartDataTable(points,spec){
  const valid=points.filter(p=>hasNum(p.value)).length,total=points.length,unit=spec.formatUnit||spec.unit;
  const rows=points.map((p,i)=>{
    const value=hasNum(p.value)?formatChartValue(Number(p.value),unit):'Unavailable';
    return '<tr class="'+(hasNum(p.value)?'':'value-unavailable')+'"><td>'+(i+1)+'</td><td>'+esc(shortGameDate(p.gameStartTimestamp)||'Date unavailable')+'</td><td>'+esc(p.champion||'Unknown champion')+'</td><td>'+esc(value)+'</td></tr>';
  }).join('');
  return '<details class="chart-data-details"><summary>View plotted values · '+valid+' valid / '+total+' games</summary><div class="chart-data-table-wrap"><table class="chart-data-table"><caption>Underlying values for '+esc(spec.title||'trend chart')+'. Unavailable values are unknown, not zero.</caption><thead><tr><th scope="col">Order</th><th scope="col">Date</th><th scope="col">Champion</th><th scope="col">Value</th></tr></thead><tbody>'+rows+'</tbody></table></div></details>';
}

function quantile(values,q){
  const xs=values.filter(Number.isFinite).slice().sort((a,b)=>a-b);if(!xs.length)return null;
  const pos=(xs.length-1)*q,lo=Math.floor(pos),hi=Math.ceil(pos),mix=pos-lo;
  return xs[lo]+(xs[hi]-xs[lo])*mix;
}
function robustStats(values){
  const xs=values.map(Number).filter(Number.isFinite);if(!xs.length)return null;
  return{n:xs.length,median:quantile(xs,.5),q1:quantile(xs,.25),q3:quantile(xs,.75),min:Math.min(...xs),max:Math.max(...xs)};
}
function consistencyFmt(v,unit){
  if(!hasNum(v))return'n/a';
  if(unit==='gold')return signed(v,0)+'g';
  if(unit==='cs')return signed(v,1)+' CS';
  if(unit==='dpm')return fmtInt(v);
  if(unit==='percent')return fmtPct(v);
  return fmt(v,2);
}
function consistencySplit(values,center,threshold,inverse=false){
  const xs=values.map(Number).filter(Number.isFinite),ref=Number(center||0),t=Math.max(0,Number(threshold||0));
  let favorable=0,close=0,unfavorable=0;
  xs.forEach(v=>{const d=(v-ref)*(inverse?-1:1);if(d>t)favorable++;else if(d<-t)unfavorable++;else close++;});
  return{favorable,close,unfavorable,n:xs.length};
}
function chartEvidenceValue(r,path){
  const direct=pathValue(r,path);if(hasNum(direct))return Number(direct);
  const c=roleEventCoverage(r);
  const fallback={
    'behaviorSummary.roamAttempts':c.roamN,
    'behaviorSummary.roamAttemptGames':c.roamGames,
    'behaviorSummary.supportRoamAdcLaneMovementWindows':c.laneWindows,
    'behaviorSummary.supportRoamAdcLaneMovementGames':c.laneGames,
    'behaviorSummary.objectiveContestEncounters':c.contestN,
    'behaviorSummary.objectiveContestGames':c.contestGames
  };
  return hasNum(fallback[path])?Number(fallback[path]):null;
}
function chartSpecEvidence(r,spec){
  const reqs=Array.isArray(spec?.evidenceRequirements)&&spec.evidenceRequirements.length?spec.evidenceRequirements:[];
  if(!reqs.length)return{ready:true,summary:''};
  const rows=reqs.map(req=>{const value=chartEvidenceValue(r,req.path),min=Math.max(1,Number(req.min||1));return{path:req.path,value,min,ready:value!=null&&value>=min};});
  return{ready:rows.every(x=>x.ready),rows,summary:rows.map(x=>practiceRequirementLabel(x.path)+' '+(x.value==null?'n/a':fmtInt(x.value))+'/'+fmtInt(x.min)).join(' · ')};
}
function consistencyCard(label,stats,unit,split,detail,ready=true,evidenceSummary=''){
  if(!stats)return'<article class="quality-card consistency-card evidence-unknown"><span>'+esc(label)+'</span><strong>Not enough data</strong><small>No valid values in this sample.</small></article>';
  if(!ready)return'<article class="quality-card consistency-card evidence-unknown"><span>'+esc(label)+'</span><strong>Thin evidence</strong><small>'+esc(evidenceSummary||detail||'The role-specific evidence floor is not met yet.')+'</small></article>';
  const middle=consistencyFmt(stats.q1,unit)+' to '+consistencyFmt(stats.q3,unit);
  const splitText=split&&split.n?(split.favorable+' favorable · '+split.close+' close · '+split.unfavorable+' unfavorable'):'';
  return'<article class="quality-card consistency-card"><span>'+esc(label)+'</span><strong>Median '+esc(consistencyFmt(stats.median,unit))+'</strong><small>Middle 50%: '+esc(middle)+(splitText?' · '+esc(splitText):'')+(detail?' · '+esc(detail):'')+'</small></article>';
}
function renderConsistencySummary(r){
  const target=$('consistencySummary');if(!target)return;
  const games=reportCoachingGames(r),reportRole=canonicalRole(r.dataQuality?.selectedRole||r.coachingSummary?.primaryRole||r.summary?.primaryRole),roleGames=games.filter(g=>canonicalRole(g.role)===reportRole),specs=roleEconomyChartSpecs(r,reportRole);
  target.innerHTML=specs.map(spec=>{
    const vals=roleGames.map(g=>spec.get?spec.get(g):g[spec.key]).filter(hasNum).map(Number),evidence=chartSpecEvidence(r,spec),hasSplit=evidence.ready&&hasNum(spec.splitCenter)&&hasNum(spec.splitThreshold),split=hasSplit?consistencySplit(vals,Number(spec.splitCenter),Number(spec.splitThreshold),!!spec.inverse):null;
    const detail=hasSplit?('close band ±'+formatChartValue(spec.splitThreshold,spec.formatUnit||spec.unit)+' · '+vals.length+' valid observations'):(vals.length+' valid '+roleLabel(reportRole)+' observations');
    return consistencyCard(spec.title,robustStats(vals),spec.consistencyUnit||'num',split,detail,evidence.ready,evidence.summary);
  }).join('');
}

function visualGraphEmpty(message){
  return '<div class="visual-graph-empty">'+esc(message||'Not enough supported evidence to draw this graph yet.')+'</div>';
}
function visualDivergingSvg(rows,opts={}){
  const valid=(rows||[]).filter(x=>hasNum(x?.value));if(!valid.length)return'';
  const observed=Math.max(...valid.map(x=>Math.abs(Number(x.value))));
  const step=hasNum(opts.tickStep)?Math.max(.1,Number(opts.tickStep)):.5;
  const bound=hasNum(opts.maxAbs)?Math.max(.1,Number(opts.maxAbs)):Math.max(2.5,niceCeil(Math.max(observed*1.14,2.5),step));
  const detailed=opts.rowDetails===true,w=detailed?940:760,rowH=detailed?78:56,padL=detailed?310:214,padR=detailed?34:72,padT=detailed?52:34,padB=42,h=padT+padB+valid.length*rowH,plotW=w-padL-padR,zeroX=padL+plotW/2,xAt=v=>padL+((clamp(Number(v),-bound,bound)+bound)/(bound*2))*plotW;
  const axisValue=v=>{if(Math.abs(v)<1e-9)return'0';const rounded=Math.round(v*10)/10,raw=Number.isInteger(rounded)?String(rounded):rounded.toFixed(1);return(v>0?'+':'')+raw+(opts.axisSuffix||'');};
  const ticks=[-bound,-bound/2,0,bound/2,bound],grid=ticks.map(v=>{const x=xAt(v),zero=Math.abs(v)<1e-9;return '<line class="visual-grid-line'+(zero?' zero':'')+'" x1="'+x.toFixed(1)+'" y1="'+padT+'" x2="'+x.toFixed(1)+'" y2="'+(h-padB)+'"/><text class="visual-axis-label" x="'+x.toFixed(1)+'" y="'+(h-13)+'" text-anchor="middle">'+esc(axisValue(v))+'</text>';}).join('');
  const directions=opts.directionLabels===false?'':'<text class="visual-axis-direction bad" x="'+padL+'" y="25">← '+esc(opts.leftLabel||'SLIPPING')+'</text><text class="visual-axis-direction good" x="'+(w-padR)+'" y="25" text-anchor="end">'+esc(opts.rightLabel||'IMPROVING')+' →</text>';
  const thresholdBand=opts.thresholdBand===true&&bound>1?(()=>{const left=xAt(-1),right=xAt(1),top=padT,bottom=h-padB;return '<rect class="visual-threshold-band" x="'+left.toFixed(1)+'" y="'+top+'" width="'+(right-left).toFixed(1)+'" height="'+(bottom-top)+'"/><line class="visual-threshold-line" x1="'+left.toFixed(1)+'" y1="'+top+'" x2="'+left.toFixed(1)+'" y2="'+bottom+'"/><line class="visual-threshold-line" x1="'+right.toFixed(1)+'" y1="'+top+'" x2="'+right.toFixed(1)+'" y2="'+bottom+'"/><text class="visual-threshold-label" x="'+zeroX.toFixed(1)+'" y="'+(padT-9)+'" text-anchor="middle">within ±1× practical-change band</text>';})():'';
  const bars=valid.map((r,i)=>{
    const y=padT+i*rowH+10,v=Number(r.value),x=xAt(v),rx=Math.min(zeroX,x),rw=Math.max(2,Math.abs(x-zeroX)),baseTone=opts.neutral||r.ready===false?'neutral':String(r.tone||(v>0?'good':v<0?'bad':'neutral')),severity=String(r.severity||''),tone=[baseTone,severity].filter(Boolean).join(' '),raw=String(r.valueLabel||signed(v,2)),detail=String(r.detail||r.label||''),rawLine=String(r.rawLine||'');
    const inside=rw>=74,labelX=inside?(v<0?x+10:x-10):(v<0?x-10:x+10),anchor=inside?(v<0?'start':'end'):(v<0?'end':'start');
    return '<text class="visual-row-label" x="8" y="'+(y+15)+'">'+esc(String(r.label||''))+'</text>'+
      (detailed&&rawLine?'<text class="visual-row-detail" x="8" y="'+(y+37)+'">'+esc(rawLine)+'</text>':'')+
      '<line class="visual-row-track" x1="'+padL+'" y1="'+(y+11)+'" x2="'+(w-padR)+'" y2="'+(y+11)+'"/>'+
      '<rect class="visual-bar '+esc(tone)+'" x="'+rx.toFixed(1)+'" y="'+(y+1)+'" width="'+rw.toFixed(1)+'" height="20" rx="7"><title>'+esc(detail)+'</title></rect>'+
      '<text class="visual-bar-end-value '+(inside?'inside ':'')+esc(baseTone)+'" x="'+labelX.toFixed(1)+'" y="'+(y+16)+'" text-anchor="'+anchor+'">'+esc(raw)+'</text>';
  }).join('');
  return '<svg class="visual-graph-svg'+(detailed?' recent-direction-svg':'')+'" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+esc(opts.ariaLabel||'Diverging comparison chart')+'">'+directions+thresholdBand+grid+bars+'</svg>';
}
function visualPercentBarSvg(rows,opts={}){
  const valid=(rows||[]).filter(x=>hasNum(x?.value));if(!valid.length)return'';
  const w=760,rowH=54,padL=200,padR=150,padT=30,padB=36,h=padT+padB+valid.length*rowH,plotW=w-padL-padR,xAt=v=>padL+clamp(Number(v),0,100)/100*plotW;
  const ticks=[0,25,50,75,100],grid=ticks.map(v=>'<line class="visual-grid-line" x1="'+xAt(v).toFixed(1)+'" y1="'+padT+'" x2="'+xAt(v).toFixed(1)+'" y2="'+(h-padB)+'"/><text class="visual-axis-label" x="'+xAt(v).toFixed(1)+'" y="'+(h-10)+'" text-anchor="middle">'+v+'%</text>').join('');
  const bars=valid.map((r,i)=>{const y=padT+i*rowH+9,value=clamp(Number(r.value),0,100),tone=String(r.tone||'neutral'),secondary=hasNum(r.secondary)?clamp(Number(r.secondary),0,100):null,raw=String(r.valueLabel||fmtPct(value)),detail=String(r.detail||r.label||'');return '<text class="visual-row-label" x="8" y="'+(y+16)+'">'+esc(String(r.label||''))+'</text><rect class="visual-percent-track" x="'+padL+'" y="'+(y+2)+'" width="'+plotW+'" height="18" rx="7"/><rect class="visual-bar '+esc(tone)+'" x="'+padL+'" y="'+(y+2)+'" width="'+Math.max(2,xAt(value)-padL).toFixed(1)+'" height="18" rx="7"><title>'+esc(detail)+'</title></rect>'+(secondary==null?'':'<line class="visual-secondary-marker" x1="'+xAt(secondary).toFixed(1)+'" y1="'+(y-2)+'" x2="'+xAt(secondary).toFixed(1)+'" y2="'+(y+24)+'"><title>'+esc(String(opts.secondaryLabel||'Secondary marker')+' '+fmtPct(secondary))+'</title></line>')+'<text class="visual-row-value" x="'+(w-8)+'" y="'+(y+16)+'" text-anchor="end">'+esc(raw)+'</text>';}).join('');
  return '<svg class="visual-graph-svg" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+esc(opts.ariaLabel||'Percentage bar chart')+'">'+grid+bars+'</svg>';
}
function visualIntervalPlotSvg(rows,opts={}){
  const valid=(rows||[]).filter(r=>hasNum(r?.value)&&hasNum(r?.low)&&hasNum(r?.high));if(!valid.length)return'';
  const detailed=opts.rowDetails!==false,w=detailed?900:760,rowH=detailed?68:54,padL=detailed?220:190,padR=detailed?142:112,padT=44,padB=40,h=padT+padB+valid.length*rowH,plotW=w-padL-padR,xAt=v=>padL+clamp(Number(v),0,100)/100*plotW;
  const ticks=[0,25,50,75,100],grid=ticks.map(v=>'<line class="visual-grid-line'+(v===50?' reference':'')+'" x1="'+xAt(v).toFixed(1)+'" y1="'+padT+'" x2="'+xAt(v).toFixed(1)+'" y2="'+(h-padB)+'"/><text class="visual-axis-label" x="'+xAt(v).toFixed(1)+'" y="'+(h-12)+'" text-anchor="middle">'+v+'%</text>').join('');
  const ref=opts.reference50===false?'':'<text class="visual-interval-reference-label" x="'+xAt(50).toFixed(1)+'" y="24" text-anchor="middle">50% result line</text>';
  const marks=valid.map((r,i)=>{
    const y=padT+i*rowH+13,value=clamp(Number(r.value),0,100),low=clamp(Number(r.low),0,100),high=clamp(Number(r.high),0,100),tone=String(r.tone||'neutral'),raw=String(r.valueLabel||fmtPct(value)),sub=String(r.subLabel||''),detail=String(r.detail||r.label||'');
    return '<text class="visual-row-label" x="8" y="'+(y+3)+'">'+esc(String(r.label||''))+'</text>'+
      (detailed&&sub?'<text class="visual-row-detail" x="8" y="'+(y+22)+'">'+esc(sub)+'</text>':'')+
      '<line class="visual-interval-whisker '+esc(tone)+'" x1="'+xAt(low).toFixed(1)+'" y1="'+y+'" x2="'+xAt(high).toFixed(1)+'" y2="'+y+'"><title>'+esc(detail)+'</title></line>'+
      '<line class="visual-interval-cap '+esc(tone)+'" x1="'+xAt(low).toFixed(1)+'" y1="'+(y-7)+'" x2="'+xAt(low).toFixed(1)+'" y2="'+(y+7)+'"/>'+
      '<line class="visual-interval-cap '+esc(tone)+'" x1="'+xAt(high).toFixed(1)+'" y1="'+(y-7)+'" x2="'+xAt(high).toFixed(1)+'" y2="'+(y+7)+'"/>'+
      '<circle class="visual-interval-point '+esc(tone)+'" cx="'+xAt(value).toFixed(1)+'" cy="'+y+'" r="'+(r.ready===false?5:7)+'"><title>'+esc(detail)+'</title></circle>'+
      '<text class="visual-row-value" x="'+(w-8)+'" y="'+(y+4)+'" text-anchor="end">'+esc(raw)+'</text>';
  }).join('');
  return '<svg class="visual-graph-svg visual-interval-svg" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+esc(opts.ariaLabel||'Estimate and uncertainty interval plot')+'">'+ref+grid+marks+'</svg>';
}
function visualCompositionSvg(rows,opts={}){
  const valid=(rows||[]).filter(r=>Number(r?.games||0)>0),total=valid.reduce((n,r)=>n+Number(r.games||0),0);if(!(total>0))return'';
  const w=900,h=170,padL=24,padR=24,barY=38,barH=42,plotW=w-padL-padR;let cursor=padL;
  const segments=valid.map((r,i)=>{const share=Number(r.games)/total*100,width=plotW*share/100,x=cursor;cursor+=width;return '<rect class="visual-composition-segment mix-'+((i%6)+1)+'" x="'+x.toFixed(1)+'" y="'+barY+'" width="'+Math.max(.8,width).toFixed(1)+'" height="'+barH+'" rx="'+(i===0?9:0)+'"><title>'+esc(String(r.label||'Unknown')+' · '+r.games+' games · '+fmtPct(share))+'</title></rect>';}).join('');
  const legend=valid.slice(0,6).map((r,i)=>{const share=Number(r.games)/total*100,x=padL+(i%3)*(plotW/3),y=112+Math.floor(i/3)*28;return '<rect class="visual-composition-key mix-'+((i%6)+1)+'" x="'+x+'" y="'+(y-10)+'" width="12" height="12" rx="3"/><text class="visual-composition-label" x="'+(x+19)+'" y="'+y+'">'+esc(String(r.label||'Unknown')+' · '+r.games+' · '+fmtPct(share))+'</text>';}).join('');
  return '<svg class="visual-graph-svg visual-composition-svg" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+esc(opts.ariaLabel||'Composition chart')+'">'+segments+legend+'</svg>';
}
function visualOutcomeMeanFormat(v,unit){
  if(!hasNum(v))return'n/a';
  if(unit==='percent')return fmt(v,1)+'%';
  if(unit==='dpm')return fmtInt(v);
  if(unit==='gold')return signed(v,0)+'g';
  if(unit==='minutes')return fmt(v,1)+'m';
  if(unit==='cs'||unit==='csmin')return fmt(v,2);
  return fmt(v,2);
}
function visualGroupedBarsSvg(groups,series,opts={}){
  const usable=(groups||[]).filter(g=>g&&series.some(spec=>hasNum(g?.values?.[spec.key])));if(!usable.length)return'';
  const values=usable.flatMap(g=>series.map(spec=>g?.values?.[spec.key]).filter(hasNum).map(Number)),observed=Math.max(...values,0),maxV=hasNum(opts.max)?Number(opts.max):Math.max(.5,niceCeil(observed,.25));
  const w=760,h=330,padL=72,padR=24,padT=30,padB=60,plotW=w-padL-padR,plotH=h-padT-padB,yAt=v=>padT+(maxV-clamp(Number(v),0,maxV))/maxV*plotH;
  const ticks=5,grid=[];for(let i=0;i<ticks;i++){const v=maxV-(maxV/(ticks-1))*i,y=yAt(v);grid.push('<line class="visual-grid-line" x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(w-padR)+'" y2="'+y.toFixed(1)+'"/><text class="visual-axis-label" x="'+(padL-9)+'" y="'+(y+4).toFixed(1)+'" text-anchor="end">'+esc(fmt(v,2))+'</text>');}
  const groupW=plotW/usable.length,barGap=5,barW=Math.min(44,(groupW-32-(series.length-1)*barGap)/series.length),bars=[];
  usable.forEach((g,gi)=>{const center=padL+groupW*(gi+.5),totalW=series.length*barW+(series.length-1)*barGap,start=center-totalW/2;series.forEach((spec,si)=>{const v=g?.values?.[spec.key];if(!hasNum(v))return;const x=start+si*(barW+barGap),y=yAt(v),bh=Math.max(2,padT+plotH-y);bars.push('<rect class="visual-series-bar '+esc(spec.cls||'series-a')+(g.ready===false?' thin':'')+'" x="'+x.toFixed(1)+'" y="'+y.toFixed(1)+'" width="'+barW.toFixed(1)+'" height="'+bh.toFixed(1)+'" rx="5"><title>'+esc(g.label+' · '+spec.label+' '+fmt(v,2)+'/10m')+'</title></rect><text class="visual-bar-number" x="'+(x+barW/2).toFixed(1)+'" y="'+Math.max(padT+10,y-6).toFixed(1)+'" text-anchor="middle">'+esc(fmt(v,2))+'</text>');});bars.push('<text class="visual-group-label" x="'+center.toFixed(1)+'" y="'+(h-22)+'" text-anchor="middle">'+esc(g.label)+'</text>');});
  return '<svg class="visual-graph-svg" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+esc(opts.ariaLabel||'Grouped bar chart')+'">'+grid.join('')+bars.join('')+'</svg>';
}
function visualTrendFormat(v,unit){
  if(unit==='percent')return fmtPct(v);
  if(unit==='gold')return signed(v,0)+'g';
  if(unit==='dpm')return fmtInt(v);
  if(unit==='csmin'||unit==='csminRaw')return fmt(v,2);
  if(unit==='minutes')return signed(v,1)+'m';
  if(unit==='cs')return signed(v,1)+' CS';
  return fmt(v,2);
}
function historyDirectionValue(v,unit){
  if(!hasNum(v))return'n/a';
  if(unit==='percent')return fmtPct(v);
  if(unit==='pp')return signed(v,1)+' points';
  if(unit==='dpm')return fmtInt(v);
  if(unit==='cs')return fmt(v,1);
  if(unit==='csmin')return fmt(v,2);
  return fmt(v,2);
}
function historyDirectionDelta(v,unit){
  if(!hasNum(v))return'n/a';
  if(unit==='percent'||unit==='pp')return signed(v,1)+' points';
  if(unit==='dpm')return signed(v,0);
  if(unit==='cs')return signed(v,1);
  if(unit==='csmin')return signed(v,2);
  return signed(v,2);
}
function renderLongHorizonDirectionGraph(specs){
  const box=$('longHorizonTrendGraph');if(!box)return;
  const rows=(specs||[]).map(spec=>{
    const o=spec?.obj,recent=hasNum(o?.recent)?Number(o.recent):null,prior=hasNum(o?.prior)?Number(o.prior):null,recentN=Number(o?.recentN||0),priorN=Number(o?.priorN||0),threshold=Math.max(.0001,Number(spec?.threshold||0));
    if(recentN<5||priorN<5||recent==null||prior==null||!(threshold>0))return null;
    const rawDelta=recent-prior,signal=(spec.inverse?-1:1)*rawDelta/threshold;
    return{label:spec.label,value:signal,tone:Math.abs(signal)<1?'neutral':signal>0?'good':'bad',severity:visualRecentSeverity(signal),valueLabel:signed(signal,1)+'×',
      rawLine:'Latest '+historyDirectionValue(recent,spec.unit)+' (n='+recentN+') · prior '+historyDirectionValue(prior,spec.unit)+' (n='+priorN+') · Δ '+historyDirectionDelta(rawDelta,spec.unit),
      detail:spec.label+' · latest '+historyDirectionValue(recent,spec.unit)+' vs prior '+historyDirectionValue(prior,spec.unit)+' · '+signed(signal,1)+' practical-change thresholds'};
  }).filter(Boolean).sort((a,b)=>Math.abs(Number(b.value))-Math.abs(Number(a.value))||String(a.label).localeCompare(String(b.label)));
  if(!rows.length){box.innerHTML=visualGraphEmpty('The 100-game history does not yet have five valid observations on both sides for a normalized direction graph.');return;}
  const strongest=rows[0],observed=Math.max(...rows.map(x=>Math.abs(Number(x.value)))),bound=Math.max(2.5,niceCeil(Math.max(observed*1.14,2.5),.5)),scale='±'+fmt(bound,bound%1?1:0)+'×';
  box.innerHTML='<div class="recent-direction-summary history-direction-summary"><span><b>Strongest 20-vs-20 shift</b><strong class="tone-'+esc(strongest.tone)+'">'+esc(strongest.label)+' '+esc(strongest.valueLabel)+'</strong></span><span><b>Dynamic chart range</b><strong>'+esc(scale)+'</strong></span><span><b>Window</b><strong>Latest 20 vs previous up to 20</strong></span></div>'+
    visualDivergingSvg(rows,{rowDetails:true,thresholdBand:true,axisSuffix:'×',ariaLabel:'Long-horizon latest twenty versus previous twenty normalized direction',leftLabel:'slipping',rightLabel:'improving'})+
    '<p class="visual-graph-reading"><b>Opponent-adjusted read:</b> directional bars use your value minus the actual direct same-role opponent in each match. Raw DPM, CS/min and similar totals are deliberately excluded here because stronger MMR/opponents can lower those totals without meaning you played worse. A positive DPM-vs-peer value means you still out-damaged the counterpart you actually faced. Each bar is normalized by a practical-change threshold; this remains descriptive, not causal.</p>';
}
function visualRecentSeverity(signal){
  const magnitude=Math.abs(Number(signal));
  if(magnitude<1)return'near';
  if(magnitude<2.5)return'moderate';
  if(magnitude<4)return'strong';
  return'extreme';
}
function renderRecentFormGraph(r){
  const box=$('recentFormGraph');if(!box)return;
  const rows=roleRecentTrendSpecs(r).filter(recentTrendSpecReady).map(spec=>{
    const recent=Number(spec.obj.recent),prior=Number(spec.obj.prior),threshold=Math.max(.0001,Number(spec.threshold||1)),rawDelta=recent-prior,signal=(spec.inverse?-1:1)*rawDelta/threshold,recentN=Number(spec.obj.recentN||0),priorN=Number(spec.obj.priorN||0);
    const rawDeltaText=spec.unit==='percent'?signed(rawDelta,1)+' points':spec.unit==='gold'?signed(rawDelta,0)+'g':spec.unit==='dpm'?signed(rawDelta,0):spec.unit==='csmin'||spec.unit==='csminRaw'?signed(rawDelta,2):spec.unit==='minutes'?signed(rawDelta,1)+'m':spec.unit==='cs'?signed(rawDelta,1)+' CS':signed(rawDelta,2);
    return{label:spec.label,value:signal,tone:Math.abs(signal)<1?'neutral':signal>0?'good':'bad',severity:visualRecentSeverity(signal),valueLabel:signed(signal,1)+'×',rawLine:'Recent '+visualTrendFormat(recent,spec.unit)+' (n='+recentN+') · prior '+visualTrendFormat(prior,spec.unit)+' (n='+priorN+') · Δ '+rawDeltaText,detail:'Latest '+visualTrendFormat(recent,spec.unit)+' vs prior '+visualTrendFormat(prior,spec.unit)+' · raw change '+rawDeltaText+' · '+signed(signal,1)+' practical-change thresholds'};
  });
  if(!rows.length){box.innerHTML=visualGraphEmpty('Recent-vs-prior metrics have not cleared their game and event evidence floors yet.');return;}
  rows.sort((a,b)=>Math.abs(Number(b.value))-Math.abs(Number(a.value))||String(a.label).localeCompare(String(b.label)));
  const strongest=rows[0],observed=Math.max(...rows.map(x=>Math.abs(Number(x.value)))),bound=Math.max(2.5,niceCeil(Math.max(observed*1.14,2.5),.5)),scaleText='±'+fmt(bound,bound%1?1:0)+'×';
  box.innerHTML='<div class="recent-direction-summary"><span><b>Strongest recent shift</b><strong class="tone-'+esc(strongest.tone)+'">'+esc(strongest.label)+' '+esc(strongest.valueLabel)+'</strong></span><span><b>Dynamic chart range</b><strong>'+esc(scaleText)+'</strong></span><span><b>Meaning of 1×</b><strong>One practical-change threshold</strong></span></div>'+
    visualDivergingSvg(rows,{rowDetails:true,thresholdBand:true,axisSuffix:'×',ariaLabel:'Recent form movement measured in practical-change thresholds',leftLabel:'slipping',rightLabel:'improving'})+
    '<p class="visual-graph-reading"><b>How to read:</b> bars are scaled to the actual largest supported shift, so different changes stay visually different instead of being clipped. Raw recent and prior values are printed under every metric. A 1× move equals that metric’s practical-change threshold; bar length shows change relative to that threshold, not causal importance.</p>';
}
function renderPhaseRiskGraph(r){
  const box=$('phaseRiskGraph');if(!box)return;
  const phase=r?.behaviorSummary?.phaseRisk||{},defs=[['early','Early'],['mid','Transition'],['late','Late']];
  const groups=defs.map(([key,label])=>{const x=phase[key]||{},exposure=Number(x.exposureMinutes||0);return{label:label+' · '+fmt(exposure,0)+'m',ready:Number(x.games||0)>=5&&exposure>=20,values:{high:hasNum(x.highRiskDeathsPer10Min)?Number(x.highRiskDeathsPer10Min):null,costly:hasNum(x.costlyDeathsPer10Min)?Number(x.costlyDeathsPer10Min):null,severe:hasNum(x.severeDeathsPer10Min)?Number(x.severeDeathsPer10Min):null}};});
  const svg=visualGroupedBarsSvg(groups,[{key:'high',label:'High-risk',cls:'series-risk'},{key:'costly',label:'Costly',cls:'series-costly'},{key:'severe',label:'Severe',cls:'series-severe'}],{ariaLabel:'Risk deaths per ten exposure minutes by game phase'});
  if(!svg){box.innerHTML=visualGraphEmpty('Phase exposure is not sufficient to graph risk rates.');return;}
  box.innerHTML='<div class="visual-graph-legend"><span><i class="series-risk"></i>High-risk</span><span><i class="series-costly"></i>Costly</span><span><i class="series-severe"></i>Severe consequence</span></div>'+svg+'<p class="visual-graph-reading">Rates are normalized per 10 minutes of actual phase exposure; the phase labels include measured exposure. High-risk, costly and severe are overlapping classifications, not slices of one total. Faded bars are below the ≥5-game / ≥20-exposure-minute hotspot evidence floor and remain descriptive only.</p>';
}
function renderOutcomeEffectGraph(r){
  const box=$('outcomeEffectGraph');if(!box)return;
  const m=r?.longHorizon?.longOutcomeFingerprint||{},metrics=Array.isArray(m.metrics)?m.metrics:[],minSide=Math.max(5,Number(m.minPerSideForDirectional||5)),directional=m.directionalEligible===true;
  const rows=metrics.map(spec=>{
    if(Number(spec?.wins?.n||0)<2||Number(spec?.losses?.n||0)<2)return null;
    const effect=standardizedMeanGap(spec.wins,spec.losses);if(!hasNum(effect))return null;
    const adjusted=Number(effect)*Math.sign(Number(spec.wins.mean)-Number(spec.losses.mean))*(spec.inverse?-1:1),ready=directional&&Number(spec.wins.n)>=minSide&&Number(spec.losses.n)>=minSide;
    return{label:spec.label,value:adjusted,ready,tone:ready?(adjusted>0?'good':adjusted<0?'bad':'neutral'):'neutral',valueLabel:signed(adjusted,2)+' gap',
      rawLine:'Wins '+visualOutcomeMeanFormat(spec.wins.mean,spec.unit)+' (n='+spec.wins.n+') · losses '+visualOutcomeMeanFormat(spec.losses.mean,spec.unit)+' (n='+spec.losses.n+')',
      detail:'Signed standardized gap '+signed(adjusted,2)+' · wins '+visualOutcomeMeanFormat(spec.wins.mean,spec.unit)+' n='+spec.wins.n+' · losses '+visualOutcomeMeanFormat(spec.losses.mean,spec.unit)+' n='+spec.losses.n};
  }).filter(Boolean).sort((a,b)=>Math.abs(Number(b.value))-Math.abs(Number(a.value))||String(a.label).localeCompare(String(b.label)));
  if(!rows.length){box.innerHTML=visualGraphEmpty('The long-horizon result split needs at least two valid wins and losses for a graph.');return;}
  const bound=Math.max(1,niceCeil(Math.max(...rows.map(x=>Math.abs(Number(x.value))))*1.14,.5)),usable=rows.filter(x=>x.ready),lead=usable[0]||null;
  box.innerHTML=visualDivergingSvg(rows,{maxAbs:bound,rowDetails:true,neutral:!directional,axisSuffix:'',leftLabel:'less favorable in wins',rightLabel:'more favorable in wins',ariaLabel:'Long-horizon win loss standardized effect sizes with raw result means'})+
    '<p class="visual-graph-reading"><b>Adjusted direction:</b> right means the metric is more favorable in wins; inverse metrics such as deaths are flipped so the visual direction stays consistent. Raw means and sample sizes are shown under every metric. '+(directional?(lead?'Largest supported separation: '+esc(lead.label)+' ('+esc(lead.valueLabel)+').':'No individual metric clears the per-side evidence floor.'):'Clean outcomes do not yet provide '+minSide+' wins and '+minSide+' losses, so the bars are neutral context only.')+' Descriptive association, not causation.</p>';
}
function renderObjectiveFamilyGraph(r){
  const box=$('objectiveFamilyGraph');if(!box)return;
  const summary=r?.behaviorSummary?.objectiveFamilySummary||{};
  const rows=Object.entries(summary).map(([key,x])=>{
    const contested=Number(x?.contestedEncounters||0),joined=Number(x?.joinedContestedEncounters||0),value=hasNum(x?.contestPresenceRate)?Number(x.contestPresenceRate):null,interval=wilsonInterval(joined,contested);
    if(!(contested>0)||!hasNum(value)||!interval)return null;
    return{label:objectiveFamilyLabel(key),value,low:interval.low,high:interval.high,ready:contested>=3,tone:'objective',contested,joined,valueLabel:fmtPct(value)+' · '+joined+'/'+contested,subLabel:'95% range '+fmtPct(interval.low)+'–'+fmtPct(interval.high)+' · '+contested+' contested',detail:objectiveFamilyLabel(key)+' · '+joined+'/'+contested+' contested joins · 95% range '+fmtPct(interval.low)+'–'+fmtPct(interval.high)};
  }).filter(Boolean).sort((a,b)=>b.contested-a.contested||a.label.localeCompare(b.label)).slice(0,7);
  if(!rows.length){box.innerHTML=visualGraphEmpty('No objective family has a measurable contested-presence sample yet.');return;}
  const reviewable=rows.filter(x=>x.ready),lowest=[...reviewable].sort((a,b)=>Number(a.value)-Number(b.value))[0]||null;
  box.innerHTML=visualIntervalPlotSvg(rows,{reference50:false,ariaLabel:'Contested objective presence with Wilson uncertainty by objective family'})+
    '<p class="visual-graph-reading">The dot shows how often you joined. The line shows uncertainty from the exact joined/contested counts. This prevents a small 0% sample from looking like certain zero presence. '+(lowest?'Lowest family with ≥3 contested encounters: '+esc(lowest.label)+' at '+esc(fmtPct(lowest.value))+' ('+lowest.joined+'/'+lowest.contested+').':'No family has three contested encounters yet.')+' Replay-priority context only, not a role grade.</p>';
}
function renderChampionHistoryGraph(r){
  const box=$('championHistoryGraph');if(!box)return;
  const h=r?.longHorizon||{},history=(Array.isArray(h.championHistory)?h.championHistory:[]).filter(x=>Number(x.games||0)>0).sort((a,b)=>Number(b.games||0)-Number(a.games||0)||String(a.champion).localeCompare(String(b.champion))),total=history.reduce((n,x)=>n+Number(x.games||0),0);
  if(!history.length||!(total>0)){box.innerHTML=visualGraphEmpty('No champion-conditioned selected-role history is available yet.');return;}
  const cleanComparable=history.filter(x=>Number(x.cleanGames||0)>=3&&hasNum(x.cleanWinRate)),leader=history[0],leaderShare=Number(leader.games||0)/total*100;
  if(cleanComparable.length<2||leaderShare>=90){
    const top=history.slice(0,5).map(x=>({label:x.champion,games:Number(x.games||0)})),shown=top.reduce((n,x)=>n+x.games,0);if(total>shown)top.push({label:'Other',games:total-shown});
    box.innerHTML=visualCompositionSvg(top,{ariaLabel:'Champion pick mix across selected-role history'})+
      '<p class="visual-graph-reading"><b>Pick concentration:</b> '+esc(leader.champion)+' accounts for '+esc(fmtPct(leaderShare))+' of this '+esc(roleLabel(h.selectedRole||r?.dataQuality?.selectedRole||state.selectedRole))+' history ('+Number(leader.games||0)+'/'+total+' games). A cross-champion clean-WR ranking is withheld because there is not a real multi-champion comparison; showing one dominant champion as a “ranking” would add no useful information.</p>';
    return;
  }
  const rows=cleanComparable.slice(0,8).map(x=>{const interval=wilsonInterval(Number(x.cleanWins||0),Number(x.cleanGames||0));return{label:x.champion,value:Number(x.cleanWinRate),low:interval?.low,high:interval?.high,ready:Number(x.cleanGames||0)>=5,tone:'champion',valueLabel:fmtPct(x.cleanWinRate)+' · '+x.cleanWins+'/'+x.cleanGames,subLabel:'95% range '+fmtPct(interval?.low)+'–'+fmtPct(interval?.high)+' · '+x.games+' total games',detail:x.champion+' · '+x.cleanWins+'/'+x.cleanGames+' clean outcomes · '+x.games+' total history games'};}).filter(x=>hasNum(x.low)&&hasNum(x.high));
  box.innerHTML=visualIntervalPlotSvg(rows,{ariaLabel:'Champion clean win rate with Wilson uncertainty'})+'<p class="visual-graph-reading">The dot is your win rate in comparable outcomes. The line shows uncertainty from the sample size. Champions are ordered by history sample depth, not by the point estimate, so small samples do not visually jump to the top.</p>';
}
function renderVisualAnalytics(r){
  renderRecentFormGraph(r);
  renderPhaseRiskGraph(r);
  renderOutcomeEffectGraph(r);
  renderObjectiveFamilyGraph(r);
  renderChampionHistoryGraph(r);
}
function renderSupportSynergyGraph(m){
  const box=$('supportSynergyGraph');if(!box)return;
  const rows=(Array.isArray(m?.supportChampions)?m.supportChampions:[]).filter(x=>Number(x.cleanGames||0)>=3&&hasNum(x.cleanWinRate)).map(x=>{
    const interval=wilsonInterval(Number(x.cleanWins||0),Number(x.cleanGames||0));if(!interval)return null;
    return{label:x.supportChampion,value:Number(x.cleanWinRate),low:interval.low,high:interval.high,ready:x.rankingEligible===true,tone:x.rankingEligible?'support-established':'support-developing',cleanGames:Number(x.cleanGames||0),wilsonLow:interval.low,valueLabel:fmtPct(x.cleanWinRate)+' · '+x.cleanWins+'/'+x.cleanGames,subLabel:(x.rankingEligible?'Established':'Developing')+' · 95% range '+fmtPct(interval.low)+'–'+fmtPct(interval.high),detail:x.supportChampion+' · reviewed-account clean WR '+fmtPct(x.cleanWinRate)+' · '+x.cleanWins+'/'+x.cleanGames+' clean outcomes · 95% range '+fmtPct(interval.low)+'–'+fmtPct(interval.high)};
  }).filter(Boolean).sort((a,b)=>Number(b.ready)-Number(a.ready)||(a.ready?Number(b.wilsonLow)-Number(a.wilsonLow):Number(b.cleanGames)-Number(a.cleanGames))||String(a.label).localeCompare(String(b.label))).slice(0,10);
  if(!rows.length){box.innerHTML=visualGraphEmpty('Support-champion graph needs at least three clean reviewed-account outcomes with the same allied Support champion.');return;}
  const established=rows.filter(x=>x.ready),best=established[0]||null;
  box.innerHTML='<div class="visual-graph-legend"><span><i class="support-established"></i>Established ≥5 clean</span><span><i class="support-developing"></i>Developing 3–4 clean</span><span><i class="wilson-whisker"></i>95% uncertainty range</span></div>'+
    visualIntervalPlotSvg(rows,{ariaLabel:'Reviewed account clean win rate and uncertainty by allied support champion'})+
    '<p class="visual-graph-reading">The dot is the reviewed account’s clean win rate; the whisker shows its 95% uncertainty range. Established rows are ranked by the Wilson lower bound, while 3–4 game developing samples stay below them regardless of a flashy point estimate.'+(best?' Best established conservative floor: '+esc(best.label)+' at '+esc(fmtPct(best.wilsonLow))+'.':'')+' Support champion remains a grouping variable only; no human teammate performance is evaluated.</p>';
}
function roleEconomyChartSpecs(r,reportRole){
  const roleName=roleLabel(reportRole),adc=reportRole==='ADC'?adcBenchmarkSummary(r):null,bench=adc?r.externalBenchmarks?.same:null;
  const gold={key:'goldDiff15',get:g=>trustedDirectPeer(g)&&g?.phaseRules?.lane15Comparable!==false&&hasNum(g.goldDiff15)?Number(g.goldDiff15):null,title:'Gold @15 vs direct role opponent',q:'Positive means more gold than the actual same-role opponent at 15. Only trusted, coaching-comparable checkpoints are plotted.',unit:'signedGold',formatUnit:'signed',consistencyUnit:'gold',signedAxis:true,relevance:150,fixedMin:-2000,fixedMax:2000,splitCenter:0,splitThreshold:150,evidenceRequirements:[{path:'peerComparison.laneGames15',min:5}]};
  const cs={key:'csDiff15',get:g=>trustedDirectPeer(g)&&g?.phaseRules?.lane15Comparable!==false&&hasNum(g.csDiff15)?Number(g.csDiff15):null,title:'CS @15 vs direct role opponent',q:'Positive means more CS than the actual same-role opponent at 15. Only trusted, coaching-comparable checkpoints are plotted.',unit:'signedCs',formatUnit:'signed',consistencyUnit:'cs',signedAxis:true,relevance:5,fixedMin:-35,fixedMax:35,splitCenter:0,splitThreshold:5,evidenceRequirements:[{path:'peerComparison.laneGames15',min:5}]};
  const dpm={key:'dpm',get:g=>hasNum(g.dpm)?Number(g.dpm):null,title:'Damage per minute · '+roleName+' sample',q:bench?'Selected-role games on a fixed 0–1500 DPM scale. Dashed line = same-tier ADC-adjusted external reference.':'Selected '+roleName+' games on a fixed 0–1500 DPM scale.',unit:'dpm',formatUnit:'int',consistencyUnit:'dpm',fixedMin:0,fixedMax:1500,reference:bench?.dpm,referenceLabel:(bench?.tier||'same tier')+' reference',splitCenter:bench?.dpm,splitThreshold:50,evidenceRequirements:[{path:'coachingSummary.games',min:5}]};
  const kp={key:'kp',get:g=>hasNum(g.kp)?Number(g.kp):null,title:'Kill participation · '+roleName+' sample',q:bench?'Selected-role games on a fixed 0–100% scale. Dashed line = same-tier ADC-adjusted external reference.':'Selected '+roleName+' games on a fixed 0–100% scale.',unit:'percent',formatUnit:'%',consistencyUnit:'percent',fixedMin:0,fixedMax:100,reference:bench?.kp,referenceLabel:(bench?.tier||'same tier')+' reference',splitCenter:bench?.kp,splitThreshold:2,evidenceRequirements:[{path:'coachingSummary.games',min:5}]};
  const impact={key:'impactDeltaVsOpponent',get:g=>trustedDirectPeer(g)&&hasNum(g.impactDeltaVsOpponent)?Number(g.impactDeltaVsOpponent):null,title:'First tracked impact vs '+roleName+' peer',q:'Negative means your first tracked kill/assist/objective impact happened earlier than the actual same-role opponent. Timing is not treated as causal by itself.',unit:'num',formatUnit:'signed1',consistencyUnit:'minutes',signedAxis:true,inverse:true,relevance:1.5,fixedMin:-6,fixedMax:6,splitCenter:0,splitThreshold:1.5,evidenceRequirements:[{path:'peerComparison.impactGames',min:5}]};
  const peerCsMin={key:'peerCsMin',get:g=>trustedDirectPeer(g)&&hasNum(g?.peer?.csMinDelta)?Number(g.peer.csMinDelta):null,title:'CS/min vs '+roleName+' peer',q:'Positive means higher CS/min than the actual same-role opponent over the match. This is farm pace, not lane ownership.',unit:'num',formatUnit:'signed2',consistencyUnit:'csmin',signedAxis:true,relevance:.15,fixedMin:-2.5,fixedMax:2.5,splitCenter:0,splitThreshold:.15,evidenceRequirements:[{path:'peerComparison.csMinGames',min:5}]};
  const peerVpm={key:'peerVpm',get:g=>trustedDirectPeer(g)&&hasNum(g?.peer?.vpmDelta)?Number(g.peer.vpmDelta):null,title:'Vision/min vs '+roleName+' peer',q:'Positive means higher vision score per minute than the actual same-role opponent. This is vision volume, not a standalone vision-quality score.',unit:'num',formatUnit:'signed2',consistencyUnit:'vpm',signedAxis:true,relevance:.15,fixedMin:-2,fixedMax:2,splitCenter:0,splitThreshold:.15,evidenceRequirements:[{path:'peerComparison.vpmGames',min:5}]};
  const itemTiming={key:'itemTiming',get:g=>trustedDirectPeer(g)&&hasNum(g?.itemSpikeDeltaVsOpponent)?Number(g.itemSpikeDeltaVsOpponent):null,title:'First major timing vs '+roleName+' peer',q:'Negative means your first tracked major item completed earlier than the actual same-role opponent. Only trusted peer comparisons with supported item timing are plotted.',unit:'num',formatUnit:'signed1',consistencyUnit:'minutes',signedAxis:true,inverse:true,relevance:.75,fixedMin:-6,fixedMax:6,splitCenter:0,splitThreshold:.75,evidenceRequirements:[{path:'peerComparison.majorItemGames',min:4}]};
  const contest={key:'objectiveContest',get:g=>perGamePct(g?.objectiveReadiness?.contestedJoined,g?.objectiveReadiness?.contestedObjectives),title:'Contested objective presence · '+roleName,q:'Per-game supported presence in team-contested neutral-objective encounters. Missing/no contested event is not converted into zero.',unit:'percent',formatUnit:'%',consistencyUnit:'percent',fixedMin:0,fixedMax:100,evidenceRequirements:[{path:'behaviorSummary.objectiveContestEncounters',min:5},{path:'behaviorSummary.objectiveContestGames',min:3}]};
  const setupDelta={key:'objectiveSetupDelta',get:g=>trustedDirectPeer(g)&&hasNum(g?.vision?.objectiveSetupDeltaVsOpponent)?Number(g.vision.objectiveSetupDeltaVsOpponent):null,title:'Objective setup wards vs '+roleName+' peer',q:'Positive means more supported pre-objective setup wards than the actual same-role opponent in the same game. Missing setup evidence is not converted into zero.',unit:'num',formatUnit:'signed1',consistencyUnit:'num',signedAxis:true,relevance:.5,fixedMin:-4,fixedMax:4,splitCenter:0,splitThreshold:.5,evidenceRequirements:[{path:'peerComparison.visionSetupGames',min:5}]};
  const roam={key:'roamConversion',get:g=>perGamePct(g?.roams?.successes,g?.roams?.attempts),title:'Early roam conversion · '+roleName,q:'Per-game conversion among detected early roam departures. A converted roam can still carry lane cost.',unit:'percent',formatUnit:'%',consistencyUnit:'percent',fixedMin:0,fixedMax:100,evidenceRequirements:[{path:'behaviorSummary.roamAttempts',min:4},{path:'behaviorSummary.roamAttemptGames',min:3}]};
  const adcLaneCost={key:'supportAdcLaneCost',get:g=>perGameSupportAdcLaneCost(g),title:'ADC lane movement during roams',q:'ADC-vs-ADC CS movement measured over detected Support roam windows. Positive is favorable lane movement for your ADC; negative is lane cost. This does not say the roam caused the movement.',unit:'num',formatUnit:'signed1',consistencyUnit:'cs',signedAxis:true,zeroLabel:'NO ADC LANE MOVEMENT',zeroMeaning:'Zero means no measured change in ADC-vs-ADC CS differential during the roam window.',relevance:2,fixedMin:-15,fixedMax:15,splitCenter:0,splitThreshold:2,evidenceRequirements:[{path:'behaviorSummary.supportRoamAdcLaneMovementWindows',min:4},{path:'behaviorSummary.supportRoamAdcLaneMovementGames',min:3}]};
  if(reportRole==='SUPPORT')return[peerVpm,setupDelta,roam,adcLaneCost];
  if(reportRole==='JUNGLE')return[peerCsMin,itemTiming,impact,contest];
  if(reportRole==='MID')return[gold,cs,impact,kp];
  if(reportRole==='TOP')return[gold,cs,dpm,kp];
  return[gold,cs,dpm,kp];
}
function renderCharts(r){
  const reportRole=canonicalRole(r.dataQuality?.selectedRole||r.coachingSummary?.primaryRole||r.summary?.primaryRole),sourceGames=[...reportCoachingGames(r)].filter(g=>canonicalRole(g.role)===reportRole),hasTimestamps=sourceGames.some(g=>Number(g?.gameStartTimestamp||0)>0);
  const chronological=hasTimestamps?sourceGames.sort((a,b)=>Number(a.gameStartTimestamp||0)-Number(b.gameStartTimestamp||0)):sourceGames.reverse(),specs=roleEconomyChartSpecs(r,reportRole);
  const hidden=[];
  $('chartGrid').innerHTML=specs.map(spec=>{
    const points=chronological.map(g=>({matchId:g.matchId,gameStartTimestamp:g.gameStartTimestamp,champion:g.champion,value:spec.get?spec.get(g):g[spec.key]})),evidence=chartSpecEvidence(r,spec);
    const svg=evidence.ready?chartSvg(points,spec):null;
    if(!svg)hidden.push(spec.title);
    const empty=evidence.ready?'Insufficient valid data':'Thin evidence · '+evidence.summary;
    return '<article class="chart-card '+(spec.signedAxis?'signed-chart':'')+(evidence.ready?'':' thin-evidence')+'"><div class="chart-card-head"><div><h3>'+esc(spec.title)+'</h3><p>'+esc(spec.q)+'</p></div><span class="chart-kind">'+(spec.signedAxis?'0 = role peer':'trend')+'</span></div><p class="chart-meta">'+esc(chartMeta(points,evidence))+'</p>'+(svg||'<div class="chart-empty">'+esc(empty)+'</div>')+(svg?'<p class="chart-reading">'+esc(chartSummary(points,spec))+'</p>':'')+chartDataTable(points,spec)+'</article>';
  }).join('');
  const all=[...(r.hiddenCharts||[]),...hidden];
  $('hiddenCharts').hidden=!all.length;$('hiddenCharts').textContent=all.length?'Unavailable / low-sample charts: '+[...new Set(all)].join(', '):'';
  renderConsistencySummary(r);
}
function metric(label,value,pending=false){
  return '<div class="metric-row"><span>'+esc(label)+'</span><strong'+(pending?' class="pending"':'')+'>'+esc(value)+'</strong></div>';
}
function renderAdvanced(r){
  const a=r.advanced||{},roam=a.roams||{},recall=a.recalls||{},itemSpike=a.itemSpike||{};
  const rows=[
    ['@15 lane-checkpoint comparable games',String(r.behaviorSummary?.checkpointEligibility?.lane15Games??'n/a')],
    ['15→25 fixed-checkpoint comparable games',String(r.behaviorSummary?.checkpointEligibility?.fixed15to25Games??'n/a')],
    ['@25 closing-checkpoint comparable games',String(r.behaviorSummary?.checkpointEligibility?.closing25Games??'n/a')],
    ['Team-contested objective presence',fmtPct(a.objectivePresence)],
    ['Team-secured objective presence',fmtPct(a.teamSecuredObjectivePresence??r.behaviorSummary?.teamSecuredObjectiveJoinRate)],
    ['Objective explanation',objectiveDiagnosisLabel(r.behaviorSummary?.objectiveDiagnosis?.primaryExplanation??r.behaviorSummary?.objectiveDiagnosis?.primaryCause)],
    ['Early KP · pooled',fmtPct(a.earlyKP)+' · '+String(r.behaviorSummary?.earlyPlayerKillInvolvements??0)+' / '+String(r.behaviorSummary?.earlyTeamKills??0)+' team kills'],
    ['Early KP · mean game rate',fmtPct(r.behaviorSummary?.meanGameEarlyKp)],
    ['Early role solo kills / deaths',String(r.behaviorSummary?.earlyRoleSoloKills??r.behaviorSummary?.pre14RoleSoloKills??0)+' / '+String(r.behaviorSummary?.earlyRoleSoloDeaths??r.behaviorSummary?.pre14RoleSoloDeaths??0)+' · games '+String(r.behaviorSummary?.earlyRoleSoloKillGames??0)+' / '+String(r.behaviorSummary?.earlyRoleSoloDeathGames??0)],
    ['Plate involvement ≤20m · strong',String(r.behaviorSummary?.first20PlayerPlateInvolvement??r.behaviorSummary?.first20PlayerPlateCredits??0)+' / '+String(r.behaviorSummary?.first20OpponentPlateInvolvement??r.behaviorSummary?.first20OpponentPlateCredits??0)+' vs role peer'],
    ['Matched plate involvement ≤20m · strong',String(r.behaviorSummary?.peerMatchedFirst20PlayerPlateInvolvement??0)+' vs '+String(r.behaviorSummary?.first20OpponentPlateInvolvement??0)+' peer · Δ '+signed(r.behaviorSummary?.first20PlateInvolvementDelta,0)],
    ['Lane-presence-only plate signals ≤20m',String(r.behaviorSummary?.first20PlayerPlateLanePresenceSignals??0)+' all games · '+String(r.behaviorSummary?.peerMatchedFirst20PlayerPlateLanePresenceSignals??0)+' matched vs '+String(r.behaviorSummary?.first20OpponentPlateLanePresenceSignals??0)+' peer'],
    ['Matched plate involvement · full match · strong',String(r.behaviorSummary?.peerMatchedAllGamePlayerPlateInvolvement??0)+' vs '+String(r.behaviorSummary?.allGameOpponentPlateInvolvement??0)+' peer · Δ '+signed(r.behaviorSummary?.allGamePlateInvolvementDelta,0)],
    ['Plate involvement · full match · strong',String(r.behaviorSummary?.allGamePlayerPlateInvolvement??r.behaviorSummary?.allGamePlayerPlateCredits??0)+' / '+String(r.behaviorSummary?.allGameOpponentPlateInvolvement??r.behaviorSummary?.allGameOpponentPlateCredits??0)+' vs role peer'],
    ['Lane-presence-only plate signals · full match',String(r.behaviorSummary?.allGamePlayerPlateLanePresenceSignals??0)+' all games · '+String(r.behaviorSummary?.peerMatchedAllGamePlayerPlateLanePresenceSignals??0)+' matched vs '+String(r.behaviorSummary?.allGameOpponentPlateLanePresenceSignals??0)+' peer'],
    ['Direct-peer timeline games',String(r.behaviorSummary?.directPeerTimelineGames??r.dataQuality?.peerComparableGames??0)],
    ['Clean solo-kill lane conversion',String(r.behaviorSummary?.soloKillConvertedEvents??0)+' / '+String(r.behaviorSummary?.soloKillConversionEvents??0)+' · '+fmtPct(r.behaviorSummary?.soloKillConversionRate)],
    ['Avg gold swing after clean solo kill',hasNum(r.behaviorSummary?.avgSoloKillGoldSwingTo15)?signed(r.behaviorSummary.avgSoloKillGoldSwingTo15,0)+'g to 15':'n/a'],
    ['Avg CS swing after clean solo kill',hasNum(r.behaviorSummary?.avgSoloKillCsSwingTo15)?signed(r.behaviorSummary.avgSoloKillCsSwingTo15,1)+' to 15':'n/a'],
    ['Solo-kill deaths before next shop',String(r.behaviorSummary?.soloKillDeathsBeforeShop??0)+' / '+String(r.behaviorSummary?.soloKillResetEvents??0)+' · '+fmtPct(r.behaviorSummary?.soloKillDeathsBeforeShopRate)],
    ['Avg next-shop delay after solo kill',hasNum(r.behaviorSummary?.avgSoloKillNextShopDelaySec)?fmtInt(r.behaviorSummary.avgSoloKillNextShopDelaySec)+'s':'n/a'],
    ['Early home-lane deaths',String(r.behaviorSummary?.earlyHomeLaneDeaths??r.behaviorSummary?.pre14HomeLaneDeaths??0)+' · '+String(r.behaviorSummary?.earlyHomeLaneDeathGames??0)+' games'],
    ['Outside-pressure classified sample',String(r.behaviorSummary?.earlyClassifiedHomeLaneDeaths??r.behaviorSummary?.earlyHomeLaneDeaths??r.behaviorSummary?.pre14ClassifiedHomeLaneDeaths??r.behaviorSummary?.pre14HomeLaneDeaths??0)+' classified · '+String(r.behaviorSummary?.earlyUnclassifiedHomeLaneDeaths??r.behaviorSummary?.pre14UnclassifiedHomeLaneDeaths??0)+' excluded'],
    ['Outside-pressure classified deaths',String(r.behaviorSummary?.earlyOutsidePressureDeaths??r.behaviorSummary?.pre14OutsidePressureDeaths??0)+' · '+String(r.behaviorSummary?.earlyOutsidePressureDeathGames??0)+' games'],
    ['Outside-pressure share of classified early lane deaths',fmtPct(r.behaviorSummary?.earlyOutsidePressureShare??r.behaviorSummary?.pre14OutsidePressureShare)],
    ['All-game role solo kills / deaths',String(r.behaviorSummary?.roleSoloKills??0)+' / '+String(r.behaviorSummary?.roleSoloDeaths??0)],
    ['≥500g pre-15 lead opportunities',String(r.behaviorSummary?.earlyLeadGames??0)],
    ['Early-lead give-backs',String(r.behaviorSummary?.earlyLeadGivebackGames??0)+' / '+String(r.behaviorSummary?.earlyLeadGames??0)+' · '+fmtPct(r.behaviorSummary?.earlyLeadGivebackRate)],
    ['Avg peak pre-15 role lead',hasNum(r.behaviorSummary?.avgEarlyLeadPeakGold)?signed(r.behaviorSummary.avgEarlyLeadPeakGold,0)+'g':'n/a'],
    ['Avg peak → 15 role-gold swing',hasNum(r.behaviorSummary?.avgEarlyLeadGoldSwingTo15)?signed(r.behaviorSummary.avgEarlyLeadGoldSwingTo15,0)+'g':'n/a'],
    ['Deaths during early-lead give-backs',String(r.behaviorSummary?.earlyLeadGivebackDeaths??0)+' · '+String(r.behaviorSummary?.earlyLeadGivebackHighRiskDeaths??0)+' high-risk'],
    ['First impact timing',hasNum(a.firstImpact?.avgDeltaVsOpponentMin)?signed(a.firstImpact.avgDeltaVsOpponentMin,1)+' min vs peer':'n/a'],
    ['Second major item timing',hasNum(r.behaviorSummary?.avgSecondMajorTime)?fmt(r.behaviorSummary.avgSecondMajorTime,1)+' min · '+String(r.behaviorSummary?.secondMajorGames??0)+' games':'n/a'],
    ['Second major timing vs peer',hasNum(r.behaviorSummary?.avgSecondMajorDeltaVsOpponent)?signed(r.behaviorSummary.avgSecondMajorDeltaVsOpponent,1)+' min · '+String(r.behaviorSummary?.secondMajorPeerGames??0)+' games':'n/a'],
    ['Longest win / loss streak',String(r.outcomeStreaks?.longestWin??0)+' / '+String(r.outcomeStreaks?.longestLoss??0)],
    ['Current result streak',r.outcomeStreaks?.currentResult?(String(r.outcomeStreaks.currentResult).toUpperCase()+' × '+String(r.outcomeStreaks?.currentLength??0)):'n/a'],
    ['Team-contested objective presence · pooled',fmtPct(r.behaviorSummary?.objectiveContestPresenceRate??r.behaviorSummary?.objectiveJoinRate)+' · '+String(r.behaviorSummary?.objectiveContestJoinedEncounters??0)+' / '+String(r.behaviorSummary?.objectiveContestEncounters??0)+' contested encounters'],
    ['Team-contested presence · mean game rate',fmtPct(r.behaviorSummary?.meanGameObjectiveContestPresenceRate)],
    ['Team-secured objective presence · pooled',fmtPct(r.behaviorSummary?.teamSecuredObjectiveJoinRate)+' · '+String(r.behaviorSummary?.objectiveJoinedEncounters??0)+' / '+String(r.behaviorSummary?.objectiveTeamEncounters??0)+' secured encounters'],
    ['Team-secured presence · mean game rate',fmtPct(r.behaviorSummary?.meanGameObjectiveJoinRate)],
    ['Objective-context death % · pooled',fmtPct(a.objectiveDeathPct)+' · '+String(r.behaviorSummary?.objectiveContextDeaths??0)+' / '+String(r.behaviorSummary?.classifiedTimelineDeaths??0)+' classified deaths'],
    ['Objective-context death % · mean game rate',fmtPct(r.behaviorSummary?.meanGameObjectiveDeathPct)],
    ['Death before enemy objective % · pooled',fmtPct(r.behaviorSummary?.preObjectiveDeathPct)+' · '+String(r.behaviorSummary?.preObjectiveDeaths??0)+' / '+String(r.behaviorSummary?.classifiedTimelineDeaths??0)+' classified deaths'],
    ['Death before enemy objective % · mean game rate',fmtPct(r.behaviorSummary?.meanGamePreObjectiveDeathPct)],
    ['Bruisienator V21 DQI · effective pipeline',hasNum(r.behaviorSummary?.avgLegacyBruisienatorDqi)?fmt(r.behaviorSummary.avgLegacyBruisienatorDqi,2)+'/10':'n/a'],
    ['Death-consequence evidence coverage',fmtPct(r.behaviorSummary?.deathConsequenceCoveragePct)],
    ['Death economy samples suppressed by repeat death',String(r.behaviorSummary?.contaminatedDeathEconomySamples??0)],
    ['Isolated deaths · all',String(r.behaviorSummary?.isolatedDeaths??0)],
    ['Death trade rate',fmtPct(r.behaviorSummary?.deathTradeRate)],
    ['High-risk untraded deaths',String(r.behaviorSummary?.highRiskUntradedDeaths??0)+' · '+fmt(r.behaviorSummary?.highRiskUntradedPerGame,1)+'/game'],
    ['Early-phase high-risk deaths',String(r.behaviorSummary?.phaseRisk?.early?.highRiskDeaths??0)+' · '+(hasNum(r.behaviorSummary?.phaseRisk?.early?.highRiskDeathsPer10Min)?fmt(r.behaviorSummary.phaseRisk.early.highRiskDeathsPer10Min,2)+'/10m':fmt(r.behaviorSummary?.phaseRisk?.early?.highRiskDeathsPerGame,2)+'/game legacy')],
    ['Transition-phase high-risk deaths',String(r.behaviorSummary?.phaseRisk?.mid?.highRiskDeaths??0)+' · '+(hasNum(r.behaviorSummary?.phaseRisk?.mid?.highRiskDeathsPer10Min)?fmt(r.behaviorSummary.phaseRisk.mid.highRiskDeathsPer10Min,2)+'/10m':fmt(r.behaviorSummary?.phaseRisk?.mid?.highRiskDeathsPerGame,2)+'/game legacy')],
    ['Late-phase high-risk deaths',String(r.behaviorSummary?.phaseRisk?.late?.highRiskDeaths??0)+' · '+(hasNum(r.behaviorSummary?.phaseRisk?.late?.highRiskDeathsPer10Min)?fmt(r.behaviorSummary.phaseRisk.late.highRiskDeathsPer10Min,2)+'/10m':fmt(r.behaviorSummary?.phaseRisk?.late?.highRiskDeathsPerGame,2)+'/game legacy')],
    ['Early / transition / late costly deaths',String(r.behaviorSummary?.phaseRisk?.early?.costlyDeaths??0)+' / '+String(r.behaviorSummary?.phaseRisk?.mid?.costlyDeaths??0)+' / '+String(r.behaviorSummary?.phaseRisk?.late?.costlyDeaths??0)],
    ['Mid-routing comparable games',String(r.behaviorSummary?.midRouting?.games??0)],
    ['Mid-routing CS swing 15→25',hasNum(r.behaviorSummary?.midRouting?.avgCsSwing15to25)?signed(r.behaviorSummary.midRouting.avgCsSwing15to25,1)+' CS':'n/a'],
    ['Mid-routing objective presence · pooled',fmtPct(r.behaviorSummary?.midRouting?.pooledObjectiveJoinRate??r.behaviorSummary?.midRouting?.avgObjectiveJoinRate)+' · '+String(r.behaviorSummary?.midRouting?.joinedObjectiveEvents??0)+' / '+String(r.behaviorSummary?.midRouting?.teamObjectiveEvents??0)+' contested encounters'],
    ['Mid-routing objective presence · coaching mean game rate',fmtPct(r.behaviorSummary?.midRouting?.coachingObjectivePresenceRate??r.behaviorSummary?.midRouting?.meanGameObjectiveJoinRate)],
    ['Mid-routing inefficient games',String(r.behaviorSummary?.midRouting?.inefficientGames??0)],
    ['Mid-routing balanced games',String(r.behaviorSummary?.midRouting?.balancedGames??0)],
    ['Side-farm / low-presence games',String(r.behaviorSummary?.midRouting?.sideFarmLowPresenceGames??0)],
    ['≥500g role lead @25 games',String(r.behaviorSummary?.closing25?.leadGames??0)],
    ['Win rate from role lead @25',fmtPct(r.behaviorSummary?.closing25?.leadWinRate)],
    ['Lead@25 losses with late risk',String(r.behaviorSummary?.closing25?.leadLossesWithLateRisk??0)+' / '+String(r.behaviorSummary?.closing25?.leadLosses??0)+' · '+fmtPct(r.behaviorSummary?.closing25?.leadLateRiskLossRate)],
    ['Late high-risk / costly deaths in lead@25 losses',String(r.behaviorSummary?.closing25?.lateHighRiskDeathsInLeadLosses??0)+' / '+String(r.behaviorSummary?.closing25?.lateCostlyDeathsInLeadLosses??0)],
    ['≤-500g role deficit @25 games',String(r.behaviorSummary?.closing25?.deficitGames??0)],
    ['Win rate from role deficit @25',fmtPct(r.behaviorSummary?.closing25?.deficitWinRate)],
    ['Measured costly deaths',String(r.behaviorSummary?.costlyDeathEvents??0)+' / '+String(r.behaviorSummary?.measuredDeathConsequences??0)+' · '+fmtPct(r.behaviorSummary?.costlyDeathRate)],
    ['Severe death consequences',String(r.behaviorSummary?.severeDeathEvents??0)+' · '+fmt(r.behaviorSummary?.severeDeathsPerTimelineGame,2)+'/game'],
    ['Rapid repeat deaths',String(r.behaviorSummary?.repeatDeaths??0)+' / '+String(r.behaviorSummary?.repeatDeathOpportunities??0)+' · '+fmtPct(r.behaviorSummary?.repeatDeathRate)],
    ['High-risk / costly repeat deaths',String(r.behaviorSummary?.highRiskRepeatDeaths??0)+' / '+String(r.behaviorSummary?.costlyRepeatDeaths??0)],
    ['Repeat-death rate vs peer · matched',fmtPct(r.behaviorSummary?.peerMatchedRepeatDeathRate)+' / '+fmtPct(r.behaviorSummary?.opponentRepeatDeathRate)+' · Δ '+(hasNum(r.behaviorSummary?.repeatDeathRateDelta)?signed(r.behaviorSummary.repeatDeathRateDelta,0)+' points':'n/a')],
    ['Avg post-death role-gold swing',hasNum(r.behaviorSummary?.avgGoldSwingAfterDeath)?signed(r.behaviorSummary.avgGoldSwingAfterDeath,0)+'g':'n/a'],
    ['Avg post-death role-CS swing',hasNum(r.behaviorSummary?.avgCsSwingAfterDeath)?signed(r.behaviorSummary.avgCsSwingAfterDeath,1):'n/a'],
    ['Deaths while ≥500g behind',String(r.behaviorSummary?.behindStateDeaths??0)],
    ['High-risk while behind',String(r.behaviorSummary?.highRiskBehindDeaths??0)+' · '+fmtPct(r.behaviorSummary?.highRiskBehindDeathRate)],
    ['Enemy objective after death',String(a.preObjectiveDeaths??0)+' deaths · '+fmtPct(a.preObjectiveDeathPct)+' of classified deaths'],
    ['Post-macro-transition side-lane deaths',String(r.behaviorSummary?.macroTransitionSideLaneDeaths??r.behaviorSummary?.postLaneSideLaneDeaths??r.behaviorSummary?.post15SideLaneDeaths??0)],
    ['Isolated side-lane deaths',String(r.behaviorSummary?.isolatedSideLaneDeaths??0)+' · '+fmtPct(r.behaviorSummary?.isolatedSideLaneDeathRate)],
    ['Pre-objective side-lane deaths',String(r.behaviorSummary?.preNeutralObjectiveSideLaneDeaths??0)+' · '+fmt(r.behaviorSummary?.preNeutralObjectiveSideLaneDeathsPerGame,2)+'/game'],
    ['Post-impact deaths',String(r.behaviorSummary?.postImpactDeaths??0)+' / '+String(r.behaviorSummary?.playerImpactEvents??0)+' · '+fmtPct(r.behaviorSummary?.postImpactDeathRate)],
    ['High-risk untraded post-impact',String(r.behaviorSummary?.highRiskUntradedPostImpactDeaths??0)+' · '+fmt(r.behaviorSummary?.highRiskUntradedPostImpactPerGame,2)+'/game'],
    ['Top risky-death area',r.behaviorSummary?.topBadDeathZone?String(r.behaviorSummary.topBadDeathZone)+' · '+fmtPct(r.behaviorSummary.topBadDeathZonePct):'n/a'],
    ['Roam attempts / success',String(roam.attempts??0)+' / '+fmtPct(roam.successRate)],
    ['Coaching roam lane movement',hasNum(roam.avgLaneCostCs)?signed(roam.avgLaneCostCs,1)+' CS avg · '+String(roam.emptyCostlyRoams??0)+' empty costly':'n/a'],
    ['First-reset measured / clean games',String(r.behaviorSummary?.firstResetMeasuredGames??0)+' / '+String(r.behaviorSummary?.firstResetCleanGames??0)],
    ['First-reset loss / gain games',String(r.behaviorSummary?.firstResetLossGames??0)+' / '+String(r.behaviorSummary?.firstResetGainGames??0)],
    ['First-reset loss rate',fmtPct(r.behaviorSummary?.firstResetLossRate)],
    ['First-reset approximate spend samples',String(r.behaviorSummary?.firstResetApproximateSpendGames??0)+' / '+String(r.behaviorSummary?.firstResetMeasuredGames??0)],
    ['Avg first-reset role-gold swing',hasNum(r.behaviorSummary?.avgFirstResetGoldSwing)?signed(r.behaviorSummary.avgFirstResetGoldSwing,0)+'g':'n/a'],
    ['Avg first-reset role-CS swing',hasNum(r.behaviorSummary?.avgFirstResetCsSwing)?signed(r.behaviorSummary.avgFirstResetCsSwing,1)+' CS':'n/a'],
    ['Avg first-reset timing vs peer',hasNum(r.behaviorSummary?.avgFirstResetTimingDelta)?signed(r.behaviorSummary.avgFirstResetTimingDelta,1)+' min':'n/a'],
    ['High-gold stay windows',String(recall.greedyStayWindows??0)],
    ['Major affordability sample',String(recall.majorReadinessGames??r.behaviorSummary?.majorReadinessGames??0)+' games'],
    ['Delayed fundable completions',String(recall.delayedMajorCompletionGames??r.behaviorSummary?.delayedMajorCompletionGames??0)+' / '+String(recall.majorReadinessGames??r.behaviorSummary?.majorReadinessGames??0)],
    ['Avg affordable → purchase delay',hasNum(recall.avgMajorCompletionDelayMin)?fmt(recall.avgMajorCompletionDelayMin,1)+' min':'n/a'],
    ['Readiness delay vs peer',hasNum(recall.avgMajorCompletionDelayVsPeerMin)?signed(recall.avgMajorCompletionDelayVsPeerMin,1)+' min · '+String(recall.majorReadinessPeerGames??0)+' games':'n/a'],
    ['Major-item Δ vs opponent',hasNum(itemSpike.avgDeltaVsOpponentMin)?signed(itemSpike.avgDeltaVsOpponentMin,1)+' min':'n/a'],
    ['Earlier-item windows used',String(itemSpike.utilizedWindows??0)+' / '+String(itemSpike.eligibleWindows??0)+' · '+fmtPct(itemSpike.utilizationRate)],
    ['Deaths before spike impact',String(itemSpike.deathsBeforeImpact??0)],
    ['Avg earlier-item lead',hasNum(itemSpike.avgLeadSec)?fmtInt(itemSpike.avgLeadSec)+'s':'n/a'],
    ['Damage share − gold share',hasNum(r.behaviorSummary?.damageGoldEfficiency)?signed(r.behaviorSummary.damageGoldEfficiency,1)+' points':'n/a'],
    ['Fight samples · active involvement',String(r.behaviorSummary?.fightSamples??0)],
    ['Fight presence · supported',String(r.behaviorSummary?.fightPresenceSamples??r.behaviorSummary?.fightSamples??0)],
    ['Fight presence · proximity-only',String(r.behaviorSummary?.fightProximityOnlySamples??0)],
    ['First allied death · active fights',fmtPct(r.behaviorSummary?.firstAllyFightDeathRate)],
    ['Died before contribution · active fights',fmtPct(r.behaviorSummary?.preContributionFightDeathRate)],
    ['Fight survival · active fights',fmtPct(r.behaviorSummary?.fightSurvivalRate)],
    ['Fight starts with ≥1000g unspent',String(r.behaviorSummary?.highUnspentFightStarts??0)+' / '+String(r.behaviorSummary?.highUnspentFightSamples??r.behaviorSummary?.fightSamples??0)+' · '+fmtPct(r.behaviorSummary?.highUnspentFightRate)],
    ['Fight starts down major item',String(r.behaviorSummary?.itemDisadvantageFightStarts??0)+' / '+String(r.behaviorSummary?.itemDisadvantageFightSamples??r.behaviorSummary?.fightSamples??0)+' · '+fmtPct(r.behaviorSummary?.itemDisadvantageFightRate)],
    ['Fight starts ≥600g down vs role',String(r.behaviorSummary?.goldDeficitFightStarts??0)+' / '+String(r.behaviorSummary?.goldDeficitFightSamples??r.behaviorSummary?.fightSamples??0)+' · '+fmtPct(r.behaviorSummary?.goldDeficitFightRate)],
    ['Locally outnumbered fight starts',String(r.behaviorSummary?.outnumberedFightStarts??0)+' / '+String(r.behaviorSummary?.outnumberedFightSamples??r.behaviorSummary?.fightSamples??0)+' · '+fmtPct(r.behaviorSummary?.outnumberedFightStartRate)],
    ['Loss rate when locally outnumbered',fmtPct(r.behaviorSummary?.outnumberedFightLossRate)],
    ['Shared fights with role peer nearby',String(r.behaviorSummary?.rolePeerFightSamples??0)],
    ['Level-down shared-role fights',String(r.behaviorSummary?.roleLevelDisadvantageFightStarts??0)+' · '+fmtPct(r.behaviorSummary?.roleLevelDisadvantageFightRate)],
    ['Tracked vision actions',String(r.behaviorSummary?.visionActions??0)],
    ['Vision-action deaths',String(r.behaviorSummary?.visionActionDeaths??0)+' · '+fmtPct(r.behaviorSummary?.visionActionDeathRate)],
    ['High-risk vision-action deaths',String(r.behaviorSummary?.highRiskVisionActionDeaths??0)+' · '+fmt(r.behaviorSummary?.highRiskVisionActionDeathsPerGame,2)+'/game'],
    ['Unsupported vision-action deaths',String(r.behaviorSummary?.unsupportedVisionActionDeaths??0)],
    ['Untraded vision-action deaths',String(r.behaviorSummary?.untradedVisionActionDeaths??0)],
    ['Objective-setup vision deaths',String(r.behaviorSummary?.objectiveSetupVisionActionDeaths??0)],
    ['Objective-setup vision Δ',hasNum(a.visionSetup?.avgDeltaVsOpponent)?signed(a.visionSetup.avgDeltaVsOpponent,1)+' wards vs peer':'n/a'],
    ['Player-supported post-kill conversion · all valid games',String(r.behaviorSummary?.killConversions??0)+' / '+String(r.behaviorSummary?.killConversionWindows??0)+' · '+fmtPct(r.behaviorSummary?.killConversionRate)],
    ['Player-supported conversion · matched peer games',String(r.behaviorSummary?.peerMatchedKillConversions??0)+' / '+String(r.behaviorSummary?.peerMatchedKillConversionWindows??0)+' · '+fmtPct(r.behaviorSummary?.peerMatchedKillConversionRate)],
    ['Team conversion after your kill windows',String(r.behaviorSummary?.teamKillConversions??0)+' / '+String(r.behaviorSummary?.killConversionWindows??0)+' · '+fmtPct(r.behaviorSummary?.teamKillConversionRate)],
    ['Peer-supported post-kill conversion · matched games',String(r.behaviorSummary?.opponentKillConversions??0)+' / '+String(r.behaviorSummary?.opponentKillConversionWindows??0)+' · '+fmtPct(r.behaviorSummary?.opponentKillConversionRate)],
    ['Peer team conversion context',String(r.behaviorSummary?.oppTeamKillConversions??r.behaviorSummary?.opponentTeamKillConversions??0)+' / '+String(r.behaviorSummary?.opponentKillConversionWindows??0)+' · '+fmtPct(r.behaviorSummary?.opponentTeamKillConversionRate)],
    ['Prior setup presence (45–105s)',String(r.behaviorSummary?.earlySetupObjectiveJoins??0)+' / '+String(r.behaviorSummary?.neutralObjectiveJoins??0)+' joins · '+fmtPct(r.behaviorSummary?.earlySetupObjectiveJoinRate)],
    ['Event-frame-only neutral-objective joins',String(r.behaviorSummary?.eventFrameOnlyObjectiveJoins??0)],
    ['Neutral-objective setup coverage',fmtPct(r.behaviorSummary?.earlySetupObjectiveCoverageRate)],
    ['Recent-shop objective absences',String(r.behaviorSummary?.recentShopObjectiveAbsences??r.behaviorSummary?.lateResetObjectiveMisses??0)+' / '+String(r.behaviorSummary?.neutralObjectiveEvents??0)+' · '+fmtPct(r.behaviorSummary?.recentShopObjectiveAbsenceRate??r.behaviorSummary?.lateResetObjectiveMissRate)],
    ['Fresh-purchase neutral-objective joins',String(r.behaviorSummary?.freshPurchaseObjectiveJoins??0)+' · '+fmtPct(r.behaviorSummary?.freshPurchaseObjectiveJoinRate)],
    ['Objective-setup ward clears',String(r.behaviorSummary?.visionSetupClears??0)],
    ['Control Wards bought',String(r.behaviorSummary?.visionControlWardPurchases??0)]
  ];
  const familySummary=r.behaviorSummary?.objectiveFamilySummary||{};
  for(const [family,x] of Object.entries(familySummary).sort((a,b)=>String(a[0]).localeCompare(String(b[0])))){
    rows.push(['Objective · '+String(family).replaceAll('_',' '),String(x.joinedContestedEncounters??0)+' / '+String(x.contestedEncounters??0)+' contested joined · '+fmtPct(x.contestPresenceRate)+' · secured-presence '+fmtPct(x.teamJoinRate)+' · secured units '+String(x.teamUnitsSecured??0)+' vs '+String(x.enemyUnitsSecured??0)]);
  }
  $('advancedMetrics').innerHTML=rows.map(([l,v])=>metric(l,v,String(v).includes('not recovered')||v==='n/a')).join('')+
    '<div class="source-note">Result streaks are descriptive contiguous outcomes within the eligible Last-20 sample; they are not treated as evidence of tilt, momentum, or player psychology.</div>';
  const p=r.peerComparison||{},conv=r.conversion||{},wl=r.winLoss||{},trend=r.recentTrend||{},session=r.sessionBehavior||{},base=r.coachingLifetime||null,s=r.coachingSummary||r.summary||{},rank=r.profile?.rank||null,rankBands=p.rankBands||{};
  const rankBandLine=(x)=>x&&Number(x.games)?String(x.games)+' matched games · @15 '+signed(x.avgGoldDiff15,0)+'g (n='+String(x.laneGames??0)+') · CS/min '+signed(x.avgCsMinDelta,2)+' (n='+String(x.csMinGames??x.games??0)+') · DPM '+signed(x.avgDpmDelta,0)+' (n='+String(x.dpmGames??x.games??0)+') · first major '+signed(x.avgMajorItemDeltaMin,1)+'m (n='+String(x.majorItemGames??0)+')':'n/a';
  const peerRows=[
    metric('Peer definition',p.definition||'Same-role opponent in each match',false),
    metric('Comparable peer games',String(p.sameRoleGames??0),false),
    metric('Rank-comparable peer games',String(p.rankedPeerGames??0),false),
    metric('Rank context excluded',String(p.rankContextExcludedGames??0),Number(p.rankContextExcludedGames||0)>0),
    metric('Rank ladders used',Object.entries(p.rankComparisonQueueCounts||{}).map(([k,v])=>String(k).replace('RANKED_','')+' '+String(v)).join(' · ')||'n/a',!Object.keys(p.rankComparisonQueueCounts||{}).length),
    metric('Higher-ranked peer games',String(p.higherRankPeerGames??0),false),
    metric('Same-rank peer games',String(p.sameRankPeerGames??0),false),
    metric('Lower-ranked peer games',String(p.lowerRankPeerGames??0),false),
    metric('Higher-rank band',rankBandLine(rankBands.higher),!(rankBands.higher&&Number(rankBands.higher.games))),
    metric('Same-rank band',rankBandLine(rankBands.same),!(rankBands.same&&Number(rankBands.same.games))),
    metric('Lower-rank band',rankBandLine(rankBands.lower),!(rankBands.lower&&Number(rankBands.lower.games))),
    metric('Gold @15 vs peer',hasNum(p.avgGoldDiff15)?signed(p.avgGoldDiff15,0)+'g':'n/a',!hasNum(p.avgGoldDiff15)),
    metric('Beat peer on gold @15',fmtPct(p.gold15OutperformPct),!hasNum(p.gold15OutperformPct)),
    metric('CS/min vs peer',hasNum(p.avgCsMinDelta)?signed(p.avgCsMinDelta,2)+' · n='+String(p.csMinGames??p.sameRoleGames??0):'n/a',!hasNum(p.avgCsMinDelta)),
    metric('Beat peer on CS/min',fmtPct(p.csMinOutperformPct)+(hasNum(p.csMinOutperformPct)?' · n='+String(p.csMinGames??p.sameRoleGames??0):''),!hasNum(p.csMinOutperformPct)),
    metric('DPM vs peer',hasNum(p.avgDpmDelta)?signed(p.avgDpmDelta,0)+' · n='+String(p.dpmGames??p.sameRoleGames??0):'n/a',!hasNum(p.avgDpmDelta)),
    metric('Beat peer on DPM',fmtPct(p.dpmOutperformPct)+(hasNum(p.dpmOutperformPct)?' · n='+String(p.dpmGames??p.sameRoleGames??0):''),!hasNum(p.dpmOutperformPct)),
    metric('Vision/min vs peer',hasNum(p.avgVpmDelta)?signed(p.avgVpmDelta,2)+' · n='+String(p.vpmGames??p.sameRoleGames??0):'n/a',!hasNum(p.avgVpmDelta)),
    metric('Beat peer on vision/min',fmtPct(p.vpmOutperformPct)+(hasNum(p.vpmOutperformPct)?' · n='+String(p.vpmGames??p.sameRoleGames??0):''),!hasNum(p.vpmOutperformPct)),
    metric('Objective-setup ward games',String(p.visionSetupGames??0),false),
    metric('Objective-setup wards vs peer',hasNum(p.avgObjectiveSetupDelta)?signed(p.avgObjectiveSetupDelta,1):'n/a',!hasNum(p.avgObjectiveSetupDelta)),
    metric('Beat peer on setup wards',fmtPct(p.objectiveSetupOutperformPct),!hasNum(p.objectiveSetupOutperformPct)),
    metric('Your objective-setup share · all valid games',hasNum(p.objectiveSetupWardRate)?fmtPct(p.objectiveSetupWardRate):'n/a',!hasNum(p.objectiveSetupWardRate)),
    metric('Your objective-setup share · matched peer games',hasNum(p.peerMatchedObjectiveSetupWardRate)?fmtPct(p.peerMatchedObjectiveSetupWardRate):'n/a',!hasNum(p.peerMatchedObjectiveSetupWardRate)),
    metric('Peer objective-setup share · matched games',hasNum(p.opponentObjectiveSetupWardRate)?fmtPct(p.opponentObjectiveSetupWardRate):'n/a',!hasNum(p.opponentObjectiveSetupWardRate)),
    metric('Objective-setup share Δ · matched',hasNum(p.objectiveSetupWardRateDelta)?signed(p.objectiveSetupWardRateDelta,0)+' points':'n/a',!hasNum(p.objectiveSetupWardRateDelta)),
    metric('Your repeat-death rate · all valid games',fmtPct(p.repeatDeathRate),!hasNum(p.repeatDeathRate)),
    metric('Your repeat-death rate · matched peer games',fmtPct(p.peerMatchedRepeatDeathRate),!hasNum(p.peerMatchedRepeatDeathRate)),
    metric('Peer repeat-death rate · matched games',fmtPct(p.opponentRepeatDeathRate),!hasNum(p.opponentRepeatDeathRate)),
    metric('Repeat-death rate Δ · matched',hasNum(p.repeatDeathRateDelta)?signed(p.repeatDeathRateDelta,0)+' points':'n/a',!hasNum(p.repeatDeathRateDelta)),
    metric('Major-item timing vs peer',hasNum(p.avgMajorItemDeltaMin)?signed(p.avgMajorItemDeltaMin,1)+' min':'n/a',!hasNum(p.avgMajorItemDeltaMin)),
    metric('Faster major item than peer',fmtPct(p.majorItemFasterPct),!hasNum(p.majorItemFasterPct)),
    metric('Measurable earlier-item windows',String(p.itemSpikeEligibleWindows??0),false),
    metric('Earlier-item windows used',fmtPct(p.itemSpikeUtilizationRate),!hasNum(p.itemSpikeUtilizationRate)),
    metric('Deaths before spike impact',String(p.itemSpikeDeathsBeforeImpact??0),false),
    metric('Avg earlier-item lead',hasNum(p.avgItemSpikeLeadSec)?fmtInt(p.avgItemSpikeLeadSec)+'s':'n/a',!hasNum(p.avgItemSpikeLeadSec)),
    metric('First-impact comparable games',String(p.impactGames??0),false),
    metric('First impact vs peer',hasNum(p.avgImpactDeltaMin)?signed(p.avgImpactDeltaMin,1)+' min':'n/a',!hasNum(p.avgImpactDeltaMin)),
    metric('You impact first',fmtPct(p.impactEarlierPct),!hasNum(p.impactEarlierPct)),
    metric('Mid-game comparable games',String(p.midgameComparableGames??0),false),
    metric('Gold swing 15→25',hasNum(p.avgGoldSwing15to25)?signed(p.avgGoldSwing15to25,0)+'g':'n/a',!hasNum(p.avgGoldSwing15to25)),
    metric('CS swing 15→25',hasNum(p.avgCsSwing15to25)?signed(p.avgCsSwing15to25,1)+' CS · '+String(p.midgameCsGames??0)+' games':'n/a',!hasNum(p.avgCsSwing15to25)),
    metric('Lead swing 15→25',hasNum(p.avgLeadSwing15to25)?signed(p.avgLeadSwing15to25,0)+'g · '+String(p.leadGames15to25??0)+' games':'n/a',!hasNum(p.avgLeadSwing15to25)),
    metric('Deficit recovery 15→25',hasNum(p.avgDeficitSwing15to25)?signed(p.avgDeficitSwing15to25,0)+'g · '+String(p.deficitGames15to25??0)+' games':'n/a',!hasNum(p.avgDeficitSwing15to25)),
    metric('Higher-rank gold @15',hasNum(p.higherRankAvgGoldDiff15)?signed(p.higherRankAvgGoldDiff15,0)+'g':'n/a',!hasNum(p.higherRankAvgGoldDiff15)),
    metric('Beat higher-rank peer on gold @15',fmtPct(p.higherRankGoldOutperformPct),!hasNum(p.higherRankGoldOutperformPct)),
    metric('DPM vs higher-rank peer',hasNum(p.higherRankAvgDpmDelta)?signed(p.higherRankAvgDpmDelta,0):'n/a',!hasNum(p.higherRankAvgDpmDelta)),
    metric('Higher-rank major-item games',String(p.higherRankMajorItemGames??0),false),
    metric('Major-item timing vs higher-rank peer',hasNum(p.higherRankAvgMajorItemDeltaMin)?signed(p.higherRankAvgMajorItemDeltaMin,1)+' min':'n/a',!hasNum(p.higherRankAvgMajorItemDeltaMin)),
    metric('Faster major item vs higher-rank peer',fmtPct(p.higherRankMajorItemFasterPct),!hasNum(p.higherRankMajorItemFasterPct)),
    metric('Post-kill conversion Δ · matched',hasNum(r.behaviorSummary?.killConversionDelta)?signed(r.behaviorSummary.killConversionDelta,0)+' points':'n/a',!hasNum(r.behaviorSummary?.killConversionDelta))
  ];
  const conversionRows=[
    metric('Wins when ≥250g ahead @15',hasNum(conv.laneLeadWinRate)?fmtPct(conv.laneLeadWinRate)+' · '+String(conv.laneLeadGames||0)+' games':'n/a',!hasNum(conv.laneLeadWinRate)),
    metric('Wins when ≥250g behind @15',hasNum(conv.laneDeficitWinRate)?fmtPct(conv.laneDeficitWinRate)+' · '+String(conv.laneDeficitGames||0)+' games':'n/a',!hasNum(conv.laneDeficitWinRate)),
    metric('Wins when ≥500g ahead @25',hasNum(conv.lead25WinRate)?fmtPct(conv.lead25WinRate)+' · '+String(conv.lead25Games||0)+' games':'n/a',!hasNum(conv.lead25WinRate)),
    metric('Wins when ≥500g behind @25',hasNum(conv.deficit25WinRate)?fmtPct(conv.deficit25WinRate)+' · '+String(conv.deficit25Games||0)+' games':'n/a',!hasNum(conv.deficit25WinRate))
  ];
  const wlRow=(label,obj,formatter)=>metric(label,obj&&hasNum(obj.wins)&&hasNum(obj.losses)?formatter(obj.wins)+' / '+formatter(obj.losses):'n/a',!(obj&&hasNum(obj.wins)&&hasNum(obj.losses)));
  const pooledWlRow=(label,obj)=>metric(label,obj&&hasNum(obj.wins)&&hasNum(obj.losses)?fmtPct(obj.wins)+' / '+fmtPct(obj.losses)+' · events '+String(obj.winsEvidence?.denominator??0)+' / '+String(obj.lossesEvidence?.denominator??0):'n/a',!(obj&&hasNum(obj.wins)&&hasNum(obj.losses)));
  const winLossRows=[
    wlRow('Gold @15 · wins / losses',wl.goldDiff15,v=>signed(v,0)+'g'),
    wlRow('High-risk deaths · wins / losses',wl.badDeaths,v=>fmt(v,1)),
    pooledWlRow('Early KP · wins / losses · pooled',wl.earlyKp),
    pooledWlRow('Team-contested objective presence · wins / losses · pooled',wl.objectiveJoin),
    pooledWlRow('Team-secured objective presence · wins / losses · pooled',wl.securedObjectiveJoin),
    wlRow('Greedy stays · wins / losses',wl.greedyStays,v=>fmt(v,1))
  ];
  const trendRow=(label,obj,formatter)=>metric(label,obj&&hasNum(obj.recent)&&hasNum(obj.prior)?formatter(obj.recent)+' / '+formatter(obj.prior):'n/a',!(obj&&hasNum(obj.recent)&&hasNum(obj.prior)));
  const eventCoveredTrendRow=(label,obj)=>{
    const aggregation=String(obj?.aggregation||''),suffix=aggregation==='mean_games_with_event_coverage'?'equal-weight game mean':aggregation==='pooled_events'?'pooled event rate':'event-covered rate';
    return metric(label+' · '+suffix,obj&&hasNum(obj.recent)&&hasNum(obj.prior)?fmtPct(obj.recent)+' / '+fmtPct(obj.prior)+' · events '+String(obj.recentEvents??0)+' / '+String(obj.priorEvents??0):'n/a',!(obj&&hasNum(obj.recent)&&hasNum(obj.prior)));
  };
  const trendRows=[
    trendRow('Latest 5 CS/min / previous',trend.csMin,v=>fmt(v,2)),
    trendRow('Latest 5 gold @15 / previous',trend.goldDiff15,v=>signed(v,0)+'g'),
    trendRow('Latest 5 high-risk deaths / previous',trend.badDeaths,v=>fmt(v,1)),
    trendRow('Latest 5 DPM / previous',trend.dpm,v=>fmtInt(v)),
    eventCoveredTrendRow('Latest 5 team-contested presence / previous',trend.objectiveJoin),
    eventCoveredTrendRow('Latest 5 team-secured presence / previous',trend.securedObjectiveJoin),
    eventCoveredTrendRow('Latest 5 early KP / previous',trend.earlyKp)
  ];
  const sessionRows=[
    metric('Session model',session.definition||'Not enough data',!session.definition),
    metric('Session-opening games',String(session.firstGame?.games??0),false),
    metric('Game 3+ sample',String(session.game3Plus?.games??0),false),
    metric('Game 3+ gold @15 delta',hasNum(session.game3PlusGoldDelta)?signed(session.game3PlusGoldDelta,0)+'g':'n/a',!hasNum(session.game3PlusGoldDelta)),
    metric('Game 3+ high-risk death delta',hasNum(session.game3PlusBadDeathDelta)?signed(session.game3PlusBadDeathDelta,2)+' / game':'n/a',!hasNum(session.game3PlusBadDeathDelta)),
    metric('Game 3+ DPM delta',hasNum(session.game3PlusDpmDelta)?signed(session.game3PlusDpmDelta,0):'n/a',!hasNum(session.game3PlusDpmDelta)),
    metric('Quick post-loss sample',String(session.quickAfterLoss?.games??0),false),
    metric('Quick post-win sample',String(session.quickAfterWin?.games??0),false),
    metric('Post-loss requeue gold @15 delta',hasNum(session.postLossGoldDelta)?signed(session.postLossGoldDelta,0)+'g':'n/a',!hasNum(session.postLossGoldDelta)),
    metric('Post-loss high-risk death delta',hasNum(session.postLossBadDeathDelta)?signed(session.postLossBadDeathDelta,2)+' / game':'n/a',!hasNum(session.postLossBadDeathDelta))
  ];
  const baselineRows=base?[
    metric('Broader cached sample',String(base.games||0)+' games',false),
    metric('WR · recent / baseline',fmtPct(s.winRate)+' / '+fmtPct(base.winRate),false),
    metric('CS/min · recent / baseline',fmt(s.csMin,2)+' / '+fmt(base.csMin,2),false),
    metric('KP · recent / baseline',fmtPct(s.kp)+' / '+fmtPct(base.kp),false),
    metric('DPM · recent / baseline',fmtInt(s.dpm)+' / '+fmtInt(base.dpm),false)
  ]:[metric('Recent vs broader baseline','Cache more than 20 games to enable',true)];
  $('benchmarkMetrics').innerHTML=[
    metric('Current Riot rank',rank&&rank.tier?[rank.tier,rank.rank,rank.leaguePoints!=null?rank.leaguePoints+' LP':''].filter(Boolean).join(' '):'Not available',!(rank&&rank.tier)),
    ...peerRows,...conversionRows,...winLossRows,...trendRows,...sessionRows,...baselineRows
  ].join('');
}
function diagnosticChip(label,value,tone='neutral',evidenceReady=true,sample=''){
  return '<span class="diagnostic-chip tone-'+(evidenceReady?tone:'neutral')+(evidenceReady?'':' thin-evidence')+'"><small>'+esc(label)+(sample?' · '+esc(sample):'')+'</small><b>'+esc(value)+'</b></span>';
}

function queueContextLabel(q,family){
  const id=Number(q||0),known={400:'Normal Draft',420:'Ranked Solo',430:'Normal Blind',440:'Ranked Flex',480:'Swiftplay',490:'Quickplay',700:'Clash'};
  return (known[id]||('Queue '+(id||'?')))+(family?' · '+String(family).replaceAll('_',' '):'');
}
function renderRoleSectionCopy(r){
  const role=canonicalRole(r?.dataQuality?.selectedRole||r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||state.selectedRole),nav=$('laneEconomyNav'),eyebrow=$('laneEconomyEyebrow'),title=$('laneEconomyTitle'),hint=$('laneEconomyHint');
  const copy={
    ADC:{nav:'Lane & economy',eyebrow:'Lane & economy',title:'Are you leaving bot lane ahead or behind?',hint:'Current ADC coaching cohort only. Signed direct-role economy charts use a fixed neutral line at zero; older-mechanics context stays in match history.'},
    TOP:{nav:'Lane & side economy',eyebrow:'Lane & side economy',title:'Are lane advantages surviving into side-lane pressure?',hint:'Current TOP coaching cohort only. Direct-role lane checkpoints are separated from later side-lane and objective-timing evidence.'},
    MID:{nav:'Lane → map economy',eyebrow:'Lane → map economy',title:'Are lane resources turning into useful map tempo?',hint:'Current MID coaching cohort only. Lane checkpoints, 15→25 routing and direct-role comparisons remain separate so movement does not erase its lane cost.'},
    JUNGLE:{nav:'Jungle economy & tempo',eyebrow:'Jungle economy & tempo',title:'Are farm and item timings becoming earlier map impact?',hint:'Current JUNGLE coaching cohort only. Direct-jungle farm/item comparisons are separated from objective presence so one does not stand in for the other.'},
    SUPPORT:{nav:'Support economy & setup',eyebrow:'Support economy & setup',title:'Are support resources, vision and movement buying enough map value?',hint:'Current SUPPORT coaching cohort only. Support economy is contextual; roam, ADC lane movement, vision and objective setup evidence are interpreted separately.'}
  }[role]||{nav:'Role economy',eyebrow:'Role economy',title:'How does your role economy develop?',hint:'Current coaching cohort only.'};
  if(nav)nav.textContent=copy.nav;if(eyebrow)eyebrow.textContent=copy.eyebrow;if(title)title.textContent=copy.title;if(hint)hint.textContent=copy.hint;
}

function championDiagnosticSet(v,role,base,riskBase){
  const riskDelta=hasNum(v.badDeaths)&&hasNum(riskBase.badDeathsPerTimelineGame)?Number(v.badDeaths)-Number(riskBase.badDeathsPerTimelineGame):null,riskN=Number(v.timelineGames||0),itemN=Number(v.itemGames||0),itemDelta=hasNum(v.itemDelta)?Number(v.itemDelta):null;
  if(role==='SUPPORT'){
    const roamN=Number(v.roamAttempts||0),roamGames=Number(v.roamAttemptGames||0),roamRate=hasNum(v.roamSuccessRate)?Number(v.roamSuccessRate):null,costN=Number(v.supportAdcCostEvents||0),costGames=Number(v.supportAdcLaneMovementGames||0),cost=hasNum(v.meanGameSupportAdcLaneMovementCs)?Number(v.meanGameSupportAdcLaneMovementCs):hasNum(v.avgSupportAdcLaneCostCs)?Number(v.avgSupportAdcLaneCostCs):null,vpmN=Number(v.vpmGames||0),vpm=hasNum(v.avgVpmDelta)?Number(v.avgVpmDelta):null,setupN=Number(v.visionSetupGames||0),setup=hasNum(v.avgObjectiveSetupDelta)?Number(v.avgObjectiveSetupDelta):null,roamReady=roamN>=4&&roamGames>=3,costReady=costN>=4&&costGames>=3;
    return{
      chips:[
        diagnosticChip('Roam conversion',roamRate==null?'n/a':fmtPct(roamRate),roamRate==null?'neutral':roamRate>=65?'good':roamRate<45?'bad':'neutral',roamReady,roamN+' attempts · '+roamGames+' games'),
        diagnosticChip('ADC lane movement on roams',cost==null?'n/a':signed(cost,1)+' CS',deltaTone(cost,0,2,false),costReady,costN+' windows · '+costGames+' games'),
        diagnosticChip('VPM vs Support peer',vpm==null?'n/a':signed(vpm,2),deltaTone(vpm,0,.15),vpmN>=3,'n='+vpmN),
        diagnosticChip('Setup wards vs Support',setup==null?'n/a':signed(setup,1),deltaTone(setup,0,.5),setupN>=3,'n='+setupN),
        diagnosticChip('Risk deaths vs usual',hasNum(riskDelta)?signed(riskDelta,2)+'/g':'n/a',deltaTone(riskDelta,0,.25,true),riskN>=3,'n='+riskN)
      ].join(''),
      coverage:String(v.peerGames||0)+' trusted peer · '+roamN+' roam attempts across '+roamGames+' games · '+costN+' ADC lane-movement windows across '+costGames+' games · '+vpmN+' VPM comparisons · '+setupN+' setup-ward comparisons · '+riskN+' timeline games'
    };
  }
  if(role==='JUNGLE'){
    const impactN=Number(v.impactGames||0),impact=hasNum(v.avgImpactDelta)?Number(v.avgImpactDelta):null,vpmN=Number(v.vpmGames||0),vpm=hasNum(v.avgVpmDelta)?Number(v.avgVpmDelta):null,setupN=Number(v.visionSetupGames||0),setup=hasNum(v.avgObjectiveSetupDelta)?Number(v.avgObjectiveSetupDelta):null;
    return{
      chips:[
        diagnosticChip('First impact vs Jungle',impact==null?'n/a':signed(impact,1)+'m',deltaTone(impact,0,1.5,true),impactN>=3,'n='+impactN),
        diagnosticChip('1st major vs Jungle',itemDelta==null?'n/a':signed(itemDelta,1)+'m',deltaTone(itemDelta,0,.5,true),itemN>=3,'n='+itemN),
        diagnosticChip('VPM vs Jungle peer',vpm==null?'n/a':signed(vpm,2),deltaTone(vpm,0,.15),vpmN>=3,'n='+vpmN),
        diagnosticChip('Setup wards vs Jungle',setup==null?'n/a':signed(setup,1),deltaTone(setup,0,.5),setupN>=3,'n='+setupN),
        diagnosticChip('Risk deaths vs usual',hasNum(riskDelta)?signed(riskDelta,2)+'/g':'n/a',deltaTone(riskDelta,0,.25,true),riskN>=3,'n='+riskN)
      ].join(''),
      coverage:String(v.peerGames||0)+' trusted peer · '+impactN+' impact timings · '+itemN+' first-major comparisons · '+vpmN+' VPM comparisons · '+setupN+' setup-ward comparisons · '+riskN+' timeline games'
    };
  }
  const goldDelta=hasNum(v.goldDiff15)&&hasNum(base.goldDiff15)?Number(v.goldDiff15)-Number(base.goldDiff15):null,dpmDelta=hasNum(v.dpm)&&hasNum(base.dpm)?Number(v.dpm)-Number(base.dpm):null,laneN=Number(v.laneGames||0),dpmN=Number(v.dpmGames??v.games??0);
  return{
    chips:[
      diagnosticChip('Role gold @15',hasNum(v.goldDiff15)?signed(v.goldDiff15,0)+'g':'n/a',deltaTone(v.goldDiff15,0,100),laneN>=3,'n='+laneN),
      diagnosticChip('Vs your usual @15',hasNum(goldDelta)?signed(goldDelta,0)+'g':'n/a',deltaTone(goldDelta,0,150),laneN>=3,'n='+laneN),
      diagnosticChip('DPM vs your usual',hasNum(dpmDelta)?signed(dpmDelta,0):'n/a',deltaTone(dpmDelta,0,75),dpmN>=3,'n='+dpmN),
      diagnosticChip('Risk deaths vs usual',hasNum(riskDelta)?signed(riskDelta,2)+'/g':'n/a',deltaTone(riskDelta,0,.25,true),riskN>=3,'n='+riskN),
      diagnosticChip('1st major vs peer',itemDelta==null?'n/a':signed(itemDelta,1)+'m',deltaTone(itemDelta,0,.5,true),itemN>=3,'n='+itemN)
    ].join(''),
    coverage:String(v.peerGames||0)+' trusted peer · '+laneN+' lane-comparable · '+riskN+' timeline · '+dpmN+' DPM · '+itemN+' first-major comparisons'
  };
}
function matchupDiagnosticSet(v,role,base,riskBase){
  const gamesN=Number(v.games||0),riskDelta=hasNum(v.badDeaths)&&hasNum(riskBase.badDeathsPerTimelineGame)?Number(v.badDeaths)-Number(riskBase.badDeathsPerTimelineGame):null,riskN=Number(v.timelineGames||0),impactN=Number(v.impactGames||0),impact=hasNum(v.avgImpactDelta)?Number(v.avgImpactDelta):null,itemN=Number(v.itemGames||0),item=hasNum(v.avgItemDelta)?Number(v.avgItemDelta):null,vpmN=Number(v.vpmGames||0),vpm=hasNum(v.avgVpmDelta)?Number(v.avgVpmDelta):null,setupN=Number(v.visionSetupGames||0),setup=hasNum(v.avgObjectiveSetupDelta)?Number(v.avgObjectiveSetupDelta):null;
  if(role==='SUPPORT'){
    let read='Mixed repeated Support matchup evidence',readTone='neutral';
    if(setupN>=3&&setup!=null&&setup<=-.5){read='Pre-objective setup trails this Support';readTone='bad';}
    else if(vpmN>=3&&vpm!=null&&vpm<=-.15){read='Vision volume trails this Support';readTone='bad';}
    else if(setupN>=3&&vpmN>=3&&setup!=null&&vpm!=null&&setup>=.5&&vpm>=.15){read='Vision and setup lead this Support';readTone='good';}
    return{
      read,readTone,
      chips:[
        diagnosticChip('VPM vs Support',vpm==null?'n/a':signed(vpm,2),deltaTone(vpm,0,.15),vpmN>=3,'n='+vpmN),
        diagnosticChip('Setup wards vs Support',setup==null?'n/a':signed(setup,1),deltaTone(setup,0,.5),setupN>=3,'n='+setupN),
        diagnosticChip('First impact vs Support',impact==null?'n/a':signed(impact,1)+'m',deltaTone(impact,0,1.5,true),impactN>=3,'n='+impactN),
        diagnosticChip('1st major vs Support',item==null?'n/a':signed(item,1)+'m',deltaTone(item,0,.5,true),itemN>=3,'n='+itemN),
        diagnosticChip('Risk deaths vs usual',hasNum(riskDelta)?signed(riskDelta,2)+'/g':'n/a',deltaTone(riskDelta,0,.25,true),riskN>=3,'n='+riskN)
      ].join(''),
      coverage:gamesN+' trusted peer · '+vpmN+' VPM · '+setupN+' setup · '+impactN+' impact · '+itemN+' item · '+riskN+' timeline comparisons'
    };
  }
  if(role==='JUNGLE'){
    const cs=hasNum(v.csDiff15)?Number(v.csDiff15):null,csN=Number(v.csDiff15Games||0),laneN=Number(v.laneGames||0);
    let read='Mixed repeated Jungle matchup evidence',readTone='neutral';
    if(impactN>=3&&impact!=null&&impact>=1.5){read='First impact arrives later against this Jungler';readTone='bad';}
    else if(setupN>=3&&setup!=null&&setup<=-.5){read='Objective setup trails this Jungler';readTone='bad';}
    else if(impactN>=3&&impact!=null&&impact<=-1.5){read='First impact arrives earlier against this Jungler';readTone='good';}
    return{
      read,readTone,
      chips:[
        diagnosticChip('CS diff @15',cs==null?'n/a':signed(cs,1),deltaTone(cs,0,8),csN>=3,'n='+csN),
        diagnosticChip('First impact vs Jungle',impact==null?'n/a':signed(impact,1)+'m',deltaTone(impact,0,1.5,true),impactN>=3,'n='+impactN),
        diagnosticChip('1st major vs Jungle',item==null?'n/a':signed(item,1)+'m',deltaTone(item,0,.5,true),itemN>=3,'n='+itemN),
        diagnosticChip('VPM vs Jungle',vpm==null?'n/a':signed(vpm,2),deltaTone(vpm,0,.15),vpmN>=3,'n='+vpmN),
        diagnosticChip('Setup wards vs Jungle',setup==null?'n/a':signed(setup,1),deltaTone(setup,0,.5),setupN>=3,'n='+setupN)
      ].join(''),
      coverage:gamesN+' trusted peer · '+laneN+' gold@15 · '+csN+' CS@15 · '+impactN+' impact · '+itemN+' item · '+vpmN+' VPM · '+setupN+' setup comparisons'
    };
  }
  const goldDelta=hasNum(v.goldDiff15)&&hasNum(base.goldDiff15)?Number(v.goldDiff15)-Number(base.goldDiff15):null,soloKills=Number(v.earlySoloKills||0),soloKillGames=Number(v.earlySoloKillGames||0),soloDeaths=Number(v.earlySoloDeaths||0),soloDeathGames=Number(v.earlySoloDeathGames||0),soloEventGames=Number(v.earlySoloEventGames||0),outside=hasNum(v.outsidePressureShare)?Number(v.outsidePressureShare):null,dpmPeer=hasNum(v.avgDpmDelta)?Number(v.avgDpmDelta):null,laneN=Number(v.laneGames||0),pressureN=Number(v.earlyClassifiedHomeLaneDeaths??v.earlyHomeLaneDeaths??0),pressureGames=Number(v.earlyClassifiedHomeLaneDeathGames??v.earlyHomeLaneDeathGames??0),pressureExcluded=Number(v.earlyUnclassifiedHomeLaneDeaths||0),outsideDeaths=Number(v.earlyOutsidePressureDeaths||0),outsideGames=Number(v.earlyOutsidePressureGames||0),dpmN=Number(v.dpmGames||0);
  const soloReady=soloKills+soloDeaths>=3&&soloEventGames>=2,soloBad=soloDeaths>=2&&soloDeathGames>=2&&soloDeaths>=soloKills+2,soloGood=soloKills>=2&&soloKillGames>=2&&soloKills>=soloDeaths+2,pressureReady=pressureN>=3&&pressureGames>=2,pressureBad=pressureReady&&outsideDeaths>=2&&outsideGames>=2&&outside!=null&&outside>=60;
  let read='Mixed repeated matchup evidence',readTone='neutral';
  if(soloBad){read='Clean 1v1 deaths recur across games';readTone='bad';}
  else if(pressureBad){read='Lane deaths are mostly outside pressure across games';}
  else if(laneN>=3&&hasNum(goldDelta)&&goldDelta<=-300){read='Lane economy below your usual role level';readTone='bad';}
  else if(laneN>=3&&hasNum(goldDelta)&&goldDelta>=300&&soloKills>=soloDeaths){read='Lane economy above your usual role level';readTone='good';}
  return{
    read,readTone,
    chips:[
      diagnosticChip('Role gold @15',hasNum(v.goldDiff15)?signed(v.goldDiff15,0)+'g':'n/a',deltaTone(v.goldDiff15,0,100),laneN>=3,'n='+laneN),
      diagnosticChip('Vs your usual @15',hasNum(goldDelta)?signed(goldDelta,0)+'g':'n/a',deltaTone(goldDelta,0,150),laneN>=3,'n='+laneN),
      diagnosticChip('Clean 1v1 K / D',soloKills+' / '+soloDeaths,soloBad?'bad':soloGood?'good':'neutral',soloReady,'events='+(soloKills+soloDeaths)+' · '+soloEventGames+' games'),
      diagnosticChip('Outside-pressure share',outside!=null?fmtPct(outside):'n/a',pressureBad?'bad':'neutral',pressureReady,'classified='+pressureN+' / '+pressureGames+' games · outside='+outsideDeaths+' / '+outsideGames+' games'+(pressureExcluded?' · excluded='+pressureExcluded:'')),
      diagnosticChip('DPM vs role peer',dpmPeer==null?'n/a':signed(dpmPeer,0),deltaTone(dpmPeer,0,75),dpmN>=3,'n='+dpmN)
    ].join(''),
    coverage:gamesN+' trusted peer · '+laneN+' lane-comparable · '+riskN+' timeline · '+dpmN+' DPM comparisons'
  };
}
function renderSupportSynergy(r){
  const panel=$('supportSynergyPanel'),nav=$('supportSynergyNav'),summary=$('supportSynergySummary'),graph=$('supportSynergyGraph'),table=$('supportChampionSynergy'),pairs=$('supportPairingSynergy'),note=$('supportSynergyNote');
  if(!panel||!summary||!table||!pairs)return;
  const role=canonicalRole(r?.dataQuality?.selectedRole||r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||state.selectedRole),m=r?.supportSynergy||{};
  const show=role==='ADC'&&m?.eligible===true;
  panel.hidden=!show;if(nav)nav.hidden=!show;
  if(!show){summary.innerHTML='';if(graph)graph.innerHTML='';table.innerHTML='';pairs.innerHTML='';if(note)note.textContent='';return;}
  const rows=Array.isArray(m.supportChampions)?m.supportChampions:[],pairRows=Array.isArray(m.pairings)?m.pairings:[],best=m.bestSupportChampion||null,developing=m.developingSupportChampion||null;
  const most=[...rows].sort((a,b)=>Number(b.games||0)-Number(a.games||0))[0]||null;
  const lane=[...rows].filter(x=>Number(x.laneGames||0)>=3&&hasNum(x.avgGoldDiff15)).sort((a,b)=>Number(b.avgGoldDiff15)-Number(a.avgGoldDiff15))[0]||null;
  const summaryCard=(label,value,sub,src='')=>'<article class="support-synergy-summary-card">'+(src?'<img loading="lazy" src="'+esc(src)+'" alt="">':'')+'<div><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small>'+esc(sub)+'</small></div></article>';
  summary.innerHTML=[
    summaryCard('Best established support champion',best?best.supportChampion:'No 5-game sample yet',best?(fmtPct(best.cleanWinRate)+' · '+best.cleanWins+'/'+best.cleanGames+' clean outcomes · Wilson floor '+fmtPct(best.wilsonLower95)):'Needs at least '+String(m.minimumCleanGamesForRanking||5)+' clean outcomes',best?championIcon(best.supportChampion):''),
    summaryCard('Most played support champion',most?most.supportChampion:'n/a',most?(most.games+' games · '+fmtPct(most.cleanWinRate)+' clean WR · your '+fmt(most.avgKda,2)+' KDA'):'No resolved support-champion context',most?championIcon(most.supportChampion):''),
    summaryCard('Developing support sample',developing?developing.supportChampion:'No 3–4 game sample',developing?(fmtPct(developing.cleanWinRate)+' · '+developing.cleanWins+'/'+developing.cleanGames+' clean · not yet established'):'Three to four clean games stay contextual',developing?championIcon(developing.supportChampion):''),
    summaryCard('Best @15 lane sample',lane?lane.supportChampion:'No 3-game lane sample',lane?(signed(lane.avgGoldDiff15,0)+'g vs enemy ADC · '+lane.laneGames+' comparable deep games'):'Direct-peer @15 evidence is still thin',lane?championIcon(lane.supportChampion):''),
    summaryCard('Support-champion coverage',String(m.resolvedGames||0)+' / '+String(m.historyGames||0)+' games',String(m.unresolvedGames||0)+' unresolved · all performance metrics belong to the reviewed account')
  ].join('');
  renderSupportSynergyGraph(m);
  const establishedRows=rows.filter(x=>x.rankingEligible),rankOf=x=>Math.max(0,establishedRows.indexOf(x))+1;
  const sampleLabel=x=>x.rankingEligible?('#'+rankOf(x)+' established'):x.sampleTier==='developing'?'developing sample':'thin sample';
  table.innerHTML=rows.length?'<div class="support-synergy-table-head"><span>Support champion</span><span>Your clean WR</span><span>Your KDA</span><span>Your DPM</span><span>Your KP</span><span>Your deaths</span><span>Your gold @15</span></div>'+
    rows.map(x=>'<article class="support-synergy-row '+(x.rankingEligible?'ranked':x.sampleTier==='developing'?'developing-sample':'thin-sample')+'"><div class="support-synergy-champion">'+(championIcon(x.supportChampion)?'<img loading="lazy" src="'+esc(championIcon(x.supportChampion))+'" alt="">':'')+'<div><strong>'+esc(x.supportChampion)+'</strong><small>'+esc(sampleLabel(x))+' · '+String(x.games||0)+' total / '+String(x.cleanGames||0)+' clean</small></div></div><div><strong>'+esc(fmtPct(x.cleanWinRate))+'</strong><small>'+(x.rankingEligible?'Wilson floor '+esc(fmtPct(x.wilsonLower95)):x.sampleTier==='developing'?'not ranked until '+String(m.minimumCleanGamesForRanking||5)+' clean':'needs '+String(m.minimumCleanGamesForDevelopingSample||3)+' clean')+'</small></div><div><strong>'+esc(fmt(x.avgKda,2))+'</strong><small>reviewed account</small></div><div><strong>'+esc(fmtInt(x.avgDpm))+'</strong><small>reviewed account</small></div><div><strong>'+esc(fmtPct(x.avgKp))+'</strong><small>reviewed account</small></div><div><strong>'+esc(fmt(x.avgDeaths,1))+'</strong><small>per game</small></div><div><strong>'+(hasNum(x.avgGoldDiff15)?esc(signed(x.avgGoldDiff15,0)+'g'):'n/a')+'</strong><small>'+String(x.laneGames||0)+' ADC-peer games</small></div></article>').join(''):
    '<div class="bullet empty">No allied Support champion could be resolved in this ADC history.</div>';
  pairs.innerHTML=pairRows.length?pairRows.slice(0,16).map(x=>{
    const a=championIcon(x.ownChampion),s=championIcon(x.supportChampion);
    return '<article class="support-pair-card '+(x.rankingEligible?'ranked':x.sampleTier==='developing'?'developing-sample':'thin-sample')+'"><div class="support-pair-icons">'+(a?'<img loading="lazy" src="'+esc(a)+'" alt="">':'')+(s?'<img loading="lazy" src="'+esc(s)+'" alt="">':'')+'</div><div><span>'+esc(x.ownChampion)+' with '+esc(x.supportChampion)+'</span><strong>'+esc(fmtPct(x.cleanWinRate))+' clean WR</strong><small>'+String(x.games||0)+' total · '+String(x.cleanGames||0)+' clean · your '+esc(fmt(x.avgKda,2))+' KDA · '+esc(fmtInt(x.avgDpm))+' DPM'+(hasNum(x.avgGoldDiff15)?' · '+esc(signed(x.avgGoldDiff15,0))+'g @15':'')+'</small></div></article>';
  }).join(''):'<div class="bullet empty">No ADC + support-champion pairings available.</div>';
  if(note)note.textContent='This section analyzes only the reviewed account. The Support champion is contextual grouping only; no teammate identity or teammate KDA/KP/vision statistic is stored, ranked or displayed. Established support-champion rankings exclude AFK/early-surrender outcomes, require '+String(m.minimumCleanGamesForRanking||5)+' clean games and use the lower end of the 95% uncertainty range. Three-to-four clean games are developing context. Associations are descriptive and do not imply the Support champion caused the result.';
}
function renderBreakdowns(r){
  const q=r.dataQuality||{},role=canonicalRole(q.selectedRole||r.coachingSummary?.primaryRole||r.summary?.primaryRole||state.selectedRole),games=Number(q.analyzedGames??r.games?.length??0),timeline=Number(q.validTimelineGames||0),peer=Number(q.directPeerComparableGames??q.peerComparableGames??0),mech=Number(q.mechanicsCohortGames??r.coachingSummary?.games??games),patch=String(q.currentPatchKey||'unknown'),queue=queueContextLabel(q.dominantQueueId,q.dominantQueueFamily);
  const cohortRows=[
    ['Selected role',roleLabel(role),games+' analyzed games'],
    ['Queue cohort',queue,String(q.queueSelection||'role-first recent cohort').replaceAll('_',' ')],
    ['Current mechanics',mech+'/'+games+' games',q.mechanicsCohortApplied===true?'older-mechanics games remain context-only':'single compatible mechanics cohort'],
    ['Timeline coverage',timeline+'/'+games+' games',games?fmtPct(100*timeline/games)+' timeline-complete':'n/a'],
    ['Trusted role peer',peer+'/'+games+' games',games?fmtPct(100*peer/games)+' direct-peer comparable':'n/a'],
    ['Current patch',patch,Object.keys(q.patchCounts||{}).length+' patch key'+(Object.keys(q.patchCounts||{}).length===1?'':'s')+' visible in selected history']
  ];
  $('roleBreakdown').innerHTML=cohortRows.map(x=>'<div class="cohort-context-row"><span>'+esc(x[0])+'</span><strong>'+esc(x[1])+'</strong><small>'+esc(x[2])+'</small></div>').join('');

  const behaviorRows=Array.isArray(r.championBehavior)?r.championBehavior:[],rawBase=r.coachingSummary||r.summary||{},base={...rawBase,goldDiff15:hasNum(r.peerComparison?.avgGoldDiff15)?Number(r.peerComparison.avgGoldDiff15):null},riskBase=r.behaviorSummary||{};
  if(behaviorRows.length){
    $('championBreakdown').innerHTML=behaviorRows.slice(0,8).map(v=>{
      const src=championIcon(v.champion),diag=championDiagnosticSet(v,role,base,riskBase);
      return '<article class="diagnostic-break-row champion-diagnostic">'+
        '<div class="diagnostic-break-head"><div class="break-visual">'+(src?'<img loading="lazy" src="'+esc(src)+'" alt="">':'')+'<span><b>'+esc(v.champion)+'</b><small>'+esc(roleLabel(v.role||role))+' · '+esc(String(v.games||0))+' games</small></span></div><div class="diagnostic-result"><strong>'+esc(fmtPct(v.winRate))+'</strong><small>sample WR</small></div></div>'+
        '<div class="diagnostic-chip-grid">'+diag.chips+'</div>'+
        '<p>'+esc(diag.coverage)+'. Colored champion diagnostics require their own metric-specific evidence floor; sample win rate remains descriptive.</p>'+
      '</article>';
    }).join('');
  }else{
    const champRows=Object.entries(r.byChampion||{}).sort((a,b)=>Number(b[1]?.games||0)-Number(a[1]?.games||0)).slice(0,8);
    $('championBreakdown').innerHTML=champRows.length?champRows.map(([name,v])=>{
      const src=championIcon(name);
      return '<div class="break-row"><div class="break-visual">'+(src?'<img loading="lazy" src="'+esc(src)+'" alt="">':'')+'<span>'+esc(name)+'</span></div><small>'+esc(String(v.games||0))+' games</small><strong>'+esc(fmtPct((v.games||0)?Number(v.wins||0)/Number(v.games)*100:null))+' WR</strong></div>';
    }).join(''):'<div class="bullet empty">No champion sample available.</div>';
  }

  const matchupRows=Array.isArray(r.matchupBehavior)?r.matchupBehavior:[],target=$('matchupBreakdown');
  if(target){
    target.innerHTML=matchupRows.length?matchupRows.slice(0,10).map(v=>{
      const own=(v.ownChampions||[]).slice(0,3).map(x=>x.champion+' '+x.games+'g').join(', '),src=championIcon(v.opponentChampion),diag=matchupDiagnosticSet(v,role,base,riskBase);
      return '<article class="diagnostic-break-row matchup-diagnostic">'+
        '<div class="diagnostic-break-head"><div class="break-visual">'+(src?'<img loading="lazy" src="'+esc(src)+'" alt="">':'')+'<span><b>vs '+esc(v.opponentChampion)+'</b><small>'+esc(roleLabel(v.role||role))+' · '+esc(String(v.games||0))+' games</small></span></div><div class="diagnostic-result"><strong>'+esc(fmtPct(v.winRate))+'</strong><small>sample WR</small></div></div>'+
        '<div class="matchup-read tone-'+diag.readTone+'"><span>Repeated-matchup read</span><strong>'+esc(diag.read)+'</strong></div>'+
        '<div class="diagnostic-chip-grid">'+diag.chips+'</div>'+
        '<p>'+(own?'Own picks: '+esc(own)+'. ':'')+esc(diag.coverage)+'. Each colored diagnostic uses its own minimum evidence; repeated-matchup win rate remains descriptive.</p>'+
      '</article>';
    }).join(''):'<div class="bullet empty">No opposing champion appears at least three times in the primary-role coaching sample.</div>';
  }
}
function evidenceLevel(n,good=10,moderate=5){
  const x=Number(n);return Number.isFinite(x)?(x>=good?'strong':x>=moderate?'moderate':'thin'):'unknown';
}
function qualityCard(label,value,detail='',level=''){
  return '<div class="quality-card '+(level?'evidence-'+esc(level):'')+'"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+(detail?'<small>'+esc(detail)+'</small>':'')+'</div>';
}
function qualityEvidenceDetail(detail,level){
  return String(detail||'')+(level==='thin'?' · thin sample — descriptive only; do not treat this rate as stable yet':level==='unknown'?' · evidence unavailable — unknown, not zero':'');
}
function renderQuality(r){
  const q=r.dataQuality||{},b=r.behaviorSummary||{},p=r.peerComparison||{},ext=r.externalBenchmarks||{};
  const analyzed=Number(q.analyzedGames??r.games?.length??0),coaching=Number(q.coachingRoleGames??r.coachingSummary?.games??0),timelines=Number(q.validTimelineGames??0);
  const timelinePct=analyzed>0?timelines/analyzed*100:null,peerN=Number(q.peerComparableGames??p.sameRoleGames??0),rankedN=Number(q.rankedPeerGames??p.rankedPeerGames??0);
  const fightN=Number(b.fightSamples??0),objectiveN=Number(b.neutralObjectiveEvents??0),wardN=Number(p.visionWardTotal??0);
  const queueLevel=evidenceLevel(q.dominantQueueGames??0),timelineLevel=evidenceLevel(timelines),peerLevel=evidenceLevel(peerN),rankedLevel=evidenceLevel(rankedN),fightLevel=evidenceLevel(fightN,12,6),objectiveLevel=evidenceLevel(objectiveN,10,5),wardLevel=evidenceLevel(wardN,30,12),baselineLevel=evidenceLevel(q.coachingBaselineRoleGames??0);
  const unsupportedExcluded=Number(q.excludedUnsupportedQueues??q.unsupportedQueueRowsExcluded??0),otherSupportedExcluded=Number(q.excludedOtherSupportedQueues??Math.max(0,Number(q.excludedOtherQueues||0)-Number(q.unsupportedQueueRowsExcluded||0)));
  const cards=[
    qualityCard('Analyzed games',String(analyzed),String(coaching)+' selected-role coaching games · '+roleLabel(q.selectedRole||r.summary?.primaryRole),evidenceLevel(coaching)),
    qualityCard('External rank reference',ext.eligible===false?'Withheld':ext.currentTier?String(ext.currentTier)+' · '+String(ext.roleLabel||'ADC'):'Unavailable',ext.eligible===false?adcBenchmarkUnavailableReason(r):(ext.source||'External benchmark')+(ext.sourceCapturedAt?' · captured '+String(ext.sourceCapturedAt):'')+(ext.sourceCorpus?' · '+String(ext.sourceCorpus):'')+' · role-adjusted, cross-patch reference; not a direct rank×role population mean','neutral'),
    qualityCard('Queue context',hasNum(q.dominantQueueId)?('Queue '+String(q.dominantQueueId)+(q.dominantQueueFamily?' · '+String(q.dominantQueueFamily).replaceAll('_',' '):'')):'n/a',qualityEvidenceDetail(String(q.dominantQueueGames??0)+' matching cached games · selected from '+String(q.queueSelection?.considered??0)+' newest supported game(s)'+(q.queueSelection?.windowSize?' (window '+String(q.queueSelection.windowSize)+')':'')+' · '+String(unsupportedExcluded)+' unsupported special/bot queue game(s) excluded before coaching/benchmarks, not counted as losses or zero-rate events · '+String(otherSupportedExcluded)+' other supported queue-context game(s) excluded',queueLevel),queueLevel),
    qualityCard('Fixed checkpoint eligibility',String(b.checkpointEligibility?.lane15Games??0)+' @15 lane','15→25 '+String(b.checkpointEligibility?.fixed15to25Games??0)+' · @25 closing '+String(b.checkpointEligibility?.closing25Games??0),'neutral'),
    qualityCard('Patch context',(q.currentPublicPatchKey||q.currentPatchKey)?('Patch '+String(q.currentPublicPatchKey||q.currentPatchKey)):'n/a',String(q.currentPatchRoleGames??0)+' current-patch role games · '+String(q.olderSamePatchRoleGames??0)+' older same-patch baseline · '+String(q.crossPatchBaselineRoleGames??0)+' cross-patch older games excluded from trend'+(q.currentPublicPatchKey&&q.currentPatchKey&&String(q.currentPublicPatchKey)!==String(q.currentPatchKey)?' · Riot/Data Dragon build '+String(q.currentPatchKey):''),q.patchBaselineReady?'good':'neutral'),
    qualityCard('Role-quest mechanics',Object.keys(q.roleQuestRevisionCounts||{}).length?Object.entries(q.roleQuestRevisionCounts||{}).map(([k,v])=>String(k)+' '+String(v)+'g').join(' · '):'n/a',q.roleQuestCheckpointNote||'Quest effects are treated as patch context, not inferred completion timestamps.','neutral'),
    qualityCard('Mechanics coaching cohort',q.currentMechanicsKey||'n/a',String(q.mechanicsCohortGames??0)+' current-mechanics role games · '+String(q.primaryRoleGamesInLast20??coaching)+' primary-role games in Last-20'+(q.mechanicsCohortApplied?' · verified current cohort applied':q.mechanicsCohortReason==='current_mechanics_unverified'?' · mixed fallback: newest mechanics revision is unverified':q.mixedMechanicsFallback?' · mixed fallback: current cohort below 5 games':' · single compatible cohort'),q.mechanicsCohortApplied?'good':q.mixedMechanicsFallback||q.currentMechanicsKnown===false?'neutral':'good'),
    qualityCard('Item catalog provenance',String(q.itemCatalogExactPatches??0)+' exact patch catalog(s)',String(q.itemCatalogFallbackPatches??0)+' patch fallback(s) · '+String(q.itemCatalogUnknownPatchGames??0)+' game(s) without a parsed patch',Number(q.itemCatalogFallbackPatches||0)===0?'good':'neutral'),
    qualityCard('Timeline position evidence',q.positionEvidenceModel?String(q.positionEvidenceModel).replaceAll('_',' '):'nearest timeline frame',hasNum(q.positionEvidenceMaxDeltaMs)?('Event-presence frames must be within '+fmtInt(Number(q.positionEvidenceMaxDeltaMs)/1000)+'s of the event'):'Event-presence timing bound unavailable','neutral'),
    qualityCard('Item undo quality',String(q.unresolvedItemUndoEvents??0)+' unresolved undo event(s)',String(q.gamesWithUnresolvedItemUndo??0)+' game(s) affected · zero-ID Riot undo events make only the nearby shop-spend estimate approximate; no purchase identity is guessed',Number(q.unresolvedItemUndoEvents||0)===0?'good':'neutral'),
    qualityCard('Sample exclusions',String(Number(q.excludedShortGames||0)+Number(q.excludedOtherMaps||0)+Number(q.excludedOtherRoles||0)+Number(unsupportedExcluded)+Number(otherSupportedExcluded)+Number(q.excludedMissingRole||0)+Number(q.excludedAmbiguousRole||0))+' games',String(q.excludedShortGames??0)+' under 10m · '+String(q.excludedOtherMaps??0)+' other maps · '+String(q.excludedOtherRoles??0)+' other-role games · '+String(unsupportedExcluded)+' unsupported special/bot queues'+(Array.isArray(q.unsupportedQueueIds)&&q.unsupportedQueueIds.length?' ['+q.unsupportedQueueIds.join(', ')+']':'')+' fail closed outside the report cohort · '+String(otherSupportedExcluded)+' other supported queue contexts · '+String(q.excludedMissingRole??0)+' missing role · '+String(q.excludedAmbiguousRole??0)+' conflicting Riot role metadata · '+String(q.excludedBeyondLast20??0)+' valid older games outside the Last-20 cap','neutral'),
    qualityCard('Timeline coverage',hasNum(timelinePct)?fmtPct(timelinePct):'n/a',qualityEvidenceDetail(String(timelines)+' / '+String(analyzed)+' games',timelineLevel),timelineLevel),
    qualityCard('Direct peer evidence',String(peerN)+' games',qualityEvidenceDetail('High-confidence same-role comparisons · '+String(q.excludedLowConfidenceDirectPeerGames??0)+' fallback-role comparison(s) withheld · '+String(q.ambiguousDirectPeerGames??0)+' ambiguous enemy-role game(s) withheld · '+String(q.missingDirectPeerGames??0)+' missing enemy-role game(s)',peerLevel),peerLevel),
    qualityCard('Ranked peer evidence',String(rankedN)+' games',qualityEvidenceDetail(String(q.higherRankPeerGames??p.higherRankPeerGames??0)+' higher-rank peers',rankedLevel),rankedLevel),
    qualityCard('Fight evidence',String(fightN)+' active clusters',qualityEvidenceDetail(String(b.fightPresenceSamples??fightN)+' supported-presence clusters · '+String(b.fightProximityOnlySamples??0)+' proximity-only context clusters excluded from execution rates',fightLevel),fightLevel),
    qualityCard('Objective evidence',String(objectiveN)+' contested encounters',qualityEvidenceDetail('Team-secured objectives plus lost objectives with supported allied presence; full concessions excluded',objectiveLevel),objectiveLevel),
    qualityCard('Ward evidence',String(wardN)+' ward events',qualityEvidenceDetail(String(q.wardEventPositions??0)+' direct-position · '+String(q.wardFrameProjectedPositions??0)+' projected from nearest ≤35s player frame · '+String(q.wardUnpositionedEvents??0)+' unpositioned',wardLevel),wardLevel),
    qualityCard('Same-patch self baseline',String(q.coachingBaselineRoleGames??0)+' games',qualityEvidenceDetail((q.currentPublicPatchKey||q.currentPatchKey)?('Older primary-role games on patch '+String(q.currentPublicPatchKey||q.currentPatchKey)):'No usable patch cohort',baselineLevel),baselineLevel)
  ];
  $('qualityGrid').innerHTML=cards.join('');
  const low=[];
  if(timelines<5)low.push('timeline behavior');
  if(peerN<5)low.push('direct-peer comparisons');
  if(rankedN<3)low.push('rank-band comparisons');
  if(fightN<6)low.push('fight-order/readiness');
  if(Number(q.excludedShortGames||0)>0)low.push('short games excluded from coaching');
  if(Number(q.excludedAmbiguousRole||0)>0)low.push('games with conflicting Riot role metadata excluded');
  if(Number(q.ambiguousDirectPeerGames||0)>0)low.push('ambiguous same-role opponent matches withheld from peer comparison');
  if(Number(q.fallbackPlayerRoleGames||0)>0)low.push('player role inferred from legacy role/lane fallback metadata');
  if(Number(q.fallbackDirectPeerRoleGames||0)>0)low.push('fallback peer-role labels visible for context but withheld from direct-peer coaching');
  if(Number((q.excludedUnsupportedQueues??q.unsupportedQueueRowsExcluded)??0)>0)low.push('unsupported special/bot Summoner’s Rift queues excluded');
  if(Number(q.excludedOtherSupportedQueues??Math.max(0,Number(q.excludedOtherQueues||0)-Number(q.unsupportedQueueRowsExcluded||0)))>0)low.push('mixed supported queue contexts excluded');
  if(q.currentPatchKey&&!q.patchBaselineReady)low.push('same-patch historical trend baseline');
  if(Number(q.itemCatalogFallbackPatches||0)>0)low.push('item-catalog patch fallback');
  if(Number(q.unresolvedItemUndoEvents||0)>0)low.push('shop spend around unresolved zero-ID Riot ITEM_UNDO events');
  if(Object.keys(q.roleQuestRevisionCounts||{}).length>1)low.push(q.mechanicsCohortApplied?'older mechanics excluded from coaching cohort':'mixed role-quest mechanics revisions');
  if(q.mechanicsCohortReason==='current_mechanics_unverified')low.push('newest mechanics revision unverified; broader role sample used');
  else if(q.mixedMechanicsFallback)low.push('current mechanics cohort below 5 games; broader role sample used');
  const base=r.sourceStatus?.note||'Report data remains traceable through the report contract. Missing data remains unknown rather than zero.';
  $('sourceNote').textContent=base+(low.length?' Thin-evidence areas right now: '+low.join(', ')+'.':' Core evidence coverage is sufficient for the main coaching dimensions.');
}

function exportReport(){
  if(!state.report)return;
  const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='bruisienator_'+String(state.profile?.game_name||'recent').replace(/[^a-z0-9_-]+/gi,'_')+'_'+String(state.profile?.tag_line||'tag').replace(/[^a-z0-9_-]+/gi,'_')+'_last20.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

const requestInputs=['requestGameName','requestTagLine','requestRegion','profileLabel','requestRole','riotApiKey'];
requestInputs.forEach(id=>{
  const node=$(id);if(!node)return;
  node.addEventListener(id==='requestRegion'||id==='requestRole'?'change':'input',(ev)=>{
    if(id==='requestRole'){
      state.selectedRole=selectedAnalysisRole();state.profileLoadEpoch++;clearSelectedReport('Opening '+roleLabel(state.selectedRole)+' report…');
      if(state.profile){saveProfilePreference(state.profile.id,state.selectedRole);renderSavedProfiles();loadCacheStatus();loadSavedReport(state.profile);}else clearSelectedReport('Save a profile to review '+roleLabel(state.selectedRole)+' games');
    }
    if(id==='riotApiKey'){
      state.riotApiKey=String(ev.target.value||'').trim();
      $('riotKeyStatus').textContent=state.riotApiKey?'Session key ready — it will not be saved.':(state.serverRiotKey?'Server Riot key available':'Add a Riot API key to load matches.');
      $('backendState').textContent=state.serverRiotKey||state.riotApiKey?'Backend + Riot ready':'Backend ready · add Riot key';
      $('backendState').className='pill '+(state.serverRiotKey||state.riotApiKey?'':'warn');
    }
    syncButtons();
  });
});
$('loadRecentBtn').addEventListener('click',runRecentAnalysis);
$('exportBtn').addEventListener('click',exportReport);
$('saveProfileBtn')?.addEventListener('click',saveProfileOnly);
$('openSavedReportBtn')?.addEventListener('click',()=>{if(state.profile&&!state.busy){state.profileLoadEpoch++;clearSelectedReport('Opening saved report…');loadSavedReport(state.profile);}});
$('profileSearch')?.addEventListener('input',renderSavedProfiles);
document.addEventListener('click',ev=>{const term=ev.target.closest('[data-stat-term]');if(term){ev.preventDefault();openStatGuide(term.dataset.statTerm);return;}const link=ev.target.closest('a[href^="#"]');if(link){const id=link.getAttribute('href').slice(1);openReportAncestors($(id));if(id==='stat-guide')$('statGuideDetails').open=true;}});
$('savedProfileSelect')?.addEventListener('change',ev=>{const id=String(ev.target.value||'');if(id)applySavedProfile(id,{loadReport:true});else startNewProfile();});
$('newSavedProfileBtn')?.addEventListener('click',startNewProfile);
$('forgetSavedProfileBtn')?.addEventListener('click',forgetSavedProfile);

const initialTerm=String(globalThis.location?.hash||'').slice(1);if(initialTerm==='stat-guide')$('statGuideDetails').open=true;else if(initialTerm.startsWith('term-'))openStatGuide(initialTerm.slice(5));
boot().catch(e=>{log('Startup failed: '+e.message,'bad');$('backendState').textContent='Startup failed';$('backendState').className='pill error';});
})();
