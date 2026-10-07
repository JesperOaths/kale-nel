// Decision intelligence layer for League review.
// Pure post-processing over already role-filtered, timeline-enriched game rows.
// All outputs are descriptive/replay-triage only; proxy metrics are labeled as such.

type A = Record<string, any>;

const n = (v:any) => Number(v);
const finite = (v:any) => v!==null && v!==undefined && v!=="" && Number.isFinite(Number(v));
const arr = (v:any) => Array.isArray(v) ? v : [];
const txt = (v:any) => String(v ?? "");
const mean = (xs:any[]) => {
  const ys = xs.filter(finite).map(n);
  return ys.length ? ys.reduce((a,b)=>a+b,0)/ys.length : null;
};
const median = (xs:any[]) => {
  const ys = xs.filter(finite).map(n).sort((a,b)=>a-b);
  if(!ys.length) return null;
  const m=Math.floor(ys.length/2);
  return ys.length%2?ys[m]:(ys[m-1]+ys[m])/2;
};
const pct = (x:number,d:number) => d ? 100*x/d : null;
const clamp = (x:number,a:number,b:number) => Math.max(a,Math.min(b,x));
const eventMin = (x:any) => {
  for(const k of ["startMin","endMin","time","tMin","minute","atMin"]){
    if(finite(x?.[k])) return n(x[k]);
  }
  for(const k of ["timestamp","tMs","timeMs"]){
    if(finite(x?.[k])) return n(x[k])/60000;
  }
  return null;
};
const gameStart = (g:any) => n(g?.gameStartTimestamp||0);
const gameEnd = (g:any) => gameStart(g) + n(g?.durationMinutes||0)*60000;
const distance = (a:any,b:any) => a&&b&&finite(a.x)&&finite(a.y)&&finite(b.x)&&finite(b.y)
  ? Math.hypot(n(a.x)-n(b.x),n(a.y)-n(b.y)) : null;
const zone = (g:any) => txt(g?.champion||"Unknown");
const directPeer = (g:any) => g?.directPeerComparable===true && g?.peer;
const count = (xs:any[],fn:(x:any)=>boolean) => xs.reduce((s,x)=>s+(fn(x)?1:0),0);
const sum = (xs:any[],fn:(x:any)=>number) => xs.reduce((s,x)=>s+(finite(fn(x))?n(fn(x)):0),0);
const safeRate = (yes:number,total:number) => total?pct(yes,total):null;
const round = (v:any,d=1) => finite(v)?Number(n(v).toFixed(d)):null;
const durationBucket = (g:any) => {
  const m=n(g?.durationMinutes||0);
  return m<22?"short":m<30?"medium":m<38?"long":"very_long";
};
const metric = (id:string,title:string,status:string,sample:number,summary:string,evidence:any={},moments:any[]=[]) =>
  ({id,title,status,sample,summary,evidence,moments});
const nearestFrameBefore = (g:any, minute:number, maxGapMin=1.3) => {
  const rows=arr(g?.frameSamples).filter((x:any)=>finite(x?.time)&&n(x.time)<=minute)
    .sort((a:any,b:any)=>n(b.time)-n(a.time));
  const x=rows[0];
  return x && minute-n(x.time)<=maxGapMin ? x : null;
};
const objectiveEvents = (g:any) => arr(g?.objectiveReadiness?.events);
const structureEvents = (g:any) => arr(g?.structurePressure?.events);
const fightEvents = (g:any) => arr(g?.fightProfile?.events);
const absenceEvents = (g:any) => arr(g?.fightProfile?.absenceEvents);
const badDeathEvents = (g:any) => arr(g?.badDeaths);
const allFightRows = (games:any[]) => games.flatMap(g=>fightEvents(g).map((e:any)=>({g,e})));
const allAbsenceRows = (games:any[]) => games.flatMap(g=>absenceEvents(g).map((e:any)=>({g,e})));

