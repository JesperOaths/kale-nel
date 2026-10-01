(function(){
'use strict';

const cfg=window.GEJAST_CONFIG||{};
const API=(cfg.SUPABASE_URL||'')+'/functions/v1/printify-gildan-diff-diag-v1';
const KEY=cfg.SUPABASE_PUBLISHABLE_KEY||'';
const $=(id)=>document.getElementById(id);
const state={profiles:[],profile:null,report:null,ddVersion:'',openMatch:null,activeDetailTab:'macro',busy:false,riotApiKey:'',serverRiotKey:false};

function esc(v){return String(v??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function token(){try{return (cfg.getPlayerSessionToken&&cfg.getPlayerSessionToken())||'';}catch(_){return'';}}
function hasNum(v){return v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));}
function fmt(v,d=1){return hasNum(v)?Number(v).toFixed(d):'n/a';}
function fmtInt(v){return hasNum(v)?Math.round(Number(v)).toLocaleString():'n/a';}
function fmtPct(v){return hasNum(v)?Math.round(Number(v))+'%':'n/a';}
function fmtDate(v){if(!v)return'—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'—';}
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

async function api(action,payload={}){
  if(!API||!KEY)throw new Error('League backend configuration is missing.');
  const res=await fetch(API,{
    method:'POST',mode:'cors',cache:'no-store',
    headers:Object.assign({'Content-Type':'application/json','apikey':KEY,'Authorization':'Bearer '+KEY,'x-gejast-session':token()},state.riotApiKey?{'x-riot-api-key':state.riotApiKey}:{}),
    body:JSON.stringify(Object.assign({action},payload))
  });
  const raw=await res.text();let data=null;
  try{data=raw?JSON.parse(raw):{};}catch(_){throw new Error(raw||('HTTP '+res.status));}
  if(!res.ok||data?.ok===false)throw new Error(data?.error||('HTTP '+res.status));
  return data;
}

function setBusy(on,label){
  state.busy=!!on;
  ['fetchBtn','analyzeBtn','batchFetchBtn','batchAnalyzeBtn','newProfileBtn','saveProfileBtn','importBtn','testRiotKeyBtn'].forEach(id=>{const n=$(id);if(n)n.disabled=!!on||((id==='fetchBtn'||id==='analyzeBtn')&&!state.profile)||((id==='batchFetchBtn'||id==='batchAnalyzeBtn')&&batchSelectedIds().length===0)||((id==='importBtn')&&(!state.profile||!$('reportFile')?.files?.length))||((id==='testRiotKeyBtn')&&(!state.profile||(!state.serverRiotKey&&!state.riotApiKey)));});
  if(label)$('progressState').textContent=label;
}
function setProgress(current,total){
  const p=total>0?Math.max(0,Math.min(100,current/total*100)):0;
  $('progressBar').style.width=p+'%';
}
function log(message,type=''){
  const line=document.createElement('div');line.className='log-line '+type;line.textContent='['+new Date().toLocaleTimeString()+'] '+message;
  $('progressLog').appendChild(line);$('progressLog').scrollTop=$('progressLog').scrollHeight;
}
function clearLog(){
  $('progressLog').innerHTML='';
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
const SR_MAP_BOUNDS={minX:-120,minY:-120,maxX:14870,maxY:14980,size:512};
function worldToMapPoint(x,y){
  if(!hasNum(x)||!hasNum(y))return null;
  const bx=SR_MAP_BOUNDS,xx=Number(x),yy=Number(y);
  if(xx<bx.minX-500||xx>bx.maxX+500||yy<bx.minY-500||yy>bx.maxY+500)return null;
  const px=(xx-bx.minX)/(bx.maxX-bx.minX)*bx.size;
  const py=(bx.maxY-yy)/(bx.maxY-bx.minY)*bx.size;
  return{x:Math.max(0,Math.min(bx.size,px)),y:Math.max(0,Math.min(bx.size,py))};
}
function map11Image(){
  const version=state.ddVersion||'6.8.1';
  return 'https://ddragon.leagueoflegends.com/cdn/'+encodeURIComponent(version)+'/img/map/map11.png';
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
function perGameSpatialHtml(g){
  const mapId=Number(g.mapId||0);
  if(mapId!==11){
    return '<div class="detail-map-grid"><div class="detail-note map-unavailable"><strong>Map renderer unavailable for mapId '+esc(String(mapId||'unknown'))+'.</strong><br>Raw Riot coordinates remain preserved, but this match is not forced onto the Summoner’s Rift projection.</div></div>';
  }
  const deaths=perGameDeathPoints(g),wards=(Array.isArray(g.wards)?g.wards:[]).filter(x=>hasNum(x.x)&&hasNum(x.y)).slice().sort((a,b)=>Number(a.time||0)-Number(b.time||0));
  const image=map11Image(),fallback='https://ddragon.leagueoflegends.com/cdn/6.8.1/img/map/map11.png';
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
    '<div class="detail-map-note">Summoner’s Rift mapId 11 · x −120→14870 · y −120→14980 · Y inverted. The per-game maps use the same projection as the Last-20 spatial review.</div>'+
  '</div>';
}

async function boot(){
  clearLog();log('Opening League web workspace.');
  await getDdragonVersion();
  try{
    const health=await api('health');
    state.serverRiotKey=!!health.server_riot_key;
    $('backendState').textContent=health.riot_configured?'Backend + Riot ready':'Backend ready · add Riot key';
    $('backendState').className='pill '+(health.riot_configured?'':'warn');
    $('riotKeyRow').hidden=state.serverRiotKey;
    $('riotKeyStatus').textContent=state.serverRiotKey?'Server Riot key configured':'No server Riot key configured';
    log('Authenticated as '+(health.player||'Kalenel player')+'.','ok');
    if(!health.riot_configured)log('Add a Riot development/personal key in the session-only field before Fetch / update. Saved/imported reports still work without it.');
  }catch(e){
    $('backendState').textContent='Backend unavailable';$('backendState').className='pill error';log(e.message,'bad');
  }
  await loadProfiles();
}

function batchSelectedIds(){
  return [...($('batchProfiles')?.querySelectorAll('input[data-profile-id]:checked')||[])].map(n=>String(n.dataset.profileId||'')).filter(Boolean);
}
function renderBatchProfiles(){
  const box=$('batchProfiles');if(!box)return;
  const previous=new Set(batchSelectedIds());
  box.innerHTML=state.profiles.length?state.profiles.map((p,i)=>{
    const checked=previous.has(String(p.id))||(!previous.size&&String(p.id)===String(state.profile?.id||state.profiles[0]?.id||''));
    return '<label class="batch-profile-option"><input type="checkbox" data-profile-id="'+esc(p.id)+'" '+(checked?'checked':'')+'><span>'+esc(p.display_name)+(p.game_name?' · '+esc(p.game_name)+'#'+esc(p.tag_line||''):'')+'</span></label>';
  }).join(''):'<div class="muted tiny">No saved profiles yet.</div>';
  box.querySelectorAll('input[data-profile-id]').forEach(n=>n.addEventListener('change',syncButtons));
}
async function loadProfiles(selectId){
  const data=await api('profiles_list');
  state.profiles=data.profiles||[];
  const sel=$('profileSelect');
  sel.innerHTML='<option value="">Choose a profile…</option>'+state.profiles.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.display_name)+(p.game_name?' · '+esc(p.game_name)+'#'+esc(p.tag_line||''):'')+'</option>').join('');
  const id=selectId||(state.profile&&state.profile.id)||state.profiles[0]?.id||'';
  if(id){sel.value=id;await selectProfile(id);}else{state.profile=null;syncButtons();$('cacheState').textContent='No profile';}
  renderBatchProfiles();syncButtons();
}
function syncButtons(){
  const batchCount=batchSelectedIds().length;
  $('fetchBtn').disabled=state.busy||!state.profile;
  $('analyzeBtn').disabled=state.busy||!state.profile;
  if($('batchFetchBtn'))$('batchFetchBtn').disabled=state.busy||batchCount===0;
  if($('batchAnalyzeBtn'))$('batchAnalyzeBtn').disabled=state.busy||batchCount===0;
  $('importBtn').disabled=state.busy||!state.profile||!$('reportFile')?.files?.length;
  $('testRiotKeyBtn').disabled=state.busy||!state.profile||(!state.serverRiotKey&&!state.riotApiKey);
}
async function selectProfile(id){
  state.profile=state.profiles.find(p=>p.id===id)||null;
  syncButtons();
  if(!state.profile){return;}
  $('sourceState').textContent=state.profile.puuid?'Resolved Riot ID':'Riot ID not resolved';
  await Promise.all([loadCacheStatus(),loadLatestReport()]);
}
async function loadCacheStatus(){
  if(!state.profile)return;
  try{
    const d=await api('cache_status',{profile_id:state.profile.id});
    $('cacheState').textContent=(d.cached_games||0)+' cached games';
    $('latestGameState').textContent=d.last_game_at?fmtDate(d.last_game_at):'None yet';
  }catch(e){$('cacheState').textContent='Unavailable';log('Cache status: '+e.message,'bad');}
}
async function loadLatestReport(){
  if(!state.profile)return;
  try{
    const d=await api('report_latest',{profile_id:state.profile.id});
    if(d.analysis?.report_data){
      $('analysisState').textContent=fmtDate(d.analysis.created_at);
      $('sourceState').textContent=d.analysis.source_kind==='legacy_import'?'Imported Bruisienator':'Web analyzer';
      renderReport(d.analysis.report_data,d.analysis.source_kind);
      renderProgressComparison(d.analysis.report_data,d.previous?.report_data||null,d.previous?.created_at||null);
    }else{
      $('analysisState').textContent='No report';
      state.report=null;$('report').hidden=true;$('reportEmpty').hidden=false;$('progressComparisonPanel').hidden=true;
    }
  }catch(e){log('Latest report: '+e.message,'bad');}
}

function openProfileEditor(profile){
  const p=profile||{};
  $('profileEditor').hidden=false;
  $('profileLabel').value=p.display_name||'';
  $('gameName').value=p.game_name||'';
  $('tagLine').value=p.tag_line||'';
  $('platformRegion').value=p.platform_region||'euw1';
  $('profileNotes').value=p.notes||'';
  $('profileEditor').dataset.profileId=p.id||'';
  $('profileLabel').focus();
}
async function saveProfile(){
  const profile={
    id:$('profileEditor').dataset.profileId||undefined,
    display_name:$('profileLabel').value.trim(),
    game_name:$('gameName').value.trim(),
    tag_line:$('tagLine').value.trim(),
    platform_region:$('platformRegion').value,
    notes:$('profileNotes').value.trim()
  };
  if(!profile.display_name||!profile.game_name||!profile.tag_line){log('Profile label, Riot game name and tag are required.','bad');return;}
  setBusy(true,'Saving');
  try{
    const d=await api('profile_save',{profile});
    log('Saved profile '+d.profile.display_name+'.','ok');
    if(d.resolve_warning)log('Saved, but Riot resolution is pending: '+d.resolve_warning,'bad');
    $('profileEditor').hidden=true;
    await loadProfiles(d.profile.id);
  }catch(e){log('Save profile failed: '+e.message,'bad');}
  finally{setBusy(false,'Idle');syncButtons();}
}

async function testRiotKey(){
  if(!state.profile||state.busy||(!state.serverRiotKey&&!state.riotApiKey))return;
  setBusy(true,'Testing key');statusPill('Testing Riot key','warn');
  try{
    log('Testing Riot access for '+state.profile.display_name+'…');
    const d=await api('riot_test',{profile_id:state.profile.id});
    log('Riot key works; Riot ID resolved'+(d.puuid_resolved?' to a PUUID.':'.'),'ok');
    $('riotKeyStatus').textContent='Riot key verified for this session';
    statusPill('Riot key verified');
    await loadProfiles(state.profile.id);
  }catch(e){
    log('Riot key test failed: '+e.message,'bad');
    $('riotKeyStatus').textContent='Riot key test failed';
    statusPill('Key test failed','error');
  }finally{setBusy(false);syncButtons();}
}

async function fetchProfileData(profile,requestedCount){
  log('Preparing recent match list for '+profile.display_name+'. Queue/duration quality filters are applied later; '+requestedCount+' raw matches requested.');
  const prep=await api('fetch_prepare',{profile_id:profile.id,count:requestedCount});
  const ids=prep.match_ids||[],cached=new Set(prep.cached_match_ids||[]);
  if(!ids.length)throw new Error('Riot returned no recent match IDs.');
  log(ids.length+' recent matches found for '+profile.display_name+'; '+cached.size+' already cached.');
  let done=0;
  for(const id of ids){
    done++;
    if(cached.has(id)){
      log('['+done+'/'+ids.length+'] '+profile.display_name+' · '+id+' · cache hit','ok');setProgress(done,ids.length);continue;
    }
    log('['+done+'/'+ids.length+'] '+profile.display_name+' · fetching match + timeline '+id+'…');
    try{
      const one=await api('fetch_one',{run_id:prep.run_id,match_id:id});
      if(one.timeline_available)log('['+done+'/'+ids.length+'] '+profile.display_name+' · '+id+' · match + timeline cached','ok');
      else log('['+done+'/'+ids.length+'] '+profile.display_name+' · '+id+' · match cached, timeline unavailable: '+(one.timeline_error||'unknown'),'bad');
    }catch(e){log('['+done+'/'+ids.length+'] '+profile.display_name+' · '+id+' · '+e.message,'bad');}
    setProgress(done,ids.length);
    await sleep(100);
  }
  const finish=await api('fetch_finish',{run_id:prep.run_id});
  if(hasNum(finish?.dominant_queue_id))log(profile.display_name+' · comparable queue '+String(finish.dominant_queue_id)+' · '+String(finish.comparable_cached_games??finish.peer_rank_target_count??0)+' comparable cached games · '+String(finish.peer_rank_target_count??0)+' final-sample peer-rank targets · '+String(finish.peer_rank_backfilled??0)+' rank snapshots backfilled.','ok');
  if(finish?.recommend_deeper_cache)log(profile.display_name+' · only '+String(finish.comparable_cached_games??0)+' comparable cached games are currently available after map/duration/queue filtering. Use the 100-match cache depth on the next update.','bad');
  return{prep,finish};
}
async function analyzeProfileData(profile){
  log(profile.display_name+' · loading cached matches only — no new match fetch is requested.');
  const d=await api('analyze_basic',{profile_id:profile.id});
  log(profile.display_name+' · deterministic web analysis generated for '+(d.report?.dataQuality?.analyzedGames||0)+' games.','ok');
  return d;
}
async function fetchMatches(){
  if(!state.profile||state.busy)return;
  clearLog();setBusy(true,'Fetching');statusPill('Fetching','warn');
  try{
    const requestedCount=Math.max(20,Math.min(100,Number($('fetchCount').value||50)));
    const {prep}=await fetchProfileData(state.profile,requestedCount);
    if(prep.profile){state.profile=Object.assign({},state.profile,prep.profile);const rs=state.profile.rank_snapshot;$('sourceState').textContent=rs&&rs.tier?'Riot · '+rs.tier+' '+(rs.rank||''):'Resolved Riot ID';}
    log('Fetch/update complete. Analyze remains a separate cached-data operation.','ok');
    statusPill('Fetch complete');await loadCacheStatus();
  }catch(e){log('Fetch failed: '+e.message,'bad');statusPill('Fetch failed','error');}
  finally{setBusy(false);syncButtons();}
}
async function analyze(){
  if(!state.profile||state.busy)return;
  clearLog();setBusy(true,'Analyzing');statusPill('Analyzing','warn');setProgress(20,100);
  try{
    const d=await analyzeProfileData(state.profile);
    setProgress(100,100);
    if(d.report?.advanced?.currentSourcePortRequired)log('Advanced Bruisienator formulas are intentionally marked unavailable until the current source package is supplied.');
    renderReport(d.report,'web_behavior');
    try{const history=await api('report_latest',{profile_id:state.profile.id});renderProgressComparison(d.report,history.previous?.report_data||null,history.previous?.created_at||null);}catch(_){$('progressComparisonPanel').hidden=true;}
    $('analysisState').textContent=fmtDate(d.created_at);$('sourceState').textContent='Behavioral analyzer';statusPill('Analysis complete');
  }catch(e){log('Analysis failed: '+e.message,'bad');statusPill('Analysis failed','error');}
  finally{setBusy(false);syncButtons();}
}
async function runBatch(kind){
  if(state.busy)return;
  const ids=batchSelectedIds(),profiles=ids.map(id=>state.profiles.find(p=>String(p.id)===String(id))).filter(Boolean);
  if(!profiles.length)return;
  const originalId=state.profile?.id||'',requestedCount=Math.max(20,Math.min(100,Number($('fetchCount').value||50)));
  clearLog();setBusy(true,kind==='fetch'?'Batch fetching':'Batch analyzing');statusPill(kind==='fetch'?'Batch fetching':'Batch analyzing','warn');
  let ok=0,failed=0;
  try{
    log('Starting sequential '+(kind==='fetch'?'fetch/update':'analysis')+' for '+profiles.length+' selected profile'+(profiles.length===1?'':'s')+'.');
    for(let i=0;i<profiles.length;i++){
      const p=profiles[i];log('=== ['+(i+1)+'/'+profiles.length+'] '+p.display_name+' ===');
      try{
        if(kind==='fetch')await fetchProfileData(p,requestedCount);
        else await analyzeProfileData(p);
        ok++;
      }catch(e){failed++;log(p.display_name+' failed: '+e.message,'bad');}
      setProgress(i+1,profiles.length);
    }
    log('Batch complete · '+ok+' succeeded · '+failed+' failed.',failed?'bad':'ok');
    statusPill(failed?(ok?'Batch partially complete':'Batch failed'):'Batch complete',failed?'warn':'neutral');
  }finally{
    setBusy(false);
    if(originalId){await loadProfiles(originalId);}else{await loadProfiles();}
    syncButtons();
  }
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
  out.dataQuality=out.dataQuality||{};
  out.sourceStatus=out.sourceStatus||{};
  out.charts=out.charts||{};
  return out;
}
function renderReport(raw,sourceKind){
  const r=normalizeReport(raw);state.report=r;
  $('reportEmpty').hidden=true;$('report').hidden=false;
  const p=r.profile||{},s=r.summary||{};
  $('reportTitle').textContent=p.displayName||p.display_name||state.profile?.display_name||'League profile';
  const riotId=[p.gameName||p.game_name,p.tagLine||p.tag_line].filter(Boolean).join('#');
  const rank=p.rank&&p.rank.tier?[p.rank.tier,p.rank.rank,p.rank.leaguePoints!=null?String(p.rank.leaguePoints)+' LP':''].filter(Boolean).join(' '):'';
  const coachingN=r.coachingSummary?.games??s.primaryRoleGames??0;
  $('reportSubtitle').textContent=(riotId?riotId+' · ':'')+(rank?rank+' · ':'')+(s.games??r.games.length)+' analyzed games · Primary role '+(s.primaryRole||'GENERIC')+' · Coaching sample '+coachingN+' '+(s.primaryRole||'GENERIC')+' games';
  $('reportSourceBadge').textContent=sourceKind==='legacy_import'?'Imported current report':(r.analyzerVersion||'Web analysis');
  renderKpis(r);renderBullets('recentFocus',r.priorityThemes?.length?r.priorityThemes:r.recentFocus,'No grounded recent-focus tips are available from the active analyzer yet.');
  renderBullets('overallHighlights',r.overallHighlights,'No broader highlights are available from the active analyzer yet.');
  renderSessionHabits(r);renderPracticePlan(r);renderGames(r);renderReplayReviewQueue(r);renderCharts(r);renderSpatial(r);renderAdvanced(r);renderBreakdowns(r);renderQuality(r);
}
function renderKpis(r){
  const s=r.summary||{},role=String(s.primaryRole||'GENERIC').toUpperCase();
  const item=(label,value,sub='')=>({label,value,sub});
  let rows;
  if(role==='SUPPORT'){
    rows=[item('Recent WR',fmtPct(s.winRate)),item('Primary role',role,(s.primaryRoleGames||0)+' games'),item('Vision / min',fmt(s.vpm,2)),item('Objective presence',fmtPct(r.advanced?.objectivePresence)),item('Early skirmish KP',fmtPct(r.advanced?.earlyKP))];
  }else if(role==='JUNGLE'){
    rows=[item('Recent WR',fmtPct(s.winRate)),item('Primary role',role,(s.primaryRoleGames||0)+' games'),item('Gold / min',fmtInt(s.gpm)),item('Objective presence',fmtPct(r.advanced?.objectivePresence)),item('Early KP',fmtPct(r.advanced?.earlyKP))];
  }else{
    rows=[item('Recent WR',fmtPct(s.winRate)),item('Primary role',role,(s.primaryRoleGames||0)+' games'),item('CS / min',fmt(s.csMin,2)),item('KP',fmtPct(s.kp)),item('DPM',fmtInt(s.dpm))];
  }
  $('kpiGrid').innerHTML=rows.map(x=>'<div class="kpi-card"><span>'+esc(x.label)+'</span><strong>'+esc(x.value)+'</strong><small>'+esc(x.sub||'Last-20 sample')+'</small></div>').join('');
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
function previousPracticeTargetOutcomes(current,previous){
  const targets=Array.isArray(previous?.practiceTargets)?previous.practiceTargets:[];
  if(!targets.length)return{rows:[],reason:''};
  const curRole=String(current?.summary?.primaryRole||''),prevRole=String(previous?.summary?.primaryRole||'');
  const curQueue=current?.dataQuality?.dominantQueueId,prevQueue=previous?.dataQuality?.dominantQueueId;
  const curPatch=String(current?.dataQuality?.currentPatchKey||''),prevPatch=String(previous?.dataQuality?.currentPatchKey||'');
  if(curRole!==prevRole)return{rows:[],reason:'Previous practice targets are not scored because the primary role changed.'};
  if(hasNum(curQueue)&&hasNum(prevQueue)&&Number(curQueue)!==Number(prevQueue))return{rows:[],reason:'Previous practice targets are not scored because the comparable queue context changed.'};
  if(curPatch&&prevPatch&&curPatch!==prevPatch)return{rows:[],reason:'Previous practice targets are not scored because the patch cohort changed.'};
  const rows=targets.map(t=>{
    const currentValue=pathValue(current,t.metricPath);
    if(!hasNum(currentValue)||!hasNum(t.baseline)||!hasNum(t.goal))return null;
    const cur=Number(currentValue),base=Number(t.baseline),goal=Number(t.goal),higher=t.direction!=='lower';
    const met=higher?cur>=goal:cur<=goal,needed=Math.abs(goal-base),toward=(higher?cur-base:base-cur);
    const material=Math.max(needed*.2,1e-9);
    const status=met?'met':toward>=material?'moving closer':toward<=-material?'moved away':'unchanged';
    const cls=met||status==='moving closer'?'improved':status==='moved away'?'worsened':'stable';
    return{label:t.label||t.metricPath,current:practiceTargetValue(cur,t.unit),baseline:practiceTargetValue(base,t.unit),goal:practiceTargetValue(goal,t.unit),status,cls,sampleSize:Number(t.sampleSize||0)};
  }).filter(Boolean);
  return{rows,reason:''};
}

function renderProgressComparison(current,previous,previousAt){
  if(!previous){
    $('progressComparisonPanel').hidden=true;
    if($('practiceOutcome'))$('practiceOutcome').innerHTML='';
    return;
  }
  const role=String(current?.summary?.primaryRole||'GENERIC').toUpperCase();
  const specs=[
    {label:'Gold @15 vs role opponent',path:'summary.goldDiff15',threshold:150,direction:1,format:v=>signed(v,0)+'g'},
    {label:'Early-lead give-back rate',path:'behaviorSummary.earlyLeadGivebackRate',threshold:15,direction:-1,format:v=>fmtPct(v)},
    {label:'Clean solo-kill conversion rate',path:'behaviorSummary.soloKillConversionRate',threshold:15,direction:1,format:v=>fmtPct(v)},
    {label:'Solo-kill structure conversion',path:'behaviorSummary.soloKillStructureConversionRate',threshold:15,direction:1,format:v=>fmtPct(v)},
    {label:'Deaths before shop after solo kill',path:'behaviorSummary.soloKillDeathsBeforeShopRate',threshold:15,direction:-1,format:v=>fmtPct(v)},
    {label:'High-risk deaths / game',path:'behaviorSummary.badDeathsPerTimelineGame',threshold:.3,direction:-1,format:v=>fmt(v,1)},
    {label:'Early high-risk deaths / game',path:'behaviorSummary.phaseRisk.early.highRiskDeathsPerGame',threshold:.2,direction:-1,format:v=>fmt(v,2)},
    {label:'Mid high-risk deaths / game',path:'behaviorSummary.phaseRisk.mid.highRiskDeathsPerGame',threshold:.2,direction:-1,format:v=>fmt(v,2)},
    {label:'Mid routing CS swing 15→25',path:'behaviorSummary.midRouting.avgCsSwing15to25',threshold:4,direction:1,format:v=>signed(v,1)+' CS'},
    {label:'Mid routing objective presence',path:'behaviorSummary.midRouting.avgObjectiveJoinRate',threshold:10,direction:1,format:v=>fmtPct(v)},
    {label:'Win rate from role lead @25',path:'behaviorSummary.closing25.leadWinRate',threshold:10,direction:1,format:v=>fmtPct(v)},
    {label:'Lead@25 losses with late risk',path:'behaviorSummary.closing25.leadLateRiskLossRate',threshold:15,direction:-1,format:v=>fmtPct(v)},
    {label:'Late high-risk deaths / game',path:'behaviorSummary.phaseRisk.late.highRiskDeathsPerGame',threshold:.2,direction:-1,format:v=>fmt(v,2)},
    {label:'High-risk untraded / game',path:'behaviorSummary.highRiskUntradedPerGame',threshold:.25,direction:-1,format:v=>fmt(v,1)},
    {label:'Costly deaths / game',path:'behaviorSummary.costlyDeathsPerTimelineGame',threshold:.25,direction:-1,format:v=>fmt(v,2)},
    {label:'Rapid repeat-death rate',path:'behaviorSummary.repeatDeathRate',threshold:10,direction:-1,format:v=>fmtPct(v)},
    {label:'Severe death consequences / game',path:'behaviorSummary.severeDeathsPerTimelineGame',threshold:.2,direction:-1,format:v=>fmt(v,2)},
    {label:'High-risk deaths while ahead / game',path:'behaviorSummary.highRiskLeadDeathsPerGame',threshold:.2,direction:-1,format:v=>fmt(v,2)},
    {label:'High-risk deaths while behind / game',path:'behaviorSummary.highRiskBehindDeathsPerGame',threshold:.2,direction:-1,format:v=>fmt(v,2)},
    {label:'Pre-objective side-lane deaths / game',path:'behaviorSummary.preNeutralObjectiveSideLaneDeathsPerGame',threshold:.15,direction:-1,format:v=>fmt(v,2)},
    {label:'High-risk post-play give-backs / game',path:'behaviorSummary.highRiskUntradedPostImpactPerGame',threshold:.15,direction:-1,format:v=>fmt(v,2)},
    {label:'Pre-14 solo deaths to role / game',path:'behaviorSummary.pre14RoleSoloDeathPerGame',threshold:.2,direction:-1,format:v=>fmt(v,2)},
    {label:'First-reset loss rate',path:'behaviorSummary.firstResetLossRate',threshold:15,direction:-1,format:v=>fmtPct(v)},
    {label:'First-reset role-CS swing',path:'behaviorSummary.avgFirstResetCsSwing',threshold:2,direction:1,format:v=>signed(v,1)+' CS'},
    {label:'First major item vs peer',path:'peerComparison.avgMajorItemDeltaMin',threshold:.4,direction:-1,format:v=>signed(v,1)+' min'},
    {label:'Affordable → first-major delay',path:'behaviorSummary.avgMajorCompletionDelayMin',threshold:.4,direction:-1,format:v=>fmt(v,1)+' min'},
    {label:'Major-item spike utilization',path:'behaviorSummary.itemSpikeUtilizationRate',threshold:15,direction:1,format:v=>fmtPct(v)},
    {label:'Damage share − gold share',path:'behaviorSummary.damageGoldEfficiency',threshold:2,direction:1,format:v=>signed(v,1)+' pp'},
    {label:'First allied death rate',path:'behaviorSummary.firstAllyFightDeathRate',threshold:10,direction:-1,format:v=>fmtPct(v)},
    {label:'Unspent-gold fight starts',path:'behaviorSummary.highUnspentFightRate',threshold:10,direction:-1,format:v=>fmtPct(v)},
    {label:'Major-item disadvantage fights',path:'behaviorSummary.itemDisadvantageFightRate',threshold:10,direction:-1,format:v=>fmtPct(v)},
    {label:'Locally outnumbered fight rate',path:'behaviorSummary.outnumberedFightStartRate',threshold:10,direction:-1,format:v=>fmtPct(v)},
    {label:'Level-down shared-role fight rate',path:'behaviorSummary.roleLevelDisadvantageFightRate',threshold:10,direction:-1,format:v=>fmtPct(v)},
    {label:'Game 3+ gold delta',path:'sessionBehavior.game3PlusGoldDelta',threshold:150,direction:1,format:v=>signed(v,0)+'g'},
    {label:'Post-loss requeue gold delta',path:'sessionBehavior.postLossGoldDelta',threshold:150,direction:1,format:v=>signed(v,0)+'g'},
    {label:'Prior-frame objective setup rate',path:'behaviorSummary.earlySetupObjectiveJoinRate',threshold:10,direction:1,format:v=>fmtPct(v)},
    {label:'Vision-action death rate',path:'behaviorSummary.visionActionDeathRate',threshold:5,direction:-1,format:v=>fmtPct(v)},
    {label:'High-risk vision deaths / game',path:'behaviorSummary.highRiskVisionActionDeathsPerGame',threshold:.15,direction:-1,format:v=>fmt(v,2)},
    {label:'Late-reset objective miss rate',path:'behaviorSummary.lateResetObjectiveMissRate',threshold:10,direction:-1,format:v=>fmtPct(v)}
  ];
  if(['ADC','MID','TOP'].includes(role))specs.splice(1,0,{label:'CS / min',path:'summary.csMin',threshold:.3,direction:1,format:v=>fmt(v,2)});
  if(['SUPPORT','JUNGLE'].includes(role))specs.push({label:'Objective presence',path:'advanced.objectivePresence',threshold:10,direction:1,format:v=>fmtPct(v)});
  const rows=specs.map(s=>{
    const cur=pathValue(current,s.path),prev=pathValue(previous,s.path);
    if(!hasNum(cur)||!hasNum(prev))return null;
    const raw=Number(cur)-Number(prev),effect=raw*s.direction;
    const status=effect>=s.threshold?'improved':effect<=-s.threshold?'worsened':'stable';
    return {label:s.label,current:s.format(cur),previous:s.format(prev),delta:raw,status};
  }).filter(Boolean);
  const targetOutcome=previousPracticeTargetOutcomes(current,previous),targetRows=targetOutcome.rows||[];
  $('progressComparison').innerHTML=rows.map(x=>'<article class="progress-comparison-card '+x.status+'">'+
    '<span>'+esc(x.label)+'</span><strong>'+esc(x.status)+'</strong>'+
    '<p>Now '+esc(x.current)+' · previous '+esc(x.previous)+'</p></article>').join('');
  if($('practiceOutcome')){
    $('practiceOutcome').innerHTML=targetRows.length?'<div class="target-outcome-head"><strong>Previous Next-5 targets</strong><small>Descriptive check against the exact saved metric path and goal.</small></div><div class="progress-comparison-grid">'+
      targetRows.map(x=>'<article class="progress-comparison-card '+x.cls+'"><span>'+esc(x.label)+'</span><strong>'+esc(x.status)+'</strong><p>Now '+esc(x.current)+' · baseline '+esc(x.baseline)+' · target '+esc(x.goal)+'</p></article>').join('')+'</div>':
      (targetOutcome.reason?'<div class="target-outcome-note">'+esc(targetOutcome.reason)+'</div>':'');
  }
  if(!rows.length&&!targetRows.length&&!targetOutcome.reason){$('progressComparisonPanel').hidden=true;return;}
  $('previousAnalysisDate').textContent='Compared with '+fmtDate(previousAt);
  $('progressComparisonPanel').hidden=false;
}

function sessionCard(title,sample){
  if(!sample||!Number(sample.games))return '';
  return '<div class="quality-card"><span>'+esc(title)+'</span><strong>'+esc(String(sample.games))+' games</strong>'+
    '<small>Gold @15 '+esc(signed(sample.goldDiff15,0))+'g · risky deaths '+esc(fmt(sample.badDeaths,1))+'/game · DPM '+esc(fmtInt(sample.dpm))+' · CS/min '+esc(fmt(sample.csMin,2))+'</small></div>';
}
function renderSessionHabits(r){
  const s=r.sessionBehavior||r.sessionModel||{};
  const cards=[
    sessionCard('Session-opening game',s.firstGame),
    sessionCard('Game 3+ in session',s.game3Plus),
    sessionCard('Quick requeue after loss',s.quickAfterLoss),
    sessionCard('Quick requeue after win',s.quickAfterWin)
  ].filter(Boolean);
  if(!cards.length){
    $('sessionHabitsPanel').hidden=true;return;
  }
  $('sessionHabits').innerHTML=cards.join('');
  const deltas=[];
  if(hasNum(s.game3PlusGoldDelta))deltas.push('game 3+ gold@15 '+signed(s.game3PlusGoldDelta,0)+'g vs opener');
  if(hasNum(s.game3PlusBadDeathDelta))deltas.push('game 3+ risky deaths '+signed(s.game3PlusBadDeathDelta,1)+'/game');
  if(hasNum(s.postLossGoldDelta))deltas.push('quick post-loss gold@15 '+signed(s.postLossGoldDelta,0)+'g vs quick post-win');
  if(hasNum(s.postLossBadDeathDelta))deltas.push('quick post-loss risky deaths '+signed(s.postLossBadDeathDelta,1)+'/game');
  $('sessionHabitsNote').textContent=(s.definition||'Session grouping uses game timing.')+(deltas.length?' Observed deltas: '+deltas.join(' · ')+'.':'');
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

function renderPracticePlan(r){
  const source=(r.priorityThemes?.length?r.priorityThemes:r.recentFocus)||[],targets=Array.isArray(r.practiceTargets)?r.practiceTargets:[];
  const focus=source.filter(x=>x&&typeof x==='object'&&x.action).sort((a,b)=>Number(a.priority||9)-Number(b.priority||9)||Number(b.score||0)-Number(a.score||0)).slice(0,3);
  if(!focus.length){
    $('practicePlan').innerHTML='<div class="practice-empty">No strong improvement priority has enough evidence yet. Fetch/analyze more timeline-complete games rather than forcing a conclusion.</div>';
    return;
  }
  $('practicePlan').innerHTML=focus.map((x,i)=>{
    const target=targets.find(t=>String(t.themeKey||'')===String(x.key||''))||targets[i]||null;
    return '<article class="practice-card">'+
      '<div class="practice-number">'+(i+1)+'</div><div><span>'+esc(x.category||'focus')+'</span><strong>'+esc(x.title||'Practice focus')+'</strong>'+
      '<p>'+esc(x.action)+'</p>'+
      (Array.isArray(x.supportingTitles)&&x.supportingTitles.length>1?'<div class="practice-supporting"><b>Why this is a priority</b>'+x.supportingTitles.slice(0,4).map(t=>'<span>• '+esc(t)+'</span>').join('')+'</div>':'')+
      practiceTargetHtml(target)+'<small>'+esc(x.comparison||'Last-20 evidence')+' · '+esc(x.confidence||'medium')+' confidence'+(Number(x.supportCount||0)?' · '+esc(String(x.supportCount))+' supporting finding'+(Number(x.supportCount)===1?'':'s'):'')+'</small></div></article>';
  }).join('');
}
function openReplayReviewMatch(matchId,tab){
  const games=state.report?.games||[],index=games.findIndex(g=>String(g.matchId)===String(matchId));
  if(index<0)return;
  state.activeDetailTab=tab||'macro';
  if(state.openMatch===index)state.openMatch=null;
  toggleGame(index);
  const row=$('gamesBody')?.querySelector('.game-row[data-match="'+CSS.escape(String(matchId))+'"]');
  if(row)row.scrollIntoView({behavior:'smooth',block:'center'});
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

function renderGames(r){
  const games=r.games||[];$('gameCountLabel').textContent=games.length+' games';
  state.openMatch=null;
  $('gamesBody').innerHTML=games.map((g,i)=>{
    const kda=[g.kills,g.deaths,g.assists].map(x=>hasNum(x)?Number(x):'?').join('/');
    const icon=championIcon(g.champion);
    return '<tr class="game-row" data-match="'+esc(g.matchId||String(i))+'" data-index="'+i+'">'+
      '<td class="caret">▸</td>'+
      '<td><div class="champion-cell">'+(icon?'<img class="champion-icon" src="'+esc(icon)+'" alt="">':'')+'<span>'+esc(g.champion||'Unknown')+'</span></div></td>'+
      '<td>'+esc(g.role||'GENERIC')+'</td>'+
      '<td class="result '+(g.win?'win':'loss')+'">'+(g.win?'WIN':'LOSS')+'</td>'+
      '<td><strong>'+esc(kda)+'</strong></td>'+
      '<td>'+esc(fmtPct(g.kp))+'</td>'+
      '<td>'+esc(fmt(g.csMin,2))+'</td>'+
      '<td>'+esc(fmtInt(g.dpm))+'</td>'+
      '<td>'+esc(signed(g.goldDiff15,0))+'</td></tr>';
  }).join('');
  $('gamesBody').querySelectorAll('.game-row').forEach(row=>row.addEventListener('click',()=>toggleGame(Number(row.dataset.index))));
}
function toggleGame(index){
  const body=$('gamesBody'),rows=[...body.querySelectorAll('.game-row')];
  body.querySelectorAll('.details-row').forEach(n=>n.remove());
  rows.forEach(r=>{const c=r.querySelector('.caret');if(c)c.textContent='▸';});
  if(state.openMatch===index){state.openMatch=null;return;}
  const game=state.report.games[index],row=rows.find(r=>Number(r.dataset.index)===index);if(!game||!row)return;
  state.openMatch=index;row.querySelector('.caret').textContent='▾';
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
  return '<div class="details-shell">'+judgmentHtml(g)+'<div class="details-tabs">'+['map','macro','resets','vision','roams','fights','phases','deaths','objectives'].map(t=>'<button class="tab-btn '+(state.activeDetailTab===t?'active':'')+'" data-tab="'+t+'" type="button">'+t[0].toUpperCase()+t.slice(1)+'</button>').join('')+'</div><div class="details-content" data-detail-content>'+detailContent(g,state.activeDetailTab)+'</div></div>';
}
function objectiveDiagnosisLabel(key){
  return ({late_reset:'Late reset timing',pre_objective_death:'Death before the contest',setup_vision:'Setup-vision deficit',arrival_pathing:'Arrival / pathing'})[String(key||'')]||'No supported primary cause';
}
function objectiveDiagnosisHtml(r){
  const d=r?.behaviorSummary?.objectiveDiagnosis||{},causes=Array.isArray(d.causes)?d.causes:[];
  if(!d.presenceLow&&!causes.length)return '<div class="detail-note">Objective presence is not currently flagged low enough for a root-cause diagnosis.</div>';
  const primary=d.primaryCause?objectiveDiagnosisLabel(d.primaryCause):'Arrival / pathing remains the unresolved hypothesis';
  return '<div class="objective-diagnosis"><div class="diagnosis-primary"><span>Primary supported cause</span><strong>'+esc(primary)+'</strong></div>'+
    (causes.length?'<ol>'+causes.map(x=>'<li><strong>'+esc(x.label||objectiveDiagnosisLabel(x.key))+'</strong><span>'+esc(x.evidence||'')+'</span><small>Evidence severity '+esc(fmt(x.severity,0))+'</small></li>').join('')+'</ol>':
    '<p>No reset/death/vision cause crossed its evidence threshold. Arrival/pathing remains a hypothesis rather than a proven cause.</p>')+
    '<small class="diagnosis-caveat">This ranks supported evidence; it does not prove a single cause.</small></div>';
}
function detailCard(label,value){return'<div class="detail-card"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>';}
function detailList(items,empty){
  const xs=(items||[]).filter(Boolean);
  return '<div class="detail-note">'+(xs.length?'<ul>'+xs.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':esc(empty||'No events detected.'))+'</div>';
}
function detailContent(g,tab){
  if(tab==='map')return perGameSpatialHtml(g);
  if(tab==='vision'){
    const v=g.vision||{};
    const vm=g.visionMission||{};
    return detailCard('Vision / min',fmt(g.vpm,2))+detailCard('Wards placed',String(v.wardCount??g.wards?.length??0))+detailCard('Wards / 30 min',fmt(v.wardsPer30,1))+
      detailCard('Vision actions',String(vm.actions??0))+detailCard('Vision-action deaths',String(vm.deaths??0)+' · '+fmtPct(vm.deathRate))+
      detailCard('High-risk vision deaths',String(vm.highRiskDeaths??0)+' · '+fmtPct(vm.highRiskDeathRate))+detailCard('Unsupported vision deaths',String(vm.unsupportedDeaths??0))+
      detailCard('Untraded vision deaths',String(vm.untradedDeaths??0))+detailCard('Objective-setup vision deaths',String(vm.objectiveSetupDeaths??0))+
      detailCard('Offensive / defensive',String(v.offensive??0)+' / '+String(v.defensive??0))+detailCard('River wards',String(v.river??0))+detailCard('Objective setup wards',String(v.objectiveSetup??0))+detailCard('Objective setup share',fmtPct(v.objectiveSetupRate))+
      detailCard('Peer setup wards',String(g.opponentVision?.objectiveSetup??0))+detailCard('Peer setup share',fmtPct(g.opponentVision?.objectiveSetupRate))+detailCard('Setup count Δ vs peer',hasNum(v.objectiveSetupDeltaVsOpponent)?signed(v.objectiveSetupDeltaVsOpponent,0):'n/a')+detailCard('Setup share Δ vs peer',hasNum(v.objectiveSetupRateDeltaVsOpponent)?signed(v.objectiveSetupRateDeltaVsOpponent,0)+' pp':'n/a')+
      detailList((vm.events||[]).map(x=>(Number(x.time)||0).toFixed(1)+'m death · '+String(x.action||'vision action')+' '+String(x.secondsAfterAction??'?')+'s earlier · '+String(x.wardType||'ward')+(x.territory?' · '+x.territory:'')+(x.objectiveSetup?' · objective setup':'')+(x.unsupported?' · no ally within 3k':'')+(x.highRisk?' · high-risk':'')+(x.traded?' · traded':' · untraded')),'No death occurred within the defined vision-action window.')+
      detailList((g.wards||[]).slice(0,8).map(w=>(Number(w.time)||0).toFixed(1)+'m · '+(w.territory||'unknown')+' · '+(w.wardType||'ward')),'No player ward positions were available.');
  }
  if(tab==='roams'){
    const r=g.roams||{},events=r.events||[];
    return detailCard('Attempts',String(r.attempts??0))+detailCard('Successful',String(r.successes??0))+detailCard('Failed',String(r.failures??0))+
      detailList(events.map(x=>(Number(x.startMin)||0).toFixed(1)+'–'+(Number(x.endMin)||0).toFixed(1)+'m · '+(x.targetZone||'map')+' · '+(x.outcome||'neutral')+(hasNum(x.laneCostCs)?' · own lane Δ '+signed(x.laneCostCs,0)+' CS':'')+(hasNum(x.adcLaneCostCs)?' · ADC lane Δ '+signed(x.adcLaneCostCs,0)+' CS':'')),'No qualifying pre-20-minute roam departures detected.');
  }
  if(tab==='fights'){
    const f=g.fightProfile||{},events=f.events||[];
    return detailCard('Attended fight clusters',String(f.attended??0))+detailCard('First allied death',String(f.firstAllyDeaths??0)+' · '+fmtPct(f.firstAllyDeathRate))+
      detailCard('Died before contribution',String(f.diedBeforeContribution??0)+' · '+fmtPct(f.diedBeforeContributionRate))+detailCard('Fight survival',fmtPct(f.survivalRate))+
      detailCard('≥1000g unspent starts',String(f.highUnspentStarts??0)+' · '+fmtPct(f.highUnspentStartRate))+detailCard('Major-item disadvantage starts',String(f.itemDisadvantageStarts??0)+' · '+fmtPct(f.itemDisadvantageStartRate))+
      detailCard('≥600g role deficit starts',String(f.goldDeficitStarts??0)+' · '+fmtPct(f.goldDeficitStartRate))+
      detailCard('Locally outnumbered',String(f.outnumberedStarts??0)+' · '+fmtPct(f.outnumberedStartRate))+detailCard('Loss rate while outnumbered',fmtPct(f.outnumberedLossRate))+
      detailList(events.slice(0,10).map(x=>(Number(x.startMin)||0).toFixed(1)+'–'+(Number(x.endMin)||0).toFixed(1)+'m · '+String(x.kills||0)+' kills · '+(x.survived?'survived':x.firstAllyDeath?'first ally death':x.diedBeforeContribution?'died before contribution':'died after contribution')+
        (hasNum(x.currentGoldAtStart)?' · '+fmtInt(x.currentGoldAtStart)+'g unspent':'')+(hasNum(x.goldDiffAtStart)?' · role gold '+signed(x.goldDiffAtStart,0)+'g':'')+(x.itemDisadvantage?' · opponent major item first':'')),'No attended multi-kill fight clusters were detected.');
  }
  if(tab==='phases'){
    const p=g.phaseBehavior||{},phase=(key,label)=>{
      const x=p[key]||{};
      return '<div class="detail-note"><strong>'+esc(label)+'</strong><ul>'+
        '<li>'+esc(String(x.deaths??0))+' deaths · '+esc(String(x.highRiskDeaths??0))+' high-risk · '+esc(String(x.costlyDeaths??0))+' costly · '+esc(String(x.severeDeaths??0))+' severe</li>'+
        '<li>'+esc(String(x.killAssistImpacts??0))+' kill/assist impacts · '+esc(String(x.objectiveJoins??0))+' / '+esc(String(x.teamObjectives??0))+' objective joins'+(Number(x.teamObjectives||0)>0?' · '+esc(fmtPct(100*Number(x.objectiveJoins||0)/Number(x.teamObjectives)))+' presence':'')+'</li>'+
        '<li>'+esc(String(x.fightClusters??0))+' attended fight clusters · '+esc(String(x.firstAllyFightDeaths??0))+' first-allied-death events</li>'+
      '</ul></div>';
    };
    return phase('early','Early · <14:00')+phase('mid','Mid · 14:00–24:59')+phase('late','Late · ≥25:00')+
      '<div class="detail-note">Phase counts are raw evidence for this match. Aggregate rates are normalized by how many analyzed games actually reach each phase.</div>';
  }
  if(tab==='deaths'){
    const bad=g.badDeaths||[];
    const pre=g.preObjectiveDeaths||[];
    const risk=g.riskStateDeaths||{};
    return detailCard('Deaths',String(g.deaths??'n/a'))+detailCard('Flagged high-risk',String(g.badDeathCount??0))+detailCard('Deaths while ≥500g ahead',String(g.leadDeathCount??0))+detailCard('High-risk deaths while ahead',String(g.highRiskLeadDeathCount??0))+
      detailCard('Deaths while ≥500g behind',String(risk.behind??0))+detailCard('High-risk deaths while behind',String(risk.highRiskBehind??0)+' · '+(Number(risk.behind||0)>0?fmtPct(100*Number(risk.highRiskBehind||0)/Number(risk.behind)):'n/a'))+
      detailCard('Post-15 side-lane deaths',String(g.sideLaneRisk?.post15SideLaneDeaths??0))+
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
      detailList((g.sideLaneRisk?.events||[]).map(x=>(Number(x.time)||0).toFixed(1)+'m · '+String(x.zone||'side lane')+(x.isolated?' · isolated':'')+(x.neutralObjectiveSoon?' · neutral objective '+String(x.secondsBeforeNeutralObjective??'?')+'s later':'')+(x.highRisk?' · high-risk':'')+(x.traded?' · traded':' · untraded')),'No post-15 side-lane death detected.')+
      detailList((g.deathConsequences?.events||[]).filter(x=>x.costly).map(x=>(Number(x.time)||0).toFixed(1)+'m · '+(x.severe?'severe':'costly')+(hasNum(x.goldSwingAfter)?' · role gold '+signed(x.goldSwingAfter,0)+'g':'')+(hasNum(x.csSwingAfter)?' · role CS '+signed(x.csSwingAfter,0):'')+(x.enemyObjectiveAfter?' · enemy objective followed':'')+(x.traded?' · traded':' · untraded')),'No measured death crossed the consequence threshold.')+
      detailList((g.deathRecovery?.events||[]).map(x=>Number(x.firstMin).toFixed(1)+'→'+Number(x.secondMin).toFixed(1)+'m · '+String(x.gapSec)+'s'+(x.phase?' · '+x.phase:'')+(x.highRisk?' · high-risk':'')+(x.costly?' · costly':'')+(x.severe?' · severe':'')+(x.traded?' · traded':' · untraded')),'No second death occurred within four minutes of the previous death.')+
      detailList(pre.map(x=>(Number(x.time)||0).toFixed(1)+'m death → '+String(x.objectiveType||'objective')+' '+String(x.secondsBeforeObjective||'?')+'s later'),'No death was followed by an enemy objective within 75 seconds.');
  }
  if(tab==='objectives'){
    const kc=g.killConversion||{},okc=g.opponentKillConversion||{};
    return detailCard('Objective presence',fmtPct(g.objectiveJoinRate))+detailCard('Joined / team objectives',String(g.objectiveJoined??0)+' / '+String(g.objectiveTeamTotal??0))+detailCard('Early KP',fmtPct(g.earlyKp))+
      detailCard('First impact',hasNum(g.impactTimeMin)?fmt(g.impactTimeMin,1)+' min · '+String(g.impactType||'event'):'n/a')+detailCard('Objective-context death %',fmtPct(g.objectiveDeathPct))+detailCard('Pre-objective conversion deaths',String(g.preObjectiveDeathCount??0))+
      detailCard('Kill-window conversion',String(kc.converted??0)+' / '+String(kc.windows??0)+' · '+fmtPct(kc.rate))+detailCard('Opposing-role conversion',String(okc.converted??0)+' / '+String(okc.windows??0)+' · '+fmtPct(okc.rate))+
      detailCard('Neutral objectives joined',String(g.objectiveReadiness?.joined??0)+' / '+String(g.objectiveReadiness?.neutralTeamObjectives??0))+
      detailCard('Prior-frame setup joins',String(g.objectiveReadiness?.earlySetupJoins??0)+' · '+fmtPct(g.objectiveReadiness?.earlySetupJoinRate))+
      detailCard('Event-frame-only joins',String(g.objectiveReadiness?.eventFrameOnlyJoins??0))+detailCard('Objective absences',String(g.objectiveReadiness?.absent??0))+
      detailCard('Late-reset objective misses',String(g.objectiveReadiness?.lateResetMisses??0))+detailCard('Fresh-purchase objective joins',String(g.objectiveReadiness?.freshPurchaseJoins??0))+detailCard('Tracked objective events',String(g.objectives?.length||0))+
      detailList((kc.events||[]).map(x=>(Number(x.startMin)||0).toFixed(1)+'–'+(Number(x.endMin)||0).toFixed(1)+'m · '+String(x.kills||0)+' involved kill(s) · '+(x.converted?('converted to '+String(x.objectiveType||'objective')+' in '+String(x.secondsAfter??'?')+'s'):'no objective/structure within 75s')),'No player-involved kill-conversion windows were available.')+
      detailList((g.objectiveReadiness?.events||[]).map(x=>(Number(x.time)||0).toFixed(1)+'m · '+String(x.objectiveType||'neutral objective')+' · '+(x.earlySetup?('prior-frame setup'+(hasNum(x.setupLeadSec)?' ~'+fmtInt(x.setupLeadSec)+'s lead':'')):x.eventFrameOnlyJoin?'event-frame-only join':x.present?'present':'absent')+(hasNum(x.secondsSinceShop)?' · shopped '+String(x.secondsSinceShop)+'s before':'')+(x.recentDeath?' · recent death':x.lateResetMiss?' · late reset miss':x.freshPurchaseJoin?' · fresh purchase + joined':'')),'No neutral-objective readiness events were available.')+
      '<div class="detail-note">Conversion is team context: it asks whether player-involved kills are followed by tracked objectives/structures within 75 seconds. It does not claim the player alone caused or prevented the conversion.</div>';
  }
  if(tab==='resets'){
    const mine=g.firstMajorItem,opp=g.opponentFirstMajorItem,shops=g.shopVisits||[],greedy=g.greedyStayWindows||[],spike=g.itemSpikeWindow||{},firstReset=g.firstResetSequence||null,ready=g.majorItemReadiness||null,oppReady=g.opponentMajorItemReadiness||null;
    return detailCard('First reset / shop',firstReset?(fmt(firstReset.time,1)+'m · spent '+fmtInt(firstReset.spent)+'g'):'n/a')+
      detailCard('First reset vs peer',firstReset&&hasNum(firstReset.timingDeltaVsOpponent)?signed(firstReset.timingDeltaVsOpponent,1)+' min':'n/a')+
      detailCard('Post-reset role-gold swing',firstReset&&hasNum(firstReset.goldSwingAfter)?signed(firstReset.goldSwingAfter,0)+'g':'n/a')+
      detailCard('Post-reset role-CS swing',firstReset&&hasNum(firstReset.csSwingAfter)?signed(firstReset.csSwingAfter,1)+' CS':'n/a')+
      detailCard('First-reset outcome',!firstReset?'n/a':firstReset.deathInWindow?'measurement contaminated by death':firstReset.economyLoss?'economy loss':firstReset.economyGain?'economy gain':firstReset.measured?'neutral / mixed':'unmeasured')+
      detailCard('First major item',mine?(mine.name+' · '+fmt(mine.time,1)+'m'):'n/a')+
      detailCard('Recipe components ready',ready&&hasNum(ready.ingredientsReadyMin)?fmt(ready.ingredientsReadyMin,1)+'m':'n/a')+
      detailCard('First major affordable',ready&&ready.eligible?(fmt(ready.affordableMin,1)+'m · '+fmtInt(ready.combineCost)+'g combine'):(ready?.reason?'not measurable · '+readinessReason(ready.reason):'n/a'))+
      detailCard('Affordable → purchased',ready&&ready.eligible?(fmt(ready.delayMin,1)+' min · '+(ready.delayed?'delayed':'prompt')):'n/a')+
      detailCard('Opponent major item',opp?(opp.name+' · '+fmt(opp.time,1)+'m'):'n/a')+
      detailCard('Opponent affordability delay',oppReady&&oppReady.eligible?fmt(oppReady.delayMin,1)+' min':'n/a')+
      detailCard('Readiness delay vs peer',ready&&hasNum(ready.delayDeltaVsOpponent)?signed(ready.delayDeltaVsOpponent,1)+' min':'n/a')+
      detailCard('Timing vs opponent',hasNum(g.itemSpikeDeltaVsOpponent)?signed(g.itemSpikeDeltaVsOpponent,1)+' min':'n/a')+
      detailCard('Item-spike window',spike.eligible?(fmtInt(spike.leadSec)+'s advantage'):'No ≥45s item window')+
      detailCard('Spike-window impact',spike.eligible?(String(spike.totalImpacts||0)+' impact(s) · '+(spike.used?'used':'unused')):'n/a')+
      detailCard('Died before spike impact',spike.eligible?(spike.diedBeforeImpact?'yes':'no'):'n/a')+
      detailCard('Detected shop visits',String(shops.length))+detailCard('Greedy-stay windows',String(greedy.length))+detailCard('Overstay deaths',String(g.overstayCount??0))+
      detailList(firstReset?[('First shop '+fmt(firstReset.time,1)+'m · spent '+fmtInt(firstReset.spent)+'g'+(firstReset.items?.length?' · '+firstReset.items.map(x=>x.name||x.id||'item').join(', '):'')+
        (hasNum(firstReset.goldDiffBefore)?' · role gold '+signed(firstReset.goldDiffBefore,0)+'g before':'')+(hasNum(firstReset.goldDiffAfter)?' → '+signed(firstReset.goldDiffAfter,0)+'g after':'')+
        (hasNum(firstReset.csDiffBefore)?' · role CS '+signed(firstReset.csDiffBefore,0)+' before':'')+(hasNum(firstReset.csDiffAfter)?' → '+signed(firstReset.csDiffAfter,0)+' after':'')+
        (firstReset.deathInWindow?' · death in measurement window':firstReset.economyLoss?' · economy loss':firstReset.economyGain?' · economy gain':''))]:[],'No measurable first-reset sequence was available.')+
      detailList((spike.events||[]).map(x=>fmt(x.time,1)+'m · '+(x.type==='kill_or_assist'?'kill/assist impact':'objective impact'+(x.objectiveType?' · '+x.objectiveType:''))),'No tracked impact occurred inside the measurable first-major-item advantage window.')+
      detailList(greedy.map(x=>(Number(x.startMin)||0).toFixed(1)+'m · '+fmtInt(x.currentGold)+'g held · next shop '+(Number(x.nextShopMin)||0).toFixed(1)+'m ('+fmt(x.delayMin,1)+'m delay)'),'No repeated high-gold stay window detected.')+
      '<div class="detail-note">First-major affordability is recipe-aware: it requires the completed item’s direct components to be observed and a supported timeline frame with enough current gold for the remaining combine cost. The purchase event confirms the shop completion; it is not an exact recall-channel timestamp.</div>';
  }
  const peer=g.peer||null,earlyLead=g.earlyLeadWindow||{};
  return detailCard('Gold diff @10',signed(g.goldDiff10,0))+detailCard('Gold diff @15',signed(g.goldDiff15,0))+detailCard('Gold diff @25',signed(g.goldDiff25,0))+
    detailCard('Peak pre-15 role lead',earlyLead.eligible?(signed(earlyLead.peakGoldDiff,0)+'g @ '+fmt(earlyLead.peakMin,1)+'m'):'No ≥500g measured peak')+
    detailCard('Peak → 15 gold swing',earlyLead.eligible?(signed(earlyLead.goldSwingTo15,0)+'g · '+(earlyLead.giveback?'give-back':earlyLead.preserved?'preserved':'partial erosion')):'n/a')+
    detailCard('Deaths after early peak',earlyLead.eligible?(String(earlyLead.deathsAfterPeak??0)+' · '+String(earlyLead.highRiskDeathsAfterPeak??0)+' high-risk'):'n/a')+
    detailCard('CS diff @10',signed(g.csDiff10,0))+detailCard('CS diff @15',signed(g.csDiff15,0))+detailCard('CS diff @25',signed(g.csDiff25,0))+
    detailCard('XP diff @10',signed(g.xpDiff10,0))+detailCard('XP diff @15',signed(g.xpDiff15,0))+detailCard('XP diff @25',signed(g.xpDiff25,0))+
    detailCard('Opponent',peer?(peer.champion||'Same-role peer'):'n/a')+detailCard('Opponent rank',peer?rankText(peer.rank):'n/a')+
    detailCard('Pre-14 clean duel',String(g.laneDuel?.pre14SoloKillsVsRole??0)+' solo kills / '+String(g.laneDuel?.pre14SoloDeathsToRole??0)+' solo deaths')+
    detailCard('Plate credits ≤20m',String(g.structurePressure?.first20PlayerPlateCredits??g.structurePressure?.pre14PlayerPlates??0)+' vs '+String(g.structurePressure?.first20OpponentPlateCredits??g.structurePressure?.pre14OpponentPlates??0)+' peer')+
    detailCard('Plate credits · full match',String(g.structurePressure?.allGamePlayerPlateCredits??g.structurePressure?.pre14PlayerPlates??0)+' vs '+String(g.structurePressure?.allGameOpponentPlateCredits??g.structurePressure?.pre14OpponentPlates??0)+' peer')+
    detailCard('Solo-kill structure conversion',String(g.structurePressure?.soloKillStructureConversions??0)+' / '+String(g.structurePressure?.soloKillWindows??0)+' · '+fmtPct(g.structurePressure?.soloKillStructureConversionRate))+
    detailCard('All-game clean duel',String(g.laneDuel?.soloKillsVsRole??0)+' / '+String(g.laneDuel?.soloDeathsToRole??0))+
    detailCard('Pre-14 home-lane deaths',String(g.lanePressure?.pre14HomeLaneDeaths??0))+
    detailCard('Outside-pressure lane deaths',String(g.lanePressure?.pre14OutsidePressureDeaths??0)+' · '+fmtPct(g.lanePressure?.outsidePressureShare))+
    detailCard('First impact',hasNum(g.impactTimeMin)?fmt(g.impactTimeMin,1)+'m':'n/a')+detailCard('Opponent first impact',hasNum(g.opponentImpactTimeMin)?fmt(g.opponentImpactTimeMin,1)+'m':'n/a')+detailCard('Impact timing vs peer',hasNum(g.impactDeltaVsOpponent)?signed(g.impactDeltaVsOpponent,1)+' min':'n/a')+
    detailCard('DPM vs same-role opponent',peer?signed(peer.dpmDelta,0):'n/a')+detailCard('CS/min vs opponent',peer?signed(peer.csMinDelta,2):'n/a')+detailCard('Team damage rank',hasNum(g.damageRank)?'#'+g.damageRank+' of 5':'n/a')+
    detailCard('Damage share',fmtPct(g.damageShare))+detailCard('Gold share',fmtPct(g.goldShare))+detailCard('Damage − gold share',hasNum(g.damageShare)&&hasNum(g.goldShare)?signed(Number(g.damageShare)-Number(g.goldShare),1)+' pp':'n/a')+
    detailCard('Session game #',g.sessionContext?.sessionGameNumber?String(g.sessionContext.sessionGameNumber):'n/a')+
    detailCard('Gap after previous game',hasNum(g.sessionContext?.gapAfterPreviousMin)?fmt(g.sessionContext.gapAfterPreviousMin,0)+' min':'n/a')+
    detailCard('Previous result',g.sessionContext?.previousWin===true?'WIN':g.sessionContext?.previousWin===false?'LOSS':'n/a')+
    detailList((g.structurePressure?.events||[]).map(x=>(Number(x.killTime)||0).toFixed(1)+'m solo kill · '+(x.converted?('structure converted'+(hasNum(x.secondsAfter)?' '+fmtInt(x.secondsAfter)+'s later':'')):'no credited plate/turret within 90s')),'No pre-14 clean solo-kill structure window detected.')+
    '<div class="detail-note">2026 turret plates are permanent on every non-Nexus turret. The ≤20m plate row is a fixed coaching slice, not a plate-expiry rule; full-match credits are shown separately.</div>'+
    detailList((g.laneDuel?.events||[]).map(x=>(Number(x.time)||0).toFixed(1)+'m · '+(x.result==='solo_kill'?'solo kill on role opponent':'solo death to role opponent')+(x.pre14?' · pre-14':'')+(hasNum(x.goldDiffAtEvent)?' · role gold '+signed(x.goldDiffAtEvent,0)+'g at event':'')+(hasNum(x.goldSwingTo15)?' · '+signed(x.goldSwingTo15,0)+'g swing to 15':'')+(hasNum(x.csSwingTo15)?' · '+signed(x.csSwingTo15,0)+' CS swing to 15':'')+(x.result==='solo_kill'&&x.pre14&&hasNum(x.convertedBy15)?(x.convertedBy15?' · converted':' · not converted'):'')+(x.result==='solo_kill'&&x.pre14&&hasNum(x.nextShopDelaySec)?' · next shop '+fmtInt(x.nextShopDelaySec)+'s':'')+(x.result==='solo_kill'&&x.pre14&&x.diedBeforeNextShop?' · died before shop':'')),'No clean direct-role solo duel event detected.')+
    detailList((g.lanePressure?.events||[]).filter(x=>x.outsidePressure).map(x=>(Number(x.time)||0).toFixed(1)+'m · outside pressure'+((x.outsideRoles||[]).length?' from '+x.outsideRoles.join(', '):'')+' · '+String(x.attackerCount||'?')+' attacker(s)'),'No pre-14 outside-pressure lane death detected.')+
    '<div class="detail-note">Clean direct-role duel events require the player and actual same-role opponent to be killer/victim with no assisting participants. This separates direct matchup outcomes from outside intervention.</div>';
}
function bindDetailTabs(container,g,index){
  container.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click',(ev)=>{
    ev.stopPropagation();state.activeDetailTab=btn.dataset.tab;
    container.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b===btn));
    container.querySelector('[data-detail-content]').innerHTML=detailContent(g,state.activeDetailTab);bindMapFallbacks(container);
  }));
}

function chartSvg(points,unit){
  const vals=points.map(p=>Number(p.value)).filter(Number.isFinite);if(vals.length<3)return null;
  const min=Math.min(...vals),max=Math.max(...vals),span=Math.max(1,max-min),w=560,h=190,pad=26;
  const valid=points.map((p,i)=>({i,v:Number(p.value)})).filter(x=>Number.isFinite(x.v));
  const coords=valid.map((x,n)=>({x:pad+(n/Math.max(1,valid.length-1))*(w-pad*2),y:h-pad-((x.v-min)/span)*(h-pad*2),v:x.v}));
  const path=coords.map((c,i)=>(i?'L':'M')+c.x.toFixed(1)+' '+c.y.toFixed(1)).join(' ');
  const dots=coords.map(c=>'<circle cx="'+c.x+'" cy="'+c.y+'" r="3.5"><title>'+esc(formatChartValue(c.v,unit))+'</title></circle>').join('');
  return '<svg class="chart-svg" viewBox="0 0 '+w+' '+h+'" role="img"><line x1="'+pad+'" y1="'+(h-pad)+'" x2="'+(w-pad)+'" y2="'+(h-pad)+'" stroke="#29404f"/><line x1="'+pad+'" y1="'+pad+'" x2="'+pad+'" y2="'+(h-pad)+'" stroke="#29404f"/><path d="'+path+'" fill="none" stroke="#c79b3b" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/><g fill="#0ac8b9">'+dots+'</g><text x="'+pad+'" y="16" fill="#8294a0" font-size="10">'+esc(formatChartValue(max,unit))+'</text><text x="'+pad+'" y="'+(h-5)+'" fill="#8294a0" font-size="10">'+esc(formatChartValue(min,unit))+'</text></svg>';
}
function formatChartValue(v,unit){if(unit==='%')return Math.round(v)+'%';if(unit==='int')return Math.round(v).toLocaleString();if(unit==='signed')return signed(v,0);return Number(v).toFixed(2);}
function renderCharts(r){
  const specs=[
    {key:'csMin',title:'CS/min across the sample',q:'How has farming rate changed?',unit:'num'},
    {key:'kp',title:'Kill participation',q:'How has fight involvement changed?',unit:'%'},
    {key:'dpm',title:'Damage per minute',q:'How has champion damage output varied?',unit:'int'},
    {key:'goldDiff15',title:'Gold difference @15',q:'How has lane/economy position changed?',unit:'signed'}
  ];
  const hidden=[];
  $('chartGrid').innerHTML=specs.map(s=>{
    const points=Array.isArray(r.charts?.[s.key])?r.charts[s.key]:(r.games||[]).map(g=>({matchId:g.matchId,value:g[s.key]}));
    const svg=chartSvg(points,s.unit);
    if(!svg)hidden.push(s.title);
    return '<article class="chart-card"><h3>'+esc(s.title)+'</h3><p>'+esc(s.q)+'</p>'+(svg||'<div class="chart-empty">Insufficient valid data</div>')+'</article>';
  }).join('');
  const all=[...(r.hiddenCharts||[]),...hidden];
  $('hiddenCharts').hidden=!all.length;$('hiddenCharts').textContent=all.length?'Unavailable / low-sample charts: '+[...new Set(all)].join(', '):'';
}
function metric(label,value,pending){
  return '<div class="metric-row"><span>'+esc(label)+'</span><strong class="'+(pending?'pending':'')+'">'+esc(value)+'</strong></div>';
}
function renderSpatial(r){
  const games=Array.isArray(r.games)?r.games:[];
  const deathPoints=[],wardPoints=[];
  for(const g of games){
    if(Number(g.mapId)!==11)continue;
    for(const x of (g.badDeaths||[]))if(hasNum(x.x)&&hasNum(x.y))deathPoints.push({...x,highRisk:true});
    for(const w of (g.wards||[]))if(hasNum(w.x)&&hasNum(w.y))wardPoints.push(w);
  }
  const image=map11Image(),fallback='https://ddragon.leagueoflegends.com/cdn/6.8.1/img/map/map11.png';
  const mapHtml=(points,kind,empty)=>points.length
    ?'<div class="map-stage"><img src="'+esc(image)+'" data-map-fallback="'+esc(fallback)+'" alt="Summoner’s Rift minimap"><svg viewBox="0 0 512 512" preserveAspectRatio="none" aria-label="'+esc(kind==='death'?'High-risk death positions':'Ward positions')+'">'+points.map(p=>mapPointSvg(p,kind)).join('')+'</svg></div>'
    :'<div class="spatial-empty">'+esc(empty)+'</div>';
  $('deathMap').innerHTML=mapHtml(deathPoints,'death','No high-risk death coordinates are available in this sample.');
  $('wardMap').innerHTML=mapHtml(wardPoints,'ward','No ward coordinates are available in this sample.');
  bindMapFallbacks($('spatialReview')||document);
  const leadDeaths=deathPoints.filter(x=>hasNum(x.goldDiffAtDeath)&&Number(x.goldDiffAtDeath)>=500).length;
  const offensive=wardPoints.filter(x=>x.territory==='offensive').length,river=wardPoints.filter(x=>x.territory==='river').length,defensive=wardPoints.filter(x=>x.territory==='defensive').length,setup=wardPoints.filter(x=>x.objectiveSetup).length,offPct=wardPoints.length?Math.round(offensive/wardPoints.length*100):0;
  $('deathMapMeta').textContent=deathPoints.length+' high-risk deaths mapped'+(leadDeaths?' · '+leadDeaths+' while ≥500g ahead vs role':'');
  $('wardMapMeta').textContent=wardPoints.length+' wards across '+games.length+' games · '+offPct+'% offensive · '+river+' river · '+defensive+' defensive · '+setup+' objective setup';
  $('spatialProjectionNote').textContent='Summoner’s Rift world projection: x −120→14870, y −120→14980, with Y inverted. Only mapId 11 coordinates are plotted.';
}
function renderAdvanced(r){
  const a=r.advanced||{},roam=a.roams||{},recall=a.recalls||{},itemSpike=a.itemSpike||{};
  const rows=[
    ['Objective presence',fmtPct(a.objectivePresence)],
    ['Objective diagnosis',objectiveDiagnosisLabel(r.behaviorSummary?.objectiveDiagnosis?.primaryCause)],
    ['Early KP',fmtPct(a.earlyKP)],
    ['Pre-14 role solo kills / deaths',String(r.behaviorSummary?.pre14RoleSoloKills??0)+' / '+String(r.behaviorSummary?.pre14RoleSoloDeaths??0)],
    ['Plate credits ≤20m',String(r.behaviorSummary?.first20PlayerPlateCredits??r.behaviorSummary?.pre14PlayerPlates??0)+' / '+String(r.behaviorSummary?.first20OpponentPlateCredits??r.behaviorSummary?.pre14OpponentPlates??0)+' vs role peer'],
    ['Plate credits · full match',String(r.behaviorSummary?.allGamePlayerPlateCredits??r.behaviorSummary?.pre14PlayerPlates??0)+' / '+String(r.behaviorSummary?.allGameOpponentPlateCredits??r.behaviorSummary?.pre14OpponentPlates??0)+' vs role peer'],
    ['Clean solo-kill lane conversion',String(r.behaviorSummary?.soloKillConvertedEvents??0)+' / '+String(r.behaviorSummary?.soloKillConversionEvents??0)+' · '+fmtPct(r.behaviorSummary?.soloKillConversionRate)],
    ['Avg gold swing after clean solo kill',hasNum(r.behaviorSummary?.avgSoloKillGoldSwingTo15)?signed(r.behaviorSummary.avgSoloKillGoldSwingTo15,0)+'g to 15':'n/a'],
    ['Avg CS swing after clean solo kill',hasNum(r.behaviorSummary?.avgSoloKillCsSwingTo15)?signed(r.behaviorSummary.avgSoloKillCsSwingTo15,1)+' to 15':'n/a'],
    ['Solo-kill deaths before next shop',String(r.behaviorSummary?.soloKillDeathsBeforeShop??0)+' / '+String(r.behaviorSummary?.soloKillResetEvents??0)+' · '+fmtPct(r.behaviorSummary?.soloKillDeathsBeforeShopRate)],
    ['Avg next-shop delay after solo kill',hasNum(r.behaviorSummary?.avgSoloKillNextShopDelaySec)?fmtInt(r.behaviorSummary.avgSoloKillNextShopDelaySec)+'s':'n/a'],
    ['Pre-14 TOP/MID home-lane deaths',String(r.behaviorSummary?.pre14HomeLaneDeaths??0)],
    ['Outside-pressure early lane deaths',String(r.behaviorSummary?.pre14OutsidePressureDeaths??0)],
    ['Outside-pressure share of early lane deaths',fmtPct(r.behaviorSummary?.pre14OutsidePressureShare)],
    ['All-game role solo kills / deaths',String(r.behaviorSummary?.roleSoloKills??0)+' / '+String(r.behaviorSummary?.roleSoloDeaths??0)],
    ['≥500g pre-15 lead opportunities',String(r.behaviorSummary?.earlyLeadGames??0)],
    ['Early-lead give-backs',String(r.behaviorSummary?.earlyLeadGivebackGames??0)+' / '+String(r.behaviorSummary?.earlyLeadGames??0)+' · '+fmtPct(r.behaviorSummary?.earlyLeadGivebackRate)],
    ['Avg peak pre-15 role lead',hasNum(r.behaviorSummary?.avgEarlyLeadPeakGold)?signed(r.behaviorSummary.avgEarlyLeadPeakGold,0)+'g':'n/a'],
    ['Avg peak → 15 role-gold swing',hasNum(r.behaviorSummary?.avgEarlyLeadGoldSwingTo15)?signed(r.behaviorSummary.avgEarlyLeadGoldSwingTo15,0)+'g':'n/a'],
    ['Deaths during early-lead give-backs',String(r.behaviorSummary?.earlyLeadGivebackDeaths??0)+' · '+String(r.behaviorSummary?.earlyLeadGivebackHighRiskDeaths??0)+' high-risk'],
    ['First impact timing',hasNum(a.firstImpact?.avgDeltaVsOpponentMin)?signed(a.firstImpact.avgDeltaVsOpponentMin,1)+' min vs peer':'n/a'],
    ['Objective-context death %',fmtPct(a.objectiveDeathPct)],
    ['Death trade rate',fmtPct(r.behaviorSummary?.deathTradeRate)],
    ['High-risk untraded deaths',String(r.behaviorSummary?.highRiskUntradedDeaths??0)+' · '+fmt(r.behaviorSummary?.highRiskUntradedPerGame,1)+'/game'],
    ['Early-phase high-risk deaths',String(r.behaviorSummary?.phaseRisk?.early?.highRiskDeaths??0)+' · '+fmt(r.behaviorSummary?.phaseRisk?.early?.highRiskDeathsPerGame,2)+'/game'],
    ['Mid-phase high-risk deaths',String(r.behaviorSummary?.phaseRisk?.mid?.highRiskDeaths??0)+' · '+fmt(r.behaviorSummary?.phaseRisk?.mid?.highRiskDeathsPerGame,2)+'/game'],
    ['Late-phase high-risk deaths',String(r.behaviorSummary?.phaseRisk?.late?.highRiskDeaths??0)+' · '+fmt(r.behaviorSummary?.phaseRisk?.late?.highRiskDeathsPerGame,2)+'/game'],
    ['Early / mid / late costly deaths',String(r.behaviorSummary?.phaseRisk?.early?.costlyDeaths??0)+' / '+String(r.behaviorSummary?.phaseRisk?.mid?.costlyDeaths??0)+' / '+String(r.behaviorSummary?.phaseRisk?.late?.costlyDeaths??0)],
    ['Mid-routing comparable games',String(r.behaviorSummary?.midRouting?.games??0)],
    ['Mid-routing CS swing 15→25',hasNum(r.behaviorSummary?.midRouting?.avgCsSwing15to25)?signed(r.behaviorSummary.midRouting.avgCsSwing15to25,1)+' CS':'n/a'],
    ['Mid-routing objective presence',fmtPct(r.behaviorSummary?.midRouting?.avgObjectiveJoinRate)],
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
    ['Repeat-death rate vs peer',fmtPct(r.behaviorSummary?.repeatDeathRate)+' / '+fmtPct(r.behaviorSummary?.opponentRepeatDeathRate)+' · Δ '+(hasNum(r.behaviorSummary?.repeatDeathRateDelta)?signed(r.behaviorSummary.repeatDeathRateDelta,0)+' pp':'n/a')],
    ['Avg post-death role-gold swing',hasNum(r.behaviorSummary?.avgGoldSwingAfterDeath)?signed(r.behaviorSummary.avgGoldSwingAfterDeath,0)+'g':'n/a'],
    ['Avg post-death role-CS swing',hasNum(r.behaviorSummary?.avgCsSwingAfterDeath)?signed(r.behaviorSummary.avgCsSwingAfterDeath,1):'n/a'],
    ['Deaths while ≥500g behind',String(r.behaviorSummary?.behindStateDeaths??0)],
    ['High-risk while behind',String(r.behaviorSummary?.highRiskBehindDeaths??0)+' · '+fmtPct(r.behaviorSummary?.highRiskBehindDeathRate)],
    ['Enemy objective after death',String(a.preObjectiveDeaths??0)+' deaths · '+fmtPct(a.preObjectiveDeathPct)],
    ['Post-15 side-lane deaths',String(r.behaviorSummary?.post15SideLaneDeaths??0)],
    ['Isolated side-lane deaths',String(r.behaviorSummary?.isolatedSideLaneDeaths??0)+' · '+fmtPct(r.behaviorSummary?.isolatedSideLaneDeathRate)],
    ['Pre-objective side-lane deaths',String(r.behaviorSummary?.preNeutralObjectiveSideLaneDeaths??0)+' · '+fmt(r.behaviorSummary?.preNeutralObjectiveSideLaneDeathsPerGame,2)+'/game'],
    ['Post-impact deaths',String(r.behaviorSummary?.postImpactDeaths??0)+' / '+String(r.behaviorSummary?.playerImpactEvents??0)+' · '+fmtPct(r.behaviorSummary?.postImpactDeathRate)],
    ['High-risk untraded post-impact',String(r.behaviorSummary?.highRiskUntradedPostImpactDeaths??0)+' · '+fmt(r.behaviorSummary?.highRiskUntradedPostImpactPerGame,2)+'/game'],
    ['Top risky-death area',r.behaviorSummary?.topBadDeathZone?String(r.behaviorSummary.topBadDeathZone)+' · '+fmtPct(r.behaviorSummary.topBadDeathZonePct):'n/a'],
    ['Roam attempts / success',String(roam.attempts??0)+' / '+fmtPct(roam.successRate)],
    ['Roam lane cost',hasNum(roam.avgLaneCostCs)?signed(roam.avgLaneCostCs,1)+' CS avg · '+String(roam.emptyCostlyRoams??0)+' empty costly':'n/a'],
    ['First-reset measured / clean games',String(r.behaviorSummary?.firstResetMeasuredGames??0)+' / '+String(r.behaviorSummary?.firstResetCleanGames??0)],
    ['First-reset loss / gain games',String(r.behaviorSummary?.firstResetLossGames??0)+' / '+String(r.behaviorSummary?.firstResetGainGames??0)],
    ['First-reset loss rate',fmtPct(r.behaviorSummary?.firstResetLossRate)],
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
    ['Fight samples',String(r.behaviorSummary?.fightSamples??0)],
    ['First allied death in fights',fmtPct(r.behaviorSummary?.firstAllyFightDeathRate)],
    ['Died before contribution',fmtPct(r.behaviorSummary?.preContributionFightDeathRate)],
    ['Fight survival',fmtPct(r.behaviorSummary?.fightSurvivalRate)],
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
    ['Post-kill conversion',String(r.behaviorSummary?.killConversions??0)+' / '+String(r.behaviorSummary?.killConversionWindows??0)+' · '+fmtPct(r.behaviorSummary?.killConversionRate)],
    ['Opposing-role post-kill conversion',String(r.behaviorSummary?.opponentKillConversions??0)+' / '+String(r.behaviorSummary?.opponentKillConversionWindows??0)+' · '+fmtPct(r.behaviorSummary?.opponentKillConversionRate)],
    ['Prior-frame objective setup',String(r.behaviorSummary?.earlySetupObjectiveJoins??0)+' / '+String(r.behaviorSummary?.neutralObjectiveJoins??0)+' joins · '+fmtPct(r.behaviorSummary?.earlySetupObjectiveJoinRate)],
    ['Event-frame-only objective joins',String(r.behaviorSummary?.eventFrameOnlyObjectiveJoins??0)],
    ['Objective setup coverage',fmtPct(r.behaviorSummary?.earlySetupObjectiveCoverageRate)],
    ['Late-reset neutral-objective misses',String(r.behaviorSummary?.lateResetObjectiveMisses??0)+' / '+String(r.behaviorSummary?.neutralObjectiveEvents??0)+' · '+fmtPct(r.behaviorSummary?.lateResetObjectiveMissRate)],
    ['Fresh-purchase objective joins',String(r.behaviorSummary?.freshPurchaseObjectiveJoins??0)+' · '+fmtPct(r.behaviorSummary?.freshPurchaseObjectiveJoinRate)]
  ];
  $('advancedMetrics').innerHTML=rows.map(([l,v])=>metric(l,v,String(v).includes('not recovered')||v==='n/a')).join('');
  const p=r.peerComparison||{},conv=r.conversion||{},wl=r.winLoss||{},trend=r.recentTrend||{},session=r.sessionBehavior||{},base=r.coachingLifetime||null,s=r.coachingSummary||r.summary||{},rank=r.profile?.rank||null,rankBands=p.rankBands||{};
  const rankBandLine=(x)=>x&&Number(x.games)?String(x.games)+' games · @15 '+signed(x.avgGoldDiff15,0)+'g · DPM '+signed(x.avgDpmDelta,0):'n/a';
  const peerRows=[
    metric('Peer definition',p.definition||'Same-role opponent in each match',false),
    metric('Comparable peer games',String(p.sameRoleGames??0),false),
    metric('Ranked peer games',String(p.rankedPeerGames??0),false),
    metric('Higher-ranked peer games',String(p.higherRankPeerGames??0),false),
    metric('Same-rank peer games',String(p.sameRankPeerGames??0),false),
    metric('Lower-ranked peer games',String(p.lowerRankPeerGames??0),false),
    metric('Higher-rank band',rankBandLine(rankBands.higher),!(rankBands.higher&&Number(rankBands.higher.games))),
    metric('Same-rank band',rankBandLine(rankBands.same),!(rankBands.same&&Number(rankBands.same.games))),
    metric('Lower-rank band',rankBandLine(rankBands.lower),!(rankBands.lower&&Number(rankBands.lower.games))),
    metric('Gold @15 vs peer',hasNum(p.avgGoldDiff15)?signed(p.avgGoldDiff15,0)+'g':'n/a',!hasNum(p.avgGoldDiff15)),
    metric('Beat peer on gold @15',fmtPct(p.gold15OutperformPct),!hasNum(p.gold15OutperformPct)),
    metric('CS/min vs peer',hasNum(p.avgCsMinDelta)?signed(p.avgCsMinDelta,2):'n/a',!hasNum(p.avgCsMinDelta)),
    metric('Beat peer on CS/min',fmtPct(p.csMinOutperformPct),!hasNum(p.csMinOutperformPct)),
    metric('DPM vs peer',hasNum(p.avgDpmDelta)?signed(p.avgDpmDelta,0):'n/a',!hasNum(p.avgDpmDelta)),
    metric('Beat peer on DPM',fmtPct(p.dpmOutperformPct),!hasNum(p.dpmOutperformPct)),
    metric('Vision/min vs peer',hasNum(p.avgVpmDelta)?signed(p.avgVpmDelta,2):'n/a',!hasNum(p.avgVpmDelta)),
    metric('Beat peer on vision/min',fmtPct(p.vpmOutperformPct),!hasNum(p.vpmOutperformPct)),
    metric('Objective-setup ward games',String(p.visionSetupGames??0),false),
    metric('Objective-setup wards vs peer',hasNum(p.avgObjectiveSetupDelta)?signed(p.avgObjectiveSetupDelta,1):'n/a',!hasNum(p.avgObjectiveSetupDelta)),
    metric('Beat peer on setup wards',fmtPct(p.objectiveSetupOutperformPct),!hasNum(p.objectiveSetupOutperformPct)),
    metric('Objective-setup ward share',hasNum(p.objectiveSetupWardRate)?fmtPct(p.objectiveSetupWardRate):'n/a',!hasNum(p.objectiveSetupWardRate)),
    metric('Peer objective-setup share',hasNum(p.opponentObjectiveSetupWardRate)?fmtPct(p.opponentObjectiveSetupWardRate):'n/a',!hasNum(p.opponentObjectiveSetupWardRate)),
    metric('Objective-setup share Δ',hasNum(p.objectiveSetupWardRateDelta)?signed(p.objectiveSetupWardRateDelta,0)+' pp':'n/a',!hasNum(p.objectiveSetupWardRateDelta)),
    metric('Repeat-death rate',fmtPct(p.repeatDeathRate),!hasNum(p.repeatDeathRate)),
    metric('Peer repeat-death rate',fmtPct(p.opponentRepeatDeathRate),!hasNum(p.opponentRepeatDeathRate)),
    metric('Repeat-death rate delta',hasNum(p.repeatDeathRateDelta)?signed(p.repeatDeathRateDelta,0)+' pp':'n/a',!hasNum(p.repeatDeathRateDelta)),
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
    metric('Post-kill conversion Δ',hasNum(r.behaviorSummary?.killConversionDelta)?signed(r.behaviorSummary.killConversionDelta,0)+' pp':'n/a',!hasNum(r.behaviorSummary?.killConversionDelta))
  ];
  const conversionRows=[
    metric('Wins when ≥250g ahead @15',hasNum(conv.laneLeadWinRate)?fmtPct(conv.laneLeadWinRate)+' · '+String(conv.laneLeadGames||0)+' games':'n/a',!hasNum(conv.laneLeadWinRate)),
    metric('Wins when ≥250g behind @15',hasNum(conv.laneDeficitWinRate)?fmtPct(conv.laneDeficitWinRate)+' · '+String(conv.laneDeficitGames||0)+' games':'n/a',!hasNum(conv.laneDeficitWinRate)),
    metric('Wins when ≥500g ahead @25',hasNum(conv.lead25WinRate)?fmtPct(conv.lead25WinRate)+' · '+String(conv.lead25Games||0)+' games':'n/a',!hasNum(conv.lead25WinRate)),
    metric('Wins when ≥500g behind @25',hasNum(conv.deficit25WinRate)?fmtPct(conv.deficit25WinRate)+' · '+String(conv.deficit25Games||0)+' games':'n/a',!hasNum(conv.deficit25WinRate))
  ];
  const wlRow=(label,obj,formatter)=>metric(label,obj&&hasNum(obj.wins)&&hasNum(obj.losses)?formatter(obj.wins)+' / '+formatter(obj.losses):'n/a',!(obj&&hasNum(obj.wins)&&hasNum(obj.losses)));
  const winLossRows=[
    wlRow('Gold @15 · wins / losses',wl.goldDiff15,v=>signed(v,0)+'g'),
    wlRow('High-risk deaths · wins / losses',wl.badDeaths,v=>fmt(v,1)),
    wlRow('Early KP · wins / losses',wl.earlyKp,v=>fmtPct(v)),
    wlRow('Objective presence · wins / losses',wl.objectiveJoin,v=>fmtPct(v)),
    wlRow('Greedy stays · wins / losses',wl.greedyStays,v=>fmt(v,1))
  ];
  const trendRow=(label,obj,formatter)=>metric(label,obj&&hasNum(obj.recent)&&hasNum(obj.prior)?formatter(obj.recent)+' / '+formatter(obj.prior):'n/a',!(obj&&hasNum(obj.recent)&&hasNum(obj.prior)));
  const trendRows=[
    trendRow('Latest 5 CS/min / previous',trend.csMin,v=>fmt(v,2)),
    trendRow('Latest 5 gold @15 / previous',trend.goldDiff15,v=>signed(v,0)+'g'),
    trendRow('Latest 5 high-risk deaths / previous',trend.badDeaths,v=>fmt(v,1)),
    trendRow('Latest 5 DPM / previous',trend.dpm,v=>fmtInt(v))
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
function renderBreakdowns(r){
  const roleRows=Object.entries(r.byRole||{}).sort((a,b)=>Number(b[1]?.games||0)-Number(a[1]?.games||0));
  $('roleBreakdown').innerHTML=roleRows.length?roleRows.map(([name,v])=>'<div class="break-row"><span>'+esc(name)+'</span><small>'+esc(String(v.games||0))+' games</small><strong>'+esc(fmtPct((v.games||0)?Number(v.wins||0)/Number(v.games)*100:null))+'</strong></div>').join(''):'<div class="bullet empty">No role sample available.</div>';
  const behaviorRows=Array.isArray(r.championBehavior)?r.championBehavior:[];
  if(behaviorRows.length){
    $('championBreakdown').innerHTML=behaviorRows.slice(0,8).map(v=>'<div class="break-row champion-behavior-row"><span>'+esc(v.champion)+' <small>'+esc(v.role)+'</small></span><small>'+esc(String(v.games||0))+' games · WR '+esc(fmtPct(v.winRate))+' · @15 '+esc(signed(v.goldDiff15,0))+'g · risk deaths '+esc(fmt(v.badDeaths,1))+'</small><strong>'+esc(fmtInt(v.dpm))+' DPM</strong></div>').join('');
  }else{
    const champRows=Object.entries(r.byChampion||{}).sort((a,b)=>Number(b[1]?.games||0)-Number(a[1]?.games||0)).slice(0,8);
    $('championBreakdown').innerHTML=champRows.length?champRows.map(([name,v])=>'<div class="break-row"><span>'+esc(name)+'</span><small>'+esc(String(v.games||0))+' games</small><strong>'+esc(fmtPct((v.games||0)?Number(v.wins||0)/Number(v.games)*100:null))+'</strong></div>').join(''):'<div class="bullet empty">No champion sample available.</div>';
  }
  const matchupRows=Array.isArray(r.matchupBehavior)?r.matchupBehavior:[];
  const target=$('matchupBreakdown');
  if(target){
    target.innerHTML=matchupRows.length?matchupRows.slice(0,10).map(v=>{
      const own=(v.ownChampions||[]).slice(0,3).map(x=>x.champion+' '+x.games+'g').join(', ');
      return '<div class="break-row matchup-behavior-row"><span>vs '+esc(v.opponentChampion)+' <small>'+esc(v.role)+'</small></span>'+
        '<small>'+esc(String(v.games||0))+' games · WR '+esc(fmtPct(v.winRate))+' · @15 '+esc(signed(v.goldDiff15,0))+'g · clean duel '+esc(String(v.pre14SoloKills||0))+'-'+esc(String(v.pre14SoloDeaths||0))+
        (hasNum(v.outsidePressureShare)?' · outside pressure '+esc(fmtPct(v.outsidePressureShare)):'')+
        (own?' · own picks '+esc(own):'')+'</small><strong>'+esc(signed(v.csDiff15,1))+' CS @15</strong></div>';
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
  const q=r.dataQuality||{},b=r.behaviorSummary||{},p=r.peerComparison||{};
  const analyzed=Number(q.analyzedGames??r.games?.length??0),coaching=Number(q.coachingRoleGames??r.coachingSummary?.games??0),timelines=Number(q.validTimelineGames??0);
  const timelinePct=analyzed>0?timelines/analyzed*100:null,peerN=Number(q.peerComparableGames??p.sameRoleGames??0),rankedN=Number(q.rankedPeerGames??p.rankedPeerGames??0);
  const fightN=Number(b.fightSamples??0),objectiveN=Number(b.neutralObjectiveEvents??0),wardN=Number(p.visionWardTotal??0);
  const cards=[
    qualityCard('Analyzed games',String(analyzed),String(coaching)+' primary-role coaching games',evidenceLevel(coaching)),
    qualityCard('Queue context',hasNum(q.dominantQueueId)?'Queue '+String(q.dominantQueueId):'n/a',String(q.dominantQueueGames??0)+' analyzed-context games · '+String(q.excludedOtherQueues??0)+' other queue-context games excluded',evidenceLevel(q.dominantQueueGames??0)),
    qualityCard('Patch context',q.currentPatchKey?('Patch '+String(q.currentPatchKey)):'n/a',String(q.currentPatchRoleGames??0)+' current-patch role games · '+String(q.olderSamePatchRoleGames??0)+' older same-patch baseline · '+String(q.crossPatchBaselineRoleGames??0)+' cross-patch older games excluded from trend',q.patchBaselineReady?'good':'neutral'),
    qualityCard('Item catalog provenance',String(q.itemCatalogExactPatches??0)+' exact patch catalog(s)',String(q.itemCatalogFallbackPatches??0)+' patch fallback(s) · '+String(q.itemCatalogUnknownPatchGames??0)+' game(s) without a parsed patch',Number(q.itemCatalogFallbackPatches||0)===0?'good':'neutral'),
    qualityCard('Sample exclusions',String(Number(q.excludedShortGames||0)+Number(q.excludedOtherMaps||0)+Number(q.excludedOtherQueues||0)+Number(q.excludedMissingRole||0))+' games',String(q.excludedShortGames??0)+' under 10m · '+String(q.excludedOtherMaps??0)+' other maps · '+String(q.excludedOtherQueues??0)+' other queues · '+String(q.excludedMissingRole??0)+' missing role','neutral'),
    qualityCard('Timeline coverage',hasNum(timelinePct)?fmtPct(timelinePct):'n/a',String(timelines)+' / '+String(analyzed)+' games',evidenceLevel(timelines)),
    qualityCard('Direct peer evidence',String(peerN)+' games','Actual same-role opponents',evidenceLevel(peerN)),
    qualityCard('Ranked peer evidence',String(rankedN)+' games',String(q.higherRankPeerGames??p.higherRankPeerGames??0)+' higher-rank peers',evidenceLevel(rankedN)),
    qualityCard('Fight evidence',String(fightN)+' clusters','Attended multi-kill fight clusters',evidenceLevel(fightN,12,6)),
    qualityCard('Objective evidence',String(objectiveN)+' events','Tracked team neutral objectives',evidenceLevel(objectiveN,10,5)),
    qualityCard('Ward evidence',String(wardN)+' wards','Used for spatial/setup analysis',evidenceLevel(wardN,30,12)),
    qualityCard('Same-patch self baseline',String(q.coachingBaselineRoleGames??0)+' games',q.currentPatchKey?('Older primary-role games on patch '+String(q.currentPatchKey)):'No usable patch cohort',evidenceLevel(q.coachingBaselineRoleGames??0))
  ];
  $('qualityGrid').innerHTML=cards.join('');
  const low=[];
  if(timelines<5)low.push('timeline behavior');
  if(peerN<5)low.push('direct-peer comparisons');
  if(rankedN<3)low.push('rank-band comparisons');
  if(fightN<6)low.push('fight-order/readiness');
  if(Number(q.excludedShortGames||0)>0)low.push('short games excluded from coaching');
  if(Number(q.excludedOtherQueues||0)>0)low.push('mixed queue contexts excluded');
  if(q.currentPatchKey&&!q.patchBaselineReady)low.push('same-patch historical trend baseline');
  if(Number(q.itemCatalogFallbackPatches||0)>0)low.push('item-catalog patch fallback');
  const base=r.sourceStatus?.note||'Report data remains traceable through the report contract. Missing data remains unknown rather than zero.';
  $('sourceNote').textContent=base+(low.length?' Thin-evidence areas right now: '+low.join(', ')+'.':' Core evidence coverage is sufficient for the main coaching dimensions.');
}

async function importReport(){
  const file=$('reportFile')?.files?.[0];if(!file||!state.profile)return;
  setBusy(true,'Importing');clearLog();
  try{
    const txt=await file.text();const parsed=JSON.parse(txt),r=normalizeReport(parsed);
    await api('report_import',{profile_id:state.profile.id,report:r});
    log('Imported report JSON into '+state.profile.display_name+'.','ok');renderReport(r,'legacy_import');$('analysisState').textContent='Imported now';$('sourceState').textContent='Imported Bruisienator';
    statusPill('Import complete');
  }catch(e){log('Import failed: '+e.message,'bad');statusPill('Import failed','error');}
  finally{setBusy(false);syncButtons();}
}
function exportReport(){
  if(!state.report)return;
  const blob=new Blob([JSON.stringify(state.report,null,2)],{type:'application/json'}),a=document.createElement('a');
  a.href=URL.createObjectURL(blob);a.download='bruisienator_'+(state.profile?.profile_key||'profile')+'_last20.json';document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(a.href),1000);
}

$('riotApiKey').addEventListener('input',(ev)=>{
  state.riotApiKey=String(ev.target.value||'').trim();
  $('riotKeyStatus').textContent=state.riotApiKey?'Session key ready':'No server Riot key configured';
  $('backendState').textContent=state.serverRiotKey||state.riotApiKey?'Backend + Riot ready':'Backend ready · add Riot key';
  $('backendState').className='pill '+(state.serverRiotKey||state.riotApiKey?'':'warn');
  syncButtons();
});
$('profileSelect').addEventListener('change',()=>selectProfile($('profileSelect').value));
$('newProfileBtn').addEventListener('click',()=>openProfileEditor(null));
$('cancelProfileBtn').addEventListener('click',()=>$('profileEditor').hidden=true);
$('saveProfileBtn').addEventListener('click',saveProfile);
$('testRiotKeyBtn').addEventListener('click',testRiotKey);
$('fetchBtn').addEventListener('click',fetchMatches);
$('analyzeBtn').addEventListener('click',analyze);
$('batchFetchBtn').addEventListener('click',()=>runBatch('fetch'));
$('batchAnalyzeBtn').addEventListener('click',()=>runBatch('analyze'));
$('reportFile').addEventListener('change',syncButtons);
$('importBtn').addEventListener('click',importReport);
$('exportBtn').addEventListener('click',exportReport);

boot().catch(e=>{log('Startup failed: '+e.message,'bad');$('backendState').textContent='Startup failed';$('backendState').className='pill error';});
})();