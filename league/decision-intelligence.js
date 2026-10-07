(function(){
  const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
  const num=v=>v!==null&&v!==undefined&&v!==''&&Number.isFinite(Number(v));
  const n=v=>Number(v);
  const fmt=(v,d=1)=>num(v)?Number(v).toLocaleString(undefined,{maximumFractionDigits:d,minimumFractionDigits:0}):'—';
  const pct=(a,b)=>b?100*a/b:null;
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const rows=a=>Array.isArray(a?.moments)&&a.moments.length?a.moments:(Array.isArray(a?.evidence?.rows)?a.evidence.rows:[]);
  const statusLabel=s=>({supported:'Measured',proxy:'Proxy',thin:'Thin sample',unavailable:'No evidence'}[s]||s||'Context');
  const statusTone=s=>s==='supported'?'measured':s==='proxy'?'proxy':s==='thin'?'thin':'muted';
  const gameMap=report=>new Map((report?.games||[]).map(g=>[String(g.matchId),g]));
  const teamRelativePoint=(g,p)=>{
    if(!p||!num(p.x)||!num(p.y))return null;
    return Number(g?.teamId)===200?{x:15000-n(p.x),y:15000-n(p.y)}:{x:n(p.x),y:n(p.y)};
  };
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
    fight_decision_ledger:{group:'Fight decisions',measure:'Shows the measured evidence after skipped fights separately: direct-role gold/CS movement, structure/objective involvement and the fight kill result. No gold-equivalent score is invented.',review:'Start with no-compensation windows where the fight was lost and the distance screen was close enough to make the decision worth replaying. Then validate path, vision and wave state.'},
    arrival_feasibility:{group:'Fight decisions',measure:'Groups the sampled player-to-fight straight-line distance into near, borderline and far bands. The player frame can be tens of seconds from the fight event, so this is a distance screen only.',review:'Use near/borderline samples to choose replays, then check the actual route, movement options, fog and whether the fight was already committed.'},
    pre_fight_positioning:{group:'Fight decisions',measure:'Uses distinct pre-fight Riot timeline frames and displays their actual seconds-before-fight. Duplicate minute-cadence frames are collapsed.',review:'Look for repeated sampled routes that leave you farther from the fight as contact approaches. Because the frame cadence is coarse, use the timestamps shown rather than assuming literal 30/20/10-second tracking.'},
    fight_formation:{group:'Fight decisions',measure:'Uses only player-position frames no more than 45 seconds before contact and groups their distance from the fight anchor. Older frames are withheld instead of being mislabeled as entry spacing.',review:'Compare contribution and survival by band, but use this as routing/spacing context only. Closer is not automatically better for an ADC.'},
    numbers_aware_participation:{group:'Fight decisions',measure:'Uses a 4.5k-unit local ally/enemy count on the latest Riot timeline frame at or before the first kill. The frame age is disclosed, so this remains a coarse numbers snapshot rather than exact fight-start attendance.',review:'Prioritize ≥2-down losses, but verify the actual frame timing and whether the numbers disadvantage existed before commitment or formed during the fight.'},
    cross_map_efficiency:{group:'Fight decisions',measure:'Summarizes how often skipped-fight windows meet the current compensation rule and reports gold movement, CS movement, structures and objectives separately. It deliberately avoids a combined pseudo-currency score.',review:'Compare compensated and uncompensated windows, then validate whether the measured gain was actually enabled by staying away and whether the team concession outweighed it.'},
    wave_fight_conflict:{group:'Fight decisions',measure:'Uses direct-role CS and gold movement after a skipped fight as a resource-pressure proxy. The review flag uses ≥4 CS movement; exact live wave size is not available.',review:'For flagged windows, check whether the resource gain was truly available only by staying away and whether the team loss outweighed it.'},
    nothing_gained_isolation:{group:'Fight decisions',measure:'Counts skipped tracked fights where the next ~90 seconds do not meet the supported structure/objective/+250g/+6CS compensation rule. This does not prove literally nothing was gained. Overlapping review windows are merged before total time is reported.',review:'These are the cleanest “what did the current evidence support instead?” windows. Prioritize high-priority cases inside the distance screen.'},
    post_recall_tempo:{group:'Tempo & setup',measure:'For shop visits that have a tracked fight/objective within four minutes, measures shop→event time. The card also shows what share of all measured shops entered that conditional sample.',review:'Review short-gap shops where the subsequent event mattered. Do not interpret the median as typical of every recall because visits without action inside four minutes are excluded.'},
    objective_setup_path:{group:'Tempo & setup',measure:'Pairs the last measured shop with distinct coarse position samples requested around 90/60/30 seconds before a contested objective. Duplicate Riot frames are collapsed and actual seconds-before-objective are shown.',review:'For missed objectives, review the sampled setup route before contact rather than only the objective event. The route is coarse timeline context, not second-perfect movement tracking.'},
    lead_utilisation:{group:'Economy & conversion',measure:'Tracks paired direct-role Gold@15→Gold@25 movement for games starting at least +500g ahead, with explicit 500–999g, 1000–1499g and 1500g+ starting bands.',review:'Compare large leads that persist with those that compress, then review resets, deaths and map trades. Preserving gold difference is not by itself proof of correct lead utilization.'},
    deficit_recovery:{group:'Economy & conversion',measure:'Tracks paired games starting ≥500g behind at 15 and measures the signed change in direct-role gold difference by 25. Positive means the deficit narrowed; negative means it deepened.',review:'Compare narrowing and worsening deficits for safe farm, deaths, picks and objective fights. The movement is team-context evidence and does not assign individual credit.'},
    death_chains:{group:'Risk & recovery',measure:'Treats repeat deaths as sequences instead of independent events, using the existing post-death recovery windows.',review:'Start at the first death in the chain. The second death is often the symptom; the useful question is why the reset/re-entry after the first death failed.'},
    resource_to_impact:{group:'Fight decisions',measure:'Time-orders direct-role gold state before an active fight and records whether the reviewed player registered a tracked kill/assist contribution and survived.',review:'For ahead-without-contribution examples, inspect positioning, unspent gold, arrival timing and target access. This metric does not measure total fight damage or prove the fight should have been taken.'},
    fight_lead_conversion:{group:'Economy & conversion',measure:'After strict tracked fight wins, checks for a same-team structure/neutral-objective gain or a new reviewed-player kill/assist contribution in the following ~90 seconds.',review:'Open wins with no tracked follow-up. A reset or tempo exit can still be correct; this measures sequencing, not whether the macro decision was wrong.'},
    fight_loss_containment:{group:'Risk & recovery',measure:'Checks only whether a tracked lost fight is followed by another classified high-risk death within roughly 90 seconds. It does not measure broader gold/objective containment.',review:'Open losses followed by another flagged death and ask whether the second risk was avoidable. Do not call the other cases fully contained losses.'},
    objective_trading:{group:'Tempo & setup',measure:'Shows skipped-fight windows that overlap reviewed-player-supported structure or neutral-objective involvement within ~90 seconds.',review:'Validate whether staying away was necessary for the gain and compare it with what the team conceded. The measured fact is timing overlap, not causal trade quality.'},
    geographical_clusters:{group:'Map patterns',measure:'Combines high-priority skipped-fight review locations and supported high-risk-death areas to expose repeated map locations that deserve replay attention.',review:'Repeated location is a review clue, not proof of a mistake. Check whether the same pathing, vision or spacing decision actually repeats inside that zone.'},
    champion_tendencies:{group:'Champion context',measure:'Groups only your own games by champion and compares decision/risk tendencies rather than teammate performance.',review:'Use this to identify champion-specific habits: e.g. safer fight entry on one ADC but more empty cross-map time on another.'},
    matchup_adjusted_lane:{group:'Lane & opponent context',measure:'Builds personal-history own-champion × direct-opponent-champion cells for lane gold and DPM-vs-peer context. A comparison is promoted only when at least two matchup cells have ≥3 games.',review:'Use repeated cells as personal context only. One supported matchup can be described, but it cannot establish a best/worst matchup ranking or a population matchup rule.'},
    expected_performance_residual:{group:'Lane & opponent context',measure:'Compares actual opponent-adjusted DPM with a hierarchical leave-one-out personal-history expectation. The recent headline uses the median residual to reduce sensitivity to extreme games.',review:'Use residuals to find unusual games versus your own context. It remains descriptive and does not fully control draft, lane state, team state or MMR.'},
    session_components:{group:'Session patterns',measure:'Breaks the opener→game-3+ answer into evidence-gated signals normalized by each metric’s practical-change threshold. Unlike units are never plotted on one raw scale.',review:'Look for the largest normalized shift, then use the raw delta and sample counts to identify the behavior that actually changed.'},
    requeue_sweet_spot:{group:'Session patterns',measure:'Compares requeue-gap buckets using a normalized direct-opponent performance composite from the longer same-role history when available.',review:'Only use buckets with enough games. The highest observed bucket is descriptive scheduling context, not evidence that a particular break length improves performance.'},
    mistake_recurrence:{group:'Learning progress',measure:'Tracks supported review-signal load game by game by category. It does not call every signal a mistake and does not claim a target-linked half-life without a defensible intervention start point.',review:'Use the line and category counts to see whether risky deaths, pre-objective deaths, reset absences or missed-join reviews are actually receding.'},
    automatic_replay_shortlist:{group:'Replay review',measure:'Ranks concrete moments with a transparent review-priority heuristic and diversity caps so one match or one event type cannot monopolize the list.',review:'Start here when you do not want to review every match. Priority is only an ordering aid, not measured severity, probability, causality or blame.'}
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
    const evidenceRows=Array.isArray(a?.evidence?.rows)?a.evidence.rows:[];
    return evidenceRows.slice(0,8).map(row=>{
      const bits=Object.entries(row||{}).filter(([k,v])=>!['matchId','checkpoints'].includes(k)&&v!=null&&typeof v!=='object').slice(0,5)
        .map(([k,v])=>'<span><b>'+esc(k.replace(/([A-Z])/g,' $1').replace(/_/g,' '))+'</b> '+esc(simpleValue(v))+'</span>').join('');
      const checkpoints=Array.isArray(row?.checkpoints)?'<small>'+row.checkpoints.map(x=>esc((num(x.actualLeadSec)?fmt(x.actualLeadSec,0)+'s before':num(x.requestedSec)?'requested '+fmt(x.requestedSec,0)+'s':'sample')+': '+(x.zone||'unknown')+(num(x.distance)?' · '+fmt(x.distance,0)+'u':''))).join(' · ')+'</small>':'';
      const match=row?.matchId?'<button class="button secondary tiny di-open-match" type="button" data-match-id="'+esc(row.matchId)+'">Open match</button>':'';
      return '<div class="di-evidence-row"><div>'+bits+checkpoints+'</div>'+match+'</div>';
    }).join('');
  }
  function conclusion(a){
    const r=rows(a),e=a?.evidence||{};
    switch(a?.id){
      case'fight_decision_ledger':{const supported=r.filter(x=>x.tradeSupported===true).length,high=r.filter(x=>x.joinReviewPriority==='high').length;return r.length?supported+'/'+r.length+' skipped-fight windows met the compensation rule; '+high+' were high-priority no-compensation join reviews. Gold, CS, structures/objectives and fight kills are deliberately kept separate.':'No skipped-fight trade evidence is available.';}
      case'arrival_feasibility':return r.length?String((e.near||0)+(e.borderline||0))+' of '+r.length+' skipped-fight position samples are within the 6.5k straight-line screen ('+String(e.near||0)+' near, '+String(e.borderline||0)+' borderline). Median player-frame distance from the fight event anchor in time is '+fmt(e.medianPositionSampleDeltaSec,0)+'s; this does not prove arrival was possible.':'No position-supported skipped fights.';
      case'pre_fight_positioning':{const earliest=r.map(x=>x.checkpoints?.slice().sort((a,b)=>n(b.actualLeadSec)-n(a.actualLeadSec))[0]).filter(Boolean),latest=r.map(x=>x.checkpoints?.slice().sort((a,b)=>n(a.actualLeadSec)-n(b.actualLeadSec))[0]).filter(Boolean),a0=avg(earliest.map(x=>x.distance)),a1=avg(latest.map(x=>x.distance)),lead0=avg(earliest.map(x=>x.actualLeadSec)),lead1=avg(latest.map(x=>x.actualLeadSec));return num(a0)&&num(a1)?'Across fights with distinct pre-fight frames, the earliest retained sample averages '+fmt(a0,0)+'u away at '+fmt(lead0,0)+'s before contact and the latest averages '+fmt(a1,0)+'u away at '+fmt(lead1,0)+'s. Actual sample times are shown because Riot frames are too coarse for literal 30/20/10 tracking.':'The available frames are too sparse for one aggregate distance conclusion; use the map examples.';}
      case'fight_formation':{const bands={};r.forEach(x=>bands[x.formationBand]=(bands[x.formationBand]||0)+1);const top=Object.entries(bands).sort((a,b)=>b[1]-a[1])[0],lead=avg(r.map(x=>x.sampleLeadSec));return top?'Among '+r.length+' position samples within 45s of contact, “'+top[0]+'” is most common ('+top[1]+'), with an average sample age of '+fmt(lead,0)+'s. '+fmt(e.withheldCoarseFrames,0)+' older frames were withheld.':'No fight-anchor distance sample is close enough to contact.';}
      case'numbers_aware_participation':return r.length?(String(e.outnumberedStarts||0)+' sampled fights were down ≥2, '+String(e.downOneStarts||0)+' down one, '+String((e.evenStarts||0)+(e.aheadStarts||0))+' even/ahead. The ≥2-down group lost '+(num(e.outnumberedLossRate)?fmt(e.outnumberedLossRate,0)+'%':'—')+'; local counts come from a coarse pre/at-first-kill frame (median age '+fmt(e.medianNumberSampleLeadSec,0)+'s).'):'No local-number sample.';
      case'cross_map_efficiency':return num(e.supportedRate)?fmt(e.supportedRate,0)+'% of skipped-fight windows met at least one compensation rule. Median direct-role movement was '+signed(e.medianGoldSwing,0)+'g and '+signed(e.medianCsSwing,1)+' CS; these are separate signals, not additive value.':a.summary;
      case'wave_fight_conflict':{const conflicts=r.filter(x=>x.likelyResourceConflict).length,lost=r.filter(x=>x.likelyResourceConflict&&x.fightLost).length;return conflicts?conflicts+' skipped fights crossed the ≥'+fmt(e.csConflictThreshold??4,0)+' CS movement review threshold; '+lost+' of those coincided with a lost fight. This is a replay-priority flag, not proof the wave/fight choice was wrong.':'No skipped fight crossed the current CS-movement review threshold.';}
      case'nothing_gained_isolation':return r.length?String(e.highPriority||0)+' of '+r.length+' skipped-fight windows without supported compensation are high-priority join reviews. The rule failing does not mean literally zero value was gained.':'No skipped-fight window lacks supported compensation.';
      case'post_recall_tempo':return num(e.medianGapMin)?fmt(e.pairedEventVisits,0)+' of '+fmt(e.totalShopVisits,0)+' measured shop visits had a tracked fight/objective inside four minutes ('+fmt(e.pairedVisitRate,0)+'%). Within that conditional sample, the median gap is '+fmt(e.medianGapMin,1)+' minutes.':a.summary;
      case'objective_setup_path':{const joined=r.filter(x=>x.joined).length;return r.length?'Tracked objective paths show '+joined+'/'+r.length+' presence in this sample. Misses should be reviewed from the prior shop/approach rather than from objective spawn alone.':'No objective setup paths.';}
      case'lead_utilisation':{const known=r.filter(x=>x.retainedTo25!==null&&x.retainedTo25!==undefined),kept=known.filter(x=>x.retainedTo25===true).length;return known.length?kept+'/'+known.length+' paired ≥500g-at-15 games retained at least half the direct-role gold lead by 25. This describes lead movement, not whether the lead was correctly utilized.':'No ≥500g-at-15 game has a usable 25-minute checkpoint.';}
      case'deficit_recovery':{const known=r.filter(x=>num(x.recovery)),even=known.filter(x=>x.recoveredToEven).length,m=avg(known.map(x=>x.recovery));return known.length?even+'/'+known.length+' measured large deficits reached roughly even by 25; average gold-difference movement was '+signed(m,0)+'g ('+(n(m)>0?'deficit narrowed on average':n(m)<0?'deficit deepened on average':'no average movement')+').':'No large-deficit game has a usable 25-minute checkpoint.';}
      case'death_chains':return a.summary||'No repeat-death chains.';
      case'resource_to_impact':return num(e.aheadFightContributionRate)?'When starting ≥300g ahead, a tracked kill/assist contribution occurred in '+fmt(e.aheadFightContributionRate,0)+'% of measured active fights. Review ahead-without-contribution examples, but do not read this as total damage or fight-quality efficiency.':a.summary;
      case'fight_lead_conversion':return num(e.followUpRate)?fmt(e.followUpRate,0)+'% of strict tracked fight wins had a measured follow-up signal within ~90 seconds. This is sequencing evidence; wins without one are review clips, not automatic macro failures.':a.summary;
      case'fight_loss_containment':return num(e.noExtraRiskDeathRate)?'After tracked fight losses, '+fmt(e.noExtraRiskDeathRate,0)+'% had no additional classified high-risk death in the next ~90s. That does not mean the broader gold/objective loss was contained.':a.summary;
      case'objective_trading':{const s=r.reduce((q,x)=>q+n(x.structures||0),0),o=r.reduce((q,x)=>q+n(x.objectives||0),0);return r.length?r.length+' skipped-fight windows overlapped '+s+' supported structure involvement signal(s) and '+o+' neutral-objective involvement signal(s). Replay is still required to judge whether skipping enabled or justified the gain.':'No skipped-fight window overlapped tracked structure/objective involvement.';}
      case'geographical_clusters':{const top=r[0];return top?'The densest repeated review zone is '+top.zone+' with '+top.count+' supported signal(s). Treat this as a place to inspect repeated decisions, not proof that the zone itself or every event there was a mistake.':'No repeated geography cluster.';}
      case'champion_tendencies':{const eligible=r.filter(x=>n(x.games)>=3);if(eligible.length<2)return eligible.length===1?eligible[0].champion+' is the only champion with ≥3 deep games, so this card is descriptive for that champion and cannot support a cross-champion tendency comparison.':'No champion has three deep games yet for a useful tendency comparison.';const safest=[...eligible].filter(x=>num(x.riskyDeathsPerGame)).sort((a,b)=>n(a.riskyDeathsPerGame)-n(b.riskyDeathsPerGame))[0];return safest?safest.champion+' currently has the lowest risky-death rate among champions with ≥3 games ('+fmt(safest.riskyDeathsPerGame,2)+'/game). Compare its spacing/routing with the others.':'Champion samples are still mixed.';}
      case'matchup_adjusted_lane':{const s=r.filter(x=>n(x.games)>=3&&num(x.avgGold15));if(!s.length)return'No matchup cell has three comparable lane samples yet; keep this contextual.';if(s.length===1)return s[0].matchup+' is the only matchup with ≥3 comparable lane games ('+signed(s[0].avgGold15,0)+'g average Gold@15). There is not enough repeated matchup evidence to rank best versus worst.';const best=[...s].sort((a,b)=>n(b.avgGold15)-n(a.avgGold15))[0],worst=[...s].sort((a,b)=>n(a.avgGold15)-n(b.avgGold15))[0];return'Among '+s.length+' repeated personal-history cells, '+best.matchup+' is strongest at 15 ('+signed(best.avgGold15,0)+'g) and '+worst.matchup+' is weakest ('+signed(worst.avgGold15,0)+'g).';}
      case'expected_performance_residual':return num(e.recentResidual)?'Median residual across the latest '+fmt(e.recentResidualGames,0)+' comparable deep games is '+signed(e.recentResidual,0)+' DPM versus the hierarchical leave-one-out personal-history expectation. It does not mean “better than MMR” or isolate individual skill.':a.summary;
      case'session_components':{if(!r.length)return'No session component has enough evidence.';const biggest=[...r].sort((a,b)=>Math.abs(n(b.normalized))-Math.abs(n(a.normalized)))[0];return'Largest practical-change shift is '+biggest.label+' at '+signed(biggest.normalized,2)+'× its threshold ('+signed(biggest.rawDelta,2)+' raw). Positive normalized values mean better later-session performance after inverse metrics are corrected.';}
      case'requeue_sweet_spot':{const b=e.best;return b?'Among requeue buckets with at least '+fmt(e.minimumBucketGames,0)+' games, the highest observed opponent-relative composite is '+b.bucket+' (n='+b.games+'). This is descriptive scheduling context without causal or uncertainty claims.':'No requeue bucket has at least five comparable games.';}
      case'mistake_recurrence':{if(!num(e.recentFive))return a.summary;const delta=num(e.priorFive)?n(e.recentFive)-n(e.priorFive):null;return'Latest five-game supported review-signal load is '+fmt(e.recentFive,2)+'/game'+(num(delta)?' ('+signed(delta,2)+' versus the prior five).':'')+' This is a recurrence trend, not proof that every signal is a mistake and not a target-linked half-life.';}
      case'automatic_replay_shortlist':{const top=r[0];return top?'The shortlist is diversity-capped across matches and event types. Highest current priority is '+(top.type||'review')+(num(top.minute)?' at '+fmt(top.minute,1)+'m':'')+': '+top.reason+'.':'No replay moment crossed the current rules.';}
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
    const cls=(x,i)=>esc(x.tone||('s'+(i%5)));
    const segs=valid.map((x,i)=>{const p=n(x.value)/total*100,start=acc;acc+=p;return'<i class="seg '+cls(x,i)+'" style="left:'+start+'%;width:'+p+'%"></i>';}).join('');
    return '<div class="di-share"><div class="di-share-bar">'+segs+'</div><div class="di-share-legend">'+valid.map((x,i)=>'<span><i class="'+cls(x,i)+'"></i><b>'+esc(x.label)+'</b> '+fmt(n(x.value)/total*100,0)+'%</span>').join('')+'</div></div>';
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
    const zero=min<=0&&max>=0?'<line class="di-zero-line" x1="55" y1="'+py(0).toFixed(1)+'" x2="445" y2="'+py(0).toFixed(1)+'"/>':'';return '<div class="di-svg-chart"><svg viewBox="0 0 500 210" role="img">'+zero+lines+'<text x="100" y="202">'+esc(startLabel)+'</text><text x="400" y="202">'+esc(endLabel)+'</text></svg></div>';
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
    return '<div class="di-map-wrap"><div class="map-stage di-map-stage"><img loading="lazy" src="'+esc(mapImage())+'" data-map-fallback="'+esc(mapFallback())+'" alt="'+esc(aria)+'"><svg viewBox="0 0 512 512" preserveAspectRatio="none">'+svgLines+svgPts+'</svg></div>'+(legend?'<div class="di-map-legend">'+legend+'</div>':'')+'<div class="di-map-basis">Team-relative orientation · reviewed team base is bottom-left</div></div>';
  }
  function fightMap(report,mode,shortlist=[]){
    const pts=[],lines=[];
    for(const g of report?.games||[]){
      const all=[...(g?.fightProfile?.events||[]),...(g?.fightProfile?.absenceEvents||[])];
      for(const e of all){
        if(!e?.fightPosition||!num(e.startMin))continue;
        const absent=(g?.fightProfile?.absenceEvents||[]).includes(e);
        const fightPos=teamRelativePoint(g,e.fightPosition),playerPos=teamRelativePoint(g,e.playerPosition);
        if(!fightPos)continue;
        if(mode==='pre'){
          const fr=nearestFrame(g,n(e.startMin)-.5),prePos=teamRelativePoint(g,fr?.position);
          if(prePos){lines.push({a:prePos,b:fightPos,tone:absent?'warn':'neutral',title:g.champion+' · '+fmt(e.startMin,1)+'m · coarse pre-fight sample to '+(e.fightZone||'fight')});pts.push({position:prePos,tone:'player',r:5,title:g.champion+' · sampled pre-fight position'});}
          pts.push({position:fightPos,tone:absent?'warn':'fight',r:7,title:(e.fightZone||'Fight')+' · '+fmt(e.startMin,1)+'m'});
        }else if(mode==='geo'){
          if(absent&&e.joinReviewPriority==='high')pts.push({position:fightPos,tone:'review',r:9,title:'High-priority skipped-fight review · '+(e.fightZone||'')+' · '+fmt(e.startMin,1)+'m'});
          else if(absent&&e.crossMapTradeSupported===true)pts.push({position:fightPos,tone:'neutral',r:8,title:'Skipped fight with supported compensation · '+(e.fightZone||'')});
        }else if(mode==='trade'){
          if(absent&&(n(e.playerStructureGains||0)>0||n(e.playerNeutralObjectiveGains||0)>0)){
            pts.push({position:fightPos,tone:'fight',r:7,title:'Fight location · '+(e.fightZone||'')});
            if(playerPos){pts.push({position:playerPos,tone:'player',r:7,title:'Reviewed player position'});lines.push({a:playerPos,b:fightPos,tone:'neutral',title:'Separation during overlapping structure/objective window'});}
          }
        }else if(mode==='shortlist'){
          const wanted=shortlist.filter(x=>String(x.matchId)===String(g.matchId)&&num(x.minute));
          for(const w of wanted)if(Math.abs(n(w.minute)-n(e.startMin))<.15)pts.push({position:fightPos,tone:'review',r:10,label:String(shortlist.indexOf(w)+1),title:'#'+(shortlist.indexOf(w)+1)+' '+w.reason});
        }
      }
    }
    const legends={pre:'<span><i class="player"></i>sampled player position</span><span><i class="fight"></i>fight anchor</span>',geo:'<span><i class="review"></i>high-priority skipped-fight review</span><span><i class="neutral"></i>supported compensation</span>',trade:'<span><i class="player"></i>reviewed player position</span><span><i class="fight"></i>fight location</span>',shortlist:'<span><i class="review"></i>ranked replay moment</span>'};
    return mapStage(pts,{lines,legend:legends[mode]||'',aria:'Summoner’s Rift '+mode+' decision map'});
  }
  function preFightMap(r,report){
    const pts=[],lines=[],gm=gameMap(report);
    for(const row of r){
      const g=gm.get(String(row.matchId)),fight=teamRelativePoint(g,row?.fightPosition);if(!fight)continue;
      pts.push({position:fight,tone:'fight',r:8,title:(row.fightZone||'Fight')+' · '+fmt(row.minute,1)+'m'});
      const cp=(row.checkpoints||[]).filter(x=>x?.position&&num(x.actualLeadSec)).sort((a,b)=>n(b.actualLeadSec)-n(a.actualLeadSec));
      const norm=cp.map(x=>({...x,normalizedPosition:teamRelativePoint(g,x.position)})).filter(x=>x.normalizedPosition);
      for(const x of norm)pts.push({position:x.normalizedPosition,tone:'player',r:5,title:'Actual sample '+fmt(x.actualLeadSec,0)+'s before fight · '+(x.zone||'unknown')});
      if(norm.length)lines.push({a:norm[0].normalizedPosition,b:fight,tone:'neutral',title:'Earliest distinct sampled pre-fight frame → fight anchor'});
    }
    return mapStage(pts,{lines,legend:'<span><i class="player"></i>distinct sampled pre-fight frame</span><span><i class="fight"></i>fight anchor</span>',aria:'Summoner’s Rift pre-fight positioning map'});
  }
  function formationVisual(r){
    const bands=[...new Set(r.map(x=>x.formationBand).filter(Boolean))];
    if(!bands.length)return'<div class="di-visual-empty">No formation bands to graph.</div>';
    return '<div class="di-formation-grid">'+bands.map(b=>{const xs=r.filter(x=>x.formationBand===b),con=xs.filter(x=>x.contributed).length,surv=xs.filter(x=>x.survived).length;return'<article><strong>'+esc(b)+'</strong><span><b>'+xs.length+'</b> fights</span><span><b>'+fmt(pct(con,xs.length),0)+'%</b> contribution</span><span><b>'+fmt(pct(surv,xs.length),0)+'%</b> survival</span></article>';}).join('')+'</div>';
  }
  function objectivePathMap(r,report){
    const pts=[],lines=[],gm=gameMap(report);
    for(const row of r){
      const g=gm.get(String(row.matchId));
      const samples=(Array.isArray(row?.approachSamples)?row.approachSamples:[])
        .filter(x=>x?.position&&num(x.actualLeadSec)).slice().sort((a,b)=>n(b.actualLeadSec)-n(a.actualLeadSec));
      if(!samples.length&&row?.approachPosition)samples.push({position:row.approachPosition,zone:row.approachZone,actualLeadSec:row.actualApproachLeadSec});
      const norm=samples.map(x=>({...x,normalizedPosition:teamRelativePoint(g,x.position)})).filter(x=>x.normalizedPosition);
      norm.forEach((x,i)=>pts.push({position:x.normalizedPosition,tone:row.joined?'player':'warn',r:i===norm.length-1?7:5,
        title:(row.objective||'objective')+' · '+(num(x.actualLeadSec)?fmt(x.actualLeadSec,0)+'s before · ':'')+(x.zone||'unknown')+' · '+(row.joined?'present':'absent')}));
      for(let i=1;i<norm.length;i++)lines.push({a:norm[i-1].normalizedPosition,b:norm[i].normalizedPosition,tone:row.joined?'neutral':'warn',title:(row.objective||'objective')+' · coarse sampled setup route'});
    }
    return mapStage(pts,{lines,legend:'<span><i class="player"></i>sampled route · present</span><span><i class="warn"></i>sampled route · absent</span>',aria:'Summoner’s Rift objective setup route map'});
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

  function miniStats(items){
    return '<div class="di-mini-summary">'+items.filter(x=>x&&x.value!==undefined&&x.value!==null).map(x=>'<span><b>'+esc(x.value)+'</b><small>'+esc(x.label)+'</small></span>').join('')+'</div>';
  }
  function tradeEvidenceVisual(r,e){
    const supported=r.filter(x=>x.tradeSupported===true).length,unsupported=Math.max(0,r.length-supported);
    const bars=[...r].filter(x=>num(x.goldSwing)).sort((a,b)=>{
      const pr=x=>x.joinReviewPriority==='high'?3:x.joinReviewPriority==='medium'?2:1;
      return pr(b)-pr(a)||Math.abs(n(b.goldSwing))-Math.abs(n(a.goldSwing));
    });
    return shareVisual([{label:'Compensation rule met',value:supported,tone:'neutral'},{label:'No supported compensation',value:unsupported,tone:'muted'}])+
      miniStats([
        {value:fmt(e.supportedTrades??supported,0),label:'supported windows'},
        {value:fmt(e.unsupportedTrades??unsupported,0),label:'unsupported windows'},
        {value:'separate',label:'gold / CS / structures / objectives'}
      ])+
      barRows(bars,{label:x=>(x.zone||'fight')+' · '+fmt(x.minute,1)+'m',value:'goldSwing',suffix:'g vs role',diverging:true,maxRows:8});
  }
  function crossCompVisual(r,e){
    return shareVisual([{label:'Compensation rule met',value:n(e.supportedWindows||0),tone:'neutral'},{label:'No supported compensation',value:n(e.unsupportedWindows||0),tone:'muted'}])+
      miniStats([
        {value:fmt(e.medianGoldSwing,0)+'g',label:'median role-gold movement'},
        {value:signed(e.medianCsSwing,1),label:'median CS movement'},
        {value:fmt(e.structureWindows,0),label:'windows with structure involvement'},
        {value:fmt(e.objectiveWindows,0),label:'windows with neutral-objective involvement'},
        {value:fmt(e.economyOnlyWindows,0),label:'economy-only compensated windows'}
      ]);
  }
  function recallTempoVisual(r,e){
    const other=Math.max(0,n(e.totalShopVisits||0)-n(e.pairedEventVisits||0));
    return shareVisual([{label:'Tracked fight/objective ≤4m',value:n(e.pairedEventVisits||0),tone:'neutral'},{label:'No tracked event ≤4m',value:other,tone:'muted'}])+
      barRows([...r].sort((a,b)=>n(a.gapMin||0)-n(b.gapMin||0)),{label:x=>(x.nextKind||'event')+' · '+(x.approachZone||'unknown'),value:'gapMin',suffix:'m',maxRows:8});
  }
  function visualFor(a,report){
    const r=rows(a),e=a?.evidence||{};
    switch(a?.id){
      case'fight_decision_ledger':return tradeEvidenceVisual(r,e);
      case'arrival_feasibility':return shareVisual([{label:'Near ≤4k',value:n(e.near||0),tone:'warn'},{label:'Borderline 4–6.5k',value:n(e.borderline||0),tone:'neutral'},{label:'Far >6.5k',value:n(e.far||0),tone:'muted'}]);
      case'pre_fight_positioning':return preFightMap(r.slice(0,36),report);
      case'fight_formation':return formationVisual(r);
      case'numbers_aware_participation':return shareVisual([{label:'Down ≥2',value:n(e.outnumberedStarts||0),tone:'bad'},{label:'Down 1',value:n(e.downOneStarts||0),tone:'warn'},{label:'Even',value:n(e.evenStarts||0),tone:'neutral'},{label:'Ahead',value:n(e.aheadStarts||0),tone:'good'}]);
      case'cross_map_efficiency':return crossCompVisual(r,e);
      case'wave_fight_conflict':return scatter(r,'csSwing','goldSwing',{xLabel:'CS movement vs role',yLabel:'Gold movement vs role',labelKey:'zone',toneFn:x=>x.fightLost?'negative':'positive',legend:'<span><i class="negative"></i>team lost tracked fight</span><span><i class="positive"></i>team did not lose tracked fight</span>'});
      case'nothing_gained_isolation':return shareVisual([{label:'High-priority review',value:n(e.highPriority||0),tone:'bad'},{label:'Other uncompensated',value:Math.max(0,r.length-n(e.highPriority||0)),tone:'warn'}]);
      case'post_recall_tempo':return recallTempoVisual(r,e);
      case'objective_setup_path':return shareVisual([{label:'Present',value:r.filter(x=>x.joined).length,tone:'neutral'},{label:'Absent',value:r.filter(x=>!x.joined).length,tone:'warn'}])+objectivePathMap(r.slice(0,40),report)+'<div class="di-path-chips">'+r.slice(0,8).map(x=>'<span><b>'+esc(x.objective||'objective')+'</b><i>shop '+(num(x.shopLeadMin)?fmt(x.shopLeadMin,1)+'m before':'?')+'</i><em>→</em><i>'+esc(x.approachZone||'unknown')+(num(x.actualApproachLeadSec)?' · '+fmt(x.actualApproachLeadSec,0)+'s before':'')+(Array.isArray(x.approachSamples)&&x.approachSamples.length>1?' · '+x.approachSamples.length+' route samples':'')+'</i><em>→</em><i>'+esc(x.joined?'present':'absent')+'</i></span>').join('')+'</div>';
      case'lead_utilisation':return miniStats([{value:fmt(e.leadBands?.['500–999g'],0),label:'500–999g starts'},{value:fmt(e.leadBands?.['1000–1499g'],0),label:'1000–1499g starts'},{value:fmt(e.leadBands?.['1500g+'],0),label:'1500g+ starts'}])+slope(r,'gold15','gold25',{startLabel:'Gold@15',endLabel:'Gold@25'});
      case'deficit_recovery':return slope(r,'gold15','gold25',{startLabel:'Gold@15',endLabel:'Gold@25'});
      case'death_chains':{const rr=(e.repeatGames||[]).map(x=>({label:shortMatch(x.matchId),value:n(x.repeatDeaths||0)}));return barRows(rr,{value:'value',suffix:' repeat'});}
      case'resource_to_impact':return scatter(r,'goldDiffAtStart','currentGold',{xLabel:'Gold diff vs role',yLabel:'Unspent gold',labelKey:'matchId',toneFn:x=>x.contributed?'positive':'negative',legend:'<span><i class="positive"></i>tracked contribution</span><span><i class="negative"></i>no tracked contribution</span>'});
      case'fight_lead_conversion':return shareVisual([{label:'Tracked follow-up',value:r.filter(x=>x.followUp).length,tone:'neutral'},{label:'No tracked follow-up',value:r.filter(x=>!x.followUp).length,tone:'muted'}]);
      case'fight_loss_containment':return shareVisual([{label:'No extra flagged death',value:r.filter(x=>x.noExtraRiskDeath).length,tone:'neutral'},{label:'Extra flagged death ≤90s',value:r.filter(x=>!x.noExtraRiskDeath).length,tone:'bad'}]);
      case'objective_trading':return fightMap(report,'trade')+barRows(r,{label:x=>(x.fightZone||'trade')+' '+fmt(x.minute,1)+'m',value:'goldSwing',suffix:'g',diverging:true});
      case'geographical_clusters':{const mapEvents=Array.isArray(e.mapEvents)?e.mapEvents:[],gm=gameMap(report);const pts=mapEvents.map(x=>{const g=gm.get(String(x.matchId));return{position:teamRelativePoint(g,x.position),tone:x.type==='bad_death'?'bad':'review',r:x.type==='bad_death'?7:9,title:(x.type==='bad_death'?'High-risk death':'High-priority missed-join review')+' · '+(x.zone||'unknown')+' · '+fmt(x.minute,1)+'m'};}).filter(x=>x.position);return mapStage(pts,{legend:'<span><i class="bad"></i>high-risk death</span><span><i class="review"></i>high-priority missed-join review</span>',aria:'Summoner’s Rift repeated decision locations'})+barRows(r,{label:'zone',value:'count',suffix:' signals'});}
      case'champion_tendencies':return championVisual(r);
      case'matchup_adjusted_lane':return matchupVisual(r);
      case'expected_performance_residual':return scatter(r,'expected','actual',{xLabel:'Expected DPM vs role',yLabel:'Actual DPM vs role',labelKey:'champion',diagonal:true,toneFn:x=>n(x.residual)>=0?'positive':'negative',legend:'<span><i class="positive"></i>above leave-one-out expectation</span><span><i class="negative"></i>below expectation</span>'})+barRows(r.slice(-12),{label:x=>(x.champion||'champ')+' vs '+(x.opponent||'opp'),value:'residual',suffix:' DPM',diverging:true});
      case'session_components':return barRows(r,{label:x=>x.label+' · raw '+signed(x.rawDelta,2)+' · n '+x.baselineN+'→'+x.recentN,value:'normalized',suffix:'× threshold',diverging:true});
      case'requeue_sweet_spot':return barRows(r.filter(x=>x.games>0),{label:x=>x.bucket+' · n='+x.games+(x.supported?'':' · <5'),value:'avgRelativeComposite',diverging:true});
      case'mistake_recurrence':return sparkline(r,'issues',{labelKey:'matchId'});
      case'automatic_replay_shortlist':return replayCards(report,r)+fightMap(report,'shortlist',r);
      default:return'<div class="di-visual-empty">Visual renderer unavailable for this metric.</div>';
    }
  }
  function analyticCard(a,index,report){
    const info=INFO[a?.id]||{group:'Other',measure:a?.summary||'',review:'Open linked matches for context.'};
    const evidence=evidenceRows(a),visual=visualFor(a,report),con=conclusion(a);
    return '<details class="di-card tone-'+statusTone(a?.status)+'" '+(index<2?'open':'')+'>'+
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
        '<div class="di-headline-copy"><span>Decision intelligence · visual review</span><strong>'+esc(available)+' of 25 analytics currently have usable evidence</strong><p>Each card pairs evidence with a matching visual and a bounded conclusion. Timeline-heavy decisions use '+esc(d?.deepGames??d?.generatedFromGames??'—')+' deep games; eligible match-level context can use '+esc(d?.historyGames??d?.deepGames??d?.generatedFromGames??'—')+' same-role history games. Thin and unavailable evidence stays separate from measured and proxy results.</p></div>'+
        '<div class="di-headline-stats"><span><b>'+esc(measured)+'</b> measured</span><span><b>'+esc(proxy)+'</b> explicit proxies</span><span><b>'+esc(h.thin||0)+'</b> thin</span><span><b>'+esc(h.unavailable||0)+'</b> unavailable</span></div>'+
      '</div>'+
      (short.length?'<section class="di-feature"><div class="section-subhead"><div><span>Start here</span><strong>Automatic replay shortlist</strong></div><small>The highest-priority current review moments under the transparent replay heuristic.</small></div><div class="di-shortlist-grid">'+short.slice(0,10).map((x,i)=>shortlistCard(x,i,report)).join('')+'</div>'+fightMap(report,'shortlist',short.slice(0,10))+'</section>':'')+
      groups+
      '<p class="source-note"><b>How to read this dashboard:</b> maps and charts are explanatory views of the same evidence already used by the analyzer. “Proxy” remains visibly separate from measured evidence. Exact live wave size, cooldown availability, hidden information, path safety and player intent are not invented when Riot data does not expose them.</p>';
    bind(box);panel.hidden=false;
  };
})();