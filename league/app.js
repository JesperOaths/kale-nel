(function(){
'use strict';

const cfg=window.GEJAST_CONFIG||{};
const API=(cfg.SUPABASE_URL||'')+'/functions/v1/printify-gildan-diff-diag-v1';
const KEY=cfg.SUPABASE_PUBLISHABLE_KEY||'';
const $=(id)=>document.getElementById(id);
const state={profile:null,report:null,ddVersion:'',openMatch:null,activeDetailTab:'macro',busy:false,riotApiKey:'',serverRiotKey:false,publicWorkspace:true,gameSort:{key:'recent',dir:'desc'},gameFilter:'all',gameChampion:'all',matchHistoryLimit:10,matchHistoryFilter:'all',matchHistoryArcKey:'',matchHistoryObjectiveFamilyKey:'',savedProfiles:[],selectedProfileId:'',selectedRole:'ADC'};

function esc(v){return String(v??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
const LEAGUE_WORKSPACE_KEY='bruisienator_public_workspace_v1';
const LEAGUE_SLOT_SELECTION_KEY='bruisienator_saved_profile_selection_v1';
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
  return canonicalRole(m?.[1]||'ADC');
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
  const run=$('loadRecentBtn');if(run)run.disabled=!!on||!directRequestComplete();
  if(label)$('progressState').textContent=label;
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
  try{
    const r=await fetch('https://ddragon.leagueoflegends.com/api/versions.json',{cache:'force-cache'});
    const list=await r.json();state.ddVersion=Array.isArray(list)&&list[0]?String(list[0]):'';
  }catch(_){}
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
  const mine=championIcon(g.champion),opp=championIcon(g.peer?.champion),items=Array.isArray(g.finalItems)?g.finalItems:[];
  return '<div class="match-visual-header"><div class="match-champion">'+
    (mine?'<img loading="lazy" src="'+esc(mine)+'" alt="'+esc(g.champion||'Champion')+'">':'')+
    '<div><span>Your champion</span><strong>'+esc(g.champion||'Unknown')+'</strong></div></div>'+
    '<div class="final-build"><span>Final build</span><div>'+(
      items.length?items.slice(0,7).map(x=>{const src=itemIcon(x.itemId);return src?'<img loading="lazy" src="'+esc(src)+'" alt="'+esc(x.name||'Item')+'" title="'+esc(x.name||'Item')+'">':'';}).join(''):'<small>No final build data</small>'
    )+'</div></div>'+
    '<div class="match-champion opponent">'+
    (opp?'<img loading="lazy" src="'+esc(opp)+'" alt="'+esc(g.peer?.champion||'Opponent')+'">':'')+
    '<div><span>Role opponent</span><strong>'+esc(g.peer?.champion||'Unknown')+'</strong></div></div></div>';
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
  const n=Number(value),tone=deltaTone(n,0,unit==='gold'?100:unit==='csmin'?0.15:unit==='dpm'?50:unit==='minutes'?0.2:0.01,inverse);
  const magnitude=Math.abs(n);
  let formatted;
  if(unit==='gold')formatted=signed(n,0)+'g';
  else if(unit==='csmin')formatted=signed(n,2)+' CS/min';
  else if(unit==='dpm')formatted=signed(n,0)+' DPM';
  else if(unit==='minutes')formatted=signed(n,1)+' min';
  else if(unit==='pp')formatted=signed(n,1)+' pp';
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
    hasNum(r.coachingLaneCostCs??r.laneCostCs)?((r.laneCostBasis==='allied_adc_vs_enemy_adc'?'ADC-vs-ADC lane cost':'direct-role lane cost')+' '+signed(r.coachingLaneCostCs??r.laneCostCs,0)+' CS'):null
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
      out.push({...d,patternKey:key,patternLabel:def.label,patternWhy:def.why,patternAction:def.action,champion:g.champion,matchId:g.matchId,gameStartTimestamp:g.gameStartTimestamp,opponentChampion:g.peer?.champion||null,detail:bits.join(' · '),consequenceMeasured:!!consequence,costly:!!consequence?.costly,severe:!!consequence?.severe,consequenceTraded:consequence?consequence.traded:null,economyWindowContaminatedByRepeatDeath:!!consequence?.economyWindowContaminatedByRepeatDeath,consequenceSignals:Array.isArray(consequence?.signals)?consequence.signals:[]});
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
  const profiles=state.savedProfiles||[];
  select.innerHTML='<option value="">New Riot profile</option>'+profiles.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.display_name||([p.game_name,p.tag_line].filter(Boolean).join('#'))||'Saved profile')+'</option>').join('');
  select.value=profiles.some(p=>String(p.id)===String(state.selectedProfileId))?String(state.selectedProfileId):'';
  const current=profiles.find(p=>String(p.id)===String(state.selectedProfileId))||null;
  if($('savedProfileTitle'))$('savedProfileTitle').textContent=current?(current.display_name||'Saved Riot profile'):'New Riot profile';
  if($('savedProfileMeta'))$('savedProfileMeta').textContent=current?('Saved on Kalenel · preferred '+roleLabel(profileRole(current))+' · '+String(current.platform_region||'euw1').toUpperCase()):'Enter a Riot ID below. The site will save the Riot profile and analysis history automatically; the Riot API key is never saved.';
  if($('forgetSavedProfileBtn'))$('forgetSavedProfileBtn').disabled=!current;
}
function rememberProfileSelection(id){
  state.selectedProfileId=String(id||'');
  try{if(state.selectedProfileId)localStorage.setItem(LEAGUE_SLOT_SELECTION_KEY,state.selectedProfileId);else localStorage.removeItem(LEAGUE_SLOT_SELECTION_KEY);}catch(_){}
  renderSavedProfiles();
}
async function loadSavedReport(profile){
  if(!profile?.id)return;
  const selectedRole=selectedAnalysisRole();
  try{
    const d=await api('report_latest',{profile_id:profile.id,target_role:selectedRole});
    const current=d.analysis?.report_data||null,previous=d.previous?.report_data||null;
    if(current){
      renderReport(current,'saved_server');
      renderProgressComparison(current,previous,d.previous?.created_at||null);
      $('analysisState').textContent=(current.games?.length||0)+' saved '+roleLabel(selectedRole)+' games';
      $('sourceState').textContent='Saved Kalenel analysis';
      statusPill('Saved '+roleLabel(selectedRole)+' report loaded');
    }else{
      // Older stored reports predate role tagging. Never reuse a mixed-role
      // payload for a selected-role view; rebuild deterministically from the
      // already cached Riot match/timeline data instead. This needs no Riot key.
      let cache=null;
      try{cache=await api('cache_status',{profile_id:profile.id,target_role:selectedRole});}catch(_){}
      const cachedRoleGames=Number(cache?.selected_role_cached_games??cache?.role_counts?.[selectedRole]??0);
      if(cachedRoleGames>0){
        $('analysisState').textContent='Rebuilding saved '+roleLabel(selectedRole)+' report';
        $('sourceState').textContent='Using cached Riot data';
        statusPill('Rebuilding '+roleLabel(selectedRole)+' report','warn');
        try{
          const rebuilt=await api('analyze_basic',{profile_id:profile.id,target_role:selectedRole});
          const report=rebuilt?.report||null;
          const wrongRole=(report?.games||[]).find(g=>canonicalRole(g.role)!==selectedRole);
          if(wrongRole)throw new Error('Role-selection safety check failed during saved-report rebuild.');
          if(report?.games?.length){
            renderReport(report,'saved_server');
            renderProgressComparison(report,null,null);
            $('analysisState').textContent=report.games.length+' saved '+roleLabel(selectedRole)+' games';
            $('sourceState').textContent='Saved Kalenel analysis · rebuilt from cache';
            statusPill('Saved '+roleLabel(selectedRole)+' report rebuilt');
            log('Rebuilt a role-pure '+roleLabel(selectedRole)+' report from '+cachedRoleGames+' cached '+roleLabel(selectedRole)+' game(s); no Riot refetch was needed.','ok');
            return;
          }
        }catch(rebuildError){log('Cached '+roleLabel(selectedRole)+' report rebuild: '+rebuildError.message,'bad');}
      }
      $('report').hidden=true;$('reportEmpty').hidden=false;
      $('analysisState').textContent='No saved '+roleLabel(selectedRole)+' report yet';
      $('sourceState').textContent=cachedRoleGames?'Cached games available · retry analysis':'Profile saved · analyze this role';
    }
  }catch(e){log('Saved report: '+e.message,'bad');}
}
async function applySavedProfile(id,{loadReport=true}={}){
  const p=(state.savedProfiles||[]).find(x=>String(x.id)===String(id));if(!p)return;
  state.profile=p;rememberProfileSelection(p.id);
  if($('requestGameName'))$('requestGameName').value=p.game_name||'';
  if($('requestTagLine'))$('requestTagLine').value=p.tag_line||'';
  if($('requestRegion'))$('requestRegion').value=p.platform_region||'euw1';
  state.selectedRole=profileRole(p);if($('requestRole'))$('requestRole').value=state.selectedRole;
  syncButtons();await loadCacheStatus();if(loadReport)await loadSavedReport(p);
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
async function ensureDirectRequestProfile(){
  const gameName=String($('requestGameName')?.value||'').trim(),tagLine=String($('requestTagLine')?.value||'').trim(),platformRegion=String($('requestRegion')?.value||'euw1'),targetRole=selectedAnalysisRole();
  if(!gameName||!tagLine)throw new Error('Enter a Riot game name and tag.');
  const existing=(state.savedProfiles||[]).find(p=>sameRiotIdentity(p,gameName,tagLine,platformRegion))||null;
  const d=await api('profile_save',{
    profile:{
      ...(existing?.id?{id:existing.id}:{}),
      profile_key:existing?.profile_key||generatedProfileKey(gameName,tagLine,platformRegion),
      display_name:gameName+'#'+tagLine,
      game_name:gameName,
      tag_line:tagLine,
      platform_region:platformRegion,
      notes:profileNotes(targetRole)
    }
  });
  if(d.resolve_warning)throw new Error('Riot account lookup failed: '+d.resolve_warning);
  if(!d.profile?.puuid)throw new Error('Riot account lookup did not return a PUUID.');
  state.profile=d.profile;state.selectedRole=targetRole;
  const idx=state.savedProfiles.findIndex(p=>String(p.id)===String(d.profile.id));if(idx>=0)state.savedProfiles[idx]=d.profile;else state.savedProfiles.unshift(d.profile);
  rememberProfileSelection(d.profile.id);
  $('sourceState').textContent='Riot profile saved + resolved';
  return d.profile;
}
async function boot(){
  bindGameSortControls();
  bindGameFilterControls();
  clearLog();log('Ready. Enter a Riot ID, region and Riot API key, then load recent matches.');
  await getDdragonVersion();
  try{
    const health=await api('health');
    state.serverRiotKey=!!health.server_riot_key;
    state.publicWorkspace=health.public_workspace!==false;
    $('backendState').textContent=health.riot_configured?'Backend + Riot ready':'Backend ready · add Riot key';
    $('backendState').className='pill '+(health.riot_configured?'':'warn');
    $('riotKeyStatus').textContent=state.serverRiotKey?'Server Riot key available':'Your Riot key stays only in this browser tab.';
    log('League backend ready. Riot profiles and analysis history can be stored in this isolated Kalenel workspace; the API key remains session-only.','ok');
    await refreshSavedProfiles({restore:true});
  }catch(e){
    $('backendState').textContent='Backend unavailable';$('backendState').className='pill error';log(e.message,'bad');
  }
  syncButtons();
}
function syncButtons(){
  const run=$('loadRecentBtn');if(run)run.disabled=state.busy||!directRequestComplete();
}
async function loadCacheStatus(){
  if(!state.profile)return;
  try{
    const targetRole=selectedAnalysisRole(),d=await api('cache_status',{profile_id:state.profile.id,target_role:targetRole}),roleCount=Number(d.selected_role_cached_games??d.role_counts?.[targetRole]??0);
    $('cacheState').textContent=(d.cached_games||0)+' cached · '+roleCount+' '+roleLabel(targetRole);
    $('latestGameState').textContent=d.last_game_at?fmtDate(d.last_game_at):'None yet';
  }catch(e){
    $('cacheState').textContent='Unavailable';
    log('Cache status: '+e.message,'bad');
  }
}

async function fetchProfileData(profile,requestedCount,progressStart=8,progressEnd=82,targetRole=selectedAnalysisRole()){
  log('Preparing recent match list for '+profile.display_name+' · '+roleLabel(targetRole)+'. Queue/map/duration and selected-role filtering are applied before the Last-20 report; '+requestedCount+' raw matches requested.');
  const prep=await api('fetch_prepare',{profile_id:profile.id,count:requestedCount});
  const ids=prep.match_ids||[],cached=new Set(prep.cached_match_ids||[]);
  if(!ids.length)throw new Error('Riot returned no recent match IDs.');
  log(ids.length+' recent matches found for '+profile.display_name+'; '+cached.size+' already cached.');
  let done=0,usable=cached.size,failed=0;
  for(const id of ids){
    done++;
    if(cached.has(id)){
      log('['+done+'/'+ids.length+'] '+profile.display_name+' · '+id+' · cache hit','ok');setProgress(progressStart+(progressEnd-progressStart)*(done/Math.max(1,ids.length)),100);continue;
    }
    log('['+done+'/'+ids.length+'] '+profile.display_name+' · fetching match + timeline '+id+'…');
    try{
      const one=await api('fetch_one',{run_id:prep.run_id,match_id:id});
      if(one.timeline_available){usable++;log('['+done+'/'+ids.length+'] '+profile.display_name+' · '+id+' · match + timeline cached','ok');}
      else{usable++;log('['+done+'/'+ids.length+'] '+profile.display_name+' · '+id+' · match cached, timeline unavailable: '+(one.timeline_error||'unknown'),'bad');}
    }catch(e){failed++;log('['+done+'/'+ids.length+'] '+profile.display_name+' · '+id+' · '+e.message,'bad');}
    setProgress(progressStart+(progressEnd-progressStart)*(done/Math.max(1,ids.length)),100);
    await sleep(100);
  }
  const finish=await api('fetch_finish',{run_id:prep.run_id,target_role:targetRole});
  if(hasNum(finish?.dominant_queue_id))log(profile.display_name+' · '+roleLabel(targetRole)+' queue '+String(finish.dominant_queue_id)+' selected from the '+String(finish.queue_selection_window??20)+' newest supported '+roleLabel(targetRole)+' games · '+String(finish.comparable_cached_games??finish.peer_rank_target_count??0)+' role+queue comparable games'+(hasNum(finish?.selected_role_total_cached_games)?' from '+String(finish.selected_role_total_cached_games)+' cached '+roleLabel(targetRole)+' games':'')+' · '+String(finish.peer_rank_target_count??0)+' peer-rank targets · '+String(finish.peer_rank_backfilled??0)+' rank snapshots backfilled.','ok');
  if(finish?.recommend_deeper_cache)log(profile.display_name+' · only '+String(finish.comparable_cached_games??0)+' comparable cached games are available after map/duration/queue filtering; the request can automatically scan deeper.','bad');
  if(usable===0)throw new Error('Riot returned match IDs, but none could be cached successfully.');
  return{prep,finish,usable,failed};
}
async function analyzeProfileData(profile,targetRole=selectedAnalysisRole()){
  log(profile.display_name+' · building the '+roleLabel(targetRole)+' Last-20 analysis from the matches just fetched/cached.');
  const d=await api('analyze_basic',{profile_id:profile.id,target_role:targetRole});
  log(profile.display_name+' · deterministic '+roleLabel(targetRole)+' analysis generated for '+(d.report?.dataQuality?.analyzedGames||0)+' games.','ok');
  return d;
}
async function runRecentAnalysis(){
  if(state.busy)return;
  if(!directRequestComplete()){
    statusPill('Missing details','error');
    log('Enter game name, tag, region and a Riot API key first.','bad');
    return;
  }
  const targetRole=selectedAnalysisRole();state.selectedRole=targetRole;
  clearLog();setBusy(true,'Resolving Riot ID');statusPill('Resolving Riot ID','warn');
  $('report').hidden=true;$('reportEmpty').hidden=false;
  try{
    const profile=await ensureDirectRequestProfile();
    $('riotKeyStatus').textContent='Riot access verified for this request';
    log('Resolved '+profile.display_name+'. Fetching recent Riot matches for a '+roleLabel(targetRole)+'-only report.','ok');
    statusPill('Fetching '+roleLabel(targetRole)+' matches','warn');
    setProgress(4,100);
    let result=await fetchProfileData(profile,30,8,64,targetRole);
    if(Number(result.finish?.comparable_cached_games??0)<20){
      log('Fewer than 20 queue-comparable '+roleLabel(targetRole)+' games found in the first 30. Extending the scan to 50 recent matches automatically.','ok');
      result=await fetchProfileData(profile,50,64,84,targetRole);
    }
    if(Number(result.finish?.comparable_cached_games??0)>=20)setProgress(84,100);
    await loadCacheStatus();
    statusPill('Analyzing '+roleLabel(targetRole)+' Last 20','warn');
    setProgress(90,100);
    const d=await analyzeProfileData(profile,targetRole);
    const analyzed=Number(d.report?.dataQuality?.analyzedGames??d.report?.games?.length??0);
    if(analyzed<=0)throw new Error('No '+roleLabel(targetRole)+' games were eligible after queue/map/duration filtering. Try another role or fetch again after more matches.');
    const wrongRole=(d.report?.games||[]).find(g=>canonicalRole(g.role)!==targetRole);
    if(wrongRole)throw new Error('Role-selection safety check failed: a '+String(wrongRole.role||'different-role')+' match entered the '+targetRole+' report.');
    renderReport(d.report,'web_behavior');
    try{const history=await api('report_latest',{profile_id:profile.id,target_role:targetRole});renderProgressComparison(d.report,history.previous?.report_data||null,history.previous?.created_at||null);}catch(_){$('progressComparisonPanel').hidden=true;}
    $('analysisState').textContent=analyzed+' '+roleLabel(targetRole)+' games analyzed';
    $('sourceState').textContent='Saved Kalenel report · Riot + behavioral analyzer';
    setProgress(100,100);
    statusPill(roleLabel(targetRole)+' Last 20 ready');
    log('Done — '+analyzed+' eligible '+roleLabel(targetRole)+' games analyzed and saved to this Kalenel League profile.','ok');
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
  out.sourceStatus=out.sourceStatus||{};
  out.charts=out.charts||{};
  return out;
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
function scheduleHeavyReportRender(r){
  const ticket=++heavyRenderTicket;clearHeavyObservers();
  const safe=fn=>()=>{if(ticket===heavyRenderTicket&&state.report===r)fn();};
  renderWhenNear('lane-economy',safe(()=>renderCharts(r)),'900px');
  renderWhenNear('spatialReview',safe(()=>renderSpatial(r)),'650px');
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
  const r=normalizeReport(raw);state.report=r;
  $('reportEmpty').hidden=true;$('report').hidden=false;
  const p=r.profile||{},s=r.summary||{};
  $('reportTitle').textContent=p.displayName||p.display_name||state.profile?.display_name||'League account';
  const riotId=[p.gameName||p.game_name,p.tagLine||p.tag_line].filter(Boolean).join('#');
  const rank=p.rank&&p.rank.tier?[p.rank.tier,p.rank.rank,p.rank.leaguePoints!=null?String(p.rank.leaguePoints)+' LP':''].filter(Boolean).join(' '):'';
  const coachingN=r.coachingSummary?.games??s.primaryRoleGames??0,reportRole=canonicalRole(r.dataQuality?.selectedRole||s.primaryRole||state.selectedRole);
  const reportTimes=(r.games||[]).map(g=>gameTimestampMs(g.gameStartTimestamp)).filter(Boolean).sort((a,b)=>a-b);
  const reportRange=reportTimes.length?(new Date(reportTimes[0]).toLocaleDateString(undefined,{day:'numeric',month:'short'})+' → '+new Date(reportTimes[reportTimes.length-1]).toLocaleDateString(undefined,{day:'numeric',month:'short'})):'';
  $('reportSubtitle').textContent=(riotId?riotId+' · ':'')+(rank?rank+' · ':'')+(s.games??r.games.length)+' '+roleLabel(reportRole)+' games · '+coachingN+' coaching-comparable'+(reportRange?' · '+reportRange:'');
  if($('rankRadarPanel'))$('rankRadarPanel').hidden=reportRole!=='ADC';
  $('reportSourceBadge').textContent=sourceKind==='legacy_import'?'Imported current report':sourceKind==='saved_server'?'Saved Kalenel report':(r.analyzerVersion||'Web analysis');
  renderQuickRead(r);
  renderRecentPulse(r);
  renderReportDrivers(r);
  renderEvidenceHealth(r);
  renderKpis(r);
  renderSupportRoleLens(r);
  renderOutcomeFingerprint(r);
  renderRankRadar(r);
  renderVisualSummary(r);
  renderBullets('recentFocus',r.priorityThemes?.length?r.priorityThemes:r.recentFocus,'No grounded improvement priority has enough evidence yet.');
  renderBullets('overallHighlights',r.overallHighlights,'No broader strength has enough evidence yet.');
  renderPracticePlan(r);
  renderDecisionMetrics(r);
  renderObjectiveFamilyOverview(r);
  renderPhaseDiagnostic(r);
  renderCompoundSignals(r);
  renderSessionHabits(r);
  renderGameArcs(r);
  renderMatchHistory(r);
  renderGames(r);
  renderReplayReviewQueue(r);
  renderBreakdowns(r);
  renderQuality(r);
  $('advancedMetrics').innerHTML='<div class="technical-placeholder">Open this section to render the full metric set.</div>';
  $('benchmarkMetrics').innerHTML='<div class="technical-placeholder">Open this section to render the full benchmark set.</div>';
  bindTechnicalMetrics(r);
  $('chartGrid').innerHTML='<div class="chart-empty">Charts load when this section approaches the viewport.</div>';
  $('deathMap').innerHTML='<div class="spatial-empty">Map loads when this section approaches the viewport.</div>';
  $('wardMap').innerHTML='<div class="spatial-empty">Map loads when this section approaches the viewport.</div>';
  scheduleHeavyReportRender(r);
}

function adcBenchmarkSummary(r){
  const role=String(r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||''),ext=r?.externalBenchmarks||{};
  return role==='ADC'&&ext.eligible!==false?(r.coachingSummary||r.summary||null):null;
}
function adcBenchmarkUnavailableReason(r){
  const role=String(r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||''),ext=r?.externalBenchmarks||{};
  if(role!=='ADC')return 'The external benchmark is ADC-specific and is withheld because ADC is not this report’s primary coaching role.';
  if(ext.eligibilityReason==='selected_cohort_not_ranked')return 'The selected Last-20 cohort is not Ranked Solo/Flex, while the external reference corpus is ranked games. The population spider is withheld to avoid an apples-to-oranges comparison.';
  if(ext.eligibilityReason==='matching_rank_queue_tier_unavailable')return 'Riot did not return a ranked tier for the same ranked queue as this report cohort, so the population benchmark is withheld.';
  return 'The ranked ADC population benchmark is unavailable for this report.';
}
function benchmarkKpi(label,value,benchmark,unit,inverse=false,extra=''){
  const delta=hasNum(value)&&hasNum(benchmark)?Number(value)-Number(benchmark):null;
  const tone=delta==null?'neutral':deltaTone(delta,0,unit==='csmin'?.15:unit==='percent'?2:unit==='dpm'?50:unit==='kda'?.2:unit==='deaths'?.25:.01,inverse);
  const formatted=unit==='percent'?fmtPct(value):unit==='csmin'?fmt(value,2):unit==='dpm'?fmtInt(value):unit==='deaths'?fmt(value,1):fmt(value,2);
  const benchmarkText=unit==='percent'?fmtPct(benchmark):unit==='csmin'?fmt(benchmark,2):unit==='dpm'?fmtInt(benchmark):unit==='deaths'?fmt(benchmark,1):fmt(benchmark,2);
  const deltaText=delta==null?'benchmark unavailable':unit==='percent'?signed(delta,1)+' pp':unit==='csmin'?signed(delta,2):unit==='dpm'?signed(delta,0):unit==='deaths'?signed(delta,1):signed(delta,2);
  return{label,value:formatted,tone,sub:'External ref '+benchmarkText+' · '+deltaText+(extra?' · '+extra:''),bar:delta==null?'':contextBar(delta,unit==='dpm'?500:unit==='csmin'?2:unit==='percent'?15:unit==='deaths'?3:2,inverse)};
}

function reportInsightParts(x,fallback){
  if(typeof x==='string'){
    const copy=x.trim();return copy?{present:true,title:fallback,copy,action:'',meta:''}:{present:false,title:'Not enough evidence',copy:'No supported '+fallback.toLowerCase()+' has crossed the report threshold yet.',action:'',meta:''};
  }
  if(!x||typeof x!=='object')return {present:false,title:'Not enough evidence',copy:'No supported '+fallback.toLowerCase()+' has crossed the report threshold yet.',action:'',meta:''};
  const sourceTitle=String(x.title||x.label||x.category||'').trim(),copy=String(x.evidence||x.text||x.comparison||'').trim(),action=String(x.action||'').trim(),present=Boolean(sourceTitle||copy||action);
  const meta=[x.confidence?String(x.confidence)+' confidence':'',Number(x.supportCount||0)>0?String(Number(x.supportCount))+' supporting finding'+(Number(x.supportCount)===1?'':'s'):'',x.comparison?'vs '+String(x.comparison):''].filter(Boolean).join(' · ');
  return {present,title:present?(sourceTitle||fallback):'Not enough evidence',copy:present?copy:'No supported '+fallback.toLowerCase()+' has crossed the report threshold yet.',action:present?action:'',meta:present?meta:''};
}
function recentDirectionSummary(r){
  const t=r.recentTrend||{},defs=[
    ['CS / min',t.csMin,false,.15],['Gold @15',t.goldDiff15,false,150],['Damage / min',t.dpm,false,50],
    ['Kill participation',t.kp,false,2],['High-risk deaths',t.badDeaths,true,.2]
  ];
  let good=0,bad=0,stable=0,supported=0;
  defs.forEach(([,o,inverse,threshold])=>{
    if(!o||!hasNum(o.recent)||!hasNum(o.prior)||Number(o.recentN||0)<3||Number(o.priorN||0)<5)return;
    supported++;
    const d=Number(o.recent)-Number(o.prior);
    if(Math.abs(d)<threshold){stable++;return;}
    const signal=inverse?-d:d;if(signal>0)good++;else bad++;
  });
  if(!supported)return {tone:'neutral',value:'Not enough evidence',copy:'The latest-five window does not yet have enough valid recent-versus-prior observations for a directional read.'};
  if(!good&&!bad)return {tone:'neutral',value:'Broadly stable',copy:stable+' supported recent signal'+(stable===1?' is':'s are')+' inside the report’s practical change bands; there is no strong short-window movement to chase.'};
  if(good>=bad+2)return {tone:'good',value:'Moving favorably',copy:good+' meaningful recent signals improved, '+bad+' moved unfavorably and '+stable+' stayed inside the practical change bands. Treat this as short-window direction, not proof of a lasting trend.'};
  if(bad>=good+2)return {tone:'bad',value:'Needs stabilizing',copy:bad+' meaningful recent signals worsened, '+good+' improved and '+stable+' stayed inside the practical change bands. Emphasize the primary practice target rather than adding new goals.'};
  return {tone:'neutral',value:'Mixed direction',copy:'Recent movement is split: '+good+' favorable, '+bad+' unfavorable and '+stable+' stable supported signals. Keep the practice plan narrow until the signal separates.'};
}
function renderPriorityEvidenceChain(r){
  const box=$('priorityEvidenceChain');if(!box)return;
  const theme=topPracticeThemes(r)[0]||null;
  if(!theme){box.innerHTML='<div class="priority-chain-empty">No top priority has enough supported evidence to build a coaching chain yet.</div>';return;}
  const targets=Array.isArray(r.practiceTargets)?r.practiceTargets:[],target=targets.find(t=>practiceThemeKey(t)===practiceThemeKey(theme))||targets.find(t=>String(t.themeKey||'')===String(theme.key||''))||null;
  const replay=practiceReplayItems(r,theme)[0]||null,supporting=(Array.isArray(theme.supportingTitles)?theme.supportingTitles:[]).filter(x=>String(x||'').trim()&&String(x)!==String(theme.title||'')).slice(0,3);
  const supportText=supporting.length?supporting.join(' · '):(Number(theme.supportCount||0)>1?String(theme.supportCount)+' related findings support this theme':'No second independent supporting finding crossed the display threshold.');
  const targetText=target?(String(target.label||target.metricPath)+' · '+practiceTargetValue(target.baseline,target.unit)+' → '+practiceTargetValue(target.goal,target.unit)+' over '+String(target.windowGames||5)+' new games'):'No denominator-safe Next-5 metric is available for this theme yet.';
  const replayText=replay?(String(replay.champion||'Unknown')+' · '+fmt(replay.minute,1)+'m · '+String(replay.title||'Replay moment')):'No ranked replay moment currently maps to this theme.';
  const stage=(step,label,value,copy,cls='')=>'<article class="priority-chain-stage '+cls+'"><span>'+step+' · '+esc(label)+'</span><strong>'+esc(value)+'</strong><p>'+esc(copy||'')+'</p></article>';
  box.innerHTML='<div class="priority-chain-head"><strong>Why this is priority #1</strong><span>Evidence → reinforcement → replay → measurement → action</span></div><div class="priority-chain-grid">'+
    stage('1','Signal',String(theme.title||theme.label||'Primary limiter'),String(theme.evidence||'Supported report finding.'),'signal')+
    stage('2','Reinforcement',Number(theme.supportCount||1)+' supporting finding'+(Number(theme.supportCount||1)===1?'':'s'),supportText,'support')+
    stage('3','Replay proof',replayText,replay?'Open the ranked moment to inspect the actual decision sequence.':'The priority remains evidence-supported, but no replay-queue moment is strong enough to surface.','replay')+
    stage('4','Next-5 measure',target?String(target.label||'Practice metric'):'Measurement pending',targetText,'measure')+
    stage('5','Action',String(theme.action||'Keep the practice plan narrow.'),'This action is the coaching prescription attached to the current highest-scoring supported theme.','action')+
  '</div><small class="priority-chain-caveat">This is an evidence trace, not a causal proof. Priority rank can change as new games enter the rolling sample.</small>';
  if(replay)box.querySelector('.priority-chain-stage.replay')?.insertAdjacentHTML('beforeend','<button class="button secondary small" type="button" data-chain-replay>Open replay evidence</button>');
  const btn=box.querySelector('[data-chain-replay]');if(btn&&replay)btn.addEventListener('click',()=>openReplayReviewMatch(replay.matchId,replay.tab||'macro'));
}
function renderReportDrivers(r){
  const box=$('reportDrivers');if(!box)return;
  const priorities=topPracticeThemes(r),strengths=r.overallHighlights||[];
  const weak=reportInsightParts(priorities[0],'Primary limiter'),strong=reportInsightParts(strengths[0],'Bankable strength'),direction=recentDirectionSummary(r),priorityIds=currentPriorityReplayIds(r);
  const card=(kind,title,value,copy,action,tone,actionLabel='Next',meta='',footer='')=>'<article class="report-driver-card '+kind+' tone-'+tone+'"><span>'+esc(title)+'</span><strong>'+esc(value)+'</strong><p>'+esc(copy||'No high-confidence supporting sentence is available yet.')+'</p>'+(meta?'<small class="driver-evidence-meta">'+esc(meta)+'</small>':'')+(action?'<div><b>'+esc(actionLabel)+':</b> '+esc(action)+'</div>':'')+footer+'</article>';
  const priorityFooter=priorityIds.size?'<button class="button secondary small driver-review-button" type="button" data-open-priority-history>Review '+priorityIds.size+' matching game'+(priorityIds.size===1?'':'s')+'</button>':'';
  box.innerHTML=[
    card('driver-priority','Primary limiter',weak.title,weak.copy,weak.action,weak.present?'bad':'neutral','Next',weak.meta,priorityFooter),
    card('driver-strength','Bankable strength',strong.title,strong.copy,strong.action,strong.present?'good':'neutral','Preserve',strong.meta),
    card('driver-direction','Recent direction',direction.value,direction.copy,'',direction.tone)
  ].join('');
  const reviewBtn=box.querySelector('[data-open-priority-history]');
  if(reviewBtn)reviewBtn.addEventListener('click',()=>{
    state.matchHistoryFilter='priority';state.matchHistoryLimit=10;renderMatchHistory(r);
    $('match-history')?.scrollIntoView({behavior:'auto',block:'start'});
  });
  renderPriorityEvidenceChain(r);
}
function gameMetricSummary(games,getter){
  const xs=games.map(getter).filter(hasNum).map(Number),n=xs.length;
  if(!n)return {mean:null,n:0,sd:null};
  const mean=xs.reduce((a,b)=>a+b,0)/n;
  const variance=n>1?xs.reduce((sum,x)=>sum+(x-mean)*(x-mean),0)/(n-1):null;
  return {mean,n,sd:variance==null?null:Math.sqrt(Math.max(0,variance))};
}
function standardizedMeanGap(a,b){
  if(!a||!b||a.n<2||b.n<2||!hasNum(a.mean)||!hasNum(b.mean)||!hasNum(a.sd)||!hasNum(b.sd))return null;
  const df=a.n+b.n-2;if(df<=0)return null;
  const pooledVar=((a.n-1)*a.sd*a.sd+(b.n-1)*b.sd*b.sd)/df;
  if(!(pooledVar>0))return Number(a.mean)===Number(b.mean)?0:null;
  const cohenD=Math.abs(Number(a.mean)-Number(b.mean))/Math.sqrt(pooledVar),hedgesCorrection=Math.max(0,1-3/(4*df-1));
  return cohenD*hedgesCorrection;
}
function outcomeFingerprintCard(label,wins,losses,unit,inverse=false){
  const valid=wins?.n>=2&&losses?.n>=2&&hasNum(wins?.mean)&&hasNum(losses?.mean);
  const delta=valid?Number(wins.mean)-Number(losses.mean):null,effect=valid?standardizedMeanGap(wins,losses):null;
  const tone=delta==null?'neutral':(inverse?(delta<0?'good':'bad'):(delta>0?'good':'bad'));
  const fmtValue=v=>unit==='percent'?fmtPct(v):unit==='gold'?(hasNum(v)?signed(v,0)+'g':'n/a'):unit==='dpm'?fmtInt(v):unit==='num'?fmt(v,2):fmt(v,2);
  const deltaText=delta==null?'Not enough valid observations.':('Observed mean gap: '+(unit==='percent'?signed(delta,1)+' pp':unit==='gold'?signed(delta,0)+'g':signed(delta,unit==='num'?2:0)+(unit==='dpm'?' DPM':'')));
  return {label,wins,losses,delta,effect,tone,html:'<article class="outcome-fingerprint-card tone-'+tone+'"><span>'+esc(label)+'</span><div><strong>'+esc(fmtValue(wins?.mean))+'</strong><small>in wins · n='+Number(wins?.n||0)+'</small></div><div><strong>'+esc(fmtValue(losses?.mean))+'</strong><small>in losses · n='+Number(losses?.n||0)+'</small></div><p>'+esc(deltaText)+(hasNum(effect)?' · Hedges-corrected gap '+fmt(effect,2):'')+'</p></article>'};
}

function supportLensCard(label,value,detail,tone='neutral',ready=true,interval=null){
  const effective=ready?tone:'neutral',hasInterval=interval&&hasNum(interval.low)&&hasNum(interval.high);
  return '<article class="support-lens-card tone-'+effective+(ready?'':' thin-evidence')+'"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong>'+
    (hasInterval?'<div class="support-lens-interval"><i style="left:'+clamp(interval.low,0,100)+'%;width:'+(clamp(interval.high,0,100)-clamp(interval.low,0,100))+'%"></i><b style="left:'+clamp(Number(String(value).replace(/[^0-9.-]/g,'')),0,100)+'%"></b></div><small>95% Wilson '+esc(fmtPct(interval.low))+'–'+esc(fmtPct(interval.high))+'</small>':'')+
    '<p>'+esc(detail)+(ready?'':' · thin sample — descriptive only')+'</p></article>';
}
function renderSupportRoleLens(r){
  const panel=$('supportRoleLensPanel'),box=$('supportRoleLens'),note=$('supportRoleLensNote');if(!panel||!box)return;
  const role=canonicalRole(r?.dataQuality?.selectedRole||r?.coachingSummary?.primaryRole||r?.summary?.primaryRole||state.selectedRole);
  if(role!=='SUPPORT'){panel.hidden=true;box.innerHTML='';if(note)note.textContent='';return;}
  const b=r.behaviorSummary||{},roamN=Number(b.roamAttempts||0),roamRate=hasNum(b.roamSuccessRate)?Number(b.roamSuccessRate):null,roamReady=roamN>=4;
  const adcCostN=Number(b.supportRoamAdcCostGames||0),adcCost=hasNum(b.avgSupportRoamAdcLaneCostCs)?Number(b.avgSupportRoamAdcLaneCostCs):null,harmful=Number(b.supportRoamsHurtingAdc||0),costReady=adcCostN>=4||harmful>=2;
  const visionN=Number(b.visionActions||0),visionDeaths=Number(b.visionActionDeaths||0),visionRate=hasNum(b.visionActionDeathRate)?Number(b.visionActionDeathRate):null,visionReady=visionN>=12,highRiskVision=Number(b.highRiskVisionActionDeaths||0),unsupportedVision=Number(b.unsupportedVisionActionDeaths||0);
  const setupN=Number(b.neutralObjectiveJoins||0),setupHits=Number(b.earlySetupObjectiveJoins||0),setupRate=hasNum(b.earlySetupObjectiveJoinRate)?Number(b.earlySetupObjectiveJoinRate):null,setupReady=setupN>=5;
  const contestN=Number(b.objectiveContestEncounters??b.neutralObjectiveEvents??0),contestHits=Number(b.objectiveContestJoinedEncounters??b.neutralObjectiveJoins??0),contestRate=hasNum(b.objectiveContestPresenceRate??b.objectiveJoinRate)?Number(b.objectiveContestPresenceRate??b.objectiveJoinRate):null,contestReady=contestN>=5;
  const roamTone=roamRate==null?'neutral':roamRate<45?'bad':roamRate>=65?'good':'neutral';
  const costTone=harmful>=2?'bad':costReady&&adcCost!=null&&adcCost>=-2&&roamRate!=null&&roamRate>=60?'good':'neutral';
  const visionTone=visionDeaths>=3&&(highRiskVision>=2||unsupportedVision>=2)?'bad':visionN>=18&&visionDeaths===0?'good':'neutral';
  const setupTone=setupRate==null?'neutral':setupRate<45?'bad':setupRate>=70?'good':'neutral';
  const contestTone=contestRate==null?'neutral':contestRate<50?'bad':contestRate>=70?'good':'neutral';
  box.innerHTML=[
    supportLensCard('Roam conversion',roamRate==null?'n/a':fmtPct(roamRate),roamN+' detected pre-major-objective-era departures · analyzer floor 4',roamTone,roamReady),
    supportLensCard('ADC lane cost during roams',adcCost==null?'n/a':signed(adcCost,1)+' CS',adcCostN+' ADC-vs-ADC lane-cost windows · '+harmful+' lost ≥6 CS without kill/assist/objective return',costTone,costReady),
    supportLensCard('Vision-action safety',visionRate==null?'n/a':fmtPct(visionRate),visionDeaths+' deaths after '+visionN+' tracked ward placements/clears · '+highRiskVision+' high-risk · '+unsupportedVision+' unsupported',visionTone,visionReady,wilsonInterval(visionDeaths,visionN)),
    supportLensCard('Prior objective setup',setupRate==null?'n/a':fmtPct(setupRate),setupHits+' / '+setupN+' joined neutral-objective encounters already near the area 45–105s before the event',setupTone,setupReady,wilsonInterval(setupHits,setupN)),
    supportLensCard('Contested objective presence',contestRate==null?'n/a':fmtPct(contestRate),contestHits+' / '+contestN+' supported team-contested neutral-objective encounters',contestTone,contestReady,wilsonInterval(contestHits,contestN))
  ].join('');
  if(note){
    const read=harmful>=2?'Repeated support roams are measurably expensive for the ADC lane; review whether the ADC could safely crash, reset or collect before you leave.':roamReady&&roamRate!=null&&roamRate>=65&&costReady&&adcCost!=null&&adcCost>=-2?'Roams are converting while preserving ADC lane economy in the measured windows; keep the same wave-preparation rule.':'Use the cards independently: a successful roam can still be expensive for bot lane, and low lane cost does not prove the roam created value.';
    note.textContent=read+' Support roam cost uses change in ADC-vs-ADC CS differential during the detected support roam; it is not a claim that every CS change was caused solely by the Support.';
  }
  panel.hidden=false;
}

function renderOutcomeFingerprint(r){
  const box=$('outcomeFingerprint'),note=$('outcomeFingerprintNote');if(!box)return;
  const games=reportCoachingGames(r),wins=games.filter(g=>g.win),losses=games.filter(g=>!g.win);
  if(wins.length<2||losses.length<2){
    box.innerHTML='<div class="bullet empty">At least two wins and two losses are needed for a useful within-sample outcome comparison.</div>';
    if(note)note.textContent='The report does not force an outcome story from a one-sided coaching cohort. Current comparison sample: '+wins.length+' wins / '+losses.length+' losses.';
    return;
  }
  const cards=[
    outcomeFingerprintCard('Role gold @15',gameMetricSummary(wins,g=>g?.phaseRules?.lane15Comparable===false?null:g.goldDiff15),gameMetricSummary(losses,g=>g?.phaseRules?.lane15Comparable===false?null:g.goldDiff15),'gold',false),
    outcomeFingerprintCard('High-risk deaths / game',gameMetricSummary(wins,g=>g.timelineAvailable===true?g.badDeathCount:null),gameMetricSummary(losses,g=>g.timelineAvailable===true?g.badDeathCount:null),'num',true),
    outcomeFingerprintCard('Damage / min',gameMetricSummary(wins,g=>g.dpm),gameMetricSummary(losses,g=>g.dpm),'dpm',false),
    outcomeFingerprintCard('Kill participation',gameMetricSummary(wins,g=>g.kp),gameMetricSummary(losses,g=>g.kp),'percent',false)
  ];
  box.innerHTML=cards.map(x=>x.html).join('');
  const usable=cards.filter(x=>hasNum(x.effect)).sort((a,b)=>Number(b.effect)-Number(a.effect)),lead=usable[0];
  if(note)note.innerHTML=lead?'<b>Largest standardized separation:</b> '+esc(lead.label)+' (Hedges g '+esc(fmt(lead.effect,2))+'). The small-sample correction makes unlike units more comparable, but this remains descriptive and is not a causal or significance claim. Coaching cohort: '+wins.length+' wins / '+losses.length+' losses.':'No metric has at least two valid observations in both wins and losses with enough variation for a standardized comparison in the coaching cohort.';
}


function evidenceHealthCard(label,value,detail,status){
  const stateLabel=status==='ready'?'Ready':status==='limited'?'Limited':'Withheld';
  return '<article class="evidence-health-card evidence-'+status+'"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong><small><b>'+stateLabel+'</b> · '+esc(detail)+'</small></article>';
}
function renderEvidenceHealth(r){
  const box=$('evidenceHealth'),link=$('evidenceHealthLink');if(!box)return;
  const q=r.dataQuality||{},games=reportCoachingGames(r),n=games.length;
  const timeline=games.filter(g=>g.timelineAvailable===true).length;
  const peers=games.filter(g=>trustedDirectPeer(g)).length;
  const lane15=games.filter(g=>g.timelineAvailable===true&&trustedDirectPeer(g)&&g?.phaseRules?.lane15Comparable!==false&&hasNum(g.goldDiff15)).length;
  const exactItems=games.filter(g=>g.timelineAvailable===true&&g.itemCatalogExactPatch===true).length;
  const mechanicsLimited=q.currentMechanicsKnown===false||q.mixedMechanicsFallback===true||q.mechanicsCohortReason==='current_mechanics_unverified';
  const status=(count,min)=>count>=min?'ready':count>0?'limited':'withheld';
  const pct=(count)=>n?fmtPct(100*count/n):'n/a';
  box.innerHTML=[
    evidenceHealthCard('Timeline behavior',timeline+'/'+n,pct(timeline)+' of coaching games · directional behavior floor 5',status(timeline,5)),
    evidenceHealthCard('Trusted role peer',peers+'/'+n,pct(peers)+' of coaching games · direct-peer comparison floor 5',status(peers,5)),
    evidenceHealthCard('Comparable @15',lane15+'/'+n,pct(lane15)+' with timeline + trusted peer + compatible lane checkpoint',status(lane15,5)),
    evidenceHealthCard('Mechanics cohort',String(q.mechanicsCohortGames ?? n)+' games',mechanicsLimited?(q.mechanicsCohortReason==='current_mechanics_unverified'?'newest mechanics revision unverified':'broader/mixed mechanics fallback in use'):(q.mechanicsCohortApplied?'verified current-mechanics cohort applied':'single compatible mechanics context'),mechanicsLimited?'limited':'ready'),
    evidenceHealthCard('Exact item mechanics',exactItems+'/'+n,pct(exactItems)+' with timeline + exact patch item catalog · item-window floor 4',status(exactItems,4))
  ].join('');
  if(link)link.onclick=()=>$('trust-coverage')?.scrollIntoView({behavior:'auto',block:'start'});
}

function renderKpis(r){
  const s=r.coachingSummary||r.summary||{},role=roleLabel(s.primaryRole||r.summary?.primaryRole||state.selectedRole),games=Number(s.games||0);
  const rows=[
    {label:'Win rate',value:fmtPct(s.winRate),sub:games+' '+role+' coaching games'},
    {label:'KDA',value:fmt(s.kda,2),sub:'Raw selected-role sample'},
    {label:'CS / min',value:fmt(s.csMin,2),sub:'Raw selected-role sample'},
    {label:'Kill participation',value:fmtPct(s.kp),sub:'Raw selected-role sample'},
    {label:'Damage / min',value:fmtInt(s.dpm),sub:'Raw selected-role sample'},
    {label:'Deaths / game',value:fmt(s.avgDeaths,1),sub:'Raw selected-role sample · lower is not automatically better'}
  ];
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
  const p=r.peerComparison||{},b=r.behaviorSummary||{};
  const laneN=Number(p.laneGames15||0),csN=Number(p.csMinGames??p.sameRoleGames??0),dpmN=Number(p.dpmGames??p.sameRoleGames??0),itemN=Number(p.majorItemGames||0),impactN=Number(p.impactGames||0),repeatN=Number(b.peerMatchedRepeatDeathOpportunities??0);
  const lane=p.avgGoldDiff15,cs=p.avgCsMinDelta,dpm=p.avgDpmDelta,item=p.avgMajorItemDeltaMin,impact=p.avgImpactDeltaMin,repeat=p.repeatDeathRateDelta;
  $('quickRead').innerHTML=[
    comparisonCard('Role gold @15',lane,'gold',1000,false,
      !hasNum(lane)?'No comparable @15 direct-role checkpoint is available.':Number(lane)>150?'You average a meaningful gold lead over the actual same-role opponent at 15.':Number(lane)<-150?'You average a meaningful gold deficit versus the actual same-role opponent at 15.':'Your average direct-role economy is close around 15 minutes.',
      laneN+' comparable @15 games · threshold 5',laneN>=5),
    comparisonCard('CS/min vs role opponent',cs,'csmin',2,false,
      !hasNum(cs)?'No same-role CS/min comparison is available.':Number(cs)>.15?'You farm faster than the direct role opponent on average.':Number(cs)<-.15?'You farm slower than the direct role opponent on average.':'Your CS/min is close to the direct role opponent.',
      csN+' direct-role CS/min comparisons · threshold 5',csN>=5),
    comparisonCard('DPM vs role opponent',dpm,'dpm',500,false,
      !hasNum(dpm)?'No same-role damage comparison is available.':Number(dpm)>100?'Your champion damage output is materially above the direct role opponent.':Number(dpm)<-100?'Your champion damage output trails the direct role opponent.':'Damage output is close to the direct role opponent.',
      dpmN+' direct-role DPM comparisons · threshold 5',dpmN>=5),
    comparisonCard('First major timing vs role',item,'minutes',3,true,
      !hasNum(item)?'No comparable first-major timing sample is available.':Number(item)<-.75?'Your first major item completes earlier than the direct role opponent on average.':Number(item)>.75?'Your first major item completes later than the direct role opponent on average.':'First-major timing is close to the direct role opponent.',
      itemN+' comparable item games · threshold 4',itemN>=4),
    comparisonCard('First tracked impact vs role',impact,'minutes',4,true,
      !hasNum(impact)?'No comparable first-impact timing sample is available.':Number(impact)<-1.5?'Your first tracked kill/assist/objective impact arrives earlier.':Number(impact)>1.5?'The direct role opponent reaches tracked map impact earlier.':'First tracked impact timing is close.',
      impactN+' comparable impact games · threshold 5',impactN>=5),
    comparisonCard('Repeat-death rate vs role',repeat,'pp',35,true,
      !hasNum(repeat)?'No comparable death-recovery rate is available.':Number(repeat)<-10?'You are less likely than direct role opponents to die again within four minutes.':Number(repeat)>10?'Rapid repeat deaths occur more often for you than for direct role opponents.':'Death-recovery recurrence is close to the direct role opponents.',
      repeatN+' recovery opportunities · threshold 8',repeatN>=8)
  ].join('');
}
function pulseFormat(v,unit){
  if(!hasNum(v))return'n/a';
  if(unit==='gold')return signed(v,0)+'g';
  if(unit==='csmin')return fmt(v,2);
  if(unit==='dpm')return fmtInt(v);
  if(unit==='percent')return fmtPct(v);
  return fmt(v,2);
}
function pulseDeltaFormat(v,unit){
  if(!hasNum(v))return'n/a';
  if(unit==='gold')return signed(v,0)+'g';
  if(unit==='csmin')return signed(v,2);
  if(unit==='dpm')return signed(v,0)+' DPM';
  if(unit==='percent')return signed(v,1)+' pp';
  return signed(v,2);
}
function pulseCard(label,obj,unit,inverse=false,threshold=0){
  const recent=obj&&hasNum(obj.recent)?Number(obj.recent):null,prior=obj&&hasNum(obj.prior)?Number(obj.prior):null;
  const recentN=Number(obj?.recentN||0),priorN=Number(obj?.priorN||0);
  if(recent==null||prior==null||recentN<3||priorN<5){
    return '<article class="pulse-card tone-neutral"><span>'+esc(label)+'</span><strong>Not enough evidence</strong><small>'+recentN+' recent / '+priorN+' prior valid games</small></article>';
  }
  const delta=recent-prior,signal=inverse?-delta:delta;
  const tone=Math.abs(delta)<threshold?'neutral':signal>0?'good':'bad';
  const word=tone==='neutral'?'stable':tone==='good'?'favorable shift':'unfavorable shift';
  return '<article class="pulse-card tone-'+tone+'"><span>'+esc(label)+'</span><strong>'+esc(pulseFormat(recent,unit))+'</strong><p>Previous '+esc(pulseFormat(prior,unit))+' · Δ '+esc(pulseDeltaFormat(delta,unit))+'</p><small>'+esc(word)+' · latest '+recentN+' vs previous '+priorN+' valid games</small></article>';
}
function renderRecentPulse(r){
  const t=r.recentTrend||{},target=$('recentPulse');if(!target)return;
  target.innerHTML=[
    pulseCard('CS / min',t.csMin,'csmin',false,.15),
    pulseCard('Gold @15 vs role',t.goldDiff15,'gold',false,150),
    pulseCard('Damage / min',t.dpm,'dpm',false,50),
    pulseCard('Kill participation',t.kp,'percent',false,2),
    pulseCard('High-risk deaths',t.badDeaths,'num',true,.2)
  ].join('');
}
function renderVisualSummary(r){
  const games=reportCoachingGames(r),champs=new Map(),items=new Map();
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
  const suffix=unit==='percent'?' pp':unit==='dpm'?' DPM':unit==='deaths'?' deaths/g':'';
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
  const intervalText=hasInterval?' · 95% Wilson '+fmtPct(interval.low)+'–'+fmtPct(interval.high):'';
  return '<article class="decision-card tone-'+effectiveTone+(evidenceReady?'':' thin-evidence')+'"><div><span>'+esc(title)+'</span><strong>'+esc(value)+'</strong></div>'+
    meter+'<p>'+esc(explanation)+'</p><small>'+esc(sub||'')+esc(intervalText)+(evidenceReady?'':' · thin sample — descriptive only')+'</small></article>';
}
function renderDecisionMetrics(r){
  const b=r.behaviorSummary||{},p=r.peerComparison||{},q=r.dataQuality||{};
  const objective=hasNum(b.objectiveContestPresenceRate)?Number(b.objectiveContestPresenceRate):null,reportRole=canonicalRole(q.selectedRole||r.summary?.primaryRole),objDiagnosis=b.objectiveDiagnosis||{},objDiagnosed=!!objDiagnosis.presenceLow||(Array.isArray(objDiagnosis.causes)&&objDiagnosis.causes.length>0);
  const fight=hasNum(b.fightSurvivalRate)?Number(b.fightSurvivalRate):null;
  const reset=hasNum(b.firstResetLossRate)?Number(b.firstResetLossRate):null;
  const spike=hasNum(p.itemSpikeUtilizationRate)?Number(p.itemSpikeUtilizationRate):null;
  const giveback=hasNum(b.earlyLeadGivebackRate)?Number(b.earlyLeadGivebackRate):null;
  const deaths=hasNum(b.badDeathsPerTimelineGame)?Number(b.badDeathsPerTimelineGame):null;
  const objectiveN=Number(b.objectiveContestEncounters??b.neutralObjectiveEvents??0),fightN=Number(b.fightSamples||0),timelineN=Number(q.validTimelineGames||0),resetN=Number(b.firstResetCleanGames||0),spikeN=Number(p.itemSpikeEligibleWindows||0),leadN=Number(b.earlyLeadGames||0);
  const ready={objective:objectiveN>=5,fight:fightN>=8,deaths:timelineN>=5,reset:resetN>=4,spike:spikeN>=4,giveback:leadN>=4};
  const tonePct=(v,good,bad,inverse=false)=>v==null?'neutral':inverse?(v<=good?'good':v>=bad?'bad':'neutral'):(v>=good?'good':v<=bad?'bad':'neutral');
  const thin=(isReady,normal)=>isReady?normal:'Current value is shown for context, but the sample is below the analyzer threshold for a directional judgment.';
  $('decisionMetrics').innerHTML=[
    decisionCard('Contested objective presence',fmtPct(objective),objective==null?'neutral':objDiagnosed?tonePct(objective,70,45,false):'neutral',
      objective==null?'Not enough contested-objective events.':thin(ready.objective,objDiagnosed?(objective>=70?'Supported presence is high in the diagnosed objective sample.':objective<45?'Supported death/setup evidence or a shop-timing association accompanies missed contest windows.':'Presence is mixed; use the supported clues below rather than the raw percentage alone.'):(roleLabel(reportRole)+' is not graded against a generic objective-attendance threshold here. Treat supported contest presence as context and inspect only event-level reasons.')),
      String(b.objectiveContestJoinedEncounters??0)+' / '+String(objectiveN)+' contested encounters',objective,ready.objective,wilsonInterval(Number(b.objectiveContestJoinedEncounters??0),objectiveN)),
    decisionCard('Fight survival · active involvement',fmtPct(fight),tonePct(fight,70,50,false),
      fight==null?'Not enough active fight involvements.':thin(ready.fight,fight>=70?'You usually stay alive through actively involved fight clusters.':fight<50?'You die in more than half of measured active fight clusters.':'Survival is mixed; review whether deaths happen before or after meaningful contribution.'),
      String(fightN)+' active fights · '+String(b.fightPresenceSamples??fightN)+' supported-presence clusters · '+String(b.fightProximityOnlySamples??0)+' proximity-only · analyzer coaching threshold 8 active fights',fight,ready.fight,wilsonInterval(Number(b.survivedFightSamples??0),fightN)),
    decisionCard('High-risk deaths / game',deaths==null?'n/a':fmt(deaths,2),deaths==null?'neutral':deaths<=.75?'good':deaths>=1.5?'bad':'neutral',
      deaths==null?'Not enough timeline-complete games.':thin(ready.deaths,deaths<=.75?'Risky deaths are contained.':deaths>=1.5?'This is frequent enough to materially distort otherwise good games.':'Risky deaths exist but are not the dominant signal.'),
      String(timelineN)+' timeline-complete games · analyzer coaching threshold 5',null,ready.deaths),
    decisionCard('First-reset economy loss',fmtPct(reset),tonePct(reset,25,50,true),
      reset==null?'Not enough clean first-reset measurements.':thin(ready.reset,reset<=25?'Most measured first resets preserve or improve lane economy.':reset>=50?'At least half of clean measured first resets lose economy afterwards.':'Reset outcomes are mixed.'),
      String(resetN)+' clean first-reset measurements · analyzer coaching threshold 4',reset,ready.reset,wilsonInterval(Number(b.firstResetLossGames??0),resetN)),
    decisionCard('Earlier-item windows used',fmtPct(spike),tonePct(spike,60,35,false),
      spike==null?'No reliable first-major advantage windows.':thin(ready.spike,spike>=60?'You usually turn an earlier major item into tracked impact.':spike<35?'Earlier item completions often expire without a tracked kill/assist/objective impact.':'Item-spike conversion is mixed.'),
      String(p.itemSpikeUtilizedWindows??0)+' / '+String(spikeN)+' eligible windows · analyzer coaching threshold 4',spike,ready.spike,wilsonInterval(Number(p.itemSpikeUtilizedWindows??0),spikeN)),
    decisionCard('Early leads given back',fmtPct(giveback),tonePct(giveback,30,50,true),
      giveback==null?'No meaningful ≥500g pre-15 lead sample.':thin(ready.giveback,giveback<=30?'Most measured early leads are preserved into the 15-minute checkpoint.':giveback>=50?'At least half of measured early leads erode substantially before 15.':'Lead preservation is inconsistent.'),
      String(b.earlyLeadGivebackGames??0)+' / '+String(leadN)+' lead games · analyzer coaching threshold 4',giveback,ready.giveback,wilsonInterval(Number(b.earlyLeadGivebackGames??0),leadN))
  ].join('');
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
  return new Set((r?.games||[]).filter(g=>Number(gameObjectiveFamilyRow(g,key)?.contestedEncounters||0)>0).map(g=>String(g.matchId||'')).filter(Boolean));
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
  box.innerHTML='<div class="section-subhead objective-family-head"><div><span>Objective families</span><strong>Where do the contested windows actually occur?</strong></div><small>Family presence is descriptive context, not a role-grade by itself.</small></div>'+
    '<div class="objective-family-grid">'+rows.map(x=>{
      const interval=wilsonInterval(x.joined,x.contested),thin=x.contested<3,matchCount=objectiveFamilyMatchIds(r,x.key).size;
      return '<article class="objective-family-card '+(thin?'thin-evidence':'')+'"><span>'+esc(x.label)+'</span><strong>'+(x.presence==null?'n/a':esc(fmtPct(x.presence)))+' contested presence</strong>'+
        '<div class="objective-family-statline"><b>'+x.joined+'/'+x.contested+'</b><small>contested joins</small></div>'+
        (interval?'<div class="objective-family-interval"><i style="left:'+clamp(interval.low,0,100)+'%;width:'+(clamp(interval.high,0,100)-clamp(interval.low,0,100))+'%"></i><b style="left:'+clamp(x.presence,0,100)+'%"></b></div><small class="objective-family-ci">95% Wilson '+esc(fmtPct(interval.low))+'–'+esc(fmtPct(interval.high))+'</small>':'')+
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

function renderPhaseDiagnostic(r){
  const box=$('phaseDiagnostic'),note=$('phaseDiagnosticNote');if(!box)return;
  const b=r.behaviorSummary||{},p=r.peerComparison||{},phase=b.phaseRisk||{},mid=b.midRouting||{},closing=b.closing25||{};
  const defs=[['early','Early phase'],['mid','Transition phase'],['late','Late / Baron-era']];
  const rows=defs.map(([key,label])=>{const x=phase[key]||{};return{key,label,games:Number(x.games||0),exposure:Number(x.exposureMinutes||0),high:hasNum(x.highRiskDeathsPer10Min)?Number(x.highRiskDeathsPer10Min):null,costly:hasNum(x.costlyDeathsPer10Min)?Number(x.costlyDeathsPer10Min):null,severe:hasNum(x.severeDeathsPer10Min)?Number(x.severeDeathsPer10Min):null,fights:Number(x.fightClusters||0),first:hasNum(x.firstAllyFightDeathRate)?Number(x.firstAllyFightDeathRate):null,raw:x,ready:Number(x.games||0)>=5&&Number(x.exposureMinutes||0)>=20};});
  const highEligible=rows.filter(x=>x.ready&&hasNum(x.high)).sort((a,b)=>Number(b.high)-Number(a.high)),highTop=highEligible[0]||null,highNext=highEligible[1]||null,highGap=highTop?(Number(highTop.high)-Number(highNext?.high||0)):0,highHot=!!highTop&&Number(highTop.high)>=.35&&highGap>=.15;
  const costlyEligible=rows.filter(x=>x.ready&&hasNum(x.costly)).sort((a,b)=>Number(b.costly)-Number(a.costly)),costTop=costlyEligible[0]||null,costNext=costlyEligible[1]||null,costGap=costTop?(Number(costTop.costly)-Number(costNext?.costly||0)):0,costHot=!!costTop&&Number(costTop.costly)>=.30&&costGap>=.12;
  const context=x=>{
    if(x.key==='early'){const lane=hasNum(p.avgGoldDiff15)?'Role gold @15 '+signed(p.avgGoldDiff15,0)+'g':'Role gold @15 n/a',reset=hasNum(b.firstResetLossRate)?'first-reset loss '+fmtPct(b.firstResetLossRate):'first-reset loss n/a';return lane+' · '+reset;}
    if(x.key==='mid'){const cs=hasNum(mid.avgCsSwing15to25)?'CS swing '+signed(mid.avgCsSwing15to25,1):'CS swing n/a',obj=hasNum(mid.avgObjectiveJoinRate)?'objective presence '+fmtPct(mid.avgObjectiveJoinRate):'objective presence n/a';return cs+' · '+obj;}
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
  const b=r.behaviorSummary||{},p=r.peerComparison||{},rows=[],sampleGames=Number(r.coachingSummary?.games??r.summary?.games??0);
  if(hasNum(p.avgGoldDiff15)||hasNum(b.earlyLeadGivebackRate)){
    const lead=Number(p.avgGoldDiff15||0),give=hasNum(b.earlyLeadGivebackRate)?Number(b.earlyLeadGivebackRate):null,leadDeaths=Number(b.highRiskLeadDeaths||0),n=Number(b.earlyLeadGames||0),ready=n>=4;
    const tone=give==null?'neutral':give<=30?'good':give>=50?'bad':'neutral';
    rows.push(intelligenceCard('Lead → preservation',hasNum(p.avgGoldDiff15)?signed(p.avgGoldDiff15,0)+'g @15':'Lead sample',tone,(lead>150?'You usually create a role lead. ':'')+(give==null?'There is not yet enough lead-preservation evidence.':give.toFixed(0)+'% of measured ≥500g early leads were given back by 15.')+(leadDeaths?' '+leadDeaths+' high-risk death(s) occurred while materially ahead.':''),n+' lead games · analyzer threshold 4 · combines lane state + subsequent risk',ready));
  }
  const mid=b.midRouting||{};
  if(hasNum(mid.avgCsSwing15to25)||hasNum(mid.avgObjectiveJoinRate)){
    const cs=hasNum(mid.avgCsSwing15to25)?Number(mid.avgCsSwing15to25):null,obj=hasNum(mid.avgObjectiveJoinRate)?Number(mid.avgObjectiveJoinRate):null,side=Number(b.preNeutralObjectiveSideLaneDeaths||0),n=Number(mid.games||0),ready=n>=4;
    const tone=side>=3?'bad':cs!=null&&cs>=0&&obj!=null&&obj>=50?'good':'neutral';
    rows.push(intelligenceCard('Farm ↔ map trade-off',(cs!=null?signed(cs,1)+' CS 15→25':'Routing sample'),tone,(cs!=null?'Your direct-role CS differential changes '+signed(cs,1)+' between 15 and 25. ':'')+(obj!=null?'Supported objective presence in comparable routing games is '+fmtPct(obj)+'. ':'')+(side?side+' isolated side-lane death(s) happened shortly before a neutral objective.':'No repeated pre-objective side-lane death pattern is currently measured.'),n+' comparable routing games · analyzer threshold 4 · combines farm gain + objective reconnect timing',ready));
  }
  if(hasNum(p.avgMajorItemDeltaMin)||hasNum(p.itemSpikeUtilizationRate)){
    const delta=hasNum(p.avgMajorItemDeltaMin)?Number(p.avgMajorItemDeltaMin):null,use=hasNum(p.itemSpikeUtilizationRate)?Number(p.itemSpikeUtilizationRate):null,died=Number(p.itemSpikeDeathsBeforeImpact||0),timingN=Number(p.majorItemGames||0),windowN=Number(p.itemSpikeEligibleWindows||0),ready=use==null?timingN>=4:windowN>=4;
    const tone=use==null?'neutral':use>=60?'good':use<35?'bad':'neutral';
    rows.push(intelligenceCard('Item timing → impact',(delta!=null?signed(delta,1)+' min vs role':'Power window'),tone,(delta!=null?(delta<0?'Your first major usually arrives earlier. ':'Your first major usually arrives later. '):'')+(use!=null?fmtPct(use)+' of measurable earlier-item windows produced tracked impact before role-opponent parity. ':'')+(died?died+' window(s) ended in death before tracked impact.':''),timingN+' timing games · '+windowN+' usable power windows · analyzer threshold 4',ready));
  }
  if(hasNum(b.damageGoldEfficiency)||hasNum(b.preContributionFightDeathRate)){
    const eff=hasNum(b.damageGoldEfficiency)?Number(b.damageGoldEfficiency):null,pre=hasNum(b.preContributionFightDeathRate)?Number(b.preContributionFightDeathRate):null,surv=hasNum(b.fightSurvivalRate)?Number(b.fightSurvivalRate):null,fights=Number(b.fightSamples||0),ready=fights>=8&&sampleGames>=5;
    const tone=pre!=null&&pre>=30?'bad':eff!=null&&eff>=2&&surv!=null&&surv>=60?'good':'neutral';
    rows.push(intelligenceCard('Resources → fight uptime',eff!=null?signed(eff,1)+' pp damage−gold':'Fight conversion',tone,(eff!=null?'Damage share minus gold share is '+signed(eff,1)+' percentage points. ':'')+(pre!=null?'You die before tracked contribution in '+fmtPct(pre)+' of active fight clusters. ':'')+(surv!=null?'Active-fight survival is '+fmtPct(surv)+'.':''),fights+' active fight clusters · '+String(b.fightProximityOnlySamples??0)+' proximity-only clusters excluded · '+sampleGames+' coaching games · thresholds 8 active fights / 5 games',ready));
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
  'behaviorSummary.highRiskUntradedPostImpactPerGame':['behaviorSummary.playerImpactEvents'],
  'behaviorSummary.highRiskBehindDeathsPerGame':['behaviorSummary.behindStateDeaths'],
  'behaviorSummary.highRiskLeadDeathsPerGame':['behaviorSummary.leadDeaths'],
  'behaviorSummary.repeatDeathRate':['behaviorSummary.repeatDeathOpportunities'],
  'behaviorSummary.costlyDeathsPerTimelineGame':['behaviorSummary.measuredDeathConsequences'],
  'behaviorSummary.badDeathsPerTimelineGame':['behaviorSummary.totalTimelineDeaths'],
  'behaviorSummary.firstResetLossRate':['behaviorSummary.firstResetCleanGames'],
  'behaviorSummary.soloKillDeathsBeforeShopRate':['behaviorSummary.soloKillResetEvents'],
  'behaviorSummary.itemSpikeUtilizationRate':['behaviorSummary.itemSpikeEligibleWindows'],
  'behaviorSummary.highUnspentFightRate':['behaviorSummary.fightSamples'],
  'behaviorSummary.preNeutralObjectiveSideLaneDeathsPerGame':['behaviorSummary.macroTransitionSideLaneDeaths'],
  'behaviorSummary.midRouting.avgCsSwing15to25':['behaviorSummary.midRouting.games'],
  'behaviorSummary.midRouting.avgObjectiveJoinRate':['behaviorSummary.midRouting.games'],
  'behaviorSummary.recentShopObjectiveAbsenceRate':['behaviorSummary.neutralObjectiveEvents'],
  'behaviorSummary.preObjectiveDeathPct':['behaviorSummary.totalTimelineDeaths'],
  'behaviorSummary.objectiveSetupWardRate':['behaviorSummary.visionWardTotal'],
  'behaviorSummary.earlySetupObjectiveJoinRate':['behaviorSummary.neutralObjectiveJoins'],
  'behaviorSummary.killConversionRate':['behaviorSummary.killConversionWindows'],
  'behaviorSummary.closing25.leadLateRiskLossRate':['behaviorSummary.closing25.leadLosses'],
  'behaviorSummary.objectiveJoinRate':['behaviorSummary.neutralObjectiveEvents'],
  'behaviorSummary.firstAllyFightDeathRate':['behaviorSummary.fightSamples'],
  'behaviorSummary.preContributionFightDeathRate':['behaviorSummary.fightSamples'],
  'behaviorSummary.damageGoldEfficiency':['coachingSummary.games'],
  'behaviorSummary.highRiskBehindDeathRate':['behaviorSummary.behindStateDeaths'],
  'behaviorSummary.visionActionDeathRate':['behaviorSummary.visionActions'],
  'behaviorSummary.roamSuccessRate':['behaviorSummary.roamAttempts'],
  'behaviorSummary.avgRoamLaneCostCs':['behaviorSummary.roamLaneCostGames'],
  'sessionBehavior.game3PlusGoldDelta':['sessionBehavior.firstGame.games','sessionBehavior.game3Plus.games'],
  'sessionBehavior.postLossGoldDelta':['sessionBehavior.quickAfterLoss.games','sessionBehavior.quickAfterWin.games']
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
function practiceTargetCurrentSample(report,t){
  const paths=practiceTargetSamplePaths(t),values=paths.map(p=>pathValue(report,p));
  if(values.some(v=>!hasNum(v)))return 0;
  return values.length?Math.min(...values.map(Number)):0;
}
function reportNewMatchCount(current,previous){
  const prev=new Set((previous?.games||[]).map(g=>String(g.matchId||'')).filter(Boolean));
  return [...new Set((current?.games||[]).map(g=>String(g.matchId||'')).filter(Boolean))].filter(id=>!prev.has(id)).length;
}

function previousPracticeTargetOutcomes(current,previous){
  const targets=Array.isArray(previous?.practiceTargets)?previous.practiceTargets:[];
  if(!targets.length)return{rows:[],reason:''};
  const curRole=String(current?.summary?.primaryRole||''),prevRole=String(previous?.summary?.primaryRole||'');
  const curQueue=current?.dataQuality?.dominantQueueId,prevQueue=previous?.dataQuality?.dominantQueueId;
  const curPatch=String(current?.dataQuality?.currentPatchKey||''),prevPatch=String(previous?.dataQuality?.currentPatchKey||''),curMechanics=String(current?.dataQuality?.currentMechanicsKey||''),prevMechanics=String(previous?.dataQuality?.currentMechanicsKey||'');
  if(curRole!==prevRole)return{rows:[],reason:'Previous practice targets are not scored because the primary role changed.'};
  if(hasNum(curQueue)&&hasNum(prevQueue)&&Number(curQueue)!==Number(prevQueue))return{rows:[],reason:'Previous practice targets are not scored because the comparable queue context changed.'};
  if(curMechanics&&prevMechanics&&curMechanics!==prevMechanics)return{rows:[],reason:'Previous practice targets are not scored because the verified mechanics cohort changed.'};
  if(curPatch&&prevPatch&&curPatch!==prevPatch)return{rows:[],reason:'Previous practice targets are not scored because the patch cohort changed.'};
  const newGames=reportNewMatchCount(current,previous);
  const rows=targets.map(t=>{
    const currentValue=pathValue(current,practiceTargetMetricPath(t));
    if(!hasNum(currentValue)||!hasNum(t.baseline)||!hasNum(t.goal))return null;
    const cur=Number(currentValue),base=Number(t.baseline),goal=Number(t.goal),higher=t.direction!=='lower',windowGames=Math.max(1,Number(t.windowGames||5)),minSample=Math.max(1,Number(t.minSample||1)),currentSample=practiceTargetCurrentSample(current,t);
    const common={label:t.label||t.metricPath,current:practiceTargetValue(cur,t.unit),baseline:practiceTargetValue(base,t.unit),goal:practiceTargetValue(goal,t.unit),sampleSize:Number(t.sampleSize||0),currentSample,minSample,newGames,windowGames};
    if(newGames<windowGames){
      const left=windowGames-newGames;
      return{...common,status:'awaiting '+left+' more new game'+(left===1?'':'s'),cls:'stable',pending:true};
    }
    if(currentSample<minSample)return{...common,status:'not enough current evidence',cls:'stable',pending:true};
    const met=higher?cur>=goal:cur<=goal,needed=Math.abs(goal-base),toward=(higher?cur-base:base-cur);
    const material=Math.max(needed*.2,1e-9);
    const status=met?'met':toward>=material?'moving closer':toward<=-material?'moved away':'unchanged';
    const cls=met||status==='moving closer'?'improved':status==='moved away'?'worsened':'stable';
    return{...common,status,cls,pending:false};
  }).filter(Boolean);
  return{rows,reason:'',newGames};
}
function progressComparisonContext(current,previous){
  const curRole=canonicalRole(current?.coachingSummary?.primaryRole||current?.summary?.primaryRole),prevRole=canonicalRole(previous?.coachingSummary?.primaryRole||previous?.summary?.primaryRole);
  const curQueue=current?.dataQuality?.dominantQueueId,prevQueue=previous?.dataQuality?.dominantQueueId;
  const curMechanics=String(current?.dataQuality?.currentMechanicsKey||''),prevMechanics=String(previous?.dataQuality?.currentMechanicsKey||'');
  const curPatch=String(current?.dataQuality?.currentPatchKey||''),prevPatch=String(previous?.dataQuality?.currentPatchKey||'');
  const curIds=[...new Set((current?.games||[]).map(g=>String(g.matchId||'')).filter(Boolean))],prevIds=[...new Set((previous?.games||[]).map(g=>String(g.matchId||'')).filter(Boolean))],prevSet=new Set(prevIds),curSet=new Set(curIds);
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
    '<article class="practice-continuity-summary '+(early?'early':'')+'"><span>Practice-plan continuity</span><strong>'+esc(state)+'</strong><p>'+retained.length+' of '+Math.max(1,Math.min(3,prev.length))+' previous top priorities remain in the current top three.'+(early?' Only '+newGames+' / '+window+' new games have entered, so treat this as an early read.':' The Next-5 review window has enough new games for a fuller continuity read.')+'</p></article>'+
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
  const context=progressComparisonContext(current,previous),role=String(current?.summary?.primaryRole||'GENERIC').toUpperCase();
  const specs=[
    {label:'Gold @15 vs role opponent',path:'peerComparison.avgGoldDiff15',samplePath:'peerComparison.laneGames15',min:5,threshold:150,direction:1,format:v=>signed(v,0)+'g'},
    {label:'Early-lead give-back rate',path:'behaviorSummary.earlyLeadGivebackRate',samplePath:'behaviorSummary.earlyLeadGames',min:4,threshold:15,direction:-1,format:v=>fmtPct(v)},
    {label:'High-risk deaths / game',path:'behaviorSummary.badDeathsPerTimelineGame',samplePath:'dataQuality.validTimelineGames',min:5,threshold:.3,direction:-1,format:v=>fmt(v,1)},
    {label:'Mid routing CS swing 15→25',path:'behaviorSummary.midRouting.avgCsSwing15to25',samplePath:'behaviorSummary.midRouting.games',min:4,threshold:4,direction:1,format:v=>signed(v,1)+' CS'},
    {label:'Mid routing objective presence',path:'behaviorSummary.midRouting.avgObjectiveJoinRate',samplePath:'behaviorSummary.midRouting.games',min:4,threshold:10,direction:1,format:v=>fmtPct(v)},
    {label:'Win rate from role lead @25',path:'behaviorSummary.closing25.leadWinRate',samplePath:'behaviorSummary.closing25.leadGames',min:4,threshold:10,direction:1,format:v=>fmtPct(v)},
    {label:'First-reset loss rate',path:'behaviorSummary.firstResetLossRate',samplePath:'behaviorSummary.firstResetCleanGames',min:4,threshold:15,direction:-1,format:v=>fmtPct(v)},
    {label:'First major item vs peer',path:'peerComparison.avgMajorItemDeltaMin',samplePath:'peerComparison.majorItemGames',min:4,threshold:.4,direction:-1,format:v=>signed(v,1)+' min'},
    {label:'Major-item spike utilization',path:'behaviorSummary.itemSpikeUtilizationRate',samplePath:'behaviorSummary.itemSpikeEligibleWindows',min:4,threshold:15,direction:1,format:v=>fmtPct(v)},
    {label:'Damage share − gold share',path:'behaviorSummary.damageGoldEfficiency',samplePath:'coachingSummary.games',min:5,threshold:2,direction:1,format:v=>signed(v,1)+' pp'},
    {label:'Died before contribution',path:'behaviorSummary.preContributionFightDeathRate',samplePath:'behaviorSummary.fightSamples',min:8,threshold:10,direction:-1,format:v=>fmtPct(v)},
    {label:'Rapid repeat-death rate',path:'behaviorSummary.repeatDeathRate',samplePath:'behaviorSummary.repeatDeathOpportunities',min:8,threshold:10,direction:-1,format:v=>fmtPct(v)},
    {label:'Prior setup presence (45–105s)',path:'behaviorSummary.earlySetupObjectiveJoinRate',samplePath:'behaviorSummary.neutralObjectiveJoins',min:5,threshold:10,direction:1,format:v=>fmtPct(v)},
    {label:'Recent-shop objective absence rate',path:'behaviorSummary.recentShopObjectiveAbsenceRate',samplePath:'behaviorSummary.neutralObjectiveEvents',min:5,threshold:10,direction:-1,format:v=>fmtPct(v)}
  ];
  if(['ADC','MID','TOP'].includes(role))specs.splice(1,0,{label:'CS / min',path:'coachingSummary.csMin',samplePath:'coachingSummary.games',min:5,threshold:.3,direction:1,format:v=>fmt(v,2)});
  if(['SUPPORT','JUNGLE'].includes(role))specs.push({label:'Team-contested objective presence',path:'advanced.objectivePresence',samplePath:'behaviorSummary.objectiveContestEncounters',min:5,threshold:10,direction:1,format:v=>fmtPct(v)});
  const allRows=specs.map(spec=>{
    const cur=pathValue(current,spec.path),prev=pathValue(previous,spec.path),curN=progressSampleCount(current,spec),prevN=progressSampleCount(previous,spec);
    if(!hasNum(cur)||!hasNum(prev)||curN<spec.min||prevN<spec.min)return null;
    const raw=Number(cur)-Number(prev),effect=raw*spec.direction,score=Math.abs(effect)/spec.threshold,status=effect>=spec.threshold?'improved':effect<=-spec.threshold?'worsened':'stable';
    return{label:spec.label,current:spec.format(cur),previous:spec.format(prev),delta:raw,effect,status,score,curN,prevN,min:spec.min};
  }).filter(Boolean);
  const withheld=specs.length-allRows.length,material=allRows.filter(x=>x.status!=='stable').sort((a,b)=>b.score-a.score),stable=allRows.filter(x=>x.status==='stable').sort((a,b)=>b.score-a.score);
  const visible=material.slice(0,8),statusText=x=>x.status==='improved'?'favorable shift':x.status==='worsened'?'unfavorable shift':'within change band';
  const card=x=>'<article class="progress-comparison-card '+x.status+'"><span>'+esc(x.label)+'</span><strong>'+esc(statusText(x))+'</strong><p>Now '+esc(x.current)+' · previous '+esc(x.previous)+'</p><small>valid n '+x.curN+' now / '+x.prevN+' previous · materiality '+esc(fmt(x.score,1))+'× change band</small></article>';
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
    $('practiceOutcome').innerHTML=targetRows.length?'<div class="target-outcome-head"><strong>Previous Next-5 targets</strong><small>Descriptive check against the exact saved metric path and goal.</small></div><div class="progress-comparison-grid">'+
      targetRows.map(x=>'<article class="progress-comparison-card '+x.cls+(x.pending?' pending-target':'')+'"><span>'+esc(x.label)+'</span><strong>'+esc(x.status)+'</strong><p>Now '+esc(x.current)+' · baseline '+esc(x.baseline)+' · target '+esc(x.goal)+'</p><small>'+esc(String(x.newGames))+' / '+esc(String(x.windowGames))+' new games · valid n '+esc(String(x.currentSample))+' / '+esc(String(x.minSample))+' required</small></article>').join('')+'</div>':
      (targetOutcome.reason?'<div class="target-outcome-note">'+esc(targetOutcome.reason)+'</div>':'');
  }
  if(!allRows.length&&!targetRows.length&&!targetOutcome.reason&&!context.reason){$('progressComparisonPanel').hidden=true;return;}
  $('previousAnalysisDate').textContent='Rolling comparison with '+fmtDate(previousAt);
  $('progressComparisonPanel').hidden=false;
}
function sessionCard(title,sample){
  if(!sample||!Number(sample.games))return '';
  const games=Number(sample.games||0),laneN=Number(sample.lane15Games||0),timelineN=Number(sample.timelineGames??(hasNum(sample.badDeaths)?games:0)),dpmN=Number(sample.dpmGames??(hasNum(sample.dpm)?games:0)),csN=Number(sample.csMinGames??(hasNum(sample.csMin)?games:0)),thin=games<3;
  const lane=laneN>0&&hasNum(sample.goldDiff15)?'Gold @15 '+signed(sample.goldDiff15,0)+'g · '+laneN+'/'+games+' comparable':'Gold @15 n/a · '+laneN+'/'+games+' comparable';
  const risk=timelineN>0&&hasNum(sample.badDeaths)?'Risky deaths '+fmt(sample.badDeaths,1)+'/game · '+timelineN+'/'+games+' timelines':'Risky deaths n/a · 0/'+games+' timelines';
  const output='DPM '+fmtInt(sample.dpm)+' · n='+dpmN+' · CS/min '+fmt(sample.csMin,2)+' · n='+csN;
  return '<div class="quality-card session-sample-card '+(thin?'thin-sample':'')+'"><span>'+esc(title)+(thin?' <em>thin sample</em>':'')+'</span><strong>'+esc(String(games))+' games</strong>'+
    '<small>'+esc(lane)+'<br>'+esc(risk)+'<br>'+esc(output)+'</small></div>';
}
function sessionPairReady(a,b,countField='games'){
  return Number(a?.games||0)>=2&&Number(b?.games||0)>=2&&Number(a?.[countField]??a?.games??0)>=2&&Number(b?.[countField]??b?.games??0)>=2;
}
function renderSessionHabits(r){
  const s=r.sessionBehavior||r.sessionModel||{},first=s.firstGame||{},late=s.game3Plus||{},afterLoss=s.quickAfterLoss||{},afterWin=s.quickAfterWin||{};
  const cards=[
    sessionCard('Session-opening game',first),
    sessionCard('Game 3+ in session',late),
    sessionCard('Quick requeue after loss',afterLoss),
    sessionCard('Quick requeue after win',afterWin)
  ].filter(Boolean);
  if(!cards.length){
    $('sessionHabitsPanel').hidden=true;return;
  }
  $('sessionHabits').innerHTML=cards.join('');
  const deltas=[];
  if(sessionPairReady(late,first,'lane15Games')&&hasNum(s.game3PlusGoldDelta))deltas.push('game 3+ gold@15 '+signed(s.game3PlusGoldDelta,0)+'g vs opener');
  if(sessionPairReady(late,first,'timelineGames')&&hasNum(s.game3PlusBadDeathDelta))deltas.push('game 3+ risky deaths '+signed(s.game3PlusBadDeathDelta,1)+'/game');
  if(sessionPairReady(late,first,'dpmGames')&&hasNum(s.game3PlusDpmDelta))deltas.push('game 3+ DPM '+signed(s.game3PlusDpmDelta,0)+' vs opener');
  if(sessionPairReady(afterLoss,afterWin,'lane15Games')&&hasNum(s.postLossGoldDelta))deltas.push('quick post-loss gold@15 '+signed(s.postLossGoldDelta,0)+'g vs quick post-win');
  if(sessionPairReady(afterLoss,afterWin,'timelineGames')&&hasNum(s.postLossBadDeathDelta))deltas.push('quick post-loss risky deaths '+signed(s.postLossBadDeathDelta,1)+'/game');
  const thin=[['opener',first],['game 3+',late],['post-loss',afterLoss],['post-win',afterWin]].filter(([,x])=>Number(x?.games||0)>0&&Number(x.games)<3).map(([label,x])=>label+' n='+Number(x.games));
  const base=s.definition||'Session grouping uses game timing. Deltas require at least two valid observations in both compared groups.';
  $('sessionHabitsNote').textContent=base+(deltas.length?' Supported observed deltas: '+deltas.join(' · ')+'.':' No comparison currently has enough paired evidence for a supported delta.')+(thin.length?' Thin subgroups shown for traceability only: '+thin.join(', ')+'.':'');
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
  if(unit==='percentage_points')return signed(n,1)+' pp';
  return n.toFixed(2);
}
function practiceTargetHtml(target){
  if(!target||!hasNum(target.baseline)||!hasNum(target.goal))return'';
  const relation=target.direction==='lower'?'≤':'≥';
  return '<div class="practice-target"><span>Next 5 comparable games</span><strong>'+esc(practiceTargetValue(target.baseline,target.unit))+' → aim '+esc(relation+' '+practiceTargetValue(target.goal,target.unit))+'</strong>'+
    '<small>'+esc(target.rationale||'Self-relative short-term target')+' · based on '+esc(String(target.sampleSize||0))+' relevant observation'+(Number(target.sampleSize||0)===1?'':'s')+'</small></div>';
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
  const items=Array.isArray(r.replayReviewQueue)?r.replayReviewQueue:[];
  panel.hidden=!items.length;
  if(!items.length){box.innerHTML='';return;}
  box.innerHTML=items.map(x=>'<article class="review-card">'+
    '<div class="review-rank">#'+esc(String(x.rank||''))+'</div>'+
    '<div class="review-copy"><div class="review-head"><span>'+esc(x.category||'review')+'</span><strong>'+esc(x.title||'Replay review')+'</strong></div>'+
    '<p>'+esc(x.evidence||'')+'</p><p class="review-prompt"><b>Look for:</b> '+esc(x.prompt||'')+'</p>'+
    '<small>'+esc(x.champion||'Unknown')+' · '+esc(x.role||'GENERIC')+(x.opponentChampion?' · vs '+esc(x.opponentChampion):'')+' · '+esc(fmt(x.minute,1))+'m</small></div>'+
    '<button class="button secondary small review-open" type="button" data-review-match="'+esc(x.matchId||'')+'" data-review-tab="'+esc(x.tab||'macro')+'">Open match</button>'+
    '</article>').join('');
  box.querySelectorAll('.review-open').forEach(btn=>btn.addEventListener('click',()=>openReplayReviewMatch(btn.dataset.reviewMatch,btn.dataset.reviewTab)));
}

function gameSortValue(g,key,index){
  if(key==='champion')return String(g.champion||'').toLowerCase();
  if(key==='role')return String(g.role||'').toLowerCase();
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
    else state.gameSort={key,dir:key==='champion'||key==='role'?'asc':'desc'};
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
function gameMatchesNamedFilter(g,key){
  if(key==='win')return!!g.win;
  if(key==='loss')return!g.win;
  if(key==='ahead15')return trustedDirectPeer(g)&&g?.phaseRules?.lane15Comparable!==false&&hasNum(g.goldDiff15)&&Number(g.goldDiff15)>100;
  if(key==='even15')return trustedDirectPeer(g)&&g?.phaseRules?.lane15Comparable!==false&&hasNum(g.goldDiff15)&&Math.abs(Number(g.goldDiff15))<=100;
  if(key==='behind15')return trustedDirectPeer(g)&&g?.phaseRules?.lane15Comparable!==false&&hasNum(g.goldDiff15)&&Number(g.goldDiff15)<-100;
  if(key==='adc')return g.role==='ADC';
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
  const games=Array.isArray(r?.games)?r.games:[],dq=r?.dataQuality||{};
  if(dq.mechanicsCohortApplied===true&&dq.currentMechanicsKey){
    return games.filter(g=>gameMechanicsKey(g)===String(dq.currentMechanicsKey));
  }
  return games;
}
function gameIsCoachingContext(r,g){
  const dq=r?.dataQuality||{};
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
function gameArcStages(g){
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
    else if(contested>=2&&setupRate!=null&&setupRate>=60)stages.push({key:'teamplay_setup',label:'Teamplay',tone:'good',value:'Early objective setup '+fmtPct(setupRate),copy:'In contested neutral-objective joins, supported player position was already near the area 45–105 seconds before the event often enough to cross the report’s positive setup band.'});
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
  if(g?.phaseRules?.fixed15to25Comparable===false||a.key==='unavailable'||b.key==='unavailable')return null;
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
  const reviewItems=(Array.isArray(r?.replayReviewQueue)?r.replayReviewQueue:[]).filter(x=>String(x.matchId||'')===String(g.matchId||''));
  reviewItems.forEach(x=>add(x.minute,'review #'+String(x.rank||''),x.title||'Ranked replay moment',x.evidence||'',Number(x.rank||999)<=3?'bad':'neutral',x.tab||'macro'));
  events.sort((a,b)=>a.time-b.time||String(a.title).localeCompare(String(b.title)));
  const seen=new Set(),unique=events.filter(x=>{const key=Math.round(x.time*20)+'|'+x.title.toLowerCase();if(seen.has(key))return false;seen.add(key);return true;}).slice(0,14);
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

function renderGameArcs(r){
  const funnelBox=$('gameArcFunnels'),patternBox=$('gameArcPatterns'),turnBox=$('gameArcTurningPoints'),note=$('gameArcNote');if(!funnelBox||!patternBox||!turnBox)return;
  const games=reportCoachingGames(r),transitions=games.map(g=>({g,t:gameArcTransition(g)})).filter(x=>x.t);
  const by15={ahead:games.filter(g=>arcRoleGoldState(g,15).key==='ahead'),close:games.filter(g=>arcRoleGoldState(g,15).key==='close'),behind:games.filter(g=>arcRoleGoldState(g,15).key==='behind')};
  const transFor=key=>transitions.filter(x=>x.t.from.key===key);
  funnelBox.innerHTML='<div class="section-subhead"><strong>Advantage conversion</strong><span>What happens after the @15 role state?</span></div><div class="game-arc-funnel-grid">'+
    arcFunnelCard('ahead','Ahead @15',by15.ahead,transFor('ahead'))+
    arcFunnelCard('close','Close @15',by15.close,transFor('close'))+
    arcFunnelCard('behind','Behind @15',by15.behind,transFor('behind'))+
  '</div><div class="section-subhead arc-repeat-head"><strong>Repeated @15 → @25 transitions</strong><span>Only shown when the same transition appears in at least 2 games</span></div>';
  const groups=new Map();
  transitions.forEach(({g,t})=>{
    const row=groups.get(t.key)||{key:t.key,label:t.label,games:[],swings:[]};
    row.games.push(g);row.swings.push(t.swing);groups.set(t.key,row);
  });
  const repeated=[...groups.values()].filter(x=>x.games.length>=2).sort((a,b)=>b.games.length-a.games.length||String(a.label).localeCompare(String(b.label))).slice(0,6);
  patternBox.innerHTML=repeated.length?repeated.map(x=>{
    const wins=x.games.filter(g=>g.win).length,wr=100*wins/x.games.length,avgSwing=x.swings.reduce((a,b)=>a+b,0)/x.swings.length,lateRiskGames=x.games.filter(g=>Number(g.closing25?.highRiskDeaths||0)>0||Number(g.closing25?.costlyDeaths||0)>0).length;
    return '<article class="game-arc-pattern"><span>Repeated transition · '+x.games.length+' games</span><strong>'+esc(x.label)+'</strong><div class="arc-pattern-stats"><b>'+esc(fmtPct(wr))+' wins</b><b>'+esc(signed(avgSwing,0))+'g avg 15→25 swing</b><b>'+lateRiskGames+' late-risk game'+(lateRiskGames===1?'':'s')+'</b></div><p>Outcome and risk are shown as context. The transition itself is direct-role gold state, not whole-team game state.</p><button class="button secondary small arc-review-button" type="button" data-review-arc="'+esc(x.key)+'">Review these '+x.games.length+' games</button></article>';
  }).join(''):'<div class="bullet empty">No @15→@25 role-state transition repeats at least twice inside the current coaching cohort yet.</div>';
  patternBox.querySelectorAll('[data-review-arc]').forEach(btn=>btn.addEventListener('click',()=>{
    state.matchHistoryArcKey=String(btn.dataset.reviewArc||'');state.matchHistoryFilter='arc';state.matchHistoryLimit=10;renderMatchHistory(r);
    $('match-history')?.scrollIntoView({behavior:'auto',block:'start'});
  }));

  const timelineGames=games.filter(g=>g.timelineAvailable===true);
  const turning=ARC_TURNING_POINT_DEFS.map(d=>{
    const hit=timelineGames.filter(g=>d.test(g)),miss=timelineGames.filter(g=>!d.test(g)),wins=hit.filter(g=>g.win).length,missWins=miss.filter(g=>g.win).length;
    const withWr=hit.length?100*wins/hit.length:null,withoutWr=miss.length?100*missWins/miss.length:null,associationReady=hit.length>=3&&miss.length>=3,winRateDelta=associationReady?Number(withWr)-Number(withoutWr):null;
    return {...d,count:hit.length,wins,withoutCount:miss.length,withoutWins:missWins,withWr,withoutWr,associationReady,winRateDelta};
  }).filter(x=>x.count>=2).sort((a,b)=>b.count-a.count||String(a.label).localeCompare(String(b.label))).slice(0,7);
  turnBox.innerHTML='<div class="section-subhead"><strong>Recurring turning-point evidence</strong><span>Recurring at ≥2 games · outcome association needs ≥3 with and ≥3 without</span></div>'+
    (turning.length?'<div class="arc-turning-grid">'+turning.map(x=>{
      const association=x.associationReady?('Win rate '+fmtPct(x.withWr)+' with vs '+fmtPct(x.withoutWr)+' without · '+signed(x.winRateDelta,1)+' pp'):(fmtPct(x.withWr)+' wins in '+x.count+' games with signal · comparison withheld ('+x.withoutCount+' without)');
      return '<article class="arc-turning-card tone-'+x.tone+'"><span>'+x.count+' / '+timelineGames.length+' timeline games</span><strong>'+esc(x.label)+'</strong><p>'+esc(x.why)+'</p><small>'+esc(association)+' · descriptive association only, not causation</small></article>';
    }).join('')+'</div>':'<div class="bullet empty">No defined turning-point signal repeats in at least two coaching-cohort games.</div>');
  if(note)note.textContent='Coaching cohort: '+games.length+' games · comparable @15→@25 transitions: '+transitions.length+'. Turning-point counts are games containing supported evidence, not raw event totals. Older-mechanics context-only games are excluded when the backend applies a mechanics cohort.';
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
  const out=[],lane=matchHistoryLaneState(g),fight=g.fightProfile||{},death=g.deathConsequences||{},recovery=g.deathRecovery||{};
  out.push({label:'Lane state',value:lane.label,tone:lane.tone,copy:lane.copy});
  if(g.timelineAvailable!==true){
    out.push({label:'Risk cost',value:'Not measurable',tone:'neutral',copy:'Timeline evidence is unavailable, so this game cannot be treated as having zero high-risk deaths.'});
  }else if(Number(g.badDeathCount||0)>0||Number(death.costly||0)>0){
    const n=Number(g.badDeathCount||0),cost=Number(death.costly||0),measured=Number(death.measured||0);
    out.push({label:'Risk cost',value:n+' high-risk · '+cost+' costly',tone:(n>=2||cost>=2)?'bad':'neutral',copy:'High-risk classification uses timeline context; costly aftermath is measured for '+measured+' death'+(measured===1?'':'s')+' in this game.'});
  }else{
    const measured=Number(death.measured||0),deaths=Number(g.deaths||0),coverage=deaths?measured+'/'+deaths+' consequences measured':'no deaths';
    out.push({label:'Risk cost',value:'No flagged high-risk death',tone:deaths===0||measured>=deaths?'good':'neutral',copy:'Timeline review found no high-risk death flags; '+coverage+'. Missing consequence coverage is not treated as proof of no cost.'});
  }
  if(Number(fight.attended||0)>0){
    const pre=Number(fight.diedBeforeContribution||0),surv=hasNum(fight.survivalRate)?fmtPct(fight.survivalRate):'n/a';
    out.push({label:'Fight uptime',value:pre+' pre-impact deaths · '+surv+' survival',tone:pre>0?'bad':'good',copy:'Tracked multi-player fight clusters separate dying before contribution from surviving or dying after impact.'});
  }
  if(g.firstMajorItem){
    out.push({label:'First major',value:String(g.firstMajorItem.name||'Item')+' · '+fmt(g.firstMajorItem.time,1)+'m',tone:'neutral',copy:'Item timing is shown as a power-window checkpoint, not treated as good or bad without opponent/context evidence.'});
  }
  if(Number(recovery.opportunities||0)>0){
    out.push({label:'Death recovery',value:String(recovery.repeatDeaths||0)+' / '+String(recovery.opportunities||0)+' rapid repeats',tone:Number(recovery.repeatDeaths||0)>0?'bad':'good',copy:'A repeat death means another death inside the measured recovery window after a prior death.'});
  }
  return out.slice(0,5);
}
function matchHistoryJudgment(g){
  const xs=Array.isArray(g.judgments)?g.judgments:[];
  const improve=xs.find(x=>x&&x.tone!=='strength'),strength=xs.find(x=>x&&x.tone==='strength'),x=improve||strength||xs[0];
  if(!x)return {tone:'neutral',title:'No high-confidence game judgment',evidence:'The game remains visible, but the analyzer did not have enough supported evidence for a specific action judgment.',action:''};
  return {tone:x.tone==='strength'?'good':'bad',title:String(x.title||x.category||'Game insight'),evidence:String(x.evidence||''),action:String(x.action||'')};
}
function matchHistoryRow(g,index,displayIndex,r){
  const peerOk=trustedDirectPeer(g),icon=championIcon(g.champion),opp=peerOk?championIcon(g.peer?.champion):'',lane=matchHistoryLaneState(g),judge=matchHistoryJudgment(g),signals=matchHistorySignals(g),coachingContext=gameIsCoachingContext(r,g),detailId='match-history-detail-'+index,focusMatch=currentPriorityReplayIds(r).has(String(g.matchId||''));
  const reviewItems=(Array.isArray(r?.replayReviewQueue)?r.replayReviewQueue:[]).filter(x=>String(x.matchId||'')===String(g.matchId||'')),reviewRank=reviewItems.length?Math.min(...reviewItems.map(x=>Number(x.rank||999)).filter(Number.isFinite)):null;
  const kda=[g.kills,g.deaths,g.assists].map(x=>hasNum(x)?Number(x):'?').join('/');
  const title=(g.win?'Win':'Loss')+' · '+String(g.champion||'Unknown');
  return '<article class="match-history-row tone-'+(g.win?'good':'bad')+(coachingContext?'':' context-only')+(focusMatch?' focus-match':'')+'" data-history-index="'+index+'">'+
    '<button class="match-history-toggle" type="button" aria-expanded="false" aria-controls="'+detailId+'">'+
      '<span class="history-rank">#'+(displayIndex+1)+'</span>'+
      '<span class="history-champions">'+(icon?'<img loading="lazy" src="'+esc(icon)+'" alt="">':'')+'<span><b>'+esc(title)+(coachingContext?'':' <em class="history-context-badge">context only</em>')+'</b><small>'+esc(shortGameDate(g.gameStartTimestamp))+' · '+esc(g.role||'')+(peerOk&&g.peer?.champion?' · vs '+esc(g.peer.champion):g.peer?.champion?' · role peer withheld':'')+(coachingContext?'':' · older mechanics excluded from coaching aggregates')+'</small></span>'+(opp?'<img class="history-opponent" loading="lazy" src="'+esc(opp)+'" alt="">':'')+'</span>'+
      '<span class="history-stat"><small>K/D/A</small><b>'+esc(kda)+'</b></span>'+
      '<span class="history-stat tone-'+lane.tone+'"><small>Role gold @15</small><b>'+esc(lane.label)+'</b></span>'+
      '<span class="history-judgment tone-'+judge.tone+'"><small>Strongest read'+(reviewRank!=null?' · review #'+esc(String(reviewRank)):'')+(focusMatch?' · current focus':'')+'</small><b>'+esc(judge.title)+'</b></span>'+
      '<span class="history-chevron" aria-hidden="true">▾</span>'+
    '</button>'+
    '<div class="match-history-detail" id="'+detailId+'" hidden>'+
      gameArcStripHtml(g)+
      '<div class="history-signal-grid">'+signals.map(x=>'<div class="history-signal tone-'+x.tone+'"><span>'+esc(x.label)+'</span><strong>'+esc(x.value)+'</strong><p>'+esc(x.copy)+'</p></div>').join('')+'</div>'+
      '<div class="history-coaching-read tone-'+judge.tone+'"><span>Game-level coaching read</span><strong>'+esc(judge.title)+'</strong><p>'+esc(judge.evidence||'No additional evidence sentence was generated.')+'</p>'+(judge.action?'<div><b>Next time:</b> '+esc(judge.action)+'</div>':'')+'</div>'+
      matchEvidenceLedgerHtml(r,g)+
      matchReplayReviewHtml(r,g)+
      '<div class="history-actions"><button class="button secondary small" type="button" data-open-full-match="'+esc(g.matchId||'')+'">Open full match evidence</button><small>Full evidence includes macro, resets, vision, fights, phases, deaths, objectives and map context.</small></div>'+
    '</div>'+
  '</article>';
}
function renderMatchHistory(r){
  const list=$('matchHistoryList'),summary=$('matchHistorySummary'),toggle=$('matchHistoryToggle'),filters=$('matchHistoryFilters'),filterSummary=$('matchHistoryFilterSummary');if(!list||!summary)return;
  const sourceGames=r.games||[],reviewIds=new Set((Array.isArray(r.replayReviewQueue)?r.replayReviewQueue:[]).map(x=>String(x.matchId||'')).filter(Boolean)),priorityIds=currentPriorityReplayIds(r),arcKey=String(state.matchHistoryArcKey||''),arcGames=arcKey?sourceGames.filter(g=>gameArcTransition(g)?.key===arcKey):[],arcLabel=arcGames.length?(gameArcTransition(arcGames[0])?.label||'Selected game arc'):'Selected game arc',objectiveFamilyKey=String(state.matchHistoryObjectiveFamilyKey||''),objectiveFamilyIds=objectiveFamilyKey?objectiveFamilyMatchIds(r,objectiveFamilyKey):new Set(),objectiveFamilyLabelText=objectiveFamilyKey?objectiveFamilyLabel(objectiveFamilyKey):'Objective family';
  const counts={
    all:sourceGames.length,
    win:sourceGames.filter(g=>g.win).length,
    loss:sourceGames.filter(g=>!g.win).length,
    ahead15:sourceGames.filter(g=>gameMatchesNamedFilter(g,'ahead15')).length,
    even15:sourceGames.filter(g=>gameMatchesNamedFilter(g,'even15')).length,
    behind15:sourceGames.filter(g=>gameMatchesNamedFilter(g,'behind15')).length,
    risk:sourceGames.filter(g=>g.timelineAvailable===true&&(Number(g.badDeathCount||0)>0||Number(g.deathConsequences?.costly||0)>0)).length,
    review:sourceGames.filter(g=>reviewIds.has(String(g.matchId||''))).length,
    priority:sourceGames.filter(g=>priorityIds.has(String(g.matchId||''))).length,
    arc:arcGames.length,
    'objective-family':sourceGames.filter(g=>objectiveFamilyIds.has(String(g.matchId||''))).length
  };
  let filter=String(state.matchHistoryFilter||'all');
  if(filter==='priority'&&Number(counts.priority||0)===0){filter='all';state.matchHistoryFilter='all';}
  if(filter==='arc'&&Number(counts.arc||0)===0){filter='all';state.matchHistoryFilter='all';state.matchHistoryArcKey='';}
  if(filter==='objective-family'&&Number(counts['objective-family']||0)===0){filter='all';state.matchHistoryFilter='all';state.matchHistoryObjectiveFamilyKey='';}
  const matchFilter=g=>{
    if(filter==='win')return !!g.win;
    if(filter==='loss')return !g.win;
    if(filter==='ahead15'||filter==='even15'||filter==='behind15')return gameMatchesNamedFilter(g,filter);
    if(filter==='risk')return g.timelineAvailable===true&&(Number(g.badDeathCount||0)>0||Number(g.deathConsequences?.costly||0)>0);
    if(filter==='review')return reviewIds.has(String(g.matchId||''));
    if(filter==='priority')return priorityIds.has(String(g.matchId||''));
    if(filter==='arc')return gameArcTransition(g)?.key===arcKey;
    if(filter==='objective-family')return objectiveFamilyIds.has(String(g.matchId||''));
    return true;
  };
  const filteredGames=sourceGames.filter(matchFilter),limit=Math.min(Math.max(1,Number(state.matchHistoryLimit||10)),Math.max(1,filteredGames.length)),games=filteredGames.slice(0,limit);
  if(filters){
    filters.querySelectorAll('[data-history-filter]').forEach(btn=>{
      const key=btn.dataset.historyFilter||'all',active=key===filter;
      btn.classList.toggle('active-filter',active);btn.setAttribute('aria-pressed',active?'true':'false');
      const base=key==='all'?'All':key==='win'?'Wins':key==='loss'?'Losses':key==='ahead15'?'Ahead @15':key==='even15'?'Close @15':key==='behind15'?'Behind @15':key==='risk'?'Risk flagged':key==='priority'?'Current focus':key==='arc'?'Arc: '+arcLabel:key==='objective-family'?objectiveFamilyLabelText:'Replay priority';
      if(key==='priority')btn.hidden=Number(counts.priority||0)===0;else if(key==='arc')btn.hidden=filter!=='arc'||Number(counts.arc||0)===0;else if(key==='objective-family')btn.hidden=filter!=='objective-family'||Number(counts['objective-family']||0)===0;else btn.hidden=false;
      btn.textContent=base+' · '+String(counts[key]??0);
      btn.onclick=()=>{state.matchHistoryFilter=key;state.matchHistoryLimit=10;renderMatchHistory(r);};
    });
  }
  if(filterSummary){
    const label=filter==='all'?'full recent sample':filter==='risk'?'timeline-supported risk-flagged games':filter==='review'?'games with ranked replay moments':filter==='priority'?'games with ranked replay moments matching '+currentPriorityReplayLabel(r):filter==='arc'?'games matching '+arcLabel:filter==='objective-family'?'games with a contested '+objectiveFamilyLabelText+' window':filter==='win'?'wins':filter==='loss'?'losses':filter==='ahead15'?'ahead-at-15 games':filter==='even15'?'close-at-15 games':'behind-at-15 games';
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
  const wins=games.filter(g=>g.win).length,ahead=games.filter(g=>gameMatchesNamedFilter(g,'ahead15')).length,behind=games.filter(g=>gameMatchesNamedFilter(g,'behind15')).length;
  const timelineGames=games.filter(g=>g.timelineAvailable===true),risky=timelineGames.reduce((n,g)=>n+Number(g.badDeathCount||0),0),coachingGames=reportCoachingGames(r);
  const mechanicsNote=r.dataQuality?.mechanicsCohortApplied===true?' · coaching aggregates use '+coachingGames.length+'/'+String((r.games||[]).length)+' current-mechanics games':'';
  summary.innerHTML='<span><b>'+wins+'–'+(games.length-wins)+'</b> visible result</span><span><b>'+ahead+'</b> ahead @15</span><span><b>'+behind+'</b> behind @15</span><span><b>'+risky+'</b> flagged high-risk deaths</span><small>Showing newest '+games.length+' of '+filteredGames.length+' filtered · '+sourceGames.length+' total comparable '+esc(roleLabel(canonicalRole(r.dataQuality?.selectedRole||r.summary?.primaryRole||state.selectedRole)))+' games · risk evidence '+timelineGames.length+'/'+games.length+' visible timelines'+esc(mechanicsNote)+'</small>';
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
  const games=r.games||[];
  state.openMatch=null;
  const championSelect=$('gameChampionFilter');
  if(championSelect){
    const champions=[...new Set(games.map(g=>String(g.champion||'')).filter(Boolean))].sort((a,b)=>a.localeCompare(b));
    championSelect.innerHTML='<option value="all">All champions</option>'+champions.map(c=>'<option value="'+esc(c)+'">'+esc(c)+'</option>').join('');
    if(!champions.includes(state.gameChampion))state.gameChampion='all';
    championSelect.value=state.gameChampion;
  }
  const championScoped=state.gameChampion==='all'?games:games.filter(g=>String(g.champion||'')===state.gameChampion);
  const filterLabels={all:'All',win:'Wins',loss:'Losses',ahead15:'Ahead @15',even15:'Close @15',behind15:'Behind @15',adc:'ADC only'};
  document.querySelectorAll('[data-game-filter]').forEach(btn=>{
    const key=String(btn.dataset.gameFilter||'all'),count=key==='all'?championScoped.length:championScoped.filter(g=>gameMatchesNamedFilter(g,key)).length;
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
    const icon=championIcon(g.champion),peerOk=trustedDirectPeer(g)&&g?.phaseRules?.lane15Comparable!==false,goldTone=peerOk?deltaTone(g.goldDiff15,0,100,false):'neutral';
    const firstItem=g.firstMajorItem,itemSrc=firstItem?itemIcon(firstItem.itemId):'';
    const goldLabel=!peerOk?'peer withheld':!hasNum(g.goldDiff15)?'n/a':Number(g.goldDiff15)>100?'ahead':Number(g.goldDiff15)<-100?'behind':'even';
    const rowLabel=[g.champion||'Unknown',g.win?'win':'loss',shortGameDate(g.gameStartTimestamp)].filter(Boolean).join(' · ');
    return '<tr class="game-row" data-match="'+esc(g.matchId||String(i))+'" data-index="'+i+'" tabindex="0" role="button" aria-expanded="false" aria-label="Open match details · '+esc(rowLabel)+'">'+
      '<td class="caret"><span class="caret-arrow" aria-hidden="true">▸</span> <small>'+(displayIndex+1)+'</small></td>'+
      '<td><div class="champion-cell">'+(icon?'<img class="champion-icon" loading="lazy" src="'+esc(icon)+'" alt="">':'')+
        '<span><b>'+esc(g.champion||'Unknown')+'</b>'+(firstItem?'<small class="table-item">'+(itemSrc?'<img loading="lazy" src="'+esc(itemSrc)+'" alt="">':'')+esc(firstItem.name||'First major')+' · '+esc(fmt(firstItem.time,1))+'m</small>':'')+'</span></div></td>'+
      '<td>'+esc(g.role==='ADC'?'ADC':(g.role||'GENERIC'))+'</td>'+
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
      detailCard('Peer setup wards',peerOk?String(g.opponentVision?.objectiveSetup??0):'n/a')+detailCard('Peer setup share',peerOk?fmtPct(g.opponentVision?.objectiveSetupRate):'n/a')+detailCard('Setup count Δ vs peer',peerOk&&hasNum(v.objectiveSetupDeltaVsOpponent)?signed(v.objectiveSetupDeltaVsOpponent,0):'n/a')+detailCard('Setup share Δ vs peer',peerOk&&hasNum(v.objectiveSetupRateDeltaVsOpponent)?signed(v.objectiveSetupRateDeltaVsOpponent,0)+' pp':'n/a')+
      detailList((vm.events||[]).map(x=>(Number(x.time)||0).toFixed(1)+'m death · '+String(x.action||'vision action')+' '+String(x.secondsAfterAction??'?')+'s earlier · '+String(x.wardType||'ward')+(x.territory?' · '+x.territory:'')+(x.objectiveSetup?' · objective setup':'')+(x.unsupported?' · no ally within 3k':'')+(x.highRisk?' · high-risk':'')+(x.traded?' · traded':' · untraded')),'No death occurred within the defined vision-action window.')+
      detailList((g.wards||[]).slice(0,8).map(w=>(Number(w.time)||0).toFixed(1)+'m · '+(w.territory||'unknown')+' · '+(w.wardType||'ward')),'No player ward positions were available.');
  }
  if(tab==='roams'){
    const r=g.roams||{},events=r.events||[];
    const kills=events.reduce((n,x)=>n+Number((x.playerKillAssists??(x.killOrAssist?1:0))||0),0),deaths=events.reduce((n,x)=>n+Number((x.playerDeaths??(x.death?1:0))||0),0),obj=events.reduce((n,x)=>n+Number((x.objectivePresent??(x.objective?1:0))||0),0),away=events.reduce((n,x)=>n+Number(x.objectiveAway||0),0);
    return detailCard('Attempts',String(r.attempts??0))+detailCard('Successful',String(r.successes??0))+detailCard('Failed',String(r.failures??0))+
      detailCard('Roam K/A / deaths',String(kills)+' / '+String(deaths))+detailCard('Objectives joined / while away',String(obj)+' / '+String(away))+
      detailList(events.map((x,i)=>'Roam '+String(i+1)+' · '+(Number(x.startMin)||0).toFixed(1)+'–'+(Number(x.endMin)||0).toFixed(1)+'m · '+(x.targetZone||'map')+' · '+(x.outcome||'neutral')+(roamEvidenceText(x)?' · '+roamEvidenceText(x):'')),'No qualifying pre-major-objective-era roam departures detected.')+
      '<div class="detail-note">V21 parity upgrade: each roam keeps its Riot-frame departure/path/return plus kill/assist, death, neutral-objective, structure/plate and lane-cost evidence. Objective success requires supported player presence. Plate/turret losses count as roam cost only when they occur in the player’s home lane, avoiding unrelated map-wide structure losses.</div>';
  }
  if(tab==='fights'){
    const f=g.fightProfile||{},events=f.events||[],active=Number(f.active??f.attended??0),present=Number(f.present??f.attended??0),nearOnly=Number(f.proximityOnly||0);
    return detailCard('Active fight involvements',String(active))+detailCard('Supported fight presence',String(present))+detailCard('Proximity-only presence',String(nearOnly))+
      detailCard('First allied death · active fights',String(f.firstAllyDeaths??0)+' · '+fmtPct(f.firstAllyDeathRate))+
      detailCard('Died before contribution · active fights',String(f.diedBeforeContribution??0)+' · '+fmtPct(f.diedBeforeContributionRate))+detailCard('Fight survival · active fights',fmtPct(f.survivalRate))+
      detailCard('≥1000g unspent active starts',String(f.highUnspentStarts??0)+' · '+fmtPct(f.highUnspentStartRate))+detailCard('Major-item disadvantage active starts',String(f.itemDisadvantageStarts??0)+' · '+fmtPct(f.itemDisadvantageStartRate))+
      detailCard('≥600g role deficit active starts',String(f.goldDeficitStarts??0)+' · '+fmtPct(f.goldDeficitStartRate))+
      detailCard('Locally outnumbered · active starts',String(f.outnumberedStarts??0)+' · '+fmtPct(f.outnumberedStartRate))+detailCard('Loss rate while outnumbered · active fights',fmtPct(f.outnumberedLossRate))+
      detailList(events.slice(0,10).map(x=>(Number(x.startMin)||0).toFixed(1)+'–'+(Number(x.endMin)||0).toFixed(1)+'m · '+String(x.kills||0)+' kills · '+(x.proximityOnly?'nearby only · no tracked contribution/death':x.survived?'active · survived':x.firstAllyDeath?'active · first ally death':x.diedBeforeContribution?'active · died before contribution':'active · died after contribution')+
        (x.active&&hasNum(x.currentGoldAtStart)?' · '+fmtInt(x.currentGoldAtStart)+'g unspent':'')+(x.active&&hasNum(x.goldDiffAtStart)?' · role gold '+signed(x.goldDiffAtStart,0)+'g':'')+(x.active&&x.itemDisadvantage?' · opponent major item first':'')),'No supported multi-kill fight presence was detected.')+
      '<div class="detail-note">Fight presence and fight execution are deliberately separate. Proximity-only clusters remain visible as positioning context, but survival, first-death, readiness, numbers and contribution rates use only active fights where Riot records your death or kill/assist contribution.</div>';
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
    detailCard('Opponent',peer?(peer.champion||'Same-role peer'):'n/a')+detailCard('Opponent rank',peer?rankText(peer.rank):'n/a')+
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
    detailCard('Outside-pressure early deaths',String(modernOrLegacy(g.lanePressure,'earlyOutsidePressureDeaths','pre14OutsidePressureDeaths'))+' · '+fmtPct(g.lanePressure?.earlyOutsidePressureShare??g.lanePressure?.outsidePressureShare))+
    detailCard('First impact',hasNum(g.impactTimeMin)?fmt(g.impactTimeMin,1)+'m':'n/a')+detailCard('Opponent first impact',peerOk&&hasNum(g.opponentImpactTimeMin)?fmt(g.opponentImpactTimeMin,1)+'m':'n/a')+detailCard('Impact timing vs peer',peerOk&&hasNum(g.impactDeltaVsOpponent)?signed(g.impactDeltaVsOpponent,1)+' min':'n/a')+
    detailCard('DPM vs same-role opponent',peerOk&&peer?signed(peer.dpmDelta,0):'n/a')+detailCard('CS/min vs opponent',peerOk&&peer?signed(peer.csMinDelta,2):'n/a')+detailCard('Team damage rank',hasNum(g.damageRank)?'#'+g.damageRank+' of 5':'n/a')+
    detailCard('Damage share',fmtPct(g.damageShare))+detailCard('Gold share',fmtPct(g.goldShare))+detailCard('Damage − gold share',hasNum(g.damageShare)&&hasNum(g.goldShare)?signed(Number(g.damageShare)-Number(g.goldShare),1)+' pp':'n/a')+
    detailCard('Session game #',g.sessionContext?.sessionGameNumber?String(g.sessionContext.sessionGameNumber):'n/a')+
    detailCard('Gap after previous game',hasNum(g.sessionContext?.gapAfterPreviousMin)?fmt(g.sessionContext.gapAfterPreviousMin,0)+' min':'n/a')+
    detailCard('Previous result',g.sessionContext?.previousWin===true?'WIN':g.sessionContext?.previousWin===false?'LOSS':'n/a')+
    detailList((g.structurePressure?.events||[]).map(x=>(Number(x.killTime)||0).toFixed(1)+'m solo kill · '+(x.converted?('supported structure involvement'+(x.towerType?' · '+x.towerType:'')+(x.laneType?' · '+x.laneType:'')+(x.attribution?' · '+String(x.attribution).replaceAll('_',' '):'')+(hasNum(x.secondsAfter)?' · '+fmtInt(x.secondsAfter)+'s later':'')):'no supported plate/turret involvement within 90s')),'No early clean solo-kill structure window detected.')+
    '<div class="detail-note">2026 turret plates no longer use the old 14:00 expiry assumption and plate-style rewards extend through deeper turret tiers. The ≤20m row is only a fixed coaching slice. <strong>Involvement</strong> now requires direct Riot event credit or supported ≤2200-unit event-position proximity. Same-lane timeline-frame evidence is retained separately as a presence-only signal and never earns plate/turret conversion credit by itself.</div>'+
    detailList((g.laneDuel?.events||[]).map(x=>(Number(x.time)||0).toFixed(1)+'m · '+(x.result==='solo_kill'?'solo kill on role opponent':'solo death to role opponent')+(x.early?' · early phase':'')+(hasNum(x.goldDiffAtEvent)?' · role gold '+signed(x.goldDiffAtEvent,0)+'g at event':'')+(hasNum(x.goldSwingTo15)?' · '+signed(x.goldSwingTo15,0)+'g swing to 15':'')+(hasNum(x.csSwingTo15)?' · '+signed(x.csSwingTo15,0)+' CS swing to 15':'')+(x.result==='solo_kill'&&x.conversionEligibleTo15&&hasNum(x.convertedBy15)?(x.convertedBy15?' · converted by 15':' · not converted by 15'):'')+(x.result==='solo_kill'&&(x.early||x.pre14)&&hasNum(x.nextShopDelaySec)?' · next shop '+fmtInt(x.nextShopDelaySec)+'s':'')+(x.result==='solo_kill'&&(x.early||x.pre14)&&x.diedBeforeNextShop?' · died before shop':'')),'No clean direct-role solo duel event detected.')+
    detailList((g.lanePressure?.events||[]).filter(x=>x.outsidePressure).map(x=>(Number(x.time)||0).toFixed(1)+'m · outside pressure'+((x.outsideRoles||[]).length?' from '+x.outsideRoles.join(', '):'')+' · '+String(x.attackerCount||'?')+' attacker(s)'),'No early-phase outside-pressure lane death detected.')+
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
  return fmt(v,2);
}
function chartSvg(points,spec){
  const vals=points.map(p=>Number(p.value)).filter(Number.isFinite);if(vals.length<3)return null;
  const valid=points.map((p,i)=>({i,v:Number(p.value),p})).filter(x=>Number.isFinite(x.v));
  const w=820,h=300,padL=64,padR=24,padT=26,padB=42,unit=spec.unit||'num',signedAxis=!!spec.signedAxis;
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
  const xAt=n=>padL+(n/Math.max(1,valid.length-1))*plotW;
  const yAt=v=>padT+(max-clamp(v,min,max))/span*plotH;
  const coords=valid.map((x,n)=>({x:xAt(n),y:yAt(x.v),v:x.v,p:x.p}));
  const path=coords.map((c,i)=>(i?'L':'M')+c.x.toFixed(1)+' '+c.y.toFixed(1)).join(' ');
  const ticks=5,grid=[];
  for(let i=0;i<ticks;i++){
    const value=max-(span/(ticks-1))*i,y=yAt(value);
    grid.push('<line class="chart-grid-line" x1="'+padL+'" y1="'+y.toFixed(1)+'" x2="'+(w-padR)+'" y2="'+y.toFixed(1)+'"/><text class="chart-axis-label" x="'+(padL-10)+'" y="'+(y+4).toFixed(1)+'" text-anchor="end">'+esc(formatChartValue(value,spec.formatUnit||spec.unit))+'</text>');
  }
  const zeroY=signedAxis?yAt(0):null;
  const bands=signedAxis?'<rect class="chart-positive-band" x="'+padL+'" y="'+padT+'" width="'+plotW+'" height="'+Math.max(0,zeroY-padT)+'"/><rect class="chart-negative-band" x="'+padL+'" y="'+zeroY+'" width="'+plotW+'" height="'+Math.max(0,padT+plotH-zeroY)+'"/>':'';
  const zero=signedAxis?'<line class="chart-zero-line" x1="'+padL+'" y1="'+zeroY+'" x2="'+(w-padR)+'" y2="'+zeroY+'"/><text class="chart-zero-label" x="'+(w-padR-4)+'" y="'+(zeroY-7)+'" text-anchor="end">EVEN WITH ROLE OPPONENT</text>':'';
  const refValue=hasNum(spec.reference)?Number(spec.reference):null,refY=refValue!=null&&refValue>=min&&refValue<=max?yAt(refValue):null;
  const reference=refY==null?'':'<line class="chart-reference-line" x1="'+padL+'" y1="'+refY+'" x2="'+(w-padR)+'" y2="'+refY+'"/><text class="chart-reference-label" x="'+(w-padR-4)+'" y="'+(refY-7)+'" text-anchor="end">'+esc(spec.referenceLabel||'REFERENCE')+' · '+esc(formatChartValue(refValue,spec.formatUnit||spec.unit))+'</text>';
  const dots=coords.map((c,i)=>{const when=shortGameDate(c.p?.gameStartTimestamp)||('Game '+String(i+1)),champ=c.p?.champion?String(c.p.champion)+' · ':'';return '<circle class="chart-dot '+(signedAxis?(c.v>0?'positive':c.v<0?'negative':'even'):'')+'" cx="'+c.x.toFixed(1)+'" cy="'+c.y.toFixed(1)+'" r="5"><title>'+esc(champ+when+': '+formatChartValue(c.v,spec.formatUnit||spec.unit))+'</title></circle>';}).join('');
  const firstTime=valid[0]?.p?.gameStartTimestamp,lastTime=valid[valid.length-1]?.p?.gameStartTimestamp;
  const xLabels=valid.length?'<text class="chart-axis-label x" x="'+padL+'" y="'+(h-12)+'">'+esc(shortGameDate(firstTime)||'older')+'</text><text class="chart-axis-label x" x="'+(w-padR)+'" y="'+(h-12)+'" text-anchor="end">'+esc(shortGameDate(lastTime)||'newer')+'</text>':'';
  return '<svg class="chart-svg" viewBox="0 0 '+w+' '+h+'" role="img" aria-label="'+esc(spec.title||'Trend chart')+'">'+bands+grid.join('')+zero+reference+'<path class="chart-line" d="'+path+'"/>'+dots+xLabels+'</svg>';
}
function chartSummary(points,spec){
  const vals=points.map(p=>Number(p.value)).filter(Number.isFinite);if(!vals.length)return'No valid values.';
  const avgV=vals.reduce((a,b)=>a+b,0)/vals.length,recent=vals.slice(-Math.min(5,vals.length)),recentAvg=recent.reduce((a,b)=>a+b,0)/recent.length;
  const unit=spec.formatUnit||spec.unit;
  if(spec.signedAxis){
    const delta=recentAvg-avgV,dir=Math.abs(delta)<(spec.relevance||50)?'stable':delta>0?'improving':'worsening';
    return 'Sample average '+formatChartValue(avgV,unit)+' · latest '+recent.length+' average '+formatChartValue(recentAvg,unit)+' · '+dir+'. Zero means even with the direct role opponent.';
  }
  return 'Sample average '+formatChartValue(avgV,unit)+' · latest '+recent.length+' average '+formatChartValue(recentAvg,unit)+'.';
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
function consistencyCard(label,stats,unit,split,detail){
  if(!stats)return'<article class="quality-card consistency-card evidence-unknown"><span>'+esc(label)+'</span><strong>Not enough data</strong><small>No valid values in this sample.</small></article>';
  const middle=consistencyFmt(stats.q1,unit)+' to '+consistencyFmt(stats.q3,unit);
  const splitText=split&&split.n?(split.favorable+' favorable · '+split.close+' close · '+split.unfavorable+' unfavorable'):'';
  return'<article class="quality-card consistency-card"><span>'+esc(label)+'</span><strong>Median '+esc(consistencyFmt(stats.median,unit))+'</strong><small>Middle 50%: '+esc(middle)+(splitText?' · '+esc(splitText):'')+(detail?' · '+esc(detail):'')+'</small></article>';
}
function renderConsistencySummary(r){
  const target=$('consistencySummary');if(!target)return;
  const games=reportCoachingGames(r),reportRole=canonicalRole(r.dataQuality?.selectedRole||r.summary?.primaryRole),roleGames=games.filter(g=>canonicalRole(g.role)===reportRole),bench=reportRole==='ADC'&&adcBenchmarkSummary(r)?r.externalBenchmarks?.same:null;
  const gold=roleGames.filter(g=>g?.phaseRules?.lane15Comparable!==false&&hasNum(g.goldDiff15)).map(g=>Number(g.goldDiff15));
  const cs=roleGames.filter(g=>g?.phaseRules?.lane15Comparable!==false&&hasNum(g.csDiff15)).map(g=>Number(g.csDiff15));
  const dpm=roleGames.filter(g=>hasNum(g.dpm)).map(g=>Number(g.dpm)),kp=roleGames.filter(g=>hasNum(g.kp)).map(g=>Number(g.kp));
  target.innerHTML=[
    consistencyCard('Gold @15 vs role',robustStats(gold),'gold',consistencySplit(gold,0,150,false),'close band ±150g · '+gold.length+' valid checkpoints'),
    consistencyCard('CS @15 vs role',robustStats(cs),'cs',consistencySplit(cs,0,5,false),'close band ±5 CS · '+cs.length+' valid checkpoints'),
    consistencyCard(roleLabel(reportRole)+' damage / min',robustStats(dpm),'dpm',bench&&hasNum(bench.dpm)?consistencySplit(dpm,Number(bench.dpm),50,false):null,bench&&hasNum(bench.dpm)?'vs '+String(bench.tier||'same-tier')+' external reference ±50 DPM':dpm.length+' valid '+roleLabel(reportRole)+' games'),
    consistencyCard(roleLabel(reportRole)+' kill participation',robustStats(kp),'percent',bench&&hasNum(bench.kp)?consistencySplit(kp,Number(bench.kp),2,false):null,bench&&hasNum(bench.kp)?'vs '+String(bench.tier||'same-tier')+' external reference ±2 pp':kp.length+' valid '+roleLabel(reportRole)+' games')
  ].join('');
}
function renderCharts(r){
  const lane15Comparable=Number(r.behaviorSummary?.checkpointEligibility?.lane15Games??0)>0,reportRole=canonicalRole(r.dataQuality?.selectedRole||r.summary?.primaryRole),adc=reportRole==='ADC'?adcBenchmarkSummary(r):null,bench=adc?r.externalBenchmarks?.same:null;
  const sourceGames=[...reportCoachingGames(r)].filter(g=>canonicalRole(g.role)===reportRole),hasTimestamps=sourceGames.some(g=>Number(g?.gameStartTimestamp||0)>0);
  const chronological=hasTimestamps?sourceGames.sort((a,b)=>Number(a.gameStartTimestamp||0)-Number(b.gameStartTimestamp||0)):sourceGames.reverse(),roleName=roleLabel(reportRole);
  const specs=[
    {key:'goldDiff15',title:lane15Comparable?'Gold @15 vs direct role opponent':'Gold @15 vs role opponent · raw checkpoint',q:'Positive means you had more gold than the direct role opponent at 15. Fixed −2000 to +2000 scale makes games directly comparable.',unit:'signedGold',formatUnit:'signed',signedAxis:true,relevance:150,fixedMin:-2000,fixedMax:2000},
    {key:'csDiff15',title:lane15Comparable?'CS @15 vs direct role opponent':'CS @15 vs role opponent · raw checkpoint',q:'Positive means you had more farm than the direct role opponent at 15. Fixed −35 to +35 scale.',unit:'signedCs',formatUnit:'signed',signedAxis:true,relevance:5,fixedMin:-35,fixedMax:35},
    {key:'dpm',title:'Damage per minute · '+roleName+' sample',q:bench?'Selected-role games on a fixed 0–1500 DPM scale. The dashed line is the same-tier ADC-adjusted external reference.':'Selected '+roleName+' games on a fixed 0–1500 DPM scale.',unit:'dpm',formatUnit:'int',fixedMin:0,fixedMax:1500,reference:bench?.dpm,referenceLabel:(bench?.tier||'same tier')+' reference'},
    {key:'kp',title:'Kill participation · '+roleName+' sample',q:bench?'Selected-role games on a fixed 0–100% scale. The dashed line is the same-tier ADC-adjusted external reference.':'Selected '+roleName+' games on a fixed 0–100% scale.',unit:'percent',formatUnit:'%',fixedMin:0,fixedMax:100,reference:bench?.kp,referenceLabel:(bench?.tier||'same tier')+' reference'}
  ];
  const hidden=[];
  $('chartGrid').innerHTML=specs.map(spec=>{
    const points=chronological.map(g=>({matchId:g.matchId,gameStartTimestamp:g.gameStartTimestamp,champion:g.champion,value:g[spec.key]}));
    const svg=chartSvg(points,spec);
    if(!svg)hidden.push(spec.title);
    return '<article class="chart-card '+(spec.signedAxis?'signed-chart':'')+'"><div class="chart-card-head"><div><h3>'+esc(spec.title)+'</h3><p>'+esc(spec.q)+'</p></div><span class="chart-kind">'+(spec.signedAxis?'0 = even':'trend')+'</span></div>'+(svg||'<div class="chart-empty">Insufficient valid data</div>')+(svg?'<p class="chart-reading">'+esc(chartSummary(points,spec))+'</p>':'')+'</article>';
  }).join('');
  const all=[...(r.hiddenCharts||[]),...hidden];
  $('hiddenCharts').hidden=!all.length;$('hiddenCharts').textContent=all.length?'Unavailable / low-sample charts: '+[...new Set(all)].join(', '):'';
  renderConsistencySummary(r);
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
    ['Early role solo kills / deaths',String(r.behaviorSummary?.earlyRoleSoloKills??r.behaviorSummary?.pre14RoleSoloKills??0)+' / '+String(r.behaviorSummary?.earlyRoleSoloDeaths??r.behaviorSummary?.pre14RoleSoloDeaths??0)],
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
    ['Early home-lane deaths',String(r.behaviorSummary?.earlyHomeLaneDeaths??r.behaviorSummary?.pre14HomeLaneDeaths??0)],
    ['Outside-pressure early lane deaths',String(r.behaviorSummary?.earlyOutsidePressureDeaths??r.behaviorSummary?.pre14OutsidePressureDeaths??0)],
    ['Outside-pressure share of early lane deaths',fmtPct(r.behaviorSummary?.earlyOutsidePressureShare??r.behaviorSummary?.pre14OutsidePressureShare)],
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
    ['Mid-routing objective presence · pooled',fmtPct(r.behaviorSummary?.midRouting?.avgObjectiveJoinRate)+' · '+String(r.behaviorSummary?.midRouting?.joinedObjectiveEvents??0)+' / '+String(r.behaviorSummary?.midRouting?.teamObjectiveEvents??0)+' encounters'],
    ['Mid-routing objective presence · mean game rate',fmtPct(r.behaviorSummary?.midRouting?.meanGameObjectiveJoinRate)],
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
    ['Repeat-death rate vs peer · matched',fmtPct(r.behaviorSummary?.peerMatchedRepeatDeathRate)+' / '+fmtPct(r.behaviorSummary?.opponentRepeatDeathRate)+' · Δ '+(hasNum(r.behaviorSummary?.repeatDeathRateDelta)?signed(r.behaviorSummary.repeatDeathRateDelta,0)+' pp':'n/a')],
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
    ['Coaching roam lane cost',hasNum(roam.avgLaneCostCs)?signed(roam.avgLaneCostCs,1)+' CS avg · '+String(roam.emptyCostlyRoams??0)+' empty costly':'n/a'],
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
    ['Damage share − gold share',hasNum(r.behaviorSummary?.damageGoldEfficiency)?signed(r.behaviorSummary.damageGoldEfficiency,1)+' pp':'n/a'],
    ['Fight samples · active involvement',String(r.behaviorSummary?.fightSamples??0)],
    ['Fight presence · supported',String(r.behaviorSummary?.fightPresenceSamples??r.behaviorSummary?.fightSamples??0)],
    ['Fight presence · proximity-only',String(r.behaviorSummary?.fightProximityOnlySamples??0)],
    ['First allied death · active fights',fmtPct(r.behaviorSummary?.firstAllyFightDeathRate)],
    ['Died before contribution · active fights',fmtPct(r.behaviorSummary?.preContributionFightDeathRate)],
    ['Fight survival · active fights',fmtPct(r.behaviorSummary?.fightSurvivalRate)],
    ['Fight starts with ≥1000g unspent',String(r.behaviorSummary?.highUnspentFightStarts??0)+' · '+fmtPct(r.behaviorSummary?.highUnspentFightRate)],
    ['Fight starts down major item',String(r.behaviorSummary?.itemDisadvantageFightStarts??0)+' · '+fmtPct(r.behaviorSummary?.itemDisadvantageFightRate)],
    ['Fight starts ≥600g down vs role',String(r.behaviorSummary?.goldDeficitFightStarts??0)+' · '+fmtPct(r.behaviorSummary?.goldDeficitFightRate)],
    ['Locally outnumbered fight starts',String(r.behaviorSummary?.outnumberedFightStarts??0)+' · '+fmtPct(r.behaviorSummary?.outnumberedFightStartRate)],
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
    metric('Objective-setup share Δ · matched',hasNum(p.objectiveSetupWardRateDelta)?signed(p.objectiveSetupWardRateDelta,0)+' pp':'n/a',!hasNum(p.objectiveSetupWardRateDelta)),
    metric('Your repeat-death rate · all valid games',fmtPct(p.repeatDeathRate),!hasNum(p.repeatDeathRate)),
    metric('Your repeat-death rate · matched peer games',fmtPct(p.peerMatchedRepeatDeathRate),!hasNum(p.peerMatchedRepeatDeathRate)),
    metric('Peer repeat-death rate · matched games',fmtPct(p.opponentRepeatDeathRate),!hasNum(p.opponentRepeatDeathRate)),
    metric('Repeat-death rate Δ · matched',hasNum(p.repeatDeathRateDelta)?signed(p.repeatDeathRateDelta,0)+' pp':'n/a',!hasNum(p.repeatDeathRateDelta)),
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
    metric('Post-kill conversion Δ · matched',hasNum(r.behaviorSummary?.killConversionDelta)?signed(r.behaviorSummary.killConversionDelta,0)+' pp':'n/a',!hasNum(r.behaviorSummary?.killConversionDelta))
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
  const pooledTrendRow=(label,obj)=>metric(label,obj&&hasNum(obj.recent)&&hasNum(obj.prior)?fmtPct(obj.recent)+' / '+fmtPct(obj.prior)+' · events '+String(obj.recentEvents??0)+' / '+String(obj.priorEvents??0):'n/a',!(obj&&hasNum(obj.recent)&&hasNum(obj.prior)));
  const trendRows=[
    trendRow('Latest 5 CS/min / previous',trend.csMin,v=>fmt(v,2)),
    trendRow('Latest 5 gold @15 / previous',trend.goldDiff15,v=>signed(v,0)+'g'),
    trendRow('Latest 5 high-risk deaths / previous',trend.badDeaths,v=>fmt(v,1)),
    trendRow('Latest 5 DPM / previous',trend.dpm,v=>fmtInt(v)),
    pooledTrendRow('Latest 5 team-contested presence / previous · pooled',trend.objectiveJoin),
    pooledTrendRow('Latest 5 team-secured presence / previous · pooled',trend.securedObjectiveJoin),
    pooledTrendRow('Latest 5 early KP / previous · pooled',trend.earlyKp)
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
function renderBreakdowns(r){
  const roleRows=Object.entries(r.byRole||{}).sort((a,b)=>Number(b[1]?.games||0)-Number(a[1]?.games||0));
  $('roleBreakdown').innerHTML=roleRows.length?roleRows.map(([name,v])=>'<div class="break-row"><span>'+esc(name==='ADC'?'ADC':name)+'</span><small>'+esc(String(v.games||0))+' games</small><strong>'+esc(fmtPct((v.games||0)?Number(v.wins||0)/Number(v.games)*100:null))+' WR</strong></div>').join(''):'<div class="bullet empty">No role sample available.</div>';

  const behaviorRows=Array.isArray(r.championBehavior)?r.championBehavior:[],base=r.coachingSummary||r.summary||{},riskBase=r.behaviorSummary||{};
  if(behaviorRows.length){
    $('championBreakdown').innerHTML=behaviorRows.slice(0,8).map(v=>{
      const src=championIcon(v.champion),goldDelta=hasNum(v.goldDiff15)&&hasNum(base.goldDiff15)?Number(v.goldDiff15)-Number(base.goldDiff15):null,dpmDelta=hasNum(v.dpm)&&hasNum(base.dpm)?Number(v.dpm)-Number(base.dpm):null,riskDelta=hasNum(v.badDeaths)&&hasNum(riskBase.badDeathsPerTimelineGame)?Number(v.badDeaths)-Number(riskBase.badDeathsPerTimelineGame):null,itemDelta=hasNum(v.itemDelta)?Number(v.itemDelta):null;
      const laneN=Number(v.laneGames||0),dpmN=Number(v.dpmGames??v.games??0),riskN=Number(v.timelineGames||0),itemN=Number(v.itemGames||0);
      const chips=[
        diagnosticChip('Role gold @15',hasNum(v.goldDiff15)?signed(v.goldDiff15,0)+'g':'n/a',deltaTone(v.goldDiff15,0,100),laneN>=3,'n='+laneN),
        diagnosticChip('Vs your usual @15',hasNum(goldDelta)?signed(goldDelta,0)+'g':'n/a',deltaTone(goldDelta,0,150),laneN>=3,'n='+laneN),
        diagnosticChip('DPM vs your usual',hasNum(dpmDelta)?signed(dpmDelta,0):'n/a',deltaTone(dpmDelta,0,75),dpmN>=3,'n='+dpmN),
        diagnosticChip('Risk deaths vs usual',hasNum(riskDelta)?signed(riskDelta,2)+'/g':'n/a',deltaTone(riskDelta,0,.25,true),riskN>=3,'n='+riskN),
        diagnosticChip('1st major vs peer',hasNum(itemDelta)?signed(itemDelta,1)+'m':'n/a',deltaTone(itemDelta,0,.5,true),itemN>=3,'n='+itemN)
      ].join('');
      return '<article class="diagnostic-break-row champion-diagnostic">'+
        '<div class="diagnostic-break-head"><div class="break-visual">'+(src?'<img loading="lazy" src="'+esc(src)+'" alt="">':'')+'<span><b>'+esc(v.champion)+'</b><small>'+esc(v.role==='ADC'?'ADC':v.role)+' · '+esc(String(v.games||0))+' games</small></span></div><div class="diagnostic-result"><strong>'+esc(fmtPct(v.winRate))+'</strong><small>sample WR</small></div></div>'+
        '<div class="diagnostic-chip-grid">'+chips+'</div>'+
        '<p>'+esc(String(v.peerGames||0))+' trusted peer games · '+esc(String(v.laneGames||0))+' lane-comparable · '+esc(String(v.timelineGames||0))+' timeline-complete · '+esc(String(v.dpmGames??v.games??0))+' DPM observations · '+esc(String(v.itemGames||0))+' first-major peer comparisons. Relative chips require at least 3 valid observations for their own metric.</p>'+
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
      const own=(v.ownChampions||[]).slice(0,3).map(x=>x.champion+' '+x.games+'g').join(', '),src=championIcon(v.opponentChampion),goldDelta=hasNum(v.goldDiff15)&&hasNum(base.goldDiff15)?Number(v.goldDiff15)-Number(base.goldDiff15):null,soloKills=Number(v.earlySoloKills||0),soloDeaths=Number(v.earlySoloDeaths||0),outside=hasNum(v.outsidePressureShare)?Number(v.outsidePressureShare):null,dpmPeer=hasNum(v.avgDpmDelta)?Number(v.avgDpmDelta):null;
      const gamesN=Number(v.games||0),laneN=Number(v.laneGames||0),pressureN=Number(v.earlyHomeLaneDeaths||0),dpmN=Number(v.dpmGames||0);
      let read='Mixed repeated matchup evidence',readTone='neutral';
      if(soloDeaths>=2&&soloDeaths>=soloKills+2){read='Clean 1v1 deaths recur';readTone='bad';}
      else if(pressureN>=3&&outside!=null&&outside>=60){read='Lane deaths are mostly outside pressure';readTone='neutral';}
      else if(laneN>=3&&hasNum(goldDelta)&&goldDelta<=-300){read='Lane economy below your usual role level';readTone='bad';}
      else if(laneN>=3&&hasNum(goldDelta)&&goldDelta>=300&&soloKills>=soloDeaths){read='Lane economy above your usual role level';readTone='good';}
      const chips=[
        diagnosticChip('Role gold @15',hasNum(v.goldDiff15)?signed(v.goldDiff15,0)+'g':'n/a',deltaTone(v.goldDiff15,0,100),laneN>=3,'n='+laneN),
        diagnosticChip('Vs your usual @15',hasNum(goldDelta)?signed(goldDelta,0)+'g':'n/a',deltaTone(goldDelta,0,150),laneN>=3,'n='+laneN),
        diagnosticChip('Clean 1v1 K / D',soloKills+' / '+soloDeaths,soloDeaths>=soloKills+2?'bad':soloKills>=soloDeaths+2?'good':'neutral',gamesN>=3,'n='+gamesN),
        diagnosticChip('Outside-pressure share',outside!=null?fmtPct(outside):'n/a',outside!=null&&outside>=60?'bad':'neutral',pressureN>=3,'deaths='+pressureN),
        diagnosticChip('DPM vs role peer',hasNum(dpmPeer)?signed(dpmPeer,0):'n/a',deltaTone(dpmPeer,0,75),dpmN>=3,'n='+dpmN)
      ].join('');
      return '<article class="diagnostic-break-row matchup-diagnostic">'+
        '<div class="diagnostic-break-head"><div class="break-visual">'+(src?'<img loading="lazy" src="'+esc(src)+'" alt="">':'')+'<span><b>vs '+esc(v.opponentChampion)+'</b><small>'+esc(v.role==='ADC'?'ADC':v.role)+' · '+esc(String(v.games||0))+' games</small></span></div><div class="diagnostic-result"><strong>'+esc(fmtPct(v.winRate))+'</strong><small>sample WR</small></div></div>'+
        '<div class="matchup-read tone-'+readTone+'"><span>Repeated-matchup read</span><strong>'+esc(read)+'</strong></div>'+
        '<div class="diagnostic-chip-grid">'+chips+'</div>'+
        '<p>'+(own?'Own picks: '+esc(own)+'. ':'')+esc(String(v.games||0))+' trusted direct-peer games · '+esc(String(v.laneGames||0))+' lane-comparable · '+esc(String(v.timelineGames||0))+' timeline-complete · '+esc(String(v.dpmGames||0))+' DPM comparisons. Each colored diagnostic uses its own minimum evidence.</p>'+
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
function renderQuality(r){
  const q=r.dataQuality||{},b=r.behaviorSummary||{},p=r.peerComparison||{},ext=r.externalBenchmarks||{};
  const analyzed=Number(q.analyzedGames??r.games?.length??0),coaching=Number(q.coachingRoleGames??r.coachingSummary?.games??0),timelines=Number(q.validTimelineGames??0);
  const timelinePct=analyzed>0?timelines/analyzed*100:null,peerN=Number(q.peerComparableGames??p.sameRoleGames??0),rankedN=Number(q.rankedPeerGames??p.rankedPeerGames??0);
  const fightN=Number(b.fightSamples??0),objectiveN=Number(b.neutralObjectiveEvents??0),wardN=Number(p.visionWardTotal??0);
  const cards=[
    qualityCard('Analyzed games',String(analyzed),String(coaching)+' selected-role coaching games · '+roleLabel(q.selectedRole||r.summary?.primaryRole),evidenceLevel(coaching)),
    qualityCard('External rank reference',ext.eligible===false?'Withheld':ext.currentTier?String(ext.currentTier)+' · '+String(ext.roleLabel||'ADC'):'Unavailable',ext.eligible===false?adcBenchmarkUnavailableReason(r):(ext.source||'External benchmark')+(ext.sourceCapturedAt?' · captured '+String(ext.sourceCapturedAt):'')+(ext.sourceCorpus?' · '+String(ext.sourceCorpus):'')+' · role-adjusted, cross-patch reference; not a direct rank×role population mean','neutral'),
    qualityCard('Queue context',hasNum(q.dominantQueueId)?('Queue '+String(q.dominantQueueId)+(q.dominantQueueFamily?' · '+String(q.dominantQueueFamily).replaceAll('_',' '):'')):'n/a',String(q.dominantQueueGames??0)+' matching cached games · selected from '+String(q.queueSelection?.considered??0)+' newest supported game(s)'+(q.queueSelection?.windowSize?' (window '+String(q.queueSelection.windowSize)+')':'')+' · '+String(q.unsupportedQueueRowsExcluded??0)+' unsupported special/bot queue game(s) excluded · '+String(Math.max(0,Number(q.excludedOtherQueues||0)-Number(q.unsupportedQueueRowsExcluded||0)))+' other supported queue-context game(s) excluded',evidenceLevel(q.dominantQueueGames??0)),
    qualityCard('Fixed checkpoint eligibility',String(b.checkpointEligibility?.lane15Games??0)+' @15 lane','15→25 '+String(b.checkpointEligibility?.fixed15to25Games??0)+' · @25 closing '+String(b.checkpointEligibility?.closing25Games??0),'neutral'),
    qualityCard('Patch context',(q.currentPublicPatchKey||q.currentPatchKey)?('Patch '+String(q.currentPublicPatchKey||q.currentPatchKey)):'n/a',String(q.currentPatchRoleGames??0)+' current-patch role games · '+String(q.olderSamePatchRoleGames??0)+' older same-patch baseline · '+String(q.crossPatchBaselineRoleGames??0)+' cross-patch older games excluded from trend'+(q.currentPublicPatchKey&&q.currentPatchKey&&String(q.currentPublicPatchKey)!==String(q.currentPatchKey)?' · Riot/Data Dragon build '+String(q.currentPatchKey):''),q.patchBaselineReady?'good':'neutral'),
    qualityCard('Role-quest mechanics',Object.keys(q.roleQuestRevisionCounts||{}).length?Object.entries(q.roleQuestRevisionCounts||{}).map(([k,v])=>String(k)+' '+String(v)+'g').join(' · '):'n/a',q.roleQuestCheckpointNote||'Quest effects are treated as patch context, not inferred completion timestamps.','neutral'),
    qualityCard('Mechanics coaching cohort',q.currentMechanicsKey||'n/a',String(q.mechanicsCohortGames??0)+' current-mechanics role games · '+String(q.primaryRoleGamesInLast20??coaching)+' primary-role games in Last-20'+(q.mechanicsCohortApplied?' · verified current cohort applied':q.mechanicsCohortReason==='current_mechanics_unverified'?' · mixed fallback: newest mechanics revision is unverified':q.mixedMechanicsFallback?' · mixed fallback: current cohort below 5 games':' · single compatible cohort'),q.mechanicsCohortApplied?'good':q.mixedMechanicsFallback||q.currentMechanicsKnown===false?'neutral':'good'),
    qualityCard('Item catalog provenance',String(q.itemCatalogExactPatches??0)+' exact patch catalog(s)',String(q.itemCatalogFallbackPatches??0)+' patch fallback(s) · '+String(q.itemCatalogUnknownPatchGames??0)+' game(s) without a parsed patch',Number(q.itemCatalogFallbackPatches||0)===0?'good':'neutral'),
    qualityCard('Timeline position evidence',q.positionEvidenceModel?String(q.positionEvidenceModel).replaceAll('_',' '):'nearest timeline frame',hasNum(q.positionEvidenceMaxDeltaMs)?('Event-presence frames must be within '+fmtInt(Number(q.positionEvidenceMaxDeltaMs)/1000)+'s of the event'):'Event-presence timing bound unavailable','neutral'),
    qualityCard('Item undo quality',String(q.unresolvedItemUndoEvents??0)+' unresolved undo event(s)',String(q.gamesWithUnresolvedItemUndo??0)+' game(s) affected · zero-ID Riot undo events make only the nearby shop-spend estimate approximate; no purchase identity is guessed',Number(q.unresolvedItemUndoEvents||0)===0?'good':'neutral'),
    qualityCard('Sample exclusions',String(Number(q.excludedShortGames||0)+Number(q.excludedOtherMaps||0)+Number(q.excludedOtherRoles||0)+Number(q.excludedUnsupportedQueues??q.unsupportedQueueRowsExcluded??0)+Number(q.excludedOtherSupportedQueues??Math.max(0,Number(q.excludedOtherQueues||0)-Number(q.unsupportedQueueRowsExcluded||0)))+Number(q.excludedMissingRole||0)+Number(q.excludedAmbiguousRole||0))+' games',String(q.excludedShortGames??0)+' under 10m · '+String(q.excludedOtherMaps??0)+' other maps · '+String(q.excludedOtherRoles??0)+' other-role games · '+String(q.excludedUnsupportedQueues??q.unsupportedQueueRowsExcluded??0)+' unsupported special/bot queues'+(Array.isArray(q.unsupportedQueueIds)&&q.unsupportedQueueIds.length?' ['+q.unsupportedQueueIds.join(', ')+']':'')+' · '+String(q.excludedOtherSupportedQueues??Math.max(0,Number(q.excludedOtherQueues||0)-Number(q.unsupportedQueueRowsExcluded||0)))+' other supported queue contexts · '+String(q.excludedMissingRole??0)+' missing role · '+String(q.excludedAmbiguousRole??0)+' conflicting Riot role metadata · '+String(q.excludedBeyondLast20??0)+' valid older games outside the Last-20 cap','neutral'),
    qualityCard('Timeline coverage',hasNum(timelinePct)?fmtPct(timelinePct):'n/a',String(timelines)+' / '+String(analyzed)+' games',evidenceLevel(timelines)),
    qualityCard('Direct peer evidence',String(peerN)+' games','High-confidence same-role comparisons · '+String(q.excludedLowConfidenceDirectPeerGames??0)+' fallback-role comparison(s) withheld · '+String(q.ambiguousDirectPeerGames??0)+' ambiguous enemy-role game(s) withheld · '+String(q.missingDirectPeerGames??0)+' missing enemy-role game(s)',evidenceLevel(peerN)),
    qualityCard('Ranked peer evidence',String(rankedN)+' games',String(q.higherRankPeerGames??p.higherRankPeerGames??0)+' higher-rank peers',evidenceLevel(rankedN)),
    qualityCard('Fight evidence',String(fightN)+' clusters','Attended multi-kill fight clusters',evidenceLevel(fightN,12,6)),
    qualityCard('Objective evidence',String(objectiveN)+' contested encounters','Team-secured objectives plus lost objectives with supported allied presence; full concessions excluded',evidenceLevel(objectiveN,10,5)),
    qualityCard('Ward evidence',String(wardN)+' ward events',String(q.wardEventPositions??0)+' direct-position · '+String(q.wardFrameProjectedPositions??0)+' projected from nearest ≤35s player frame · '+String(q.wardUnpositionedEvents??0)+' unpositioned',evidenceLevel(wardN,30,12)),
    qualityCard('Same-patch self baseline',String(q.coachingBaselineRoleGames??0)+' games',(q.currentPublicPatchKey||q.currentPatchKey)?('Older primary-role games on patch '+String(q.currentPublicPatchKey||q.currentPatchKey)):'No usable patch cohort',evidenceLevel(q.coachingBaselineRoleGames??0))
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

const requestInputs=['requestGameName','requestTagLine','requestRegion','requestRole','riotApiKey'];
requestInputs.forEach(id=>{
  const node=$(id);if(!node)return;
  node.addEventListener(id==='requestRegion'||id==='requestRole'?'change':'input',(ev)=>{
    if(id==='requestRole'){
      state.selectedRole=selectedAnalysisRole();
      if(state.profile){loadCacheStatus();loadSavedReport(state.profile);}
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
$('savedProfileSelect')?.addEventListener('change',ev=>{const id=String(ev.target.value||'');if(id)applySavedProfile(id,{loadReport:true});else startNewProfile();});
$('newSavedProfileBtn')?.addEventListener('click',startNewProfile);
$('forgetSavedProfileBtn')?.addEventListener('click',forgetSavedProfile);

boot().catch(e=>{log('Startup failed: '+e.message,'bad');$('backendState').textContent='Startup failed';$('backendState').className='pill error';});
})();