function issueComponents(g:any){
  return {
    riskyDeaths:n(g?.badDeathCount??g?.highRiskDeathCount??0),
    preObjectiveDeaths:n(g?.preObjectiveDeathCount||0),
    recentShopAbsences:n(g?.objectiveReadiness?.recentShopAbsences||0),
    missedJoinReviews:count(absenceEvents(g),(e:any)=>e?.joinReviewPriority==="high")
  };
}
function issueCount(g:any){
  const x=issueComponents(g);
  return x.riskyDeaths+x.preObjectiveDeaths+x.recentShopAbsences+x.missedJoinReviews;
}
function mergedWindowMinutes(rows:any[]){
  const grouped=new Map<string,Array<[number,number]>>();
  for(const x of rows){
    const id=txt(x?.g?.matchId||x?.matchId),start=finite(x?.e?.startMin)?n(x.e.startMin):finite(x?.minute)?n(x.minute):null;
    const end=finite(x?.e?.endMin)?n(x.e.endMin)+1.5:finite(start)?n(start)+1.5:null;
    if(!id||!finite(start)||!finite(end))continue;
    if(!grouped.has(id))grouped.set(id,[]);
    grouped.get(id)!.push([n(start),n(end)]);
  }
  let total=0;
  for(const windows of grouped.values()){
    windows.sort((a,b)=>a[0]-b[0]);
    let s:number|null=null,e:number|null=null;
    for(const [a,b] of windows){
      if(s==null){s=a;e=b;continue;}
      if(a<=Number(e)){e=Math.max(Number(e),b);}
      else{total+=Number(e)-Number(s);s=a;e=b;}
    }
    if(s!=null)total+=Number(e)-Number(s);
  }
  return total;
}
function sampledZoneExposure(games:any[]){
  const out=new Map<string,number>();
  for(const g of games){
    const fs=arr(g?.frameSamples).filter((x:any)=>finite(x?.time)&&txt(x?.fightZone)!=="")
      .sort((a:any,b:any)=>n(a.time)-n(b.time));
    for(let i=0;i<fs.length;i++){
      const cur=fs[i],z=txt(cur?.fightZone||"unknown");
      if(!z||z==="unknown"||z.includes("base"))continue;
      const next=fs[i+1],dt=next?clamp(n(next.time)-n(cur.time),0,1.5):clamp(n(g?.durationMinutes||0)-n(cur.time),0,1);
      if(dt<=0)continue;
      out.set(z,(out.get(z)||0)+dt);
    }
  }
  return out;
}
function nextEventAfter(g:any, minute:number){
  const rows:any[]=[];
  for(const e of fightEvents(g)) { const t=eventMin(e); if(finite(t)&&n(t)>=minute) rows.push({kind:"fight",t:n(t),raw:e}); }
  for(const e of objectiveEvents(g)) { const t=eventMin(e); if(finite(t)&&n(t)>=minute) rows.push({kind:"objective",t:n(t),raw:e}); }
  return rows.sort((a,b)=>a.t-b.t)[0]||null;
}
function pathToObjectiveRow(g:any,e:any){
  const t=eventMin(e); if(!finite(t)) return null;
  const shops=arr(g?.shopVisits).filter((s:any)=>finite(s?.startMin)&&n(s.startMin)<=n(t)).sort((a:any,b:any)=>n(b.startMin)-n(a.startMin));
  const shop=shops[0]||null;
  // Build a coarse setup route from distinct Riot timeline frames requested
  // around 90/60/30 seconds before the objective. Frame cadence is coarse,
  // so actual seconds-before-event are always retained and duplicate frames
  // are collapsed.
  const seen=new Set<string>(),approachSamples:any[]=[];
  for(const requestedSec of [90,60,30]){
    const fr=nearestFrameBefore(g,n(t)-requestedSec/60,.9);
    if(!fr?.position||!finite(fr.time)||!finite(fr.position.x)||!finite(fr.position.y))continue;
    const key=String(fr.time);if(seen.has(key))continue;seen.add(key);
    approachSamples.push({requestedSec,actualLeadSec:Math.max(0,Math.round((n(t)-n(fr.time))*60)),
      zone:txt(fr.zone||"unknown"),sampleMinute:round(fr.time,2),position:{x:n(fr.position.x),y:n(fr.position.y)}});
  }
  approachSamples.sort((a,b)=>n(b.actualLeadSec)-n(a.actualLeadSec));
  const latest=approachSamples[approachSamples.length-1]||null;
  return {
    matchId:g.matchId,champion:g.champion,objective:txt(e?.type||e?.objectiveType||e?.monsterType||"objective"),
    minute:round(t,1),joined:e?.joined===true||e?.present===true||e?.playerJoined===true,
    lastShopMin:shop?round(shop?.lastMin??shop?.startMin,1):null,
    shopLeadMin:shop?round(n(t)-n(shop?.lastMin??shop?.startMin),1):null,
    approachZone:txt(latest?.zone||"unknown"),actualApproachLeadSec:latest?.actualLeadSec??null,
    objectiveSetupLeadSec:finite(e?.setupLeadSec)?round(e.setupLeadSec,0):null,
    approachPosition:latest?.position||null,approachSamples
  };
}
function championGroup(games:any[]){
  const m=new Map<string,any[]>();
  for(const g of games){const k=zone(g); if(!m.has(k))m.set(k,[]);m.get(k)!.push(g);}
  return [...m].map(([champ,gs])=>{
    const abs=gs.flatMap(g=>absenceEvents(g)),f=gs.flatMap(g=>fightEvents(g)),risk=sum(gs,g=>n(g?.badDeathCount??g?.highRiskDeathCount??0));
    const high=count(abs,e=>e?.joinReviewPriority==="high"),trades=count(abs,e=>e?.crossMapTradeSupported===true);
    const active=count(f,e=>e?.active===true);
    return {champion:champ,games:gs.length,skippedFightSamples:abs.length,activeFightSamples:active,
      joinableMissRate:safeRate(high,abs.length),crossMapTradeRate:safeRate(trades,abs.length),
      activeFightSurvivalRate:safeRate(count(f,e=>e?.active===true&&!e?.playerDied),active),
      riskyDeathsPerGame:gs.length?risk/gs.length:null,killConversionRate:mean(gs.map(g=>g?.killConversion?.rate))};
  }).sort((a,b)=>b.games-a.games);
}
function matchupRows(games:any[]){
  const groups=new Map<string,any[]>();
  for(const g of games){
    if(!directPeer(g)||!finite(g?.goldDiff15))continue;
    const k=txt(g.champion)+" vs "+txt(g.peer?.champion||"Unknown");
    if(!groups.has(k))groups.set(k,[]);
    groups.get(k)!.push(g);
  }
  return [...groups].map(([matchup,gs])=>({matchup,games:gs.length,avgGold15:mean(gs.map(g=>g.goldDiff15)),avgDpmVsPeer:mean(gs.map(g=>g.peer?.dpmDelta))}))
    .sort((a,b)=>b.games-a.games);
}
function performanceResidualRows(games:any[]){
  const valid=games.filter(g=>directPeer(g)&&finite(g?.peer?.dpmDelta));
  const peersFor=(g:any,fn:(x:any)=>boolean)=>valid.filter(x=>x.matchId!==g.matchId&&fn(x));
  return valid.map(g=>{
    const champ=txt(g.champion),opp=txt(g.peer?.champion||"Unknown"),dur=durationBucket(g);
    const candidates=[
      {level:"champion_opponent_duration_leave_one_out",rows:peersFor(g,x=>txt(x.champion)===champ&&txt(x.peer?.champion||"Unknown")===opp&&durationBucket(x)===dur),min:2},
      {level:"champion_duration_leave_one_out",rows:peersFor(g,x=>txt(x.champion)===champ&&durationBucket(x)===dur),min:2},
      {level:"champion_leave_one_out",rows:peersFor(g,x=>txt(x.champion)===champ),min:3},
      {level:"duration_leave_one_out",rows:peersFor(g,x=>durationBucket(x)===dur),min:4},
      {level:"global_leave_one_out",rows:peersFor(g,_=>true),min:1}
    ];
    const chosen=candidates.find(x=>x.rows.length>=x.min)||candidates[candidates.length-1];
    const expected=median(chosen.rows.map(x=>x.peer?.dpmDelta));
    return {matchId:g.matchId,champion:g.champion,opponent:g.peer?.champion||"Unknown",durationBucket:dur,
      actual:n(g.peer.dpmDelta),expected,residual:finite(expected)?n(g.peer.dpmDelta)-n(expected):null,
      contextLevel:chosen.level,contextGames:chosen.rows.length};
  }).filter(x=>finite(x.expected)&&finite(x.residual));
}

