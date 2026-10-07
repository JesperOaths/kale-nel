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
    fight_formation:{group:'Fight decisions',measure:'Plots the actual age of each usable pre-fight position sample against its distance from the fight anchor. Samples older than 45 seconds are withheld; no arbitrary core/backline distance bands are imposed.',review:'Use outlying points to select replays, then inspect actual ADC spacing, terrain and target access. The chart deliberately does not define one “correct” distance.'},
    numbers_aware_participation:{group:'Fight decisions',measure:'Uses a 4.5k-unit local ally/enemy count on the latest Riot timeline frame at or before the first kill and shows the observed loss rate inside each numbers state. Frame age is disclosed, so this remains a coarse snapshot.',review:'Compare loss rates by numbers state, but verify replay before blaming a fight: the sampled disadvantage may have formed after commitment.'},
    cross_map_efficiency:{group:'Fight decisions',measure:'Summarizes how often skipped-fight windows meet the current compensation rule and reports gold movement, CS movement, structures and objectives separately. It deliberately avoids a combined pseudo-currency score.',review:'Compare compensated and uncompensated windows, then validate whether the measured gain was actually enabled by staying away and whether the team concession outweighed it.'},
    wave_fight_conflict:{group:'Fight decisions',measure:'Uses direct-role CS and gold movement after a skipped fight as a resource-pressure proxy. The review flag uses ≥4 CS movement; exact live wave size is not available.',review:'For flagged windows, check whether the resource gain was truly available only by staying away and whether the team loss outweighed it.'},
    nothing_gained_isolation:{group:'Fight decisions',measure:'Counts skipped tracked fights where the next ~90 seconds do not meet the supported structure/objective/+250g/+6CS compensation rule. This does not prove literally nothing was gained. Overlapping review windows are merged before total time is reported.',review:'These are the cleanest “what did the current evidence support instead?” windows. Prioritize high-priority cases inside the distance screen.'},
    post_recall_tempo:{group:'Tempo & setup',measure:'For shop visits that have a tracked fight/objective within four minutes, measures recall/shop completion → next tracked action time. The denominator of all measured shops is shown so the conditional sample is explicit.',review:'Review short-gap shops where the next action mattered. Do not read a shorter gap as automatically better, and do not treat the conditional median as typical of every recall.'},
    objective_setup_path:{group:'Tempo & setup',measure:'Pairs the last measured shop with distinct coarse position samples requested around 90/60/30 seconds before a contested objective. Duplicate Riot frames are collapsed and actual seconds-before-objective are shown.',review:'For missed objectives, review the sampled setup route before contact rather than only the objective event. The route is coarse timeline context, not second-perfect movement tracking.'},
    lead_utilisation:{group:'Economy & conversion',measure:'Tracks paired direct-role Gold@15→Gold@25 movement for games starting at least +500g ahead. It reports whether the account is still ahead at 25 and the actual movement; no percentage-retained success threshold is used.',review:'Open games that flipped from ahead to behind and inspect resets, deaths, waves and map trades. A shrinking lead can still be strategically correct.'},
    deficit_recovery:{group:'Economy & conversion',measure:'Tracks paired games starting ≥500g behind at 15 and reports how many deficits narrowed, how many crossed to even-or-ahead, and the median Gold@15→25 movement. Median reduces outlier distortion.',review:'Compare the rare recoveries with games that worsened. The movement is team-context evidence and does not assign individual credit.'},
    death_chains:{group:'Risk & recovery',measure:'Measures the share of consecutive-death opportunities where the next death arrives within four minutes and compares that same rule with the direct-role opponents from the same deep games.',review:'Use the player-vs-opponent gap to decide whether rapid repeat deaths are unusually common in this sample, then review the shortest/high-risk pairs. The timing rule still does not prove causation.'},
    resource_to_impact:{group:'Fight decisions',measure:'Looks only at active fights that started at least +300g versus the direct role opponent, then separates survival, death after contribution, death before contribution, and ≥1000 unspent-gold state.',review:'Prioritize ahead-state deaths before contribution and high-unspent starts. Check whether the lead was actually spendable, whether a reset was available, and whether positioning preserved access to the fight.'},
    fight_lead_conversion:{group:'Economy & conversion',measure:'After a strict tracked fight win, checks for neutral objectives, buildings, plates or a new reviewed-player kill/assist before the next tracked fight or 90 seconds, whichever comes first. Windows do not overlap.',review:'Open wins with no tracked follow-up and compare them with objective/tower/plate/kill follow-ups. A reset can still be correct; this measures clean sequencing, not causal conversion quality.'},
    fight_loss_containment:{group:'Risk & recovery',measure:'Checks only whether a tracked lost fight is followed by another classified high-risk death before the next tracked fight or 90 seconds, whichever comes first. Windows do not overlap.',review:'Open losses followed by another flagged death before the next fight and ask whether the second risk was avoidable. Do not call the other cases fully contained losses.'},
    objective_trading:{group:'Tempo & setup',measure:'Shows skipped-fight windows that overlap reviewed-player-supported structure or neutral-objective involvement within ~90 seconds. Because skipped-fight windows can themselves overlap, per-window involvement counts are not unique event totals.',review:'Validate individual windows in replay. Do not add the structure/objective counts across rows as if every downstream event were unique or caused by skipping.'},
    geographical_clusters:{group:'Map patterns',measure:'Combines high-priority skipped-fight reviews and high-risk deaths by team-relative map zone, then adds coarse exposure from minute-spaced position frames so raw activity is not mistaken for risk concentration. Exposure-adjusted rates require at least 15 sampled minutes and 3 signals.',review:'Compare raw counts with sufficiently sampled exposure-adjusted rates. Zones below the evidence floor stay raw-only instead of being promoted by a tiny denominator.'},
    champion_tendencies:{group:'Champion context',measure:'Groups only your own games by champion and compares decision/risk tendencies rather than teammate performance.',review:'Use this to identify champion-specific habits: e.g. safer fight entry on one ADC but more empty cross-map time on another.'},
    matchup_adjusted_lane:{group:'Lane & opponent context',measure:'Builds personal-history own-champion × direct-opponent-champion cells for lane gold and DPM-vs-peer context. A comparison is promoted only when at least two matchup cells have ≥3 games.',review:'Use repeated cells as personal context only. One supported matchup can be described, but it cannot establish a best/worst matchup ranking or a population matchup rule.'},
    expected_performance_residual:{group:'Lane & opponent context',measure:'Compares actual opponent-adjusted DPM with a hierarchical leave-one-out personal-history expectation. The recent headline uses the median residual to reduce sensitivity to extreme games.',review:'Use residuals to find unusual games versus your own context. It remains descriptive and does not fully control draft, lane state, team state or MMR.'},
    session_components:{group:'Session patterns',measure:'Breaks game-3+ versus opener into evidence-gated components, preserves each raw unit/sample count, and uses the practical-change threshold only for direction and relative magnitude.',review:'Read the mix of better, worse and small components together. Do not reduce a mixed session to whichever bar happens to be largest.'},
    requeue_sweet_spot:{group:'Session patterns',measure:'Compares requeue-gap buckets using raw direct-opponent DPM, CS/min, deaths, KP and GPM deltas in their own units. No synthetic combined score or “best break” is calculated.',review:'Look for component patterns that repeat across sufficiently sampled buckets. Treat them as observational scheduling context, never as a causal recommendation.'},
    mistake_recurrence:{group:'Learning progress',measure:'Tracks supported review-signal load game by game by category. It does not call every signal a mistake and does not claim a target-linked half-life without a defensible intervention start point.',review:'Use the line and category counts to see whether risky deaths, pre-objective deaths, reset absences or missed-join reviews are actually receding.'},
    automatic_replay_shortlist:{group:'Replay review',measure:'Ranks concrete moments with a transparent review-priority heuristic and diversity caps so one match or one event type cannot monopolize the list.',review:'Start here when you do not want to review every match. Priority is only an ordering aid, not measured severity, probability, causality or blame.'}
  };
  const GROUP_ORDER=['Fight decisions','Tempo & setup','Economy & conversion','Risk & recovery','Map patterns','Champion context','Lane & opponent context','Session patterns','Learning progress','Replay review'];
  const PURPOSE={
    lead_utilisation:'act',deficit_recovery:'act',death_chains:'act',resource_to_impact:'act',fight_lead_conversion:'act',fight_loss_containment:'act',objective_setup_path:'act',mistake_recurrence:'act',automatic_replay_shortlist:'act',
    post_recall_tempo:'context',objective_trading:'context',geographical_clusters:'context',champion_tendencies:'context',matchup_adjusted_lane:'context',expected_performance_residual:'context',session_components:'context',requeue_sweet_spot:'context',cross_map_efficiency:'context',
    fight_decision_ledger:'diagnostic',arrival_feasibility:'diagnostic',pre_fight_positioning:'diagnostic',fight_formation:'diagnostic',numbers_aware_participation:'diagnostic',wave_fight_conflict:'diagnostic',nothing_gained_isolation:'diagnostic'
  };
  const purposeLabel=id=>PURPOSE[id]==='act'?'Act on this':PURPOSE[id]==='context'?'Useful context':'Diagnostic / exploratory';
  const purposeReason=id=>PURPOSE[id]==='act'?'Can directly change a replay or practice decision when the evidence is supported.':PURPOSE[id]==='context'?'Helps interpret performance but should not independently create a coaching target.':'Locates review questions or mechanisms; it is not a standalone performance verdict.';


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
      case'fight_formation':return r.length?r.length+' position samples are within 45s of contact (median age '+fmt(e.medianSampleLeadSec,0)+'s; median anchor distance '+fmt(e.medianDistanceToAnchor,0)+'u), while '+fmt(e.withheldCoarseFrames,0)+' older frames are withheld. No preferred spacing band is inferred.':'No fight-anchor distance sample is close enough to contact.';
      case'numbers_aware_participation':{const states=Array.isArray(e.states)?e.states:[];return states.length?states.map(x=>x.label+': n='+x.fights+', lost '+fmt(x.lossRate,0)+'%').join(' · ')+'. Observed loss rates span '+fmt(e.minStateLossRate,1)+'–'+fmt(e.maxStateLossRate,1)+'% (range '+fmt(e.stateLossRateRangePp,1)+'pp), so this descriptive sample does not show a clear directional outcome separation by the coarse numbers state. Snapshot frame median age: '+fmt(e.medianNumberSampleLeadSec,0)+'s.':'No local-number sample.';}
      case'cross_map_efficiency':return num(e.supportedRate)?fmt(e.supportedRate,0)+'% of skipped-fight windows met at least one compensation rule. Median direct-role movement was '+signed(e.medianGoldSwing,0)+'g and '+signed(e.medianCsSwing,1)+' CS; these are separate signals, not additive value.':a.summary;
      case'wave_fight_conflict':{const conflicts=r.filter(x=>x.likelyResourceConflict).length,lost=r.filter(x=>x.likelyResourceConflict&&x.fightLost).length;return conflicts?conflicts+' skipped fights crossed the ≥'+fmt(e.csConflictThreshold??4,0)+' CS movement review threshold; '+lost+' of those coincided with a lost fight. This is a replay-priority flag, not proof the wave/fight choice was wrong.':'No skipped fight crossed the current CS-movement review threshold.';}
      case'nothing_gained_isolation':return r.length?String(e.highPriority||0)+' of '+r.length+' skipped-fight windows without supported compensation are high-priority join reviews. The rule failing does not mean literally zero value was gained.':'No skipped-fight window lacks supported compensation.';
      case'post_recall_tempo':return num(e.medianGapMin)?fmt(e.pairedEventVisits,0)+' of '+fmt(e.totalShopVisits,0)+' measured shop visits had a tracked fight/objective inside four minutes ('+fmt(e.pairedVisitRate,0)+'%). Within that conditional sample, the median gap is '+fmt(e.medianGapMin,1)+' minutes.':a.summary;
      case'objective_setup_path':{const joined=r.filter(x=>x.joined).length;return r.length?'Tracked objective paths show '+joined+'/'+r.length+' presence in this sample. Misses should be reviewed from the prior shop/approach rather than from objective spawn alone.':'No objective setup paths.';}
      case'lead_utilisation':return r.length?fmt(e.stillAheadAt25,0)+'/'+r.length+' paired ≥500g-at-15 games were still ahead at 25; '+fmt(e.flippedBehindAt25,0)+' flipped behind. Median Gold@15→25 movement was '+signed(e.medianMovement,0)+'g.':'No ≥500g-at-15 game has a usable 25-minute checkpoint.';
      case'deficit_recovery':return r.length?fmt(e.narrowedGames,0)+'/'+r.length+' paired deficits narrowed and '+fmt(e.crossedAheadAt25,0)+' crossed to even-or-ahead by 25. Median Gold@15→25 movement was '+signed(e.medianMovement,0)+'g.':'No large-deficit game has a usable 25-minute checkpoint.';
      case'death_chains':return num(e.totalOpportunities)?fmt(e.repeatEvents,0)+'/'+fmt(e.totalOpportunities,0)+' player opportunities ('+fmt(e.repeatRate,0)+'%) repeated within '+fmt(e.windowMinutes,0)+'m versus '+fmt(e.opponentRepeatEvents,0)+'/'+fmt(e.opponentOpportunities,0)+' for direct-role opponents ('+fmt(e.opponentRepeatRate,0)+'%). Player-minus-opponent difference: '+signed(e.repeatRateDeltaPp,1)+' pp. Median player gap '+fmt(e.medianGapSec,0)+'s.':a.summary;
      case'resource_to_impact':return num(e.preContributionDeathRate)?'Across '+fmt(e.aheadFightSamples,0)+' active fights started ≥300g ahead, '+fmt(e.preContributionDeathRate,0)+'% ended in death before tracked contribution, '+fmt(e.survivalRate,0)+'% were survived, and '+fmt(e.highUnspentRate,0)+'% began with ≥1000 unspent gold where current-gold evidence existed.':a.summary;
      case'fight_lead_conversion':return num(e.followUpRate)?fmt(e.followUpRate,0)+'% of strict fight wins had a follow-up before the next fight / 90s cutoff. Windows with neutral objective: '+fmt(e.objectiveFollowUpWindows,0)+', building: '+fmt(e.towerFollowUpWindows,0)+', plate: '+fmt(e.plateFollowUpWindows,0)+', new player kill/assist: '+fmt(e.playerKillFollowUpWindows,0)+'. Median usable window '+fmt(e.medianWindowSec,0)+'s.':a.summary;
      case'fight_loss_containment':return num(e.noExtraRiskDeathRate)?'After tracked fight losses, '+fmt(e.noExtraRiskDeathRate,0)+'% had no additional classified high-risk death before the next fight / 90s cutoff. Median usable window '+fmt(e.medianWindowSec,0)+'s. That does not mean the broader gold/objective loss was contained.':a.summary;
      case'objective_trading':return r.length?r.length+' skipped-fight windows overlapped supported structure/objective involvement. Row-level counts are window evidence, not unique event totals, because nearby skipped-fight windows can overlap. Replay is required to judge whether skipping enabled or justified any gain.':'No skipped-fight window overlapped tracked structure/objective involvement.';
      case'geographical_clusters':{if(!r.length)return'No repeated geography cluster.';const raw=[...r].sort((a,b)=>n(b.count)-n(a.count))[0],rate=[...r].filter(x=>num(x.signalsPer30SampledMin)).sort((a,b)=>n(b.signalsPer30SampledMin)-n(a.signalsPer30SampledMin))[0];return'Most raw review signals: '+raw.zone+' ('+raw.count+'). '+(rate?'Highest exposure-adjusted review rate: '+rate.zone+' ('+fmt(rate.signalsPer30SampledMin,2)+' per 30 sampled minutes). ':'')+'The exposure denominator is coarse timeline-frame time, so neither result proves a zone itself is dangerous.';}
      case'champion_tendencies':{const eligible=r.filter(x=>n(x.games)>=3);if(eligible.length<2)return eligible.length===1?eligible[0].champion+' is the only champion with ≥3 deep games, so this card is descriptive for that champion and cannot support a cross-champion tendency comparison.':'No champion has three deep games yet for a useful tendency comparison.';const safest=[...eligible].filter(x=>num(x.riskyDeathsPerGame)).sort((a,b)=>n(a.riskyDeathsPerGame)-n(b.riskyDeathsPerGame))[0];return safest?safest.champion+' currently has the lowest risky-death rate among champions with ≥3 games ('+fmt(safest.riskyDeathsPerGame,2)+'/game). Compare its spacing/routing with the others.':'Champion samples are still mixed.';}
      case'matchup_adjusted_lane':{const s=r.filter(x=>n(x.games)>=3&&num(x.avgGold15));if(!s.length)return'No matchup cell has three comparable lane samples yet; keep this contextual.';if(s.length===1)return s[0].matchup+' is the only matchup with ≥3 comparable lane games ('+signed(s[0].avgGold15,0)+'g average Gold@15). There is not enough repeated matchup evidence to rank best versus worst.';const best=[...s].sort((a,b)=>n(b.avgGold15)-n(a.avgGold15))[0],worst=[...s].sort((a,b)=>n(a.avgGold15)-n(b.avgGold15))[0];return'Among '+s.length+' repeated personal-history cells, '+best.matchup+' is strongest at 15 ('+signed(best.avgGold15,0)+'g) and '+worst.matchup+' is weakest ('+signed(worst.avgGold15,0)+'g).';}
      case'expected_performance_residual':return num(e.recentResidual)?'Median residual across the latest '+fmt(e.recentResidualGames,0)+' comparable deep games is '+signed(e.recentResidual,0)+' DPM versus the hierarchical leave-one-out personal-history expectation. It does not mean “better than MMR” or isolate individual skill.':a.summary;
      case'session_components':{if(!r.length)return'No session component has enough evidence.';const better=r.filter(x=>x.direction==='better').map(x=>x.label),worse=r.filter(x=>x.direction==='worse').map(x=>x.label),small=r.filter(x=>x.direction==='small').map(x=>x.label);return'Later-session read: '+(e.sessionStatus||'mixed')+'. Better: '+(better.join(', ')||'none')+'. Worse: '+(worse.join(', ')||'none')+'. Below practical-change threshold: '+(small.join(', ')||'none')+'.';}
      case'requeue_sweet_spot':return Number(e.supportedBuckets||0)>0?fmt(e.supportedBuckets,0)+' requeue-gap bucket(s) have ≥'+fmt(e.minimumBucketGames,0)+' comparable games. Raw opponent-relative components are shown separately; there is deliberately no combined winner or “best break” conclusion.':'No requeue-gap bucket has at least five comparable games.';
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
    return scatter(r,'sampleLeadSec','distanceToAnchor',{
      xLabel:'Seconds before contact',yLabel:'Distance to fight anchor',labelKey:'zone',maxRows:80,
      toneFn:x=>x.contributed?'positive':'negative',
      legend:'<span><i class="positive"></i>tracked kill/assist contribution</span><span><i class="negative"></i>no tracked kill/assist contribution</span>'
    });
  }
  function numbersVisual(e){
    const states=Array.isArray(e?.states)?e.states:[];
    if(!states.length)return'<div class="di-visual-empty">No local-number state rows to graph.</div>';
    return '<div class="di-state-grid">'+states.map(x=>'<article><strong>'+esc(x.label)+'</strong><span><b>'+fmt(x.fights,0)+'</b> fights</span><span><b>'+fmt(x.lossRate,0)+'%</b> lost</span></article>').join('')+'</div>';
  }
  function deathIntervalVisual(e){
    const xs=Array.isArray(e?.gameRows)?e.gameRows.filter(x=>num(x.repeatRate)):[];
    const compare=shareVisual([
      {label:'Player ≤4m repeats',value:n(e.repeatEvents||0),tone:'warn'},
      {label:'Player >4m',value:Math.max(0,n(e.totalOpportunities||0)-n(e.repeatEvents||0)),tone:'muted'}
    ]);
    const peer=miniStats([
      {value:fmt(e.repeatRate,1)+'%',label:'player repeat rate'},
      {value:fmt(e.opponentRepeatRate,1)+'%',label:'role-opponent repeat rate'},
      {value:signed(e.repeatRateDeltaPp,1)+' pp',label:'player − opponent'},
      {value:fmt(e.medianGapSec,0)+'s',label:'player median repeat gap'}
    ]);
    if(!xs.length)return peer+compare;
    return peer+compare+barRows(xs.sort((a,b)=>n(b.repeatRate)-n(a.repeatRate)),{label:x=>shortMatch(x.matchId)+' · '+x.repeatDeaths+'/'+x.opportunities,value:'repeatRate',suffix:'%',maxRows:8});
  }
  function requeueContextVisual(e){
    const xs=Array.isArray(e?.rows)?e.rows.filter(x=>x.games>0):[];
    if(!xs.length)return'<div class="di-visual-empty">No requeue-gap context to graph.</div>';
    const metric=(v,inverse=false)=>!num(v)?'—':'<b class="'+((inverse?-n(v):n(v))>0?'positive':(inverse?-n(v):n(v))<0?'negative':'neutral')+'">'+esc(signed(v,1))+'</b>';
    return '<div class="di-requeue-grid">'+xs.map(x=>'<article class="'+(x.supported?'supported':'thin')+'"><header><strong>'+esc(x.bucket)+'</strong><small>n='+fmt(x.games,0)+(x.supported?'':' · thin')+'</small></header><div><span>DPM vs role '+metric(x.dpmDelta)+'</span><span>CS/min vs role '+metric(x.csMinDelta)+'</span><span>Deaths vs role '+metric(x.deathsDelta,true)+'</span><span>KP vs role '+metric(x.kpDelta)+'</span><span>GPM vs role '+metric(x.gpmDelta)+'</span></div></article>').join('')+'</div>';
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
      case'numbers_aware_participation':return numbersVisual(e);
      case'cross_map_efficiency':return crossCompVisual(r,e);
      case'wave_fight_conflict':return scatter(r,'csSwing','goldSwing',{xLabel:'CS movement vs role',yLabel:'Gold movement vs role',labelKey:'zone',toneFn:x=>x.fightLost?'negative':'positive',legend:'<span><i class="negative"></i>team lost tracked fight</span><span><i class="positive"></i>team did not lose tracked fight</span>'});
      case'nothing_gained_isolation':return shareVisual([{label:'High-priority review',value:n(e.highPriority||0),tone:'bad'},{label:'Other uncompensated',value:Math.max(0,r.length-n(e.highPriority||0)),tone:'warn'}]);
      case'post_recall_tempo':return recallTempoVisual(r,e);
      case'objective_setup_path':return shareVisual([{label:'Present',value:r.filter(x=>x.joined).length,tone:'neutral'},{label:'Absent',value:r.filter(x=>!x.joined).length,tone:'warn'}])+objectivePathMap(r.slice(0,40),report)+'<div class="di-path-chips">'+r.slice(0,8).map(x=>'<span><b>'+esc(x.objective||'objective')+'</b><i>shop '+(num(x.shopLeadMin)?fmt(x.shopLeadMin,1)+'m before':'?')+'</i><em>→</em><i>'+esc(x.approachZone||'unknown')+(num(x.actualApproachLeadSec)?' · '+fmt(x.actualApproachLeadSec,0)+'s before':'')+(Array.isArray(x.approachSamples)&&x.approachSamples.length>1?' · '+x.approachSamples.length+' route samples':'')+'</i><em>→</em><i>'+esc(x.joined?'present':'absent')+'</i></span>').join('')+'</div>';
      case'lead_utilisation':return miniStats([{value:fmt(e.leadBands?.['500–999g'],0),label:'500–999g starts'},{value:fmt(e.leadBands?.['1000–1499g'],0),label:'1000–1499g starts'},{value:fmt(e.leadBands?.['1500g+'],0),label:'1500g+ starts'}])+slope(r,'gold15','gold25',{startLabel:'Gold@15',endLabel:'Gold@25'});
      case'deficit_recovery':return slope(r,'gold15','gold25',{startLabel:'Gold@15',endLabel:'Gold@25'});
      case'death_chains':return deathIntervalVisual(e);
      case'resource_to_impact':return miniStats([{value:fmt(e.preContributionDeathRate,0)+'%',label:'died before contribution'},{value:fmt(e.survivalRate,0)+'%',label:'survived'},{value:fmt(e.highUnspentRate,0)+'%',label:'started with ≥1000 unspent'}])+scatter(r,'goldDiffAtStart','currentGold',{xLabel:'Gold diff vs role',yLabel:'Unspent gold',labelKey:'matchId',toneFn:x=>x.diedBeforeContribution?'negative':x.survived?'positive':'warn',legend:'<span><i class="positive"></i>survived</span><span><i class="warn"></i>contributed then died</span><span><i class="negative"></i>died before contribution</span>'});
      case'fight_lead_conversion':return miniStats([{value:fmt(e.objectiveFollowUpWindows,0),label:'neutral-objective windows'},{value:fmt(e.towerFollowUpWindows,0),label:'building windows'},{value:fmt(e.plateFollowUpWindows,0),label:'plate windows'},{value:fmt(e.playerKillFollowUpWindows,0),label:'new player K/A windows'}])+shareVisual([{label:'Measured follow-up',value:r.filter(x=>x.followUp).length,tone:'neutral'},{label:'No tracked follow-up',value:r.filter(x=>!x.followUp).length,tone:'muted'}]);
      case'fight_loss_containment':return shareVisual([{label:'No extra flagged death',value:r.filter(x=>x.noExtraRiskDeath).length,tone:'neutral'},{label:'Extra flagged death ≤90s',value:r.filter(x=>!x.noExtraRiskDeath).length,tone:'bad'}]);
      case'objective_trading':return fightMap(report,'trade')+barRows(r,{label:x=>(x.fightZone||'trade')+' '+fmt(x.minute,1)+'m',value:'goldSwing',suffix:'g',diverging:true});
      case'geographical_clusters':{const mapEvents=Array.isArray(e.mapEvents)?e.mapEvents:[],gm=gameMap(report);const pts=mapEvents.map(x=>{const g=gm.get(String(x.matchId));return{position:teamRelativePoint(g,x.position),tone:x.type==='bad_death'?'bad':'review',r:x.type==='bad_death'?7:9,title:(x.type==='bad_death'?'High-risk death':'High-priority missed-join review')+' · '+(x.zone||'unknown')+' · '+fmt(x.minute,1)+'m'};}).filter(x=>x.position);const rated=r.filter(x=>num(x.signalsPer30SampledMin));return mapStage(pts,{legend:'<span><i class="bad"></i>high-risk death</span><span><i class="review"></i>high-priority missed-join review</span>',aria:'Summoner’s Rift geographical review locations'})+(rated.length?barRows([...rated].sort((a,b)=>n(b.signalsPer30SampledMin)-n(a.signalsPer30SampledMin)),{label:x=>x.zone+' · '+fmt(x.count,0)+' signals · '+fmt(x.sampledExposureMin,0)+'m sampled',value:'signalsPer30SampledMin',suffix:'/30m',maxRows:8}):barRows(r,{label:'zone',value:'count',suffix:' signals'}));}
      case'champion_tendencies':return championVisual(r);
      case'matchup_adjusted_lane':return matchupVisual(r);
      case'expected_performance_residual':return scatter(r,'expected','actual',{xLabel:'Expected DPM vs role',yLabel:'Actual DPM vs role',labelKey:'champion',diagonal:true,toneFn:x=>n(x.residual)>=0?'positive':'negative',legend:'<span><i class="positive"></i>above leave-one-out expectation</span><span><i class="negative"></i>below expectation</span>'})+barRows(r.slice(-12),{label:x=>(x.champion||'champ')+' vs '+(x.opponent||'opp'),value:'residual',suffix:' DPM',diverging:true});
      case'session_components':return barRows(r,{label:x=>x.label+' · raw '+signed(x.rawDelta,2)+' · n '+x.baselineN+'→'+x.recentN,value:'normalized',suffix:'× threshold',diverging:true});
      case'requeue_sweet_spot':return requeueContextVisual(e);
      case'mistake_recurrence':return sparkline(r,'issues',{labelKey:'matchId'});
      case'automatic_replay_shortlist':return replayCards(report,r)+fightMap(report,'shortlist',r);
      default:return'<div class="di-visual-empty">Visual renderer unavailable for this metric.</div>';
    }
  }
  function analyticCard(a,index,report){
    const info=INFO[a?.id]||{group:'Other',measure:a?.summary||'',review:'Open linked matches for context.'};
    const evidence=evidenceRows(a),visual=visualFor(a,report),con=conclusion(a);
    return '<details class="di-card tone-'+statusTone(a?.status)+' purpose-'+esc(PURPOSE[a?.id]||'diagnostic')+'" '+(index<2?'open':'')+'>'+
      '<summary><span class="di-index">'+String(index+1).padStart(2,'0')+'</span><div><strong>'+esc(a?.title||'Analysis')+'</strong><small><b class="di-purpose-badge">'+esc(purposeLabel(a?.id))+'</b> · '+esc(statusLabel(a?.status))+' · n='+esc(a?.sample??0)+' · '+esc(info.group)+'</small></div><i></i></summary>'+
      '<div class="di-card-body"><div class="di-purpose-explainer"><b>'+esc(purposeLabel(a?.id))+'</b><span>'+esc(purposeReason(a?.id))+'</span></div><div class="di-visual">'+visual+'</div>'+
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
    const purposeCounts={act:analytics.filter(a=>PURPOSE[a.id]==='act').length,context:analytics.filter(a=>PURPOSE[a.id]==='context').length,diagnostic:analytics.filter(a=>(PURPOSE[a.id]||'diagnostic')==='diagnostic').length};
    let index=0;
    const groups=GROUP_ORDER.map(group=>{const count=analytics.filter(a=>(INFO[a.id]?.group||'Other')===group).length,html=groupHtml(group,analytics,report,index);index+=count;return html;}).join('');
    box.innerHTML=
      '<div class="di-headline">'+
        '<div class="di-headline-copy"><span>Decision intelligence · visual review</span><strong>'+esc(available)+' of 25 analytics currently have usable evidence</strong><p>Each card pairs evidence with a matching visual and a bounded conclusion. Timeline-heavy decisions use '+esc(d?.deepGames??d?.generatedFromGames??'—')+' deep games; eligible match-level context can use '+esc(d?.historyGames??d?.deepGames??d?.generatedFromGames??'—')+' same-role history games. Thin and unavailable evidence stays separate from measured and proxy results.</p></div>'+
        '<div class="di-headline-stats"><span><b>'+esc(measured)+'</b> measured</span><span><b>'+esc(proxy)+'</b> explicit proxies</span><span><b>'+esc(h.thin||0)+'</b> thin</span><span><b>'+esc(h.unavailable||0)+'</b> unavailable</span></div>'+
      '</div>'+
      '<div class="di-purpose-key"><span class="act"><b>'+purposeCounts.act+'</b> Act on this</span><span class="context"><b>'+purposeCounts.context+'</b> Useful context</span><span class="diagnostic"><b>'+purposeCounts.diagnostic+'</b> Diagnostic / exploratory</span><p>Purpose labels answer a different question from evidence status: a measured diagnostic can still be non-actionable, while an actionable card can remain thin until its sample grows.</p></div>'+
      (short.length?'<section class="di-feature"><div class="section-subhead"><div><span>Start here</span><strong>Automatic replay shortlist</strong></div><small>The highest-priority current review moments under the transparent replay heuristic.</small></div><div class="di-shortlist-grid">'+short.slice(0,10).map((x,i)=>shortlistCard(x,i,report)).join('')+'</div>'+fightMap(report,'shortlist',short.slice(0,10))+'</section>':'')+
      groups+
      '<p class="source-note"><b>How to read this dashboard:</b> maps and charts are explanatory views of the same evidence already used by the analyzer. “Proxy” remains visibly separate from measured evidence. Exact live wave size, cooldown availability, hidden information, path safety and player intent are not invented when Riot data does not expose them.</p>';
    bind(box);panel.hidden=false;
  };
})();