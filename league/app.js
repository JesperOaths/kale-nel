(function(){
'use strict';

const cfg=window.GEJAST_CONFIG||{};
const API=(cfg.SUPABASE_URL||'')+'/functions/v1/printify-gildan-diff-diag-v1';
const KEY=cfg.SUPABASE_PUBLISHABLE_KEY||'';
const $=(id)=>document.getElementById(id);
const state={profiles:[],profile:null,report:null,ddVersion:'',openMatch:null,activeDetailTab:'macro',busy:false,riotApiKey:'',serverRiotKey:false};

function esc(v){return String(v??'').replace(/[&<>"']/g,(c)=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function token(){try{return (cfg.getPlayerSessionToken&&cfg.getPlayerSessionToken())||'';}catch(_){return'';}}
function fmt(v,d=1){const n=Number(v);return Number.isFinite(n)?n.toFixed(d):'n/a';}
function fmtInt(v){const n=Number(v);return Number.isFinite(n)?Math.round(n).toLocaleString():'n/a';}
function fmtPct(v){const n=Number(v);return Number.isFinite(n)?Math.round(n)+'%':'n/a';}
function fmtDate(v){if(!v)return'—';const d=new Date(v);return Number.isFinite(d.getTime())?d.toLocaleString(undefined,{dateStyle:'medium',timeStyle:'short'}):'—';}
function fmtDuration(v){const n=Number(v);if(!Number.isFinite(n))return'n/a';const m=Math.floor(n),s=Math.round((n-m)*60);return m+':'+String(s).padStart(2,'0');}
function signed(v,d=0){const n=Number(v);return Number.isFinite(n)?(n>0?'+':'')+n.toFixed(d):'n/a';}
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
  ['fetchBtn','analyzeBtn','newProfileBtn','saveProfileBtn','importBtn'].forEach(id=>{const n=$(id);if(n)n.disabled=!!on||((id==='fetchBtn'||id==='analyzeBtn')&&!state.profile)||((id==='importBtn')&&!state.profile||!$('reportFile')?.files?.length);});
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

async function loadProfiles(selectId){
  const data=await api('profiles_list');
  state.profiles=data.profiles||[];
  const sel=$('profileSelect');
  sel.innerHTML='<option value="">Choose a profile…</option>'+state.profiles.map(p=>'<option value="'+esc(p.id)+'">'+esc(p.display_name)+(p.game_name?' · '+esc(p.game_name)+'#'+esc(p.tag_line||''):'')+'</option>').join('');
  const id=selectId||(state.profile&&state.profile.id)||state.profiles[0]?.id||'';
  if(id){sel.value=id;await selectProfile(id);}else{state.profile=null;syncButtons();$('cacheState').textContent='No profile';}
}
function syncButtons(){
  $('fetchBtn').disabled=state.busy||!state.profile;
  $('analyzeBtn').disabled=state.busy||!state.profile;
  $('importBtn').disabled=state.busy||!state.profile||!$('reportFile')?.files?.length;
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
    }else{
      $('analysisState').textContent='No report';
      state.report=null;$('report').hidden=true;$('reportEmpty').hidden=false;
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

async function fetchMatches(){
  if(!state.profile||state.busy)return;
  clearLog();setBusy(true,'Fetching');statusPill('Fetching','warn');
  try{
    log('Preparing recent match list for '+state.profile.display_name+'.');
    const prep=await api('fetch_prepare',{profile_id:state.profile.id,count:20});
    const ids=prep.match_ids||[],cached=new Set(prep.cached_match_ids||[]);
    if(!ids.length)throw new Error('Riot returned no recent match IDs.');
    log(ids.length+' recent matches found; '+cached.size+' already cached.');
    let done=0;
    for(const id of ids){
      done++;
      if(cached.has(id)){
        log('['+done+'/'+ids.length+'] '+id+' · cache hit','ok');setProgress(done,ids.length);continue;
      }
      log('['+done+'/'+ids.length+'] Fetching match + timeline '+id+'…');
      try{
        const one=await api('fetch_one',{run_id:prep.run_id,match_id:id});
        if(one.timeline_available)log('['+done+'/'+ids.length+'] '+id+' · match + timeline cached','ok');
        else log('['+done+'/'+ids.length+'] '+id+' · match cached, timeline unavailable: '+(one.timeline_error||'unknown'),'bad');
      }catch(e){log('['+done+'/'+ids.length+'] '+id+' · '+e.message,'bad');}
      setProgress(done,ids.length);
      await sleep(100);
    }
    await api('fetch_finish',{run_id:prep.run_id});
    log('Fetch/update complete. Analyze remains a separate cached-data operation.','ok');
    statusPill('Fetch complete');
    await loadCacheStatus();
  }catch(e){log('Fetch failed: '+e.message,'bad');statusPill('Fetch failed','error');}
  finally{setBusy(false);syncButtons();}
}

async function analyze(){
  if(!state.profile||state.busy)return;
  clearLog();setBusy(true,'Analyzing');statusPill('Analyzing','warn');setProgress(20,100);
  try{
    log('Loading cached matches only — no new match fetch is requested.');
    const d=await api('analyze_basic',{profile_id:state.profile.id});
    setProgress(100,100);
    log('Deterministic web analysis generated for '+(d.report?.dataQuality?.analyzedGames||0)+' games.','ok');
    if(d.report?.advanced?.currentSourcePortRequired)log('Advanced Bruisienator formulas are intentionally marked unavailable until the current source package is supplied.');
    renderReport(d.report,'web_basic');
    $('analysisState').textContent=fmtDate(d.created_at);
    $('sourceState').textContent='Web analyzer';
    statusPill('Analysis complete');
  }catch(e){log('Analysis failed: '+e.message,'bad');statusPill('Analysis failed','error');}
  finally{setBusy(false);syncButtons();}
}

function normalizeReport(r){
  const out=(r&&typeof r==='object')?r:{};
  if(!Array.isArray(out.games))out.games=Array.isArray(out.last20)?out.last20:Array.isArray(out.PERGAME)?out.PERGAME:Array.isArray(out.perGame)?out.perGame:[];
  out.summary=out.summary||out.aggregates||{};
  out.byRole=out.byRole||{};
  out.byChampion=out.byChampion||out.byChamp||{};
  out.recentFocus=Array.isArray(out.recentFocus)?out.recentFocus:Array.isArray(out.tips20)?out.tips20:[];
  out.overallHighlights=Array.isArray(out.overallHighlights)?out.overallHighlights:Array.isArray(out.tips)?out.tips:[];
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
  $('reportSubtitle').textContent=(riotId?riotId+' · ':'')+(s.games??r.games.length)+' analyzed games · Primary role '+(s.primaryRole||'GENERIC');
  $('reportSourceBadge').textContent=sourceKind==='legacy_import'?'Imported current report':(r.analyzerVersion||'Web analysis');
  renderKpis(r);renderBullets('recentFocus',r.recentFocus,'No grounded recent-focus tips are available from the active analyzer yet.');
  renderBullets('overallHighlights',r.overallHighlights,'No broader highlights are available from the active analyzer yet.');
  renderGames(r);renderCharts(r);renderAdvanced(r);renderBreakdowns(r);renderQuality(r);
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
  $(id).innerHTML=list.length?list.map(x=>'<div class="bullet">'+esc(typeof x==='string'?x:(x.text||x.label||JSON.stringify(x)))+'</div>').join(''):'<div class="bullet empty">'+esc(empty)+'</div>';
}

function renderGames(r){
  const games=r.games||[];$('gameCountLabel').textContent=games.length+' games';
  state.openMatch=null;
  $('gamesBody').innerHTML=games.map((g,i)=>{
    const kda=[g.kills,g.deaths,g.assists].map(x=>Number.isFinite(Number(x))?Number(x):'?').join('/');
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
  bindDetailTabs(tr,game,index);
}
function detailsHtml(g,index){
  return '<div class="details-shell"><div class="details-tabs">'+['macro','vision','roams','deaths','objectives'].map(t=>'<button class="tab-btn '+(state.activeDetailTab===t?'active':'')+'" data-tab="'+t+'" type="button">'+t[0].toUpperCase()+t.slice(1)+'</button>').join('')+'</div><div class="details-content" data-detail-content>'+detailContent(g,state.activeDetailTab)+'</div></div>';
}
function detailCard(label,value){return'<div class="detail-card"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>';}
function detailContent(g,tab){
  if(tab==='vision'){
    return detailCard('Vision / min',fmt(g.vpm,2))+detailCard('Ward coordinates',String(g.wards?.length||0))+detailCard('Timeline',g.timelineAvailable?'Available':'Missing')+
      '<div class="detail-note">Offensive vs defensive ward classification is not guessed in the web-basic analyzer. Raw timeline coordinates are preserved for the current-source port.</div>';
  }
  if(tab==='roams'){
    return detailCard('Roams',g.roams==null?'Pending current analyzer':String(g.roams))+detailCard('Role',g.role||'GENERIC')+detailCard('Duration',fmtDuration(g.durationMinutes))+
      '<div class="detail-note">True roam detection must use the current Bruisienator lane/path semantics; ordinary out-of-lane events are not automatically labelled as roams.</div>';
  }
  if(tab==='deaths'){
    return detailCard('Deaths',String(g.deaths??'n/a'))+detailCard('Death coordinates',String(g.deathPositions?.length||0))+detailCard('Objective-death %',fmtPct(state.report.advanced?.objectiveDeathPct))+
      '<div class="detail-note">Bad-death classification is intentionally withheld until the established current heuristic is ported.</div>';
  }
  if(tab==='objectives'){
    return detailCard('Objective events',String(g.objectives?.length||0))+detailCard('Objective presence',fmtPct(state.report.advanced?.objectivePresence))+detailCard('Map ID',String(g.mapId??'n/a'))+
      '<div class="detail-note">No arbitrary gold conversion is applied to objective events.</div>';
  }
  return detailCard('Gold diff @10',signed(g.goldDiff10,0))+detailCard('Gold diff @15',signed(g.goldDiff15,0))+detailCard('CS diff @10',signed(g.csDiff10,0))+detailCard('CS diff @15',signed(g.csDiff15,0))+detailCard('XP diff @10',signed(g.xpDiff10,0))+detailCard('XP diff @15',signed(g.xpDiff15,0))+
    '<div class="detail-note">Recall/item-spike, overstay and map-path analysis are slots in the report contract but remain pending the current Bruisienator analyzer source.</div>';
}
function bindDetailTabs(container,g,index){
  container.querySelectorAll('.tab-btn').forEach(btn=>btn.addEventListener('click',(ev)=>{
    ev.stopPropagation();state.activeDetailTab=btn.dataset.tab;
    container.querySelectorAll('.tab-btn').forEach(b=>b.classList.toggle('active',b===btn));
    container.querySelector('[data-detail-content]').innerHTML=detailContent(g,state.activeDetailTab);
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
function renderAdvanced(r){
  const a=r.advanced||{},rows=[
    ['DQI',Number.isFinite(Number(a.dqi))?fmt(a.dqi,1)+' / 10':'Pending current analyzer'],
    ['AGOR',Number.isFinite(Number(a.agor))?fmt(a.agor,2):'Pending current analyzer'],
    ['Objective presence',fmtPct(a.objectivePresence)],
    ['Early KP',fmtPct(a.earlyKP)],
    ['Objective-death %',fmtPct(a.objectiveDeathPct)],
    ['Roaming',a.roams==null?'Pending current analyzer':String(a.roams)],
    ['Recalls / overstay',a.recalls==null?'Pending current analyzer':String(a.recalls)],
    ['Ward depth classification',a.wardClassification==null?'Pending current analyzer':String(a.wardClassification)]
  ];
  $('advancedMetrics').innerHTML=rows.map(([l,v])=>metric(l,v,String(v).includes('Pending')||v==='n/a')).join('');
  const b=r.benchmarks||{};
  $('benchmarkMetrics').innerHTML=[
    metric('Rank-above benchmark',b.rankAbove?String(b.rankAbove):'Pending current analyzer',!b.rankAbove),
    metric('Item-spike timing',b.itemSpike?String(b.itemSpike):'Pending current analyzer',!b.itemSpike),
    metric('Recent vs lifetime',r.lifetime?'Available':'Not available in web-basic source',!r.lifetime)
  ].join('');
}
function renderBreakdowns(r){
  const roleRows=Object.entries(r.byRole||{}).sort((a,b)=>Number(b[1]?.games||0)-Number(a[1]?.games||0));
  $('roleBreakdown').innerHTML=roleRows.length?roleRows.map(([name,v])=>'<div class="break-row"><span>'+esc(name)+'</span><small>'+esc(String(v.games||0))+' games</small><strong>'+esc(fmtPct((v.games||0)?Number(v.wins||0)/Number(v.games)*100:null))+'</strong></div>').join(''):'<div class="bullet empty">No role sample available.</div>';
  const champRows=Object.entries(r.byChampion||{}).sort((a,b)=>Number(b[1]?.games||0)-Number(a[1]?.games||0)).slice(0,8);
  $('championBreakdown').innerHTML=champRows.length?champRows.map(([name,v])=>'<div class="break-row"><span>'+esc(name)+'</span><small>'+esc(String(v.games||0))+' games</small><strong>'+esc(fmtPct((v.games||0)?Number(v.wins||0)/Number(v.games)*100:null))+'</strong></div>').join(''):'<div class="bullet empty">No champion sample available.</div>';
}
function renderQuality(r){
  const q=r.dataQuality||{};
  const cards=[['Analyzed games',q.analyzedGames??r.games?.length??0],['Timeline games',q.validTimelineGames??'n/a'],['Coordinate games',q.validCoordinateGames??'n/a'],['Missing timelines',q.missingTimelineGames??'n/a']];
  $('qualityGrid').innerHTML=cards.map(([l,v])=>'<div class="quality-card"><span>'+esc(l)+'</span><strong>'+esc(v)+'</strong></div>').join('');
  $('sourceNote').textContent=r.sourceStatus?.note||'Report data remains traceable through the report contract. Missing advanced data is shown as unavailable rather than zero.';
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
});
$('profileSelect').addEventListener('change',()=>selectProfile($('profileSelect').value));
$('newProfileBtn').addEventListener('click',()=>openProfileEditor(null));
$('cancelProfileBtn').addEventListener('click',()=>$('profileEditor').hidden=true);
$('saveProfileBtn').addEventListener('click',saveProfile);
$('fetchBtn').addEventListener('click',fetchMatches);
$('analyzeBtn').addEventListener('click',analyze);
$('reportFile').addEventListener('change',syncButtons);
$('importBtn').addEventListener('click',importReport);
$('exportBtn').addEventListener('click',exportReport);

boot().catch(e=>{log('Startup failed: '+e.message,'bad');$('backendState').textContent='Startup failed';$('backendState').className='pill error';});
})();