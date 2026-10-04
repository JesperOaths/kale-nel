(function(root){
'use strict';

// Rebuild from preserved per-game evidence on every render, including saved
// reports. No Riot key, profile identity or browser storage is used here.
const hasNum=v=>v!==null&&v!==undefined&&v!==''&&typeof v!=='boolean'&&Number.isFinite(Number(v));
const count=v=>hasNum(v)&&Number(v)>=0&&Number.isInteger(Number(v))?Number(v):null;
function role(v){
  const r=String(v||'').toUpperCase().trim();
  return ['BOTTOM','BOT','DUO_CARRY','ADC'].includes(r)?'ADC':['UTILITY','DUO_SUPPORT','SUPPORT'].includes(r)?'SUPPORT':['MIDDLE','MID'].includes(r)?'MID':['JUNGLE','TOP'].includes(r)?r:null;
}
const mechanics=g=>[g?.phaseRules?.key||'unknown',g?.roleQuestContext?.revision||'unknown'].join('|');
const mean=xs=>xs.length?xs.reduce((s,x)=>s+x,0)/xs.length:null;
const arr=v=>Array.isArray(v)?v:null;
function observation(flagged,total,moments=[]){
  if(count(flagged)===null||count(total)===null||total<=0||flagged>total)return null;
  return {flagged,total,rate:100*flagged/total,moments:moments.filter(hasNum).map(Number)};
}
function eventsObservation(events,eligible,flag,time){
  if(!arr(events))return null;
  const supported=events.filter(eligible),flagged=supported.filter(flag);
  return observation(flagged.length,supported.length,flagged.map(time));
}
function habitSpecs(selectedRole){
  const specs=[{
    key:'repeat-deaths',label:'Risky or costly repeat deaths',unit:'adjacent death gaps',tab:'deaths',
    definition:'A second death within 4 minutes with tracked risk or consequence. The denominator is every adjacent death gap, excluding the final death as a new starting point.',
    cue:'After respawning, choose one safe wave or camp and reconnect with the team before trying to recover the previous play.',
    question:'At the first death, what changed in the wave, enemy positions and objective timing? Was the second route still justified?',
    read:g=>{
      const d=g.deathRecovery,events=arr(d?.events),total=count(d?.opportunities),repeats=count(d?.repeatDeaths);
      if(!events||total===null||repeats===null||events.length!==repeats||events.some(x=>typeof x?.costly!=='boolean'||typeof x?.highRisk!=='boolean'))return null;
      const flagged=events.filter(x=>x.costly===true||x.highRisk===true);
      return observation(flagged.length,total,flagged.map(x=>x.secondMin));
    }
  },{
    key:'objective-death',label:'Death before a missed contest',unit:'supported contested encounters',tab:'objectives',
    definition:'A tracked death in the 75 seconds before an objective encounter your team contested, while you were absent. The timing is an association; it does not prove the death caused the miss.',
    cue:'Before an objective approach, check the nearest allies, safe route and exit. Preserve your ability to join a justified contest.',
    question:'Was the preceding fight necessary, and did the team actually intend to contest? Check timers and the route before the death.',
    read:g=>eventsObservation(g.objectiveReadiness?.events,x=>x?.scope==='team_contested'&&typeof x.present==='boolean'&&typeof x.recentDeath==='boolean',x=>!x.present&&x.recentDeath,x=>x.time)
  },{
    key:'unspent-fights',label:'Fighting with 1,000g unspent',unit:'active fights with known stored gold',tab:'fights',
    definition:'An active combat cluster starts with at least 1,000g in your inventory. Only starts with observed stored gold enter the denominator. Urgent defensive fights may still be correct.',
    cue:'Before a voluntary fight, check what the gold buys and whether a safe reset fits the next wave and objective window.',
    question:'Was the fight optional? Compare the value of buying first with the wave or objective you would concede.',
    read:g=>eventsObservation(g.fightProfile?.events,x=>x?.active===true&&hasNum(x.currentGoldAtStart)&&Number(x.currentGoldAtStart)>=0&&typeof x.highUnspent==='boolean',x=>x.highUnspent,x=>x.startMin)
  },{
    key:'opening-deaths',label:'Dying before a kill or assist',unit:'supported active combat clusters',tab:'fights',
    definition:'You die before recording a kill or assist in an active combat cluster. Damage, crowd control, peeling and space created are not fully measured, so this is a replay cue rather than a fight grade.',
    cue:'Before entering, identify the threat that can reach you and the position from which you can contribute. Review whether engaging or waiting was appropriate for your role.',
    question:'Could you contribute from a different position, or was the death a useful engage, peel or sacrifice?',
    read:g=>eventsObservation(g.fightProfile?.events,x=>x?.active===true&&typeof x.diedBeforeContribution==='boolean',x=>x.diedBeforeContribution,x=>x.startMin)
  },{
    key:'kill-conversion',label:'No tracked post-kill conversion',unit:'supported post-kill windows',tab:'macro',
    definition:'Neither your supported involvement nor team context shows a structure or objective conversion in the analyzer’s post-kill window. A reset, denied farm or an unavailable objective can still make this correct.',
    cue:'After a kill, name the available next action: safe wave crash, structure, objective or reset. Choose one before chasing again.',
    question:'What was actually available after the kill? Check health, wave position, reinforcement and the next purchase.',
    read:g=>eventsObservation(g.killConversion?.events,x=>typeof x?.playerSupportedConverted==='boolean'&&typeof x.teamConverted==='boolean',x=>!x.playerSupportedConverted&&!x.teamConverted,x=>x.endMin)
  }];
  if(['ADC','MID','TOP'].includes(selectedRole))specs.push({
    key:'first-reset',label:'First reset loses role economy',unit:'clean measured first resets',tab:'resets',minimumOpportunities:3,
    definition:'The direct-role economy comparison worsens after your first meaningful shop. Requires a trusted role opponent, measured frames and no death inside the comparison window; the swing does not isolate recall causality.',
    cue:'Plan the first reset around wave state and the purchase you need. Review the wave you leave and the wave you return to.',
    question:'Was the wave safely crashed or collectable on return? Did health, pressure or purchase timing force this reset?',
    read:g=>{
      const x=g.firstResetSequence;
      return g.directPeerComparable===true&&g.phaseRules?.lane15Comparable!==false&&x?.measured===true&&x.deathInWindow===false&&typeof x.economyLoss==='boolean'?observation(x.economyLoss?1:0,1,[x.time]):null;
    }
  },{
    key:'lead-giveback',label:'Early lead given back',unit:'eligible meaningful early leads',tab:'macro',minimumOpportunities:3,
    definition:'The analyzer identifies a meaningful early same-role gold lead that is given back by 15 minutes. Only eligible, trusted direct-role lead windows count; this does not identify the cause of the swing.',
    cue:'Once ahead, check the wave, purchase and reinforcement before extending. Make the next play protect the economy you already earned.',
    question:'From the peak lead to 15 minutes, which waves, resets and fights changed the differential?',
    read:g=>{
      const x=g.earlyLeadWindow;
      return g.directPeerComparable===true&&g.phaseRules?.lane15Comparable!==false&&x?.eligible===true&&typeof x.giveback==='boolean'?observation(x.giveback?1:0,1,[x.peakMin]):null;
    }
  });
  if(selectedRole==='SUPPORT')specs.push({
    key:'empty-costly-roam',label:'Costly roam without tracked return',unit:'roams with measured allied-ADC lane movement',tab:'roams',minimumOpportunities:4,
    definition:'A roam has at least 6 CS of measured allied-ADC lane loss and no player kill/assist or supported objective return. The CS association can include enemy pressure; team kills alone do not give personal credit.',
    cue:'Before leaving bot lane, check the ADC’s wave, safety and reset. Choose a map action you can reach and set a return condition.',
    question:'Could your ADC collect the wave safely, and was there a reachable play worth the lane cost?',
    read:g=>eventsObservation(g.roams?.events,x=>hasNum(x?.adcLaneCostCs)&&typeof x.killOrAssist==='boolean'&&typeof x.objective==='boolean',x=>Number(x.adcLaneCostCs)<=-6&&!x.killOrAssist&&!x.objective,x=>x.startMin)
  });
  if(selectedRole==='JUNGLE')specs.push({
    key:'outnumbered-entry',label:'Outnumbered combat entries',unit:'active combat starts with known nearby numbers',tab:'fights',
    definition:'The active combat cluster starts with a supported nearby numbers disadvantage. Position samples are approximate; this is not a judgment that every contest or steal was wrong.',
    cue:'Before entering river or invading, check who can move first and whether nearby allies can join before the enemy.',
    question:'Did lane movement support this entry, and was there a justified objective steal or defensive trade?',
    read:g=>eventsObservation(g.fightProfile?.events,x=>x?.active===true&&hasNum(x.numbersDelta)&&typeof x.outnumberedAtFirstKill==='boolean',x=>x.outnumberedAtFirstKill,x=>x.startMin)
  });
  return specs;
}
function example(row){
  if(!row)return null;
  const g=row.game;
  return {matchId:String(g.matchId),champion:String(g.champion||'Unknown'),win:typeof g.win==='boolean'?g.win:null,outcomeCompromised:g.outcomeCompromised!==false,
    gameStartTimestamp:g.gameStartTimestamp||null,durationMinutes:hasNum(g.durationMinutes)?Number(g.durationMinutes):null,
    flagged:row.flagged,opportunities:row.total,rate:row.rate,minute:row.moments[0]??null};
}
function summary(spec,games){
  const rows=games.map(game=>{const x=spec.read(game);return x?{...x,game}:null;}).filter(Boolean);
  const affected=rows.filter(x=>x.flagged>0),without=rows.filter(x=>x.flagged===0);
  const flags=rows.reduce((s,x)=>s+x.flagged,0),opportunities=rows.reduce((s,x)=>s+x.total,0);
  const flagged=affected.slice().sort((a,b)=>b.rate-a.rate||b.flagged-a.flagged||Number(b.game.gameStartTimestamp||0)-Number(a.game.gameStartTimestamp||0))[0]||null;
  // Same queue AND known mechanics are required for a reference comparison.
  const reference=flagged?without.filter(x=>x.game.outcomeCompromised===false&&hasNum(x.game.queueId)&&Number(x.game.queueId)===Number(flagged.game.queueId)&&!mechanics(x.game).includes('unknown')&&mechanics(x.game)===mechanics(flagged.game)).sort((a,b)=>
    Number(b.game.champion===flagged.game.champion)-Number(a.game.champion===flagged.game.champion)||Math.abs(a.total-flagged.total)-Math.abs(b.total-flagged.total)||Math.abs(Number(a.game.durationMinutes||0)-Number(flagged.game.durationMinutes||0))-Math.abs(Number(b.game.durationMinutes||0)-Number(flagged.game.durationMinutes||0)))[0]||null:null;
  const resultGroup=xs=>{const clean=xs.filter(x=>x.game.outcomeCompromised===false&&typeof x.game.win==='boolean');return {games:clean.length,wins:clean.filter(x=>x.game.win).length,winRate:clean.length?100*clean.filter(x=>x.game.win).length/clean.length:null};};
  const flaggedOutcome=resultGroup(affected),withoutOutcome=resultGroup(without);
  return {key:spec.key,label:spec.label,unit:spec.unit,tab:spec.tab,definition:spec.definition,cue:spec.cue,question:spec.question,
    eligibleGames:rows.length,unknownOrNoOpportunityGames:games.length-rows.length,affectedGames:affected.length,withoutFlagGames:without.length,
    flaggedEvents:flags,opportunities,meanGameRate:mean(rows.map(x=>x.rate)),pooledEventRate:opportunities?100*flags/opportunities:null,
    ready:rows.length>=3&&opportunities>=(spec.minimumOpportunities||5),repeated:affected.length>=2,
    flaggedOutcome,withoutOutcome,outcomeComparisonReady:flaggedOutcome.games>=3&&withoutOutcome.games>=3,
    flaggedExample:example(flagged),referenceExample:example(reference),sameChampionReference:!!reference&&reference.game.champion===flagged.game.champion,
    affectedMatchIds:affected.map(x=>String(x.game.matchId)),observations:rows.map(x=>({matchId:String(x.game.matchId),flagged:x.flagged,total:x.total,rate:x.rate}))};
}
function build(report){
  const r=report||{},dq=r.dataQuality||{},selectedRole=role(dq.selectedRole||r.coachingSummary?.primaryRole||r.summary?.primaryRole);
  const ids=new Set(),roleGames=(arr(r.games)||[]).filter(g=>{
    if(!selectedRole||role(g?.role)!==selectedRole||g?.roleEvidence?.confidence==='ambiguous'||!g?.matchId||ids.has(String(g.matchId)))return false;
    if(dq.mechanicsCohortApplied===true&&mechanics(g)!==String(dq.currentMechanicsKey||''))return false;
    ids.add(String(g.matchId));return true;
  });
  const games=roleGames.filter(g=>g.timelineAvailable===true&&Number(g.mapId)===11);
  const habits=habitSpecs(selectedRole).map(spec=>summary(spec,games)).sort((a,b)=>Number(b.ready)-Number(a.ready)||b.affectedGames-a.affectedGames||b.eligibleGames-a.eligibleGames||a.key.localeCompare(b.key));
  const supported=habits.filter(x=>x.ready),matrix={winFlagged:[],lossFlagged:[],winNoFlag:[],lossNoFlag:[],limitedCoverage:[],excludedOutcome:[]};
  for(const g of games){
    const id=String(g.matchId),observed=supported.map(h=>h.observations.find(x=>x.matchId===id)).filter(Boolean),flags=observed.some(x=>x.flagged>0);
    if(g.outcomeCompromised!==false||typeof g.win!=='boolean'){matrix.excludedOutcome.push(id);continue;}
    if(!flags&&observed.length<3){matrix.limitedCoverage.push(id);continue;}
    matrix[g.win?(flags?'winFlagged':'winNoFlag'):(flags?'lossFlagged':'lossNoFlag')].push(id);
  }
  const combinations=[];
  for(let i=0;i<supported.length;i++)for(let j=i+1;j<supported.length;j++){
    const a=supported[i],b=supported[j],other=new Map(b.observations.map(x=>[x.matchId,x])),common=a.observations.filter(x=>other.has(x.matchId)),shared=common.filter(x=>x.flagged>0&&other.get(x.matchId).flagged>0);
    if(shared.length>=3)combinations.push({first:a.key,second:b.key,firstLabel:a.label,secondLabel:b.label,games:shared.length,comparableGames:common.length,matchIds:shared.map(x=>x.matchId)});
  }
  combinations.sort((a,b)=>b.games-a.games||a.first.localeCompare(b.first)||a.second.localeCompare(b.second));
  return {version:'league-learning-review-v1',selectedRole,roleGames:roleGames.length,timelineGames:games.length,missingTimelineGames:roleGames.length-games.length,
    habits,supportedHabitCount:supported.length,matrix,combinations:combinations.slice(0,3),
    outcomePolicy:'explicit_uncompromised_outcomes_only',ratePolicy:'mean_of_supported_game_rates_with_pooled_counts_separate'};
}
root.LeagueLearningReview=Object.freeze({build});
})(typeof window!=='undefined'?window:globalThis);
