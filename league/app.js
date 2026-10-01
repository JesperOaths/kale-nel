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
  ['fetchBtn','analyzeBtn','newProfileBtn','saveProfileBtn','importBtn','testRiotKeyBtn'].forEach(id=>{const n=$(id);if(n)n.disabled=!!on||((id==='fetchBtn'||id==='analyzeBtn')&&!state.profile)||((id==='importBtn')&&(!state.profile||!$('reportFile')?.files?.length))||((id==='testRiotKeyBtn')&&(!state.profile||(!state.serverRiotKey&&!state.riotApiKey)));});
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

async function fetchMatches(){
  if(!state.profile||state.busy)return;
  clearLog();setBusy(true,'Fetching');statusPill('Fetching','warn');
  try{
    log('Preparing recent match list for '+state.profile.display_name+'.');
    const requestedCount=Math.max(20,Math.min(100,Number($('fetchCount').value||20)));
    const prep=await api('fetch_prepare',{profile_id:state.profile.id,count:requestedCount});
    if(prep.profile){state.profile=Object.assign({},state.profile,prep.profile);const rs=state.profile.rank_snapshot;$('sourceState').textContent=rs&&rs.tier?'Riot · '+rs.tier+' '+(rs.rank||''):'Resolved Riot ID';}
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
    renderReport(d.report,'web_behavior');
    try{const history=await api('report_latest',{profile_id:state.profile.id});renderProgressComparison(d.report,history.previous?.report_data||null,history.previous?.created_at||null);}catch(_){$('progressComparisonPanel').hidden=true;}
    $('analysisState').textContent=fmtDate(d.created_at);
    $('sourceState').textContent='Behavioral analyzer';
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
  const rank=p.rank&&p.rank.tier?[p.rank.tier,p.rank.rank,p.rank.leaguePoints!=null?String(p.rank.leaguePoints)+' LP':''].filter(Boolean).join(' '):'';
  const coachingN=r.coachingSummary?.games??s.primaryRoleGames??0;
  $('reportSubtitle').textContent=(riotId?riotId+' · ':'')+(rank?rank+' · ':'')+(s.games??r.games.length)+' analyzed games · Primary role '+(s.primaryRole||'GENERIC')+' · Coaching sample '+coachingN+' '+(s.primaryRole||'GENERIC')+' games';
  $('reportSourceBadge').textContent=sourceKind==='legacy_import'?'Imported current report':(r.analyzerVersion||'Web analysis');
  renderKpis(r);renderBullets('recentFocus',r.recentFocus,'No grounded recent-focus tips are available from the active analyzer yet.');
  renderBullets('overallHighlights',r.overallHighlights,'No broader highlights are available from the active analyzer yet.');
  renderPracticePlan(r);renderGames(r);renderCharts(r);renderAdvanced(r);renderBreakdowns(r);renderQuality(r);
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
    const title=x.title||x.label||x.category||'Insight',evidence=x.evidence||x.text||'',action=x.action||'',confidence=x.confidence||'';
    return '<div class="bullet coaching-bullet priority-'+esc(String(x.priority||3))+'">'+
      '<div class="coaching-head"><strong>'+esc(title)+'</strong>'+(x.category?'<span>'+esc(x.category)+'</span>':'')+(x.priority?'<em>Priority '+esc(String(x.priority))+'</em>':'')+(confidence?'<small>'+esc(confidence)+' confidence</small>':'')+'</div>'+
      (evidence?'<p>'+esc(evidence)+'</p>':'')+
      (action?'<p class="coaching-action"><b>Improve:</b> '+esc(action)+'</p>':'')+
      '</div>';
  }).join(''):'<div class="bullet empty">'+esc(empty)+'</div>';
}

