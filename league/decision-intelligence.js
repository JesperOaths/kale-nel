(function(){
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const num=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const n=v=>Number(v);
  const fmt=(v,d=1)=>num(v)?Number(v).toLocaleString(undefined,{maximumFractionDigits:d,minimumFractionDigits:0}):'—';
  const pct=(a,b)=>b?100*a/b:null;
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const rows=a=>Array.isArray(a?.evidence?.rows)?a.evidence.rows:[];
  const statusLabel=s=>({supported:'Measured',proxy:'Proxy',thin:'Thin sample',unavailable:'No evidence'}[s]||s||'Context');
  const statusTone=s=>s==='supported'?'good':s==='proxy'?'warn':s==='thin'?'neutral':'muted';
  const gameMap=report=>new Map((report?.games||[]).map(g=>[String(g.matchId),g]));
  const shortMatch=id=>String(id||'').split('_').pop().slice(-7);
  const signed=(v,d=1)=>num(v)?(n(v)>0?'+':'')+fmt(v,d):'—';
  const avg=xs=>{const v=xs.filter(num).map(n);return v.length?v.reduce((a,b)=>a+b,0)/v.length:null;};
  const median=xs=>{const v=xs.filter(num).map(n).sort((a,b)=>a-b);if(!v.length)return null;const m=Math.floor(v.length/2);return v.length%2?v[m]:(v[m-1]+v[m])/2;};
  const nearestFrame=(g,minute)=>{
    const fs=(g?.frameSamples||[]).filter(x=>num(x?.time)).sort((a,b)=>Math.abs(n(a.time)-minute)-Math.abs(n(b.time)-minute));
    return fs[0]&&Math.abs(n(fs[0].time)-minute)<=1.25?fs[0]:null;
  };
  const project=(p)=>{
    if(!p||!num(p.x)||!num(p.y))return null;
    if(typeof window.worldToMapPoint==='function')return window.worldToMapPoint(p.x,p.y);
    const minX=-120,minY=-120,maxX=14870,maxY=14980,size=512;
    return{x:clamp((n(p.x)-minX)/(maxX-minX)*size,0,size),y:clamp((maxY-n(p.y))/(maxY-minY)*size,0,size)};
  };
  const mapImage=()=>typeof window.map11Image==='function'?window.map11Image():'https://ddragon.leagueoflegends.com/cdn/16.19.1/img/map/map11.png';
  const mapFallback=()=>typeof window.map11FallbackImage==='function'?window.map11FallbackImage():'https://ddragon.leagueoflegends.com/cdn/16.19.1/img/map/map11.png';
  const champIcon=name=>typeof window.championIcon==='function'?window.championIcon(name):'';

  const INFO={
    fight_decision_ledger:{group:'Fight decisions',measure:'Compares a transparent cross-map value proxy with a net-kill fight-cost proxy while you were absent. Neither side is a complete economic total.',review:'Open the largest negative and positive examples. Ask whether the wave/objective value was guaranteed and whether joining was realistically available.'},
    arrival_feasibility:{group:'Fight decisions',measure:'Groups skipped fights by straight-line distance to the fight anchor. This is a reachability screen, not a travel-time or path-safety model.',review:'Review reachable missed fights first. Distance is not the same as path safety, so check terrain, vision and movement options in replay.'},
    pre_fight_positioning:{group:'Fight decisions',measure:'Uses distinct pre-fight Riot timeline frames and displays their actual seconds-before-fight. Duplicate minute-cadence frames are collapsed.',review:'Look for repeated 30→10 second paths that leave you farther from the fight instead of closer.'},
    fight_formation:{group:'Fight decisions',measure:'Uses entry distance to the fight anchor as a formation proxy: fight core, edge/backline distance, or far edge/late-entry distance.',review:'For ADC, compare deaths/contribution from core starts versus edge starts. The goal is not always “closer”; it is repeatable safe access to targets.'},
    numbers_aware_participation:{group:'Fight decisions',measure:'Adds local ally/enemy counts to participation so walking into a clearly lost numbers state is not rewarded as “good attendance”.',review:'Inspect losses that started two or more players down and ask whether you could disengage earlier or whether the numbers snapshot formed only after commitment.'},
    cross_map_efficiency:{group:'Fight decisions',measure:'Normalizes supported cross-map compensation over the 90-second skip window so productive separation can be distinguished from empty absence.',review:'Compare your highest-value cross-map windows with low/zero-value ones and identify what made the productive ones actually convertible.'},
    wave_fight_conflict:{group:'Fight decisions',measure:'Uses direct-role CS and gold movement as a resource-pressure proxy when a fight begins elsewhere. Exact live wave size is not available.',review:'When CS gain was real but the team lost heavily, check whether the wave could have been pushed or abandoned earlier.'},
    nothing_gained_isolation:{group:'Fight decisions',measure:'Counts skipped tracked fights where the next 90 seconds show no supported structure, objective, +250g or +6 CS compensation.',review:'These are the cleanest “what were you doing instead?” review windows. Prioritize high-priority reachable examples.'},
    post_recall_tempo:{group:'Tempo & setup',measure:'Measures the time from a completed shop to the next tracked fight/objective and shows where you were sampled on the approach.',review:'Look for recalls that finish shortly before action but still leave you on the wrong side of the map.'},
    objective_setup_path:{group:'Tempo & setup',measure:'Reconstructs the sequence from last shop → sampled approach zone → contested objective.',review:'For missed objectives, move the review start one minute earlier. The important mistake often happens before the objective appears on screen.'},
    lead_utilisation:{group:'Economy & conversion',measure:'Tracks ≥500g direct-role leads at 15 into the 25-minute state and nearby conversion evidence.',review:'Compare leads that stay large with leads that collapse. Check reset timing, deaths and whether the lead became structures/objectives.'},
    deficit_recovery:{group:'Economy & conversion',measure:'Tracks games starting ≥500g behind at 15 and how much direct-role gold difference moves by 25.',review:'Review the strongest recoveries and identify whether they came from safe farm, picks, objective fights or opponent mistakes.'},
    death_chains:{group:'Risk & recovery',measure:'Treats repeat deaths as sequences instead of independent events, using the existing post-death recovery windows.',review:'Start at the first death in the chain. The second death is often the symptom; the useful question is why the reset/re-entry after the first death failed.'},
    resource_to_impact:{group:'Fight decisions',measure:'Time-orders direct-role gold state before a fight and then records tracked contribution/survival.',review:'If being ahead does not translate into contribution, inspect positioning, unspent gold, arrival timing and target access rather than damage totals alone.'},
    fight_lead_conversion:{group:'Economy & conversion',measure:'Checks whether a won active fight is followed by a supported structure, objective or kill-conversion signal within roughly 90 seconds.',review:'Open fight wins with no conversion. Check whether the right call was reset, push, objective, invade, or simply not overstay.'},
    fight_loss_containment:{group:'Risk & recovery',measure:'Checks whether a lost fight is followed by another classified bad death within roughly 90 seconds.',review:'Review compounded losses. The practical goal is to stop one lost fight from becoming two separate losses.'},
    objective_trading:{group:'Tempo & setup',measure:'Isolates skipped fights that produced a supported structure or neutral-objective gain elsewhere.',review:'Validate that the trade was actually dependent on staying away and that the enemy did not receive much more guaranteed value.'},
    geographical_clusters:{group:'Map patterns',measure:'Combines high-priority skipped-fight locations and supported bad-death areas to expose repeated map locations that deserve replay attention.',review:'Repeated location is a habit clue, not a verdict. Check whether the same pathing/vision/spacing decision repeats inside that zone.'},
    champion_tendencies:{group:'Champion context',measure:'Groups only your own games by champion and compares decision/risk tendencies rather than teammate performance.',review:'Use this to identify champion-specific habits: e.g. safer fight entry on one ADC but more empty cross-map time on another.'},
    matchup_adjusted_lane:{group:'Lane & opponent context',measure:'Builds personal-history own-champion × direct-opponent-champion cells for lane gold and DPM-vs-peer context.',review:'Only treat repeated cells as useful. A single matchup result is an example, not a matchup rule.'},
    expected_performance_residual:{group:'Lane & opponent context',measure:'Compares actual opponent-adjusted DPM with your own champion/opponent/duration expectation and graphs the residual.',review:'Use residuals to find unexpectedly strong/weak games after controlling some obvious context. They are not a causal skill estimate.'},
    session_components:{group:'Session patterns',measure:'Breaks the opener→game-3+ answer into evidence-gated signals normalized by each metric’s practical-change threshold. Unlike units are never plotted on one raw scale.',review:'Look for the largest normalized shift, then use the raw delta and sample counts to identify the behavior that actually changed.'},
    requeue_sweet_spot:{group:'Session patterns',measure:'Compares break-time buckets using the normalized direct-opponent performance composite.',review:'Only use buckets with enough games. Treat the best bucket as scheduling context, not a causal prescription.'},
    mistake_recurrence:{group:'Learning progress',measure:'Tracks supported issue-signal load game by game by category. It does not claim a target-linked half-life without a defensible target start point.',review:'Use the line and category counts to see whether risky deaths, pre-objective deaths, reset absences or missed-join reviews are actually receding.'},
    automatic_replay_shortlist:{group:'Replay review',measure:'Ranks concrete moments with a transparent heuristic built from skipped-fight, fight-entry, objective-setup and repeat-death evidence.',review:'Start here when you do not want to review every match. The heuristic priority is not measured severity, probability or blame.'}
  };
  const GROUP_ORDER=['Fight decisions','Tempo & setup','Economy & conversion','Risk & recovery','Map patterns','Champion context','Lane & opponent context','Session patterns','Learning progress','Replay review'];

  function simpleValue(v){
    if(v==null)return '—';
    if(typeof v==='boolean')return v?'Yes':'No';
    if(typeof v==='number')return fmt(v,2);
    if(typeof v==='string')return v;
    if(Array.isArray(v))return v.slice(0,4).map(simpleValue).join(' · ');
    return '';
  }
  function scalarEvidence(e){
    if(!e||typeof e!=='object')return '';
    const skip=new Set(['rows','proxy']);
    const bits=Object.entries(e).filter(([k,v])=>!skip.has(k)&&v!=null&&!Array.isArray(v)&&typeof v!=='object').slice(0,6);
    if(!bits.length&&!e.proxy)return '';
    return '<div class="di-evidence-chips">'+(e.proxy?'<span class="di-proxy-note"><b>Proxy definition</b> '+esc(e.proxy)+'</span>':'')+
      bits.map(([k,v])=>'<span><b>'+esc(k.replace(/([A-Z])/g,' $1').replace(/_/g,' '))+'</b> '+esc(simpleValue(v))+'</span>').join('')+'</div>';
  }
  function evidenceRows(a){
    return rows(a).slice(0,8).map(row=>{
      const bits=Object.entries(row||{}).filter(([k,v])=>!['matchId','checkpoints'].includes(k)&&v!=null&&typeof v!=='object').slice(0,5)
        .map(([k,v])=>'<span><b>'+esc(k.replace(/([A-Z])/g,' $1').replace(/_/g,' '))+'</b> '+esc(simpleValue(v))+'</span>').join('');
      const checkpoints=Array.isArray(row?.checkpoints)?'<small>'+row.checkpoints.map(x=>esc(x.sec+'s: '+(x.zone||'unknown')+(num(x.distance)?' · '+fmt(x.distance,0)+'u':''))).join(' · ')+'</small>':'';
      const match=row?.matchId?'<button class="button secondary tiny di-open-match" type="button" data-match-id="'+esc(row.matchId)+'">Open match</button>':'';
      return '<div class="di-evidence-row"><div>'+bits+checkpoints+'</div>'+match+'</div>';
    }).join('');
  }
  function conclusion(a){
    const r=rows(a),e=a?.evidence||{};
    switch(a?.id){
      case'fight_decision_ledger':{const pos=r.filter(x=>num(x.netProxyG)&&n(x.netProxyG)>0).length,neg=r.filter(x=>num(x.netProxyG)&&n(x.netProxyG)<0).length;return r.length?pos+' skipped fights had a positive value-minus-fight-cost proxy and '+neg+' were negative. Focus on the largest negative reachable examples first.':'No skipped-fight ledger is available.';}
      case'arrival_feasibility':return r.length?String((e.near||0)+(e.borderline||0))+' of '+r.length+' skipped fights began within the 6.5k straight-line screen ('+String(e.near||0)+' near, '+String(e.borderline||0)+' borderline). This does not prove arrival was possible through terrain/vision.':'No position-supported skipped fights.';
      case'pre_fight_positioning':{const earliest=r.map(x=>x.checkpoints?.slice().sort((a,b)=>n(b.actualLeadSec)-n(a.actualLeadSec))[0]).filter(Boolean),latest=r.map(x=>x.checkpoints?.slice().sort((a,b)=>n(a.actualLeadSec)-n(b.actualLeadSec))[0]).filter(Boolean),a0=avg(earliest.map(x=>x.distance)),a1=avg(latest.map(x=>x.distance)),lead0=avg(earliest.map(x=>x.actualLeadSec)),lead1=avg(latest.map(x=>x.actualLeadSec));return num(a0)&&num(a1)?'Across fights with distinct pre-fight frames, the earliest retained sample averages '+fmt(a0,0)+'u away at '+fmt(lead0,0)+'s before contact and the latest averages '+fmt(a1,0)+'u away at '+fmt(lead1,0)+'s. Actual sample times are shown because Riot frames are too coarse for literal 30/20/10 tracking.':'The available frames are too sparse for one aggregate distance conclusion; use the map examples.';}
      case'fight_formation':{const c={};r.forEach(x=>c[x.formationBand]=(c[x.formationBand]||0)+1);const top=Object.entries(c).sort((a,b)=>b[1]-a[1])[0];return top?'Most tracked entries start in “'+top[0]+'” ('+top[1]+'/'+r.length+'). Compare contribution and survival inside each band.':'No formation sample.';}
      case'numbers_aware_participation':return r.length?(String(e.outnumberedStarts||0)+' fights began down ≥2, '+String(e.downOneStarts||0)+' down one, '+String((e.evenStarts||0)+(e.aheadStarts||0))+' even/ahead. The ≥2-down group lost '+(num(e.outnumberedLossRate)?fmt(e.outnumberedLossRate,0)+'%':'—')+' of measured fights.'):'No local-number sample.';
      case'cross_map_efficiency':return num(e.medianValuePerMin)?'Typical supported trade-value proxy is '+fmt(e.medianValuePerMin,0)+' per minute. The spread matters more than the average: compare high-value and near-zero windows.':a.summary;
      case'wave_fight_conflict':{const conflicts=r.filter(x=>x.likelyResourceConflict).length,lost=r.filter(x=>x.likelyResourceConflict&&x.fightLost).length;return conflicts?conflicts+' skipped fights show a meaningful resource-pressure proxy; '+lost+' of those coincided with a lost fight. Those are the clearest wave-vs-fight tradeoffs to review.':'No strong resource-conflict proxy crossed the threshold.';}
      case'nothing_gained_isolation':return r.length?String(e.highPriority||0)+' of '+r.length+' uncompensated separation windows are high-priority missed-join reviews.':'No uncompensated skipped-fight window.';
      case'post_recall_tempo':return num(e.medianGapMin)?'Median shop→next tracked event gap is '+fmt(e.medianGapMin,1)+' minutes. Short gaps are the best place to inspect whether the recall timing and destination were aligned.':a.summary;
      case'objective_setup_path':{const joined=r.filter(x=>x.joined).length;return r.length?'Tracked objective paths show '+joined+'/'+r.length+' presence in this sample. Misses should be reviewed from the prior shop/approach rather than from objective spawn alone.':'No objective setup paths.';}
      case'lead_utilisation':{const known=r.filter(x=>x.retainedTo25!==null&&x.retainedTo25!==undefined),kept=known.filter(x=>x.retainedTo25===true).length;return known.length?kept+'/'+known.length+' ≥500g-at-15 leads retained at least half the lead by 25. Open lost-lead examples to find the conversion leak.':'No lead-preservation sample reaches 25 minutes.';}
      case'deficit_recovery':{const known=r.filter(x=>num(x.recovery)),even=known.filter(x=>x.recoveredToEven).length;return known.length?even+'/'+known.length+' measured large deficits recovered to roughly even by 25; mean movement is '+signed(avg(known.map(x=>x.recovery)),0)+'g.':'No large-deficit game has a usable 25-minute checkpoint.';}
      case'death_chains':return a.summary||'No repeat-death chains.';
      case'resource_to_impact':return num(e.aheadFightContributionRate)?'When starting ≥300g ahead, tracked contribution occurred in '+fmt(e.aheadFightContributionRate,0)+'% of measured active fights. Review ahead-without-impact examples first.':a.summary;
      case'fight_lead_conversion':return num(e.conversionRate)?'Tracked fight wins converted within ~90s at '+fmt(e.conversionRate,0)+'%. Non-conversions are the best macro review clips.':a.summary;
      case'fight_loss_containment':return num(e.containmentRate)?'After lost fights, '+fmt(e.containmentRate,0)+'% avoided another classified bad death in the next ~90s. The remainder are compound-loss reviews.':a.summary;
      case'objective_trading':{const s=r.reduce((q,x)=>q+n(x.structures||0),0),o=r.reduce((q,x)=>q+n(x.objectives||0),0);return r.length?'Skipped fights produced '+s+' tracked structure gain(s) and '+o+' neutral-objective gain(s). Validate whether those trades outweighed what the team conceded.':'No structure/objective trade was supported.';}
      case'geographical_clusters':{const top=r[0];return top?'The densest repeated review zone is '+top.zone+' with '+top.count+' supported signal(s). Treat this as a route/vision habit to inspect, not as a dangerous zone by definition.':'No repeated geography cluster.';}
      case'champion_tendencies':{const eligible=r.filter(x=>n(x.games)>=3);if(!eligible.length)return'Champion rows are visible, but none has three games yet for a useful tendency conclusion.';const safest=[...eligible].filter(x=>num(x.riskyDeathsPerGame)).sort((a,b)=>n(a.riskyDeathsPerGame)-n(b.riskyDeathsPerGame))[0];return safest?safest.champion+' currently has the lowest risky-death rate among champions with ≥3 games ('+fmt(safest.riskyDeathsPerGame,2)+'/game). Compare its spacing/routing with the others.':'Champion samples are still mixed.';}
      case'matchup_adjusted_lane':{const s=r.filter(x=>n(x.games)>=3&&num(x.avgGold15));if(!s.length)return'No matchup cell has three comparable lane samples yet; keep this contextual.';const best=[...s].sort((a,b)=>n(b.avgGold15)-n(a.avgGold15))[0],worst=[...s].sort((a,b)=>n(a.avgGold15)-n(b.avgGold15))[0];return'Among repeated personal-history cells, '+best.matchup+' is strongest at 15 ('+signed(best.avgGold15,0)+'g) and '+worst.matchup+' is weakest ('+signed(worst.avgGold15,0)+'g).';}
      case'expected_performance_residual':return num(e.recentResidual)?'Recent residual is '+signed(e.recentResidual,0)+' DPM versus your own contextual expectation. Positive means better than your personal-history context model, not “better than MMR”.':a.summary;
      case'session_components':{if(!r.length)return'No session component has enough evidence.';const biggest=[...r].sort((a,b)=>Math.abs(n(b.normalized))-Math.abs(n(a.normalized)))[0];return'Largest practical-change shift is '+biggest.label+' at '+signed(biggest.normalized,2)+'× its threshold ('+signed(biggest.rawDelta,2)+' raw). Positive normalized values mean better later-session performance after inverse metrics are corrected.';}
      case'requeue_sweet_spot':{const b=e.best;return b?'Best-supported break bucket is '+b.bucket+' across '+b.games+' comparable games. Keep it descriptive until the bucket has a larger sample.':'No requeue bucket has at least three comparable games.';}
      case'mistake_recurrence':{if(!num(e.recentFive))return a.summary;const delta=num(e.priorFive)?n(e.recentFive)-n(e.priorFive):null;return'Latest five-game supported issue-signal load is '+fmt(e.recentFive,2)+'/game'+(num(delta)?' ('+signed(delta,2)+' versus the prior five).':'')+' This is a recurrence trend, not a target-linked half-life.';}
      case'automatic_replay_shortlist':{const top=r[0];return top?'Highest-ranked current replay is '+(top.type||'review')+(num(top.minute)?' at '+fmt(top.minute,1)+'m':'')+': '+top.reason+'.':'No replay moment crossed the current rules.';}
      default:return a?.summary||'No conclusion available.';
    }
  }

  function barRows(data,{label='label',value='value',suffix='',diverging=false,inverse=false,maxRows=8}={}){
    const xs=data.filter(x=>num(x?.[value])).slice(0,maxRows);if(!xs.length)return'<div class="di-visual-empty">Not enough numeric evidence to graph.</div>';
    const max=Math.max(...xs.map(x=>Math.abs(n(x[value]))),1);
    return '<div class="di-bars '+(diverging?'is-diverging':'')+'">'+xs.map(x=>{
      const v=n(x[value]),w=Math.max(2,Math.abs(v)/max*48),left=diverging?(v<0?50-w:50):0;
      const tone=diverging?((inverse?-v:v)>0?'positive':(inverse?-v:v)<0?'negative':'neutral'):'accent';
      return '<div class="di-bar-row"><span>'+esc(typeof label==='function'?label(x):x[label])+'</span><div class="di-bar-track">'+(diverging?'<i class="di-zero"></i>':'')+'<b class="'+tone+'" style="left:'+left+'%;width:'+(diverging?w*1.0:Math.max(4,Math.abs(v)/max*100))+'%"></b></div><strong>'+esc((v>0&&diverging?'+':'')+fmt(v,1)+suffix)+'</strong></div>';
    }).join('')+'</div>';
  }
  function shareVisual(parts){
    const valid=parts.filter(x=>num(x.value)&&n(x.value)>=0),total=valid.reduce((s,x)=>s+n(x.value),0);if(!total)return'<div class="di-visual-empty">No categorical evidence to graph.</div>';
    let acc=0;
    const segs=valid.map((x,i)=>{const p=n(x.value)/total*100,start=acc;acc+=p;return'<i class="seg s'+(i%5)+'" style="left:'+start+'%;width:'+p+'%"></i>';}).join('');
    return '<div class="di-share"><div class="di-share-bar">'+segs+'</div><div class="di-share-legend">'+valid.map((x,i)=>'<span><i class="s'+(i%5)+'"></i><b>'+esc(x.label)+'</b> '+fmt(n(x.value)/total*100,0)+'%</span>').join('')+'</div></div>';
  }
  function scatter(data,xKey,yKey,{xLabel='',yLabel='',labelKey=null,maxRows=30,toneFn=null,diagonal=false,legend=''}={}){
    const xs=data.filter(x=>num(x?.[xKey])&&num(x?.[yKey])).slice(0,maxRows);if(xs.length<2)return'<div class="di-visual-empty">Need at least two numeric observations for a scatterplot.</div>';
    let minX=Math.min(...xs.map(x=>n(x[xKey]))),maxX=Math.max(...xs.map(x=>n(x[xKey]))),minY=Math.min(...xs.map(x=>n(x[yKey]))),maxY=Math.max(...xs.map(x=>n(x[yKey])));
    if(minX===maxX){minX-=1;maxX+=1;}if(minY===maxY){minY-=1;maxY+=1;}
    const padX=(maxX-minX)*.08,padY=(maxY-minY)*.08;minX-=padX;maxX+=padX;minY-=padY;maxY+=padY;
    const px=v=>48+(n(v)-minX)/(maxX-minX)*420,py=v=>180-(n(v)-minY)/(maxY-minY)*146;
    let refs='';
    if(minX<=0&&maxX>=0)refs+='<line class="di-zero-line" x1="'+px(0).toFixed(1)+'" y1="30" x2="'+px(0).toFixed(1)+'" y2="180"/>';
    if(minY<=0&&maxY>=0)refs+='<line class="di-zero-line" x1="48" y1="'+py(0).toFixed(1)+'" x2="468" y2="'+py(0).toFixed(1)+'"/>';
    if(diagonal){const lo=Math.max(minX,minY),hi=Math.min(maxX,maxY);if(lo<=hi)refs+='<line class="di-reference-line" x1="'+px(lo).toFixed(1)+'" y1="'+py(lo).toFixed(1)+'" x2="'+px(hi).toFixed(1)+'" y2="'+py(hi).toFixed(1)+'"/>';}
    const dots=xs.map(x=>{const tone=typeof toneFn==='function'?String(toneFn(x)||'neutral'):'neutral';return'<circle class="di-scatter-dot '+esc(tone)+'" cx="'+px(x[xKey]).toFixed(1)+'" cy="'+py(x[yKey]).toFixed(1)+'" r="5"><title>'+esc((labelKey?x[labelKey]+' · ':'')+xLabel+' '+fmt(x[xKey],1)+' · '+yLabel+' '+fmt(x[yKey],1))+'</title></circle>';}).join('');
    return '<div class="di-svg-chart"><svg viewBox="0 0 500 220" role="img" aria-label="'+esc(xLabel+' versus '+yLabel)+'"><line class="axis" x1="48" y1="180" x2="468" y2="180"/><line class="axis" x1="48" y1="30" x2="48" y2="180"/>'+refs+dots+'<text class="di-axis-value" x="48" y="197">'+esc(fmt(minX,1))+'</text><text class="di-axis-value" x="468" y="197">'+esc(fmt(maxX,1))+'</text><text class="di-axis-value yv" x="42" y="'+(py(maxY)+4).toFixed(1)+'">'+esc(fmt(maxY,1))+'</text><text class="di-axis-value yv" x="42" y="'+(py(minY)+4).toFixed(1)+'">'+esc(fmt(minY,1))+'</text><text x="258" y="214">'+esc(xLabel)+'</text><text class="y-label" x="13" y="106">'+esc(yLabel)+'</text></svg>'+(legend?'<div class="di-chart-legend">'+legend+'</div>':'')+'</div>';
  }
  function slope(data,startKey,endKey,{startLabel='15m',endLabel='25m',maxRows=12}={}){
    const xs=data.filter(x=>num(x?.[startKey])&&num(x?.[endKey])).slice(0,maxRows);if(!xs.length)return'<div class="di-visual-empty">No paired checkpoints to draw.</div>';
    let min=Math.min(...xs.flatMap(x=>[n(x[startKey]),n(x[endKey])])),max=Math.max(...xs.flatMap(x=>[n(x[startKey]),n(x[endKey])]));if(min===max){min-=1;max+=1;}
    const py=v=>176-(n(v)-min)/(max-min)*138;
    const lines=xs.map((x,i)=>'<g><line class="'+(n(x[endKey])>=n(x[startKey])?'up':'down')+'" x1="100" y1="'+py(x[startKey]).toFixed(1)+'" x2="400" y2="'+py(x[endKey]).toFixed(1)+'"/><circle cx="100" cy="'+py(x[startKey]).toFixed(1)+'" r="4"/><circle cx="400" cy="'+py(x[endKey]).toFixed(1)+'" r="4"><title>'+esc(shortMatch(x.matchId)+' · '+signed(x[startKey],0)+' → '+signed(x[endKey],0))+'</title></circle></g>').join('');
    return '<div class="di-svg-chart"><svg viewBox="0 0 500 210" role="img"><line class="di-zero-line" x1="55" y1="'+py(0).toFixed(1)+'" x2="445" y2="'+py(0).toFixed(1)+'"/>'+lines+'<text x="100" y="202">'+esc(startLabel)+'</text><text x="400" y="202">'+esc(endLabel)+'</text></svg></div>';
  }
  function sparkline(data,valueKey,{labelKey=null,maxRows=30}={}){
    const xs=data.filter(x=>num(x?.[valueKey])).slice(-maxRows);if(xs.length<2)return'<div class="di-visual-empty">Need at least two games for a trend line.</div>';
    let min=Math.min(...xs.map(x=>n(x[valueKey]))),max=Math.max(...xs.map(x=>n(x[valueKey])));if(min===max){min-=1;max+=1;}
    const px=i=>28+i/(xs.length-1)*444,py=v=>168-(n(v)-min)/(max-min)*128;
    const pts=xs.map((x,i)=>px(i).toFixed(1)+','+py(x[valueKey]).toFixed(1)).join(' ');
    return '<div class="di-svg-chart"><svg viewBox="0 0 500 205" role="img"><line class="axis" x1="28" y1="168" x2="472" y2="168"/><polyline class="di-spark" points="'+pts+'"/>'+xs.map((x,i)=>'<circle class="di-spark-dot" cx="'+px(i).toFixed(1)+'" cy="'+py(x[valueKey]).toFixed(1)+'" r="4"><title>'+esc((labelKey?x[labelKey]+' · ':'')+fmt(x[valueKey],2))+'</title></circle>').join('')+'<text x="28" y="196">older</text><text x="436" y="196">newer</text></svg></div>';
  }
  function mapStage(points,{lines=[],legend='',aria='Summoner’s Rift decision map'}={}){
    const pp=points.map(x=>({...x,p:project(x.position)})).filter(x=>x.p),ll=lines.map(x=>({...x,a:project(x.a),b:project(x.b)})).filter(x=>x.a&&x.b);
    if(!pp.length&&!ll.length)return'<div class="di-visual-empty">No usable map coordinates for this analytic.</div>';
    const svgLines=ll.map(x=>'<line class="di-map-line '+esc(x.tone||'neutral')+'" x1="'+x.a.x.toFixed(1)+'" y1="'+x.a.y.toFixed(1)+'" x2="'+x.b.x.toFixed(1)+'" y2="'+x.b.y.toFixed(1)+'"><title>'+esc(x.title||'movement / decision link')+'</title></line>').join('');
    const svgPts=pp.map((x,i)=>'<g><circle class="di-map-point '+esc(x.tone||'neutral')+'" cx="'+x.p.x.toFixed(1)+'" cy="'+x.p.y.toFixed(1)+'" r="'+(x.r||7)+'"><title>'+esc(x.title||'map event')+'</title></circle>'+(x.label?'<text x="'+x.p.x.toFixed(1)+'" y="'+(x.p.y+3).toFixed(1)+'">'+esc(x.label)+'</text>':'')+'</g>').join('');
    return '<div class="di-map-wrap"><div class="map-stage di-map-stage"><img loading="lazy" src="'+esc(mapImage())+'" data-map-fallback="'+esc(mapFallback())+'" alt="'+esc(aria)+'"><svg viewBox="0 0 512 512" preserveAspectRatio="none">'+svgLines+svgPts+'</svg></div>'+(legend?'<div class="di-map-legend">'+legend+'</div>':'')+'</div>';
  }
  function fightMap(report,mode,shortlist=[]){
    const pts=[],lines=[];
    for(const g of report?.games||[]){
      const all=[...(g?.fightProfile?.events||[]),...(g?.fightProfile?.absenceEvents||[])];
      for(const e of all){
        if(!e?.fightPosition||!num(e.startMin))continue;
        const absent=(g?.fightProfile?.absenceEvents||[]).includes(e);
        if(mode==='pre'){
          const fr=nearestFrame(g,n(e.startMin)-.5);
          if(fr?.position){lines.push({a:fr.position,b:e.fightPosition,tone:absent?'warn':'good',title:g.champion+' · '+fmt(e.startMin,1)+'m · sampled ~30s route to '+(e.fightZone||'fight')});pts.push({position:fr.position,tone:'player',r:5,title:g.champion+' · sampled pre-fight position'});}
          pts.push({position:e.fightPosition,tone:absent?'warn':'fight',r:7,title:(e.fightZone||'Fight')+' · '+fmt(e.startMin,1)+'m'});
        }else if(mode==='geo'){
          if(absent&&e.joinReviewPriority==='high')pts.push({position:e.fightPosition,tone:'bad',r:9,title:'High-priority skipped fight · '+(e.fightZone||'')+' · '+fmt(e.startMin,1)+'m'});
          else if(absent&&e.crossMapTradeSupported===true)pts.push({position:e.fightPosition,tone:'good',r:8,title:'Skipped fight with measurable trade · '+(e.fightZone||'')});
        }else if(mode==='trade'){
          if(absent&&(n(e.playerStructureGains||0)>0||n(e.playerNeutralObjectiveGains||0)>0)){
            pts.push({position:e.fightPosition,tone:'fight',r:7,title:'Fight location · '+(e.fightZone||'')});
            if(e.playerPosition){pts.push({position:e.playerPosition,tone:'good',r:7,title:'Your cross-map position'});lines.push({a:e.playerPosition,b:e.fightPosition,tone:'trade',title:'Cross-map trade decision'});}
          }
        }else if(mode==='shortlist'){
          const wanted=shortlist.filter(x=>String(x.matchId)===String(g.matchId)&&num(x.minute));
          for(const w of wanted)if(Math.abs(n(w.minute)-n(e.startMin))<.15)pts.push({position:e.fightPosition,tone:'review',r:10,label:String(shortlist.indexOf(w)+1),title:'#'+(shortlist.indexOf(w)+1)+' '+w.reason});
        }
      }
    }
    const legends={pre:'<span><i class="player"></i>sampled player position</span><span><i class="fight"></i>fight anchor</span>',geo:'<span><i class="bad"></i>reachable missed join</span><span><i class="good"></i>measurable cross-map trade</span>',trade:'<span><i class="good"></i>your cross-map position</span><span><i class="fight"></i>fight location</span>',shortlist:'<span><i class="review"></i>ranked replay moment</span>'};
    return mapStage(pts,{lines,legend:legends[mode]||'',aria:'Summoner’s Rift '+mode+' decision map'});
  }
  function preFightMap(r){
    const pts=[],lines=[];
    for(const row of r){
      const fight=row?.fightPosition;if(!fight)continue;
      pts.push({position:fight,tone:'fight',r:8,title:(row.fightZone||'Fight')+' · '+fmt(row.minute,1)+'m'});
      const cp=(row.checkpoints||[]).filter(x=>x?.position&&num(x.actualLeadSec)).sort((a,b)=>n(b.actualLeadSec)-n(a.actualLeadSec));
      for(const x of cp)pts.push({position:x.position,tone:'player',r:5,title:'Actual sample '+fmt(x.actualLeadSec,0)+'s before fight · '+(x.zone||'unknown')});
      if(cp.length)lines.push({a:cp[0].position,b:fight,tone:'neutral',title:'Earliest distinct sampled pre-fight frame → fight anchor'});
    }
    return mapStage(pts,{lines,legend:'<span><i class="player"></i>distinct sampled pre-fight frame</span><span><i class="fight"></i>fight anchor</span>',aria:'Summoner’s Rift pre-fight positioning map'});
  }

  function formationVisual(r){
    const bands=[...new Set(r.map(x=>x.formationBand).filter(Boolean))];
    if(!bands.length)return'<div class="di-visual-empty">No formation bands to graph.</div>';
    return '<div class="di-formation-grid">'+bands.map(b=>{const xs=r.filter(x=>x.formationBand===b),con=xs.filter(x=>x.contributed).length,surv=xs.filter(x=>x.survived).length;return'<article><strong>'+esc(b)+'</strong><span><b>'+xs.length+'</b> fights</span><span><b>'+fmt(pct(con,xs.length),0)+'%</b> contribution</span><span><b>'+fmt(pct(surv,xs.length),0)+'%</b> survival</span></article>';}).join('')+'</div>';
  }
  function objectivePathMap(r){
    const pts=r.filter(x=>x?.approachPosition).map(x=>({position:x.approachPosition,tone:x.joined?'good':'bad',r:7,title:(x.objective||'objective')+' · sampled approach '+(x.approachZone||'unknown')+' · '+(x.joined?'present':'absent')}));
    return mapStage(pts,{legend:'<span><i class="good"></i>present at contested objective</span><span><i class="bad"></i>absent</span>',aria:'Summoner’s Rift objective approach map'});
  }

  function championVisual(r){
    if(!r.length)return'<div class="di-visual-empty">No champion-conditioned sample.</div>';
    const maxRisk=Math.max(...r.map(x=>n(x.riskyDeathsPerGame||0)),1);
    return '<div class="di-champion-grid">'+r.slice(0,8).map(x=>{const src=champIcon(x.champion);return'<article><div class="di-champ-head">'+(src?'<img loading="lazy" src="'+esc(src)+'" alt="'+esc(x.champion)+' portrait">':'')+'<div><strong>'+esc(x.champion)+'</strong><small>'+x.games+' games</small></div></div><div class="di-mini-metrics"><span><b>'+fmt(x.riskyDeathsPerGame,2)+'</b> risky deaths/g</span><span><b>'+fmt(x.crossMapTradeRate,0)+'%</b> trade · n='+fmt(x.skippedFightSamples,0)+'</span><span><b>'+fmt(x.activeFightSurvivalRate,0)+'%</b> survival · n='+fmt(x.activeFightSamples,0)+'</span></div><div class="di-risk-meter"><i style="width:'+clamp(n(x.riskyDeathsPerGame||0)/maxRisk*100,0,100)+'%"></i></div></article>';}).join('')+'</div>';
  }
  function matchupVisual(r){
    if(!r.length)return'<div class="di-visual-empty">No direct-opponent matchup cells.</div>';
    const max=Math.max(...r.filter(x=>num(x.avgGold15)).map(x=>Math.abs(n(x.avgGold15))),1);
    return '<div class="di-matchup-grid">'+r.slice(0,12).map(x=>{const [mine,opp]=String(x.matchup||' vs ').split(' vs '),mi=champIcon(mine),oi=champIcon(opp),v=num(x.avgGold15)?n(x.avgGold15):0;return'<article><div class="di-matchup-icons">'+(mi?'<img src="'+esc(mi)+'" alt="'+esc(mine)+'">':'')+'<b>vs</b>'+(oi?'<img src="'+esc(oi)+'" alt="'+esc(opp)+'">':'')+'</div><strong>'+esc(x.matchup)+'</strong><small>'+x.games+' games · Gold@15 '+signed(x.avgGold15,0)+'g · DPM vs peer '+signed(x.avgDpmVsPeer,0)+'</small><div class="di-matchup-meter"><em></em><i class="'+(v>0?'positive':v<0?'negative':'neutral')+'" style="left:'+(v<0?(50-clamp(Math.abs(v)/max*50,2,50)):50)+'%;width:'+clamp(Math.abs(v)/max*50,2,50)+'%"></i></div></article>';}).join('')+'</div>';
  }
  function replayCards(report,short){
    const gm=gameMap(report);
    return'<div class="di-replay-visual-grid">'+short.slice(0,10).map((x,i)=>{const g=gm.get(String(x.matchId)),src=g?champIcon(g.champion):'';return'<article><div class="di-replay-rank">#'+(i+1)+'</div>'+(src?'<img loading="lazy" src="'+esc(src)+'" alt="">':'')+'<div><span>'+esc(x.type||'Replay')+(num(x.minute)?' · '+fmt(x.minute,1)+'m':'')+'</span><strong>'+esc(x.reason||'Review this moment')+'</strong><small>'+esc(x.zone||'')+' · heuristic priority '+fmt(x.score,0)+'</small><div class="di-score-meter"><i style="width:'+clamp(n(x.score||0),0,100)+'%"></i></div></div><button class="button secondary tiny di-open-match" type="button" data-match-id="'+esc(x.matchId)+'">Open</button></article>';}).join('')+'</div>';
  }

  function visualFor(a,report){
    const r=rows(a),e=a?.evidence||{};
    switch(a?.id){
      case'fight_decision_ledger':return barRows([...r].sort((x,y)=>Math.abs(n(y.netProxyG||0))-Math.abs(n(x.netProxyG||0))),{label:x=>(x.zone||'fight')+' · '+fmt(x.minute,1)+'m',value:'netProxyG',suffix:'g proxy',diverging:true});
      case'arrival_feasibility':return shareVisual([{label:'Near ≤4k',value:n(e.near||0)},{label:'Borderline 4–6.5k',value:n(e.borderline||0)},{label:'Far >6.5k',value:n(e.far||0)}]);
      case'pre_fight_positioning':return preFightMap(r);
      case'fight_formation':return formationVisual(r);
      case'numbers_aware_participation':return shareVisual([{label:'Down ≥2',value:n(e.outnumberedStarts||0)},{label:'Down 1',value:n(e.downOneStarts||0)},{label:'Even',value:n(e.evenStarts||0)},{label:'Ahead',value:n(e.aheadStarts||0)}]);
      case'cross_map_efficiency':return barRows([...r].sort((a,b)=>n(b.valuePerMin||0)-n(a.valuePerMin||0)),{label:x=>(x.zone||'fight')+' '+fmt(x.minute,1)+'m',value:'valuePerMin',suffix:'/min'});
      case'wave_fight_conflict':return scatter(r,'csSwing','goldSwing',{xLabel:'CS movement vs role',yLabel:'Gold movement vs role',labelKey:'zone',toneFn:x=>x.fightLost?'negative':'positive',legend:'<span><i class="negative"></i>team lost tracked fight</span><span><i class="positive"></i>team did not lose tracked fight</span>'});
      case'nothing_gained_isolation':return shareVisual([{label:'High-priority',value:n(e.highPriority||0)},{label:'Other uncompensated',value:Math.max(0,r.length-n(e.highPriority||0))}]);
      case'post_recall_tempo':return barRows([...r].sort((a,b)=>n(a.gapMin||0)-n(b.gapMin||0)),{label:x=>(x.nextKind||'event')+' · '+(x.approachZone||'unknown'),value:'gapMin',suffix:'m'});
      case'objective_setup_path':return shareVisual([{label:'Present',value:r.filter(x=>x.joined).length},{label:'Absent',value:r.filter(x=>!x.joined).length}])+objectivePathMap(r)+'<div class="di-path-chips">'+r.slice(0,8).map(x=>'<span><b>'+esc(x.objective||'objective')+'</b><i>shop '+(num(x.shopLeadMin)?fmt(x.shopLeadMin,1)+'m before':'?')+'</i><em>→</em><i>'+esc(x.approachZone||'unknown')+'</i><em>→</em><i>'+esc(x.joined?'present':'absent')+'</i></span>').join('')+'</div>';
      case'lead_utilisation':return slope(r,'gold15','gold25',{startLabel:'Gold@15',endLabel:'Gold@25'});
      case'deficit_recovery':return slope(r,'gold15','gold25',{startLabel:'Gold@15',endLabel:'Gold@25'});
      case'death_chains':{const rr=(e.repeatGames||[]).map(x=>({label:shortMatch(x.matchId),value:n(x.repeatDeaths||0)}));return barRows(rr,{value:'value',suffix:' repeat'});}
      case'resource_to_impact':return scatter(r,'goldDiffAtStart','currentGold',{xLabel:'Gold diff vs role',yLabel:'Unspent gold',labelKey:'matchId',toneFn:x=>x.contributed?'positive':'negative',legend:'<span><i class="positive"></i>tracked contribution</span><span><i class="negative"></i>no tracked contribution</span>'});
      case'fight_lead_conversion':return shareVisual([{label:'Converted',value:r.filter(x=>x.converted).length},{label:'No tracked conversion',value:r.filter(x=>!x.converted).length}]);
      case'fight_loss_containment':return shareVisual([{label:'Contained',value:r.filter(x=>x.contained).length},{label:'Compounded',value:r.filter(x=>!x.contained).length}]);
      case'objective_trading':return fightMap(report,'trade')+barRows(r,{label:x=>(x.fightZone||'trade')+' '+fmt(x.minute,1)+'m',value:'goldSwing',suffix:'g',diverging:true});
      case'geographical_clusters':{const mapEvents=Array.isArray(e.mapEvents)?e.mapEvents:[];const pts=mapEvents.map(x=>({position:x.position,tone:x.type==='bad_death'?'bad':'review',r:x.type==='bad_death'?7:9,title:(x.type==='bad_death'?'High-risk death':'High-priority missed join')+' · '+(x.zone||'unknown')+' · '+fmt(x.minute,1)+'m'}));return mapStage(pts,{legend:'<span><i class="bad"></i>high-risk death</span><span><i class="review"></i>high-priority missed join</span>',aria:'Summoner’s Rift repeated decision locations'})+barRows(r,{label:'zone',value:'count',suffix:' signals'});}
      case'champion_tendencies':return championVisual(r);
      case'matchup_adjusted_lane':return matchupVisual(r);
      case'expected_performance_residual':return scatter(r,'expected','actual',{xLabel:'Expected DPM vs role',yLabel:'Actual DPM vs role',labelKey:'champion',diagonal:true,toneFn:x=>n(x.residual)>=0?'positive':'negative',legend:'<span><i class="positive"></i>above leave-one-out expectation</span><span><i class="negative"></i>below expectation</span>'})+barRows(r.slice(-12),{label:x=>(x.champion||'champ')+' vs '+(x.opponent||'opp'),value:'residual',suffix:' DPM',diverging:true});
      case'session_components':return barRows(r,{label:x=>x.label+' · raw '+signed(x.rawDelta,2)+' · n '+x.baselineN+'→'+x.recentN,value:'normalized',suffix:'× threshold',diverging:true});
      case'requeue_sweet_spot':return barRows(r.filter(x=>x.games>0),{label:x=>x.bucket+' · n='+x.games+(x.supported?'':' · thin'),value:'avgRelativeComposite',diverging:true});
      case'mistake_recurrence':return sparkline(r,'issues',{labelKey:'matchId'});
      case'automatic_replay_shortlist':return replayCards(report,r)+fightMap(report,'shortlist',r);
      default:return'<div class="di-visual-empty">Visual renderer unavailable for this metric.</div>';
    }
  }
  function analyticCard(a,index,report){
    const info=INFO[a?.id]||{group:'Other',measure:a?.summary||'',review:'Open linked matches for context.'};
    const evidence=evidenceRows(a),visual=visualFor(a,report),con=conclusion(a);
    return '<details class="di-card tone-'+statusTone(a?.status)+'" '+(index<4?'open':'')+'>'+
      '<summary><span class="di-index">'+String(index+1).padStart(2,'0')+'</span><div><strong>'+esc(a?.title||'Analysis')+'</strong><small>'+esc(statusLabel(a?.status))+' · n='+esc(a?.sample??0)+' · '+esc(info.group)+'</small></div><i></i></summary>'+
      '<div class="di-card-body"><div class="di-visual">'+visual+'</div>'+
      '<div class="di-interpretation"><div><span>What it measures</span><p>'+esc(info.measure)+'</p></div><div class="di-conclusion"><span>Conclusion from this sample</span><p>'+esc(con)+'</p></div><div><span>What to review</span><p>'+esc(info.review)+'</p></div></div>'+
      scalarEvidence(a?.evidence)+(evidence?'<details class="di-evidence-details"><summary>Underlying evidence · up to 8 rows</summary><div class="di-evidence-list">'+evidence+'</div></details>':'')+
      '</div></details>';
  }
  function groupHtml(group,analytics,report,startIndex){
    const xs=analytics.filter(a=>(INFO[a.id]?.group||'Other')===group);if(!xs.length)return'';
    return'<section class="di-group"><div class="di-group-head"><div><span>'+esc(group)+'</span><strong>'+xs.length+' visual review'+(xs.length===1?'':'s')+'</strong></div><small>Graph + explanation + conclusion + replay cue</small></div><div class="di-grid">'+xs.map((a,i)=>analyticCard(a,startIndex+i,report)).join('')+'</div></section>';
  }
  function shortlistCard(x,index,report){
    const g=gameMap(report).get(String(x.matchId)),src=g?champIcon(g.champion):'';
    return '<article class="di-shortlist-card"><div class="di-shortlist-rank">'+(index+1)+'</div>'+(src?'<img loading="lazy" src="'+esc(src)+'" alt="">':'')+'<div><span>'+esc(x.type||'Replay')+(num(x.minute)?' · '+fmt(x.minute,1)+'m':'')+'</span><strong>'+esc(x.reason||'Review this moment')+'</strong><small>'+esc(x.zone||'')+(num(x.score)?' · heuristic priority '+fmt(x.score,0):'')+'</small></div>'+(x.matchId?'<button class="button secondary tiny di-open-match" type="button" data-match-id="'+esc(x.matchId)+'">Open</button>':'')+'</article>';
  }
  function bind(box){
    box.querySelectorAll('.di-open-match').forEach(btn=>btn.addEventListener('click',()=>{
      const id=btn.dataset.matchId;if(!id)return;
      if(typeof window.openReplayReviewMatch==='function')window.openReplayReviewMatch(id,'fights');
      else document.getElementById('match-history')?.scrollIntoView({behavior:'smooth',block:'start'});
    }));
    if(typeof window.bindMapFallbacks==='function')window.bindMapFallbacks(box);
  }
  window.renderDecisionIntelligence=function(report){
    const panel=document.getElementById('decisionIntelligencePanel'),box=document.getElementById('decisionIntelligence');
    if(!panel||!box)return;
    const d=report?.decisionIntelligence,analytics=Array.isArray(d?.analytics)?d.analytics:[];
    if(!analytics.length){panel.hidden=true;box.innerHTML='';return;}
    const h=d?.headline||{},short=Array.isArray(d?.replayShortlist)?d.replayShortlist:[];
    const measured=analytics.filter(a=>a.status==='supported').length,proxy=analytics.filter(a=>a.status==='proxy').length,available=analytics.filter(a=>a.status!=='unavailable').length;
    let index=0;
    const groups=GROUP_ORDER.map(group=>{const count=analytics.filter(a=>(INFO[a.id]?.group||'Other')===group).length,html=groupHtml(group,analytics,report,index);index+=count;return html;}).join('');
    box.innerHTML=
      '<div class="di-headline">'+
        '<div class="di-headline-copy"><span>Decision intelligence · visual review</span><strong>'+esc(available)+' of 25 analytics currently have evidence</strong><p>The section now answers each question visually. Maps use the same Summoner’s Rift projection as the existing death/ward/roam review; opponent-relative charts keep a visible neutral point; every card explains what the graph means and what conclusion is justified.</p></div>'+
        '<div class="di-headline-stats"><span><b>'+esc(measured)+'</b> measured</span><span><b>'+esc(proxy)+'</b> explicit proxies</span><span><b>'+esc(h.thin||0)+'</b> thin</span><span><b>'+esc(h.unavailable||0)+'</b> unavailable</span></div>'+
      '</div>'+
      (short.length?'<section class="di-feature"><div class="section-subhead"><div><span>Start here</span><strong>Automatic replay shortlist</strong></div><small>The ten moments with the highest current learning value.</small></div><div class="di-shortlist-grid">'+short.slice(0,10).map((x,i)=>shortlistCard(x,i,report)).join('')+'</div>'+fightMap(report,'shortlist',short.slice(0,10))+'</section>':'')+
      groups+
      '<p class="source-note"><b>How to read this dashboard:</b> maps and charts are explanatory views of the same evidence already used by the analyzer. “Proxy” remains visibly separate from measured evidence. Exact live wave size, cooldown availability, hidden information, path safety and player intent are not invented when Riot data does not expose them.</p>';
    bind(box);panel.hidden=false;
  };
})();