export function buildDecisionIntelligence(gamesInput:any[], sessionModel:any, primaryRole:string, historyInput:any[]=gamesInput){
  const games=arr(gamesInput).filter(g=>g?.timelineAvailable===true).sort((a:any,b:any)=>gameStart(a)-gameStart(b));
  const history=arr(historyInput).filter(Boolean).sort((a:any,b:any)=>gameStart(a)-gameStart(b));
  const recent=[...games].sort((a,b)=>gameStart(b)-gameStart(a));
  const abs=allAbsenceRows(games),fights=allFightRows(games);
  const analytics:any[]=[];

  // 1. Skipped-fight trade evidence
  const ledger=abs.map(({g,e})=>({
    matchId:g.matchId,champion:g.champion,minute:round(e.startMin,1),zone:e.fightZone||"unknown",
    goldSwing:round(e.crossMapGoldSwingVsPeer,0),csSwing:round(e.crossMapCsSwingVsPeer,1),
    structures:n(e.playerStructureGains||0),neutralObjectives:n(e.playerNeutralObjectiveGains||0),
    teamFightKills:n(e.teamFightKills||0),enemyFightKills:n(e.enemyFightKills||0),
    fightKillDelta:n(e.teamFightKills||0)-n(e.enemyFightKills||0),
    tradeSupported:e.crossMapTradeSupported===true,joinReviewPriority:e.joinReviewPriority||"context",
    positionEvidenceDeltaSec:round(e.positionEvidenceDeltaSec,0)
  }));
  const reviewRank=(x:any)=>(x.joinReviewPriority==="high"?300:x.joinReviewPriority==="medium"?200:100)+(x.tradeSupported?0:50)+Math.max(0,-n(x.fightKillDelta||0))*10;
  const ledgerPreview=[...ledger].sort((a,b)=>reviewRank(b)-reviewRank(a)).slice(0,12);
  const supportedTrades=count(ledger,x=>x.tradeSupported===true);
  analytics.push(metric("fight_decision_ledger","Skipped-fight trade evidence",ledger.length?"proxy":"unavailable",ledger.length,
    ledger.length?`${supportedTrades} of ${ledger.length} skipped-fight windows met the current compensation rule. Gold movement, CS movement, structure/objective involvement and the fight kill result are shown separately; no gold-equivalent value is invented.`:"No position-supported skipped fights in the current deep sample.",
    {compensationRule:"structure/objective involvement or +250g/+6CS direct-role movement within ~90s",supportedTrades,unsupportedTrades:ledger.length-supportedTrades,rows:ledgerPreview},ledger));

  // 2. Fight-distance screen
  const arrival=abs.map(({g,e})=>({
    matchId:g.matchId,minute:round(e.startMin,1),zone:e.fightZone,distance:e.playerDistanceToFight,
    insideScreen:e.joinReachable===true,feasible:e.joinReachable===true,priority:e.joinReviewPriority||"context",
    numbersDelta:e.numbersDelta,positionEvidenceDeltaSec:round(e.positionEvidenceDeltaSec,0),
    reachabilityBand:!finite(e.playerDistanceToFight)?"unknown":n(e.playerDistanceToFight)<=4000?"near":n(e.playerDistanceToFight)<=6500?"borderline":"far"
  }));
  const arrivalSampleDelta=median(arrival.map(x=>x.positionEvidenceDeltaSec));
  analytics.push(metric("arrival_feasibility","Fight-distance screen",arrival.length?"proxy":"unavailable",arrival.length,
    arrival.length?`${count(arrival,x=>x.insideScreen)} of ${arrival.length} skipped-fight position samples were within the current 6.5k-unit straight-line screen. The player-position frame is only guaranteed to be within 35 seconds of a fight event anchor, so this is not a travel-time or join-feasibility model.`:"No skipped-fight position evidence available.",
    {near:count(arrival,x=>x.reachabilityBand==="near"),borderline:count(arrival,x=>x.reachabilityBand==="borderline"),far:count(arrival,x=>x.reachabilityBand==="far"),medianPositionSampleDeltaSec:round(arrivalSampleDelta,0),rows:arrival.slice(0,12)},arrival));


  // 3. Pre-fight sampled positioning
  const pre:any[]=[];
  for(const {g,e} of [...fights,...abs]){
    if(!finite(e?.startMin)||!e?.fightPosition)continue;const t=n(e.startMin);
    const seen=new Set<string>(),checkpoints:any[]=[];
    for(const requestedSec of [30,20,10]){
      const fr=nearestFrameBefore(g,t-requestedSec/60,1.15);
      if(!fr?.position||!finite(fr.time)||!finite(fr.position.x)||!finite(fr.position.y))continue;
      const key=String(fr.time);if(seen.has(key))continue;seen.add(key);
      const d=distance(fr.position,e.fightPosition),actualLeadSec=Math.max(0,Math.round((t-n(fr.time))*60));
      checkpoints.push({requestedSec,actualLeadSec,zone:fr.zone||"unknown",distance:round(d,0),sampleMinute:round(fr.time,2),position:{x:n(fr.position.x),y:n(fr.position.y)}});
    }
    checkpoints.sort((a,b)=>b.actualLeadSec-a.actualLeadSec);
    if(checkpoints.length)pre.push({matchId:g.matchId,minute:round(t,1),fightZone:e.fightZone,fightPosition:e.fightPosition,checkpoints});
  }
  analytics.push(metric("pre_fight_positioning","Pre-fight sampled positioning",pre.length?"proxy":"unavailable",pre.length,
    pre.length?"Uses distinct Riot timeline frames requested around 30/20/10 seconds before fights, but displays the actual seconds-before-fight for each retained frame. Duplicate minute-cadence frames are collapsed rather than pretending they are separate observations.":"No usable pre-fight frame/coordinate pairs.",
    {frameCadenceCaveat:true,rows:pre.slice(0,12)},pre));

  // 4. Pre-fight distance versus sample timing
  const formation:any[]=[];let formationTooCoarse=0;
  for(const {g,e} of fights.filter(x=>x.e?.active===true&&finite(x.e?.startMin))){
    const fr=nearestFrameBefore(g,n(e.startMin),1.1),d=fr?.position&&e?.fightPosition?distance(fr.position,e.fightPosition):null;
    if(!finite(d)||!fr||!finite(fr.time))continue;
    const sampleLeadSec=Math.max(0,Math.round((n(e.startMin)-n(fr.time))*60));
    if(sampleLeadSec>45){formationTooCoarse++;continue;}
    formation.push({matchId:g.matchId,minute:round(e.startMin,1),zone:e.fightZone,distanceToAnchor:round(d,0),sampleLeadSec,
      numbersDelta:e.numbersDelta,contributed:e.contributed===true,survived:e.survived===true});
  }
  analytics.push(metric("fight_formation","Pre-fight distance vs sample timing",formation.length?"proxy":"unavailable",formation.length,
    formation.length?`${formation.length} active fights have a usable player-position sample within 45 seconds of contact; ${formationTooCoarse} older frames are withheld. Distance and sample age are shown directly instead of forcing arbitrary “core/backline” bands or a preferred spacing conclusion.`:"No active fights have a usable player-position frame within 45 seconds of contact.",
    {maxSampleLeadSec:45,withheldCoarseFrames:formationTooCoarse,medianSampleLeadSec:round(median(formation.map(x=>x.sampleLeadSec)),0),
      medianDistanceToAnchor:round(median(formation.map(x=>x.distanceToAnchor)),0),rows:formation.slice(0,16)},formation));


  // 5. Numbers-aware participation
  const numF=fights.filter(x=>x.e?.active===true&&finite(x.e?.numbersDelta)&&typeof x.e?.lostFight==="boolean");
  const numberGroups=[
    {key:"down2plus",label:"Down ≥2",rows:numF.filter(x=>n(x.e.numbersDelta)<=-2)},
    {key:"down1",label:"Down 1",rows:numF.filter(x=>n(x.e.numbersDelta)===-1)},
    {key:"even",label:"Even",rows:numF.filter(x=>n(x.e.numbersDelta)===0)},
    {key:"ahead",label:"Ahead",rows:numF.filter(x=>n(x.e.numbersDelta)>=1)}
  ].map(x=>({key:x.key,label:x.label,fights:x.rows.length,lossRate:round(safeRate(count(x.rows,y=>y.e?.lostFight===true),x.rows.length),1)}));
  const numberLead=median(numF.map(x=>x.e?.numberSampleLeadSec));
  const numberLossRates=numberGroups.filter(x=>x.fights>=5).map(x=>x.lossRate).filter(finite).map(n);
  const numberLossMin=numberLossRates.length?Math.min(...numberLossRates):null,numberLossMax=numberLossRates.length?Math.max(...numberLossRates):null;
  const numberLossRange=numberLossRates.length>=2?n(numberLossMax)-n(numberLossMin):null;
  analytics.push(metric("numbers_aware_participation","Local-number snapshot at fight start",numF.length?"proxy":"unavailable",numF.length,
    numF.length?`Local-number states are shown with their observed fight-loss rate, using a 4.5k-unit radius on the latest Riot timeline frame at or before the first kill (median frame age ${round(numberLead,0)??"—"}s). Across states with at least five fights the observed loss rates span ${round(numberLossMin,1)??"—"}–${round(numberLossMax,1)??"—"}% (range ${round(numberLossRange,1)??"—"} percentage points). This reports the observed spread without asserting that the states are equivalent or that sampled numbers caused the outcome.`:"No active fights with local-number evidence.",
    {states:numberGroups,minimumStateFights:5,supportedStates:numberLossRates.length,outnumberedStarts:numberGroups[0].fights,downOneStarts:numberGroups[1].fights,evenStarts:numberGroups[2].fights,aheadStarts:numberGroups[3].fights,
      medianNumberSampleLeadSec:round(numberLead,0),outnumberedLossRate:numberGroups[0].lossRate,
      minStateLossRate:round(numberLossMin,1),maxStateLossRate:round(numberLossMax,1),stateLossRateRangePp:round(numberLossRange,1)}));

  // 6. Cross-map compensation profile
  const supportedCross=ledger.filter(x=>x.tradeSupported===true),unsupportedCross=ledger.filter(x=>x.tradeSupported!==true);
  const structureWindows=count(ledger,x=>n(x.structures)>0),objectiveWindows=count(ledger,x=>n(x.neutralObjectives)>0);
  const economyOnlyWindows=count(ledger,x=>x.tradeSupported===true&&n(x.structures)===0&&n(x.neutralObjectives)===0);
  const supportedRate=safeRate(supportedCross.length,ledger.length);
  analytics.push(metric("cross_map_efficiency","Cross-map compensation profile",ledger.length?"proxy":"unavailable",ledger.length,
    ledger.length?`${round(supportedRate,0)}% of skipped-fight windows met at least one current compensation rule. Across all skipped windows, median direct-role movement was ${round(median(ledger.map(x=>x.goldSwing)),0)??"—"}g and ${round(median(ledger.map(x=>x.csSwing)),1)??"—"} CS; these signals are reported separately to avoid double-counting.`:"No measurable skipped-fight windows.",
    {supportedRate:round(supportedRate,1),supportedWindows:supportedCross.length,unsupportedWindows:unsupportedCross.length,
      medianGoldSwing:round(median(ledger.map(x=>x.goldSwing)),0),medianCsSwing:round(median(ledger.map(x=>x.csSwing)),1),
      structureWindows,objectiveWindows,economyOnlyWindows,rows:ledgerPreview}));


  // 7. Wave-to-fight conflict review
  const wave=abs.filter(x=>finite(x.e?.crossMapCsSwingVsPeer)).map(({g,e})=>({matchId:g.matchId,minute:round(e.startMin,1),zone:e.fightZone,
    csSwing:round(e.crossMapCsSwingVsPeer,1),goldSwing:round(e.crossMapGoldSwingVsPeer,0),fightLost:e.lostFight===true,
    likelyResourceConflict:n(e.crossMapCsSwingVsPeer)>=4}));
  analytics.push(metric("wave_fight_conflict","Wave-to-fight conflict review",wave.length?"proxy":"unavailable",wave.length,
    wave.length?"Uses direct-role CS/gold movement after a skipped fight as a resource-pressure proxy. The review flag uses ≥4 CS movement; Riot timeline data does not expose exact live minion-wave size.":"No skipped fights with peer CS movement.",
    {csConflictThreshold:4,resourceConflictWindows:count(wave,x=>x.likelyResourceConflict),rows:wave.slice(0,12)},wave));

  // 8. Nothing-gained isolation time
  const nothing=abs.filter(x=>x.e?.crossMapTradeSupported!==true),uniqueNothingMinutes=mergedWindowMinutes(nothing);
  analytics.push(metric("nothing_gained_isolation","Skipped fights without supported compensation",nothing.length?"proxy":"unavailable",nothing.length,
    nothing.length?`${nothing.length} skipped tracked fights produced no supported 90-second structure/objective/+250g/+6CS compensation. Their de-duplicated review windows cover about ${round(uniqueNothingMinutes,1)} minutes.`:"No uncompensated skipped-fight windows.",
    {reviewableMinutes:round(uniqueNothingMinutes,1),windowCount:nothing.length,highPriority:count(nothing,x=>x.e?.joinReviewPriority==="high"),
      rows:nothing.slice(0,12).map(({g,e})=>({matchId:g.matchId,minute:round(e.startMin,1),zone:e.fightZone,priority:e.joinReviewPriority}))},
    nothing.map(({g,e})=>({matchId:g.matchId,minute:round(e.startMin,1),zone:e.fightZone}))));

  // 9. Tempo after recall
  const resetRows:any[]=[];let totalShopVisits=0;
  for(const g of games)for(const s of arr(g?.shopVisits)){
    const rawShopMin=s?.lastMin??s?.startMin;if(!finite(rawShopMin))continue;const sm=n(rawShopMin);totalShopVisits++;
    const next=nextEventAfter(g,sm); if(!next||next.t-sm>4)continue;
    const fr=nearestFrameBefore(g,next.t,1.4);
    resetRows.push({matchId:g.matchId,shopMin:round(sm,1),nextKind:next.kind,eventMin:round(next.t,1),gapMin:round(next.t-sm,1),approachZone:fr?.zone||"unknown"});
  }
  const pairedShopRate=safeRate(resetRows.length,totalShopVisits);
  analytics.push(metric("post_recall_tempo","Recall-to-next-action timing",resetRows.length?"supported":"unavailable",resetRows.length,
    resetRows.length?`Among ${resetRows.length} of ${totalShopVisits} measured shop visits with a tracked fight/objective inside four minutes, the median shop→event gap is ${round(median(resetRows.map(x=>x.gapMin)),1)} minutes. Visits without tracked action inside four minutes are outside this timing distribution.`:"No shop visit could be paired with a fight/objective inside four minutes.",
    {totalShopVisits,pairedEventVisits:resetRows.length,pairedVisitRate:round(pairedShopRate,1),medianGapMin:round(median(resetRows.map(x=>x.gapMin)),1),rows:resetRows.slice(0,16)},resetRows));


  // 10. Objective setup path
  const paths=games.flatMap(g=>objectiveEvents(g).map(e=>pathToObjectiveRow(g,e)).filter(Boolean));
  analytics.push(metric("objective_setup_path","Objective setup route context",paths.length?"proxy":"unavailable",paths.length,
    paths.length?"Pairs measured shop/objective timing with distinct coarse position samples requested around 90/60/30 seconds before the event. Duplicate timeline frames are collapsed and actual seconds-before-objective are retained.":"No objective events with usable timing.",
    {rows:paths.slice(0,18)},paths));

  // 11. Lead movement from 15→25
  const leads=games.filter(g=>directPeer(g)&&g?.phaseRules?.fixed15to25Comparable===true&&finite(g?.goldDiff15)&&n(g.goldDiff15)>=500);
  const leadRows=leads.map(g=>({matchId:g.matchId,gold15:round(g.goldDiff15,0),gold25:round(g.goldDiff25,0),
    leadBand:n(g.goldDiff15)>=1500?"1500g+":n(g.goldDiff15)>=1000?"1000–1499g":"500–999g",
    movement:finite(g.goldDiff25)?round(n(g.goldDiff25)-n(g.goldDiff15),0):null,
    stillAheadAt25:finite(g.goldDiff25)?n(g.goldDiff25)>0:null,
    flippedBehindAt25:finite(g.goldDiff25)?n(g.goldDiff25)<0:null}));
  const measuredLeadRows=leadRows.filter(x=>finite(x.gold25));
  const leadBands={"500–999g":count(leadRows,x=>x.leadBand==="500–999g"),"1000–1499g":count(leadRows,x=>x.leadBand==="1000–1499g"),"1500g+":count(leadRows,x=>x.leadBand==="1500g+")};
  const leadMedianMove=median(measuredLeadRows.map(x=>x.movement));
  analytics.push(metric("lead_utilisation","Lead movement from 15→25",measuredLeadRows.length>=2?"supported":measuredLeadRows.length?"thin":"unavailable",measuredLeadRows.length,
    measuredLeadRows.length?`${count(measuredLeadRows,x=>x.stillAheadAt25===true)} of ${measuredLeadRows.length} paired ≥500g-at-15 games were still ahead of the direct-role opponent at 25; ${count(measuredLeadRows,x=>x.flippedBehindAt25===true)} had flipped behind. Median 15→25 gold-difference movement was ${round(leadMedianMove,0)}g. No arbitrary “half the lead” success threshold is used.`:"No ≥500g-at-15 game has a usable 25-minute checkpoint.",
    {eligibleLeadGames:leadRows.length,leadBands,stillAheadAt25:count(measuredLeadRows,x=>x.stillAheadAt25===true),
      flippedBehindAt25:count(measuredLeadRows,x=>x.flippedBehindAt25===true),medianMovement:round(leadMedianMove,0),rows:measuredLeadRows},measuredLeadRows));


  // 12. Deficit movement from 15→25
  const deficits=games.filter(g=>directPeer(g)&&g?.phaseRules?.fixed15to25Comparable===true&&finite(g?.goldDiff15)&&n(g.goldDiff15)<=-500);
  const defRows=deficits.map(g=>({matchId:g.matchId,gold15:round(g.goldDiff15,0),gold25:round(g.goldDiff25,0),
    movement:finite(g.goldDiff25)?round(n(g.goldDiff25)-n(g.goldDiff15),0):null,
    narrowed:finite(g.goldDiff25)?n(g.goldDiff25)>n(g.goldDiff15):null,
    crossedAheadAt25:finite(g.goldDiff25)?n(g.goldDiff25)>=0:null}));
  const measuredDefRows=defRows.filter(x=>finite(x.gold25));
  const deficitMedianMove=median(measuredDefRows.map(x=>x.movement));
  analytics.push(metric("deficit_recovery","Deficit movement from 15→25",measuredDefRows.length>=2?"supported":measuredDefRows.length?"thin":"unavailable",measuredDefRows.length,
    measuredDefRows.length?`${count(measuredDefRows,x=>x.narrowed===true)} of ${measuredDefRows.length} paired ≥500g-deficit games narrowed the direct-role deficit by 25, and ${count(measuredDefRows,x=>x.crossedAheadAt25===true)} crossed to even-or-ahead. Median movement was ${round(deficitMedianMove,0)}g. Median is used because one large comeback can distort the mean.`:"No ≥500g deficit-at-15 game has a usable 25-minute checkpoint.",
    {eligibleDeficitGames:defRows.length,narrowedGames:count(measuredDefRows,x=>x.narrowed===true),
      crossedAheadAt25:count(measuredDefRows,x=>x.crossedAheadAt25===true),medianMovement:round(deficitMedianMove,0),rows:measuredDefRows},measuredDefRows));


  // 13. Short-interval consecutive deaths vs direct-role opponent
  const repeatWindowMin=4;
  const chainRows=games.flatMap(g=>arr(g?.deathRecovery?.events).map((e:any)=>({
    matchId:g.matchId,champion:g.champion,minute:round(e?.secondMin??eventMin(e),1),gapMin:finite(e?.gapSec)?round(n(e.gapSec)/60,2):null,...e
  })));
  const repeatGameRows=games.map(g=>({
    matchId:g.matchId,deaths:n(g?.deathRecovery?.deaths||0),opportunities:n(g?.deathRecovery?.opportunities||0),
    repeatDeaths:n(g?.deathRecovery?.repeatDeaths||0),
    repeatRate:round(safeRate(n(g?.deathRecovery?.repeatDeaths||0),n(g?.deathRecovery?.opportunities||0)),1)
  })).filter(x=>x.opportunities>0);
  const opponentRepeatRows=games.filter(g=>directPeer(g)).map(g=>({
    matchId:g.matchId,opportunities:n(g?.opponentDeathRecovery?.opportunities||0),
    repeatDeaths:n(g?.opponentDeathRecovery?.repeatDeaths||0)
  })).filter(x=>x.opportunities>0);
  const repeatGames=repeatGameRows.filter(x=>x.repeatDeaths>0),totalRepeatOpps=sum(repeatGameRows,x=>x.opportunities);
  const opponentRepeatOpps=sum(opponentRepeatRows,x=>x.opportunities),opponentRepeatEvents=sum(opponentRepeatRows,x=>x.repeatDeaths);
  const repeatRate=round(safeRate(sum(repeatGameRows,x=>x.repeatDeaths),totalRepeatOpps),1),opponentRepeatRate=round(safeRate(opponentRepeatEvents,opponentRepeatOpps),1);
  const repeatRateDelta=finite(repeatRate)&&finite(opponentRepeatRate)?round(n(repeatRate)-n(opponentRepeatRate),1):null;
  analytics.push(metric("death_chains","Consecutive deaths within 4 minutes",totalRepeatOpps>=5?"supported":totalRepeatOpps?"thin":"unavailable",totalRepeatOpps,
    chainRows.length?`${chainRows.length} of ${totalRepeatOpps} player consecutive-death opportunities (${repeatRate}%) had the next death within ${repeatWindowMin} minutes. The direct-role opponents were ${opponentRepeatEvents} of ${opponentRepeatOpps} (${opponentRepeatRate??"—"}%) in the same deep games${repeatRateDelta!==null?`, a ${repeatRateDelta>=0?"+":""}${repeatRateDelta} percentage-point player-minus-opponent difference`:""}. Median player gap was ${round(median(chainRows.map(x=>x.gapSec)),0)??"—"} seconds. This is a pacing/risk comparison, not proof one death caused the next.`:"No consecutive deaths fell inside the four-minute review window.",
    {windowMinutes:repeatWindowMin,totalOpportunities:totalRepeatOpps,repeatEvents:sum(repeatGameRows,x=>x.repeatDeaths),repeatRate,
      opponentOpportunities:opponentRepeatOpps,opponentRepeatEvents,opponentRepeatRate,repeatRateDeltaPp:repeatRateDelta,
      gamesWithRepeat:repeatGames.length,medianGapSec:round(median(chainRows.map(x=>x.gapSec)),0),minimumOpportunities:5,gameRows:repeatGameRows,rows:chainRows.slice(0,18)},chainRows));

  // 14. Ahead-state fight execution
  const ri=fights.filter(x=>directPeer(x.g)&&x.e?.active===true&&finite(x.e?.goldDiffAtStart)).map(({g,e})=>({
    matchId:g.matchId,minute:round(e.startMin,1),goldDiffAtStart:round(e.goldDiffAtStart,0),currentGold:round(e.currentGoldAtStart,0),
    contributed:e.contributed===true,survived:e.survived===true,diedBeforeContribution:e.diedBeforeContribution===true,
    highUnspent:finite(e.currentGoldAtStart)?n(e.currentGoldAtStart)>=1000:null,lostFight:e.lostFight===true
  }));
  const rich=ri.filter(x=>n(x.goldDiffAtStart)>=300);
  const richPreContributionDeathRate=safeRate(count(rich,x=>x.diedBeforeContribution===true),rich.length);
  const richSurvivalRate=safeRate(count(rich,x=>x.survived===true),rich.length);
  const richHighUnspentKnown=rich.filter(x=>x.highUnspent!==null),richHighUnspentRate=safeRate(count(richHighUnspentKnown,x=>x.highUnspent===true),richHighUnspentKnown.length);
  analytics.push(metric("resource_to_impact","Ahead-state fight execution",rich.length?"supported":"unavailable",rich.length,
    rich.length?`Across ${rich.length} active fights started ≥300g ahead of the direct role opponent, ${round(richPreContributionDeathRate,0)}% ended in death before tracked kill/assist contribution, ${round(richSurvivalRate,0)}% were survived, and ${round(richHighUnspentRate,0)??"—"}% started with ≥1000 unspent gold where current-gold evidence existed. These are execution/state outcomes, not a generic impact-efficiency score.`:"No active fights started ≥300g ahead of the direct role opponent.",
    {aheadFightSamples:rich.length,preContributionDeathRate:round(richPreContributionDeathRate,1),survivalRate:round(richSurvivalRate,1),
      highUnspentRate:round(richHighUnspentRate,1),highUnspentKnown:richHighUnspentKnown.length,rows:rich.slice(0,18)},rich));


  // 15. After fight wins: next-fight-bounded follow-up
  const winFightRows:any[]=[];
  for(const g of games){
    const tracked=[...fightEvents(g),...absenceEvents(g)].filter((e:any)=>finite(e?.startMin)).sort((a:any,b:any)=>n(a.startMin)-n(b.startMin));
    const wins=fightEvents(g).filter((e:any)=>e?.active===true&&finite(e?.startMin)&&finite(e?.teamFightKills)&&finite(e?.enemyFightKills)&&n(e.teamFightKills)>n(e.enemyFightKills))
      .sort((a:any,b:any)=>n(a.startMin)-n(b.startMin));
    for(const e of wins){
      const end=n(e?.endMin??e?.startMin),nextFight=tracked.find((x:any)=>n(x.startMin)>end+.01);
      const to=Math.min(end+1.5,nextFight?Math.max(end,n(nextFight.startMin)):Infinity,finite(g?.durationMinutes)?n(g.durationMinutes):Infinity),teamId=n(g?.teamId||0);
      if(!finite(to)||to<=end)continue;
      const rawObjectives=arr(g?.objectives).filter((o:any)=>finite(eventMin(o))&&n(eventMin(o))>end&&n(eventMin(o))<=to&&(!teamId||n(o?.ownerTeam||0)===teamId));
      const neutral=rawObjectives.filter((o:any)=>txt(o?.type)==="ELITE_MONSTER_KILL").length;
      const towers=rawObjectives.filter((o:any)=>txt(o?.type)==="BUILDING_KILL").length;
      const plates=rawObjectives.filter((o:any)=>txt(o?.type)==="TURRET_PLATE_DESTROYED").length;
      const playerFollowUpKills=arr(g?.involvedKills).filter((o:any)=>finite(eventMin(o))&&n(eventMin(o))>end&&n(eventMin(o))<=to).length;
      const followUp=neutral+towers+plates+playerFollowUpKills>0;
      winFightRows.push({matchId:g.matchId,minute:round(e.startMin,1),zone:e.fightZone,windowSec:round((to-end)*60,0),
        objectives:neutral,towers,plates,playerFollowUpKills,followUp});
    }
  }
  const followUpWins=count(winFightRows,x=>x.followUp),objectiveFollowUps=count(winFightRows,x=>x.objectives>0),
    towerFollowUps=count(winFightRows,x=>x.towers>0),plateFollowUps=count(winFightRows,x=>x.plates>0),
    playerKillFollowUps=count(winFightRows,x=>x.playerFollowUpKills>0);
  analytics.push(metric("fight_lead_conversion","After fight wins: before the next fight",winFightRows.length?"supported":"unavailable",winFightRows.length,
    winFightRows.length?`${round(safeRate(followUpWins,winFightRows.length),0)}% of strict tracked fight wins had a measured follow-up before the next tracked fight, 90 seconds or game end, whichever came first. ${objectiveFollowUps} windows included a neutral objective, ${towerFollowUps} a building, ${plateFollowUps} a plate and ${playerKillFollowUps} a new reviewed-player kill/assist contribution. Windows are non-overlapping by construction, so one later event cannot inflate several fight wins.`:"No strict active fight wins to evaluate.",
    {followUpRate:round(safeRate(followUpWins,winFightRows.length),1),objectiveFollowUpWindows:objectiveFollowUps,
      towerFollowUpWindows:towerFollowUps,plateFollowUpWindows:plateFollowUps,playerKillFollowUpWindows:playerKillFollowUps,
      medianWindowSec:round(median(winFightRows.map(x=>x.windowSec)),0),windowRule:"ends at next tracked fight, 90 seconds or game end",rows:winFightRows},winFightRows));

  // 16. After fight losses: next-fight-bounded extra high-risk deaths
  const lossRows:any[]=[];
  for(const g of games){
    const tracked=[...fightEvents(g),...absenceEvents(g)].filter((e:any)=>finite(e?.startMin)).sort((a:any,b:any)=>n(a.startMin)-n(b.startMin));
    const losses=fightEvents(g).filter((e:any)=>e?.active===true&&e?.lostFight===true&&finite(e?.startMin)).sort((a:any,b:any)=>n(a.startMin)-n(b.startMin));
    for(const e of losses){
      const end=n(e?.endMin??e?.startMin),nextFight=tracked.find((x:any)=>n(x.startMin)>end+.01);
      const to=Math.min(end+1.5,nextFight?Math.max(end,n(nextFight.startMin)):Infinity,finite(g?.durationMinutes)?n(g.durationMinutes):Infinity);
      if(!finite(to)||to<=end)continue;
      const extraDeaths=count(badDeathEvents(g),d=>finite(eventMin(d))&&n(eventMin(d))>end&&n(eventMin(d))<=to);
      lossRows.push({matchId:g.matchId,minute:round(e.startMin,1),zone:e.fightZone,windowSec:round((to-end)*60,0),
        extraRiskDeaths:extraDeaths,noExtraRiskDeath:extraDeaths===0});
    }
  }
  analytics.push(metric("fight_loss_containment","After fight losses: before the next fight",lossRows.length?"supported":"unavailable",lossRows.length,
    lossRows.length?`${round(safeRate(count(lossRows,x=>x.noExtraRiskDeath),lossRows.length),0)}% of tracked active fight losses had no additional classified high-risk death before the next tracked fight, 90 seconds or game end, whichever came first. Windows do not overlap, and this card does not claim the broader game-state loss was contained.`:"No active lost fights to evaluate.",
    {noExtraRiskDeathRate:round(safeRate(count(lossRows,x=>x.noExtraRiskDeath),lossRows.length),1),
      medianWindowSec:round(median(lossRows.map(x=>x.windowSec)),0),windowRule:"ends at next tracked fight, 90 seconds or game end",rows:lossRows},lossRows));

  // 17. Skipped-fight structure/objective overlap
  const objTrade=abs.filter(x=>x.e?.playerNeutralObjectiveGains>0||x.e?.playerStructureGains>0).map(({g,e})=>({
    matchId:g.matchId,minute:round(e.startMin,1),fightZone:e.fightZone,
    structures:n(e.playerStructureGains||0),objectives:n(e.playerNeutralObjectiveGains||0),
    goldSwing:round(e.crossMapGoldSwingVsPeer,0),csSwing:round(e.crossMapCsSwingVsPeer,1)
  }));
  analytics.push(metric("objective_trading","Skipped-fight structure/objective overlap",objTrade.length?"supported":"unavailable",objTrade.length,
    objTrade.length?`${objTrade.length} skipped-fight windows also contained reviewed-player-supported structure or neutral-objective involvement within ~90 seconds. The timing overlap is measured; whether skipping the fight caused or justified that gain remains a replay question.`:"No skipped-fight window overlapped a tracked structure/objective gain.",
    {rows:objTrade},objTrade));


  // 18. Geographical review locations with coarse exposure context
  const geo=new Map<string,{zone:string,count:number,joinMiss:number,badDeaths:number,matches:Set<string>}>();
  const geoMapEvents:any[]=[];
  for(const {g,e} of abs){
    if(e?.joinReviewPriority!=="high")continue;
    const k=txt(e?.fightZone||"unknown"),r=geo.get(k)||{zone:k,count:0,joinMiss:0,badDeaths:0,matches:new Set()};
    r.count++;r.joinMiss++;r.matches.add(g.matchId);geo.set(k,r);
    if(e?.fightPosition)geoMapEvents.push({matchId:g.matchId,minute:round(e.startMin,1),zone:k,type:"missed_join",position:e.fightPosition});
  }
  for(const g of games)for(const d of badDeathEvents(g)){
    const k=txt(d?.fightZone||d?.zone||"unknown"),r=geo.get(k)||{zone:k,count:0,joinMiss:0,badDeaths:0,matches:new Set()};
    r.count++;r.badDeaths++;r.matches.add(g.matchId);geo.set(k,r);
    if(finite(d?.x)&&finite(d?.y))geoMapEvents.push({matchId:g.matchId,minute:round(d.time,1),zone:k,type:"bad_death",position:{x:n(d.x),y:n(d.y)}});
  }
  const exposure=sampledZoneExposure(games);
  const geoRows=[...geo.values()].map(x=>{
    const exposureMin=round(exposure.get(x.zone)||0,1);
    return {...x,matches:[...x.matches],sampledExposureMin:exposureMin,
      signalsPer30SampledMin:finite(exposureMin)&&n(exposureMin)>=15&&x.count>=3?round(30*x.count/n(exposureMin),2):null};
  }).sort((a,b)=>b.count-a.count);
  const rawTop=geoRows[0]||null,rateTop=geoRows.filter(x=>finite(x.signalsPer30SampledMin)&&n(x.sampledExposureMin)>=15&&x.count>=3)
    .sort((a,b)=>n(b.signalsPer30SampledMin)-n(a.signalsPer30SampledMin))[0]||null;
  analytics.push(metric("geographical_clusters","Geographical review locations",geoRows.length?"proxy":"unavailable",sum(geoRows,x=>x.count),
    geoRows.length?`Most raw review signals occurred in ${rawTop.zone} (${rawTop.count}). ${rateTop?`After coarse timeline-frame exposure adjustment, ${rateTop.zone} is highest at ${rateTop.signalsPer30SampledMin} signals per 30 sampled minutes. `:""}Exposure is estimated from roughly minute-spaced position frames, so this identifies places to inspect rather than proving a zone is intrinsically risky.`:"No repeated supported geography cluster.",
    {exposureBasis:"team-relative fight-zone minutes approximated from timeline frame intervals; rate requires ≥15 sampled minutes and ≥3 signals",
      rawTopZone:rawTop?.zone||null,rateTopZone:rateTop?.zone||null,rows:geoRows.slice(0,12),mapEvents:geoMapEvents.slice(0,40)}));

  // 19. Champion-specific decision tendencies
  const champs=championGroup(games),champEligible=champs.filter(x=>x.games>=3);
  analytics.push(metric("champion_tendencies","Champion-specific decision tendencies",champEligible.length>=2?"supported":champs.length?"thin":"unavailable",games.length,
    champEligible.length>=2?"Groups the reviewed account only by its own champion and compares skipped-fight, survival, risky-death and conversion tendencies.":champEligible.length===1?`Only ${champEligible[0].champion} has at least three deep games, so this is descriptive champion context rather than a cross-champion comparison.`:"No champion has at least three deep games yet.",
    {eligibleChampions:champEligible.length,rows:champs.slice(0,12)}));

  // 20. Matchup-adjusted lane results
  const matchups=matchupRows(games);
  const matchupSupported=matchups.filter(x=>x.games>=3);
  analytics.push(metric("matchup_adjusted_lane","Repeated matchup lane context",matchupSupported.length>=2?"proxy":matchups.length?"thin":"unavailable",matchups.reduce((s,x)=>s+x.games,0),
    matchupSupported.length>=2?"Uses repeated own-champion × direct-opponent-champion cells as personal-history context. It is not a population matchup table.":matchupSupported.length===1?`Only ${matchupSupported[0].matchup} has at least three comparable lane samples, so this is repeated-matchup context rather than a best/worst matchup comparison.`:"No matchup has at least three comparable lane samples yet.",
    {rows:matchups.slice(0,16),supportedCells:matchupSupported.length}));

  // 21. Context-adjusted DPM residuals
  const residuals=performanceResidualRows(history),recentResidual=residuals.filter(x=>recent.slice(0,20).some(g=>g.matchId===x.matchId));
  const contextCounts=residuals.reduce((m:any,x:any)=>(m[x.contextLevel]=(m[x.contextLevel]||0)+1,m),{});
  const contextualRows=residuals.filter(x=>x.contextLevel!=="global_leave_one_out").length;
  const recentResidualMedian=median(recentResidual.map(x=>x.residual));
  analytics.push(metric("expected_performance_residual","Context-adjusted DPM residuals",recentResidual.length>=5?"proxy":residuals.length?"thin":"unavailable",residuals.length,
    recentResidual.length>=5?`Median residual across the latest ${recentResidual.length} comparable deep games is ${round(recentResidualMedian,0)} DPM versus the leave-one-out personal context baseline. ${contextualRows} of ${residuals.length} history rows use champion and/or duration context; this is descriptive within-history adjustment, not a predictive MMR model.`:"The latest deep sample needs at least five direct-opponent DPM residuals before a recent performance conclusion is shown.",
    {recentResidual:recentResidual.length>=5?round(recentResidualMedian,1):null,minimumRecentGames:5,recentResidualStatistic:"median",recentResidualGames:recentResidual.length,contextualRows,contextCounts,rows:residuals.slice(-20)}));


  // 22. Later-session change by component
  const supportedSessionSignals=arr(sessionModel?.answer?.supportedSignals);
  const componentRows=supportedSessionSignals.map((s:any)=>({
    label:txt(s?.label),rawDelta:round(s?.delta,2),normalized:round(s?.normalized,2),threshold:round(s?.threshold,2),inverse:s?.inverse===true,
    recentN:n(s?.recentN||0),baselineN:n(s?.baselineN||0),
    direction:n(s?.normalized)>=.6?"better":n(s?.normalized)<=-.6?"worse":"small"
  })).filter((x:any)=>finite(x.normalized));
  const sessionBetter=count(componentRows,x=>x.direction==="better"),sessionWorse=count(componentRows,x=>x.direction==="worse"),sessionSmall=count(componentRows,x=>x.direction==="small");
  const sessionStatus=txt(sessionModel?.answer?.status||"insufficient");
  analytics.push(metric("session_components","Later-session change by component",componentRows.length?"proxy":"unavailable",componentRows.length,
    componentRows.length?`Game-3+ versus opener evidence is ${sessionStatus}: ${sessionBetter} supported component(s) shift better, ${sessionWorse} worse and ${sessionSmall} remain below the practical-change threshold. Each component keeps its own unit and sample counts; normalized values are used only to compare direction/magnitude.`:"No session component has enough evidence.",
    {sessionStatus,betterSignals:sessionBetter,worseSignals:sessionWorse,smallSignals:sessionSmall,rows:componentRows}));


  // 23. Requeue gap context
  const gaps:any[]=[];
  for(let i=1;i<history.length;i++){
    const prev=history[i-1],g=history[i];if(gameStart(prev)<=0||gameStart(g)<=0||!finite(prev?.durationMinutes)||n(prev.durationMinutes)<=0)continue;const gap=(gameStart(g)-gameEnd(prev))/60000;
    if(!finite(gap)||gap<0||gap>180||!directPeer(g))continue;
    const p=g.peer||{},available=[p.dpmDelta,p.csMinDelta,p.deathsDelta,p.kpDelta,p.gpmDelta].filter(finite).length;
    if(available<2)continue;
    const bucket=gap<10?"<10m":gap<25?"10–25m":gap<45?"25–45m":"45m+";
    gaps.push({matchId:g.matchId,gapMin:round(gap,1),bucket,
      dpmDelta:round(p.dpmDelta,1),csMinDelta:round(p.csMinDelta,2),deathsDelta:round(p.deathsDelta,2),
      kpDelta:round(p.kpDelta,1),gpmDelta:round(p.gpmDelta,1)});
  }
  const gapMetricKeys=["dpmDelta","csMinDelta","deathsDelta","kpDelta","gpmDelta"];
  const gapRows=["<10m","10–25m","25–45m","45m+"].map(bucket=>{
    const xs=gaps.filter(x=>x.bucket===bucket),metricSamples:any={},values:any={};
    for(const key of gapMetricKeys){const known=xs.filter(x=>finite(x[key]));metricSamples[key]=known.length;values[key]=known.length>=5?round(mean(known.map(x=>x[key])),key==="csMinDelta"?2:1):null;}
    return{bucket,games:xs.length,supported:gapMetricKeys.filter(key=>metricSamples[key]>=5).length>=2,metricSamples,...values};
  });
  const supportedGapRows=gapRows.filter(x=>x.supported);
  analytics.push(metric("requeue_sweet_spot","Requeue gap context",supportedGapRows.length?"supported":gaps.length?"thin":"unavailable",gaps.length,
    supportedGapRows.length?`${supportedGapRows.length} requeue-gap bucket(s) have at least two components with five comparable observations each. DPM, CS/min, deaths, KP and GPM versus the direct-role opponent retain separate denominators; no synthetic “best break” score or causal break recommendation is inferred.`:"No requeue-gap bucket has two components with five direct-opponent observations each yet.",
    {minimumBucketGames:5,minimumMetricGames:5,supportedBuckets:supportedGapRows.length,associationOnly:true,rows:gapRows}));

  // 24. Mistake recurrence trend
  const issues=games.map(g=>({matchId:g.matchId,start:gameStart(g),issues:issueCount(g),...issueComponents(g)}));
  const recentIssueRows=issues.slice(-5),priorIssueRows=issues.slice(Math.max(0,issues.length-10),Math.max(0,issues.length-5));
  const recentIssues=recentIssueRows.length===5?mean(recentIssueRows.map(x=>x.issues)):null,priorIssues=priorIssueRows.length===5?mean(priorIssueRows.map(x=>x.issues)):null;
  const recentByType={
    riskyDeaths:mean(issues.slice(-5).map(x=>x.riskyDeaths)),
    preObjectiveDeaths:mean(issues.slice(-5).map(x=>x.preObjectiveDeaths)),
    recentShopAbsences:mean(issues.slice(-5).map(x=>x.recentShopAbsences)),
    missedJoinReviews:mean(issues.slice(-5).map(x=>x.missedJoinReviews))
  };
  analytics.push(metric("mistake_recurrence","Review-signal recurrence trend",issues.length>=10?"proxy":issues.length?"thin":"unavailable",issues.length,
    finite(recentIssues)?`Latest five-game supported review-signal load is ${round(recentIssues,2)} per game versus ${round(priorIssues,2)??"—"} in the prior five. Signal categories can overlap within one event, so this is not a unique-mistake count or a target-linked half-life.`:"Five recent timeline games are required for a latest-five load, and five more for its prior-five comparison.",
    {targetLinked:false,recentGameN:recentIssueRows.length,priorGameN:priorIssueRows.length,recentFive:round(recentIssues,2),priorFive:round(priorIssues,2),recentByType,rows:issues.slice(-20)}));

  // 25. Automatic replay shortlist
  const candidates:any[]=[];
  for(const {g,e} of abs){
    let score=e?.joinReviewPriority==="high"?80:e?.lostFight?45:20;
    if(e?.crossMapTradeSupported===true)score+=25;
    candidates.push({matchId:g.matchId,minute:round(e.startMin,1),type:"Skipped fight",zone:e.fightZone,score,
      reason:e?.joinReviewPriority==="high"?"Lost, inside distance screen, no supported compensation":e?.crossMapTradeSupported?"Cross-map compensation worth validating":"Skipped fight with incomplete counterfactual"});
  }
  for(const {g,e} of fights){
    if(e?.firstAllyDeath)candidates.push({matchId:g.matchId,minute:round(e.startMin,1),type:"Fight entry",zone:e.fightZone,score:70,reason:"First allied death in tracked active fight"});
    if(e?.diedBeforeContribution)candidates.push({matchId:g.matchId,minute:round(e.startMin,1),type:"Fight entry",zone:e.fightZone,score:75,reason:"Died before tracked kill/assist contribution"});
    if(e?.outnumberedAtFirstKill&&e?.lostFight)candidates.push({matchId:g.matchId,minute:round(e.startMin,1),type:"Numbers check",zone:e.fightZone,score:65,reason:"Locally outnumbered snapshot in a lost fight"});
  }
  for(const g of games){
    for(const d of arr(g?.preObjectiveDeaths).slice(0,2))candidates.push({matchId:g.matchId,minute:round(eventMin(d),1),type:"Objective setup",zone:d?.fightZone||d?.zone||null,score:72,reason:"Death shortly before enemy objective conversion"});
    for(const d of arr(g?.deathRecovery?.events).filter((x:any)=>finite(x?.secondMin)).slice(0,2))candidates.push({matchId:g.matchId,minute:round(d.secondMin,1),type:"Death chain",zone:null,score:d?.highRisk?72:68,reason:"Repeat death inside the tracked recovery window"});
  }
  const ranked=candidates.sort((a,b)=>b.score-a.score).filter((x,i,a)=>a.findIndex(y=>y.matchId===x.matchId&&y.type===x.type&&y.minute===x.minute)===i);
  const shortlist:any[]=[],perMatch=new Map<string,number>(),perType=new Map<string,number>();
  for(const x of ranked){
    const mid=txt(x.matchId),typ=txt(x.type);
    if((perMatch.get(mid)||0)>=2||(perType.get(typ)||0)>=4)continue;
    shortlist.push(x);perMatch.set(mid,(perMatch.get(mid)||0)+1);perType.set(typ,(perType.get(typ)||0)+1);
    if(shortlist.length>=10)break;
  }
  analytics.push(metric("automatic_replay_shortlist","Automatic replay shortlist",shortlist.length?"proxy":"unavailable",shortlist.length,
    shortlist.length?`Top ${shortlist.length} moments use a transparent review-priority heuristic with diversity caps so one match or one event type cannot dominate the entire shortlist.`:"No replay moment crossed the current review-priority rules.",
    {heuristicPriority:true,maxPrimaryPerMatch:2,maxPrimaryPerType:4,rows:shortlist},shortlist));


  return {
    version:"decision-intelligence-v8",
    generatedFromGames:games.length,
    deepGames:games.length,
    historyGames:history.length,
    selectedRole:txt(primaryRole).toUpperCase(),
    proxyPolicy:"Proxy outputs are explicitly labeled and may rank replay questions; they must not be presented as causal proof or exact counterfactual value.",
    analytics,
    replayShortlist:shortlist,
    headline:{
      supported:analytics.filter(x=>x.status==="supported").length,
      proxy:analytics.filter(x=>x.status==="proxy").length,
      thin:analytics.filter(x=>x.status==="thin").length,
      unavailable:analytics.filter(x=>x.status==="unavailable").length
    }
  };
}