function pathValue(obj,path){
  return String(path||'').split('.').reduce((v,k)=>v==null?null:v[k],obj);
}
function renderProgressComparison(current,previous,previousAt){
  if(!previous){
    $('progressComparisonPanel').hidden=true;return;
  }
  const role=String(current?.summary?.primaryRole||'GENERIC').toUpperCase();
  const specs=[
    {label:'Gold @15 vs role opponent',path:'summary.goldDiff15',threshold:150,direction:1,format:v=>signed(v,0)+'g'},
    {label:'High-risk deaths / game',path:'behaviorSummary.badDeathsPerTimelineGame',threshold:.3,direction:-1,format:v=>fmt(v,1)},
    {label:'First major item vs peer',path:'peerComparison.avgMajorItemDeltaMin',threshold:.4,direction:-1,format:v=>signed(v,1)+' min'},
    {label:'Damage share − gold share',path:'behaviorSummary.damageGoldEfficiency',threshold:2,direction:1,format:v=>signed(v,1)+' pp'}
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
  if(!rows.length){$('progressComparisonPanel').hidden=true;return;}
  $('previousAnalysisDate').textContent='Compared with '+fmtDate(previousAt);
  $('progressComparison').innerHTML=rows.map(x=>'<article class="progress-comparison-card '+x.status+'">'+
    '<span>'+esc(x.label)+'</span><strong>'+esc(x.status)+'</strong>'+
    '<p>Now '+esc(x.current)+' · previous '+esc(x.previous)+'</p></article>').join('');
  $('progressComparisonPanel').hidden=false;
}

function renderPracticePlan(r){
  const focus=(r.recentFocus||[]).filter(x=>x&&typeof x==='object'&&x.action).sort((a,b)=>Number(a.priority||9)-Number(b.priority||9)).slice(0,3);
  if(!focus.length){
    $('practicePlan').innerHTML='<div class="practice-empty">No strong improvement priority has enough evidence yet. Fetch/analyze more timeline-complete games rather than forcing a conclusion.</div>';
    return;
  }
  $('practicePlan').innerHTML=focus.map((x,i)=>'<article class="practice-card">'+
    '<div class="practice-number">'+(i+1)+'</div><div><span>'+esc(x.category||'focus')+'</span><strong>'+esc(x.title||'Practice focus')+'</strong>'+
    '<p>'+esc(x.action)+'</p><small>'+esc(x.comparison||'Last-20 evidence')+' · '+esc(x.confidence||'medium')+' confidence</small></div></article>').join('');
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
  bindDetailTabs(tr,game,index);
}
function judgmentHtml(g){
  const xs=Array.isArray(g.judgments)?g.judgments:[];
  if(!xs.length)return '<div class="game-judgments empty-judgment">No high-confidence action judgment for this game.</div>';
  return '<div class="game-judgments">'+xs.map(x=>'<article class="game-judgment '+(x.tone==='strength'?'strength':'improve')+'">'+
    '<div class="game-judgment-head"><span>'+esc(x.category||'analysis')+'</span><strong>'+esc(x.title||'Insight')+'</strong></div>'+
    '<p>'+esc(x.evidence||'')+'</p>'+(x.action?'<p class="game-action"><b>Next time:</b> '+esc(x.action)+'</p>':'')+'</article>').join('')+'</div>';
}
function detailsHtml(g,index){
  return '<div class="details-shell">'+judgmentHtml(g)+'<div class="details-tabs">'+['macro','resets','vision','roams','deaths','objectives'].map(t=>'<button class="tab-btn '+(state.activeDetailTab===t?'active':'')+'" data-tab="'+t+'" type="button">'+t[0].toUpperCase()+t.slice(1)+'</button>').join('')+'</div><div class="details-content" data-detail-content>'+detailContent(g,state.activeDetailTab)+'</div></div>';
}
function detailCard(label,value){return'<div class="detail-card"><span>'+esc(label)+'</span><strong>'+esc(value)+'</strong></div>';}
function detailList(items,empty){
  const xs=(items||[]).filter(Boolean);
  return '<div class="detail-note">'+(xs.length?'<ul>'+xs.map(x=>'<li>'+esc(x)+'</li>').join('')+'</ul>':esc(empty||'No events detected.'))+'</div>';
}
function detailContent(g,tab){
  if(tab==='vision'){
    const v=g.vision||{};
    return detailCard('Vision / min',fmt(g.vpm,2))+detailCard('Wards placed',String(v.wardCount??g.wards?.length??0))+detailCard('Wards / 30 min',fmt(v.wardsPer30,1))+
      detailCard('Offensive / defensive',String(v.offensive??0)+' / '+String(v.defensive??0))+detailCard('River wards',String(v.river??0))+detailCard('Objective setup wards',String(v.objectiveSetup??0))+detailCard('Peer setup wards',String(g.opponentVision?.objectiveSetup??0))+detailCard('Setup Δ vs peer',hasNum(v.objectiveSetupDeltaVsOpponent)?signed(v.objectiveSetupDeltaVsOpponent,0):'n/a')+
      detailList((g.wards||[]).slice(0,8).map(w=>(Number(w.time)||0).toFixed(1)+'m · '+(w.territory||'unknown')+' · '+(w.wardType||'ward')),'No player ward positions were available.');
  }
  if(tab==='roams'){
    const r=g.roams||{},events=r.events||[];
    return detailCard('Attempts',String(r.attempts??0))+detailCard('Successful',String(r.successes??0))+detailCard('Failed',String(r.failures??0))+
      detailList(events.map(x=>(Number(x.startMin)||0).toFixed(1)+'–'+(Number(x.endMin)||0).toFixed(1)+'m · '+(x.targetZone||'map')+' · '+(x.outcome||'neutral')+(hasNum(x.laneCostCs)?' · own lane Δ '+signed(x.laneCostCs,0)+' CS':'')+(hasNum(x.adcLaneCostCs)?' · ADC lane Δ '+signed(x.adcLaneCostCs,0)+' CS':'')),'No qualifying pre-20-minute roam departures detected.');
  }
  if(tab==='deaths'){
    const bad=g.badDeaths||[];
    const pre=g.preObjectiveDeaths||[];
    return detailCard('Deaths',String(g.deaths??'n/a'))+detailCard('Flagged high-risk',String(g.badDeathCount??0))+detailCard('Objective-context deaths',fmtPct(g.objectiveDeathPct))+detailCard('Pre-objective conversions',String(g.preObjectiveDeathCount??0))+detailCard('≥1000 unspent gold deaths',String(g.highUnspentGoldDeaths??0))+
      detailList(bad.map(x=>(Number(x.time)||0).toFixed(1)+'m · '+(x.tags||[]).join(', ')+' · '+fmtInt(x.currentGold)+'g unspent · nearby '+String(x.alliesNear??0)+' ally / '+String(x.enemiesNear??0)+' enemy'),'No death crossed the multi-signal bad-death threshold.')+
      detailList(pre.map(x=>(Number(x.time)||0).toFixed(1)+'m death → '+String(x.objectiveType||'objective')+' '+String(x.secondsBeforeObjective||'?')+'s later'),'No death was followed by an enemy objective within 75 seconds.');
  }
  if(tab==='objectives'){
    return detailCard('Objective presence',fmtPct(g.objectiveJoinRate))+detailCard('Joined / team objectives',String(g.objectiveJoined??0)+' / '+String(g.objectiveTeamTotal??0))+detailCard('Early KP',fmtPct(g.earlyKp))+
      detailCard('First impact',hasNum(g.impactTimeMin)?fmt(g.impactTimeMin,1)+' min · '+String(g.impactType||'event'):'n/a')+detailCard('Objective-context death %',fmtPct(g.objectiveDeathPct))+detailCard('Pre-objective conversion deaths',String(g.preObjectiveDeathCount??0))+detailCard('Tracked events',String(g.objectives?.length||0))+
      '<div class="detail-note">Objective presence counts a team objective once and checks whether your timeline position is within the action radius; it does not convert objectives into fake gold values.</div>';
  }
  if(tab==='resets'){
    const mine=g.firstMajorItem,opp=g.opponentFirstMajorItem,shops=g.shopVisits||[],greedy=g.greedyStayWindows||[];
    return detailCard('First major item',mine?(mine.name+' · '+fmt(mine.time,1)+'m'):'n/a')+
      detailCard('Opponent major item',opp?(opp.name+' · '+fmt(opp.time,1)+'m'):'n/a')+
      detailCard('Timing vs opponent',hasNum(g.itemSpikeDeltaVsOpponent)?signed(g.itemSpikeDeltaVsOpponent,1)+' min':'n/a')+
      detailCard('Detected shop visits',String(shops.length))+detailCard('Greedy-stay windows',String(greedy.length))+detailCard('Overstay deaths',String(g.overstayCount??0))+
      detailList(greedy.map(x=>(Number(x.startMin)||0).toFixed(1)+'m · '+fmtInt(x.currentGold)+'g held · next shop '+(Number(x.nextShopMin)||0).toFixed(1)+'m ('+fmt(x.delayMin,1)+'m delay)'),'No repeated high-gold stay window detected.');
  }
  const peer=g.peer||null;
  return detailCard('Gold diff @10',signed(g.goldDiff10,0))+detailCard('Gold diff @15',signed(g.goldDiff15,0))+detailCard('Gold diff @25',signed(g.goldDiff25,0))+
    detailCard('CS diff @10',signed(g.csDiff10,0))+detailCard('CS diff @15',signed(g.csDiff15,0))+detailCard('CS diff @25',signed(g.csDiff25,0))+
    detailCard('XP diff @10',signed(g.xpDiff10,0))+detailCard('XP diff @15',signed(g.xpDiff15,0))+detailCard('XP diff @25',signed(g.xpDiff25,0))+
    detailCard('Opponent',peer?(peer.champion||'Same-role peer'):'n/a')+detailCard('Opponent rank',peer?rankText(peer.rank):'n/a')+
    detailCard('First impact',hasNum(g.impactTimeMin)?fmt(g.impactTimeMin,1)+'m':'n/a')+detailCard('Opponent first impact',hasNum(g.opponentImpactTimeMin)?fmt(g.opponentImpactTimeMin,1)+'m':'n/a')+detailCard('Impact timing vs peer',hasNum(g.impactDeltaVsOpponent)?signed(g.impactDeltaVsOpponent,1)+' min':'n/a')+
    detailCard('DPM vs same-role opponent',peer?signed(peer.dpmDelta,0):'n/a')+detailCard('CS/min vs opponent',peer?signed(peer.csMinDelta,2):'n/a')+detailCard('Team damage rank',hasNum(g.damageRank)?'#'+g.damageRank+' of 5':'n/a')+
    detailCard('Damage share',fmtPct(g.damageShare))+detailCard('Gold share',fmtPct(g.goldShare))+detailCard('Damage − gold share',hasNum(g.damageShare)&&hasNum(g.goldShare)?signed(Number(g.damageShare)-Number(g.goldShare),1)+' pp':'n/a')+
    '<div class="detail-note">Peer comparisons use the actual same-role opponent in this match. Positive values mean you finished ahead on that metric; opponent rank is fetched during the Fetch step and cached with the match.</div>';
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
  const a=r.advanced||{},roam=a.roams||{},recall=a.recalls||{},itemSpike=a.itemSpike||{};
  const rows=[
    ['DQI',hasNum(a.dqi)?fmt(a.dqi,1)+' / 10':'Formula not recovered'],
    ['AGOR',hasNum(a.agor)?fmt(a.agor,2):'Formula not recovered'],
    ['Objective presence',fmtPct(a.objectivePresence)],
    ['Early KP',fmtPct(a.earlyKP)],
    ['First impact timing',hasNum(a.firstImpact?.avgDeltaVsOpponentMin)?signed(a.firstImpact.avgDeltaVsOpponentMin,1)+' min vs peer':'n/a'],
    ['Objective-context death %',fmtPct(a.objectiveDeathPct)],
    ['Enemy objective after death',String(a.preObjectiveDeaths??0)+' deaths · '+fmtPct(a.preObjectiveDeathPct)],
    ['Roam attempts / success',String(roam.attempts??0)+' / '+fmtPct(roam.successRate)],
    ['Roam lane cost',hasNum(roam.avgLaneCostCs)?signed(roam.avgLaneCostCs,1)+' CS avg · '+String(roam.emptyCostlyRoams??0)+' empty costly':'n/a'],
    ['High-gold stay windows',String(recall.greedyStayWindows??0)],
    ['Major-item Δ vs opponent',hasNum(itemSpike.avgDeltaVsOpponentMin)?signed(itemSpike.avgDeltaVsOpponentMin,1)+' min':'n/a'],
    ['Damage share − gold share',hasNum(r.behaviorSummary?.damageGoldEfficiency)?signed(r.behaviorSummary.damageGoldEfficiency,1)+' pp':'n/a'],
    ['Objective-setup vision Δ',hasNum(a.visionSetup?.avgDeltaVsOpponent)?signed(a.visionSetup.avgDeltaVsOpponent,1)+' wards vs peer':'n/a']
  ];
  $('advancedMetrics').innerHTML=rows.map(([l,v])=>metric(l,v,String(v).includes('not recovered')||v==='n/a')).join('');
  const p=r.peerComparison||{},conv=r.conversion||{},wl=r.winLoss||{},trend=r.recentTrend||{},base=r.coachingLifetime||null,s=r.coachingSummary||r.summary||{},rank=r.profile?.rank||null;
  const peerRows=[
    metric('Peer definition',p.definition||'Same-role opponent in each match',false),
    metric('Comparable peer games',String(p.sameRoleGames??0),false),
    metric('Ranked peer games',String(p.rankedPeerGames??0),false),
    metric('Higher-ranked peer games',String(p.higherRankPeerGames??0),false),
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
    metric('Major-item timing vs peer',hasNum(p.avgMajorItemDeltaMin)?signed(p.avgMajorItemDeltaMin,1)+' min':'n/a',!hasNum(p.avgMajorItemDeltaMin)),
    metric('Faster major item than peer',fmtPct(p.majorItemFasterPct),!hasNum(p.majorItemFasterPct)),
    metric('First-impact comparable games',String(p.impactGames??0),false),
    metric('First impact vs peer',hasNum(p.avgImpactDeltaMin)?signed(p.avgImpactDeltaMin,1)+' min':'n/a',!hasNum(p.avgImpactDeltaMin)),
    metric('You impact first',fmtPct(p.impactEarlierPct),!hasNum(p.impactEarlierPct)),
    metric('Mid-game comparable games',String(p.midgameComparableGames??0),false),
    metric('Gold swing 15→25',hasNum(p.avgGoldSwing15to25)?signed(p.avgGoldSwing15to25,0)+'g':'n/a',!hasNum(p.avgGoldSwing15to25)),
    metric('Lead swing 15→25',hasNum(p.avgLeadSwing15to25)?signed(p.avgLeadSwing15to25,0)+'g · '+String(p.leadGames15to25??0)+' games':'n/a',!hasNum(p.avgLeadSwing15to25)),
    metric('Deficit recovery 15→25',hasNum(p.avgDeficitSwing15to25)?signed(p.avgDeficitSwing15to25,0)+'g · '+String(p.deficitGames15to25??0)+' games':'n/a',!hasNum(p.avgDeficitSwing15to25)),
    metric('Higher-rank gold @15',hasNum(p.higherRankAvgGoldDiff15)?signed(p.higherRankAvgGoldDiff15,0)+'g':'n/a',!hasNum(p.higherRankAvgGoldDiff15)),
    metric('Beat higher-rank peer on gold @15',fmtPct(p.higherRankGoldOutperformPct),!hasNum(p.higherRankGoldOutperformPct)),
    metric('DPM vs higher-rank peer',hasNum(p.higherRankAvgDpmDelta)?signed(p.higherRankAvgDpmDelta,0):'n/a',!hasNum(p.higherRankAvgDpmDelta))
  ];
  const conversionRows=[
    metric('Wins when ≥250g ahead @15',hasNum(conv.laneLeadWinRate)?fmtPct(conv.laneLeadWinRate)+' · '+String(conv.laneLeadGames||0)+' games':'n/a',!hasNum(conv.laneLeadWinRate)),
    metric('Wins when ≥250g behind @15',hasNum(conv.laneDeficitWinRate)?fmtPct(conv.laneDeficitWinRate)+' · '+String(conv.laneDeficitGames||0)+' games':'n/a',!hasNum(conv.laneDeficitWinRate))
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
  const baselineRows=base?[
    metric('Broader cached sample',String(base.games||0)+' games',false),
    metric('WR · recent / baseline',fmtPct(s.winRate)+' / '+fmtPct(base.winRate),false),
    metric('CS/min · recent / baseline',fmt(s.csMin,2)+' / '+fmt(base.csMin,2),false),
    metric('KP · recent / baseline',fmtPct(s.kp)+' / '+fmtPct(base.kp),false),
    metric('DPM · recent / baseline',fmtInt(s.dpm)+' / '+fmtInt(base.dpm),false)
  ]:[metric('Recent vs broader baseline','Cache more than 20 games to enable',true)];
  $('benchmarkMetrics').innerHTML=[
    metric('Current Riot rank',rank&&rank.tier?[rank.tier,rank.rank,rank.leaguePoints!=null?rank.leaguePoints+' LP':''].filter(Boolean).join(' '):'Not available',!(rank&&rank.tier)),
    ...peerRows,...conversionRows,...winLossRows,...trendRows,...baselineRows
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
}
function renderQuality(r){
  const q=r.dataQuality||{};
  const cards=[['Analyzed games',q.analyzedGames??r.games?.length??0],['Primary-role coaching games',q.coachingRoleGames??r.coachingSummary?.games??'n/a'],['Primary-role baseline',q.coachingBaselineRoleGames??0],['Timeline games',q.validTimelineGames??'n/a'],['Peer-comparable games',q.peerComparableGames??'n/a'],['Ranked peer games',q.rankedPeerGames??'n/a'],['Higher-rank peers',q.higherRankPeerGames??'n/a'],['Coordinate games',q.validCoordinateGames??'n/a'],['Missing timelines',q.missingTimelineGames??'n/a'],['Overall broader baseline',q.baselineGames??0]];
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
  syncButtons();
});
$('profileSelect').addEventListener('change',()=>selectProfile($('profileSelect').value));
$('newProfileBtn').addEventListener('click',()=>openProfileEditor(null));
$('cancelProfileBtn').addEventListener('click',()=>$('profileEditor').hidden=true);
$('saveProfileBtn').addEventListener('click',saveProfile);
$('testRiotKeyBtn').addEventListener('click',testRiotKey);
$('fetchBtn').addEventListener('click',fetchMatches);
$('analyzeBtn').addEventListener('click',analyze);
$('reportFile').addEventListener('change',syncButtons);
$('importBtn').addEventListener('click',importReport);
$('exportBtn').addEventListener('click',exportReport);

boot().catch(e=>{log('Startup failed: '+e.message,'bad');$('backendState').textContent='Startup failed';$('backendState').className='pill error';});
})();