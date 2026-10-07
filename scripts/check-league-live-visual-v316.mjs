#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { chromium } from 'playwright';

const SUPABASE_URL=process.env.SUPABASE_URL||'https://uiqntazgnrxwliaidkmy.supabase.co';
const API_KEY=process.env.SUPABASE_SERVICE_ROLE_KEY||'';
const BASE=(process.env.GEJAST_BASE_URL||'https://kalenel.nl/').replace(/\/+$/,'')+'/';
const EXPECTED_FRONTEND='20261007-league-web-v316';
const EXPECTED_ANALYZER='league-web-behavior-v4.181';
const EDGE=SUPABASE_URL+'/functions/v1/printify-gildan-diff-diag-v1';
const OUT='league-visual-audit';
const PROFILE_ID='00000000-0000-4000-8000-000000000316';
const WORKSPACE_ID='00000000-0000-4000-8000-000000000317';

if(!API_KEY)throw new Error('SUPABASE_SERVICE_ROLE_KEY missing');
fs.mkdirSync(OUT,{recursive:true});

const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const assert=(ok,msg)=>{if(!ok)throw new Error(msg);};
const diagnostic={startedAt:new Date().toISOString(),stage:'boot'};
function mark(stage,data={}){
  diagnostic.stage=stage;
  Object.assign(diagnostic,data);
  fs.writeFileSync(path.join(OUT,'diagnostic.json'),JSON.stringify(diagnostic,null,2));
  console.log('LEAGUE_VISUAL_STAGE '+stage+' '+JSON.stringify(data));
}
function errText(e){return String(e?.stack||e?.message||e);}
mark('boot');

async function boundedFetch(url,init={},label='request',timeoutMs=15000,attempts=3){
  let last;
  for(let i=1;i<=attempts;i++){
    try{
      const r=await fetch(url,{...init,signal:AbortSignal.timeout(timeoutMs)});
      if((r.status===429||r.status>=500)&&i<attempts){
        last=new Error(label+' HTTP '+r.status);
        await sleep(500*i);
        continue;
      }
      return r;
    }catch(e){
      last=e;
      if(i<attempts){await sleep(500*i);continue;}
    }
  }
  throw new Error(label+' failed after '+attempts+' attempts: '+String(last?.message||last));
}

async function edgeHealth(){
  const r=await boundedFetch(EDGE,{
    method:'POST',
    headers:{'content-type':'application/json',apikey:API_KEY,'x-league-workspace':WORKSPACE_ID},
    body:JSON.stringify({action:'health'})
  },'League edge health',15000,3);
  const raw=await r.text();
  let data;
  try{data=raw?JSON.parse(raw):{};}catch{throw new Error('League edge health returned invalid JSON');}
  if(!r.ok||data?.ok===false)throw new Error('League edge health failed: '+String(data?.error||r.status));
  return data;
}

async function converge(){
  let frontend='',analyzer='';
  for(let i=0;i<90;i++){
    try{
      const r=await boundedFetch(BASE+'league/?league_visual_audit='+Date.now(),{headers:{'cache-control':'no-cache'}},'League page',10000,2);
      frontend=(await r.text()).includes(EXPECTED_FRONTEND)?EXPECTED_FRONTEND:'';
    }catch{}
    try{analyzer=String((await edgeHealth()).analyzer_version||'');}catch{}
    if(frontend===EXPECTED_FRONTEND&&analyzer===EXPECTED_ANALYZER)return{frontend,analyzer};
    await sleep(5000);
  }
  throw new Error('Production did not converge to '+EXPECTED_FRONTEND+' / '+EXPECTED_ANALYZER+'; saw '+(frontend||'old frontend')+' / '+(analyzer||'unavailable analyzer'));
}

const metric=(value,n)=>({value,n});
function buildGames(){
  const champs=['Jinx','KaiSa','Ashe','Caitlyn','Jinx','KaiSa','Jinx','Ashe','Caitlyn','Jinx','KaiSa','Ashe','Jinx','Caitlyn','KaiSa','Jinx','Ashe','KaiSa','Jinx','Caitlyn'];
  const opponents=['Ezreal','Jhin','MissFortune','Sivir','Varus','Lucian','Xayah','Smolder','Aphelios','Jhin','Ezreal','Sivir','Varus','Lucian','Xayah','Smolder','Aphelios','MissFortune','Jhin','Ezreal'];
  const g15=[900,720,610,520,350,210,80,-50,-180,-420,-650,-900,500,260,-300,-760,680,-120,40,-540];
  const g25=[1100,850,300,-120,700,100,-250,180,-600,-200,-900,-1250,950,400,-80,-350,720,-300,260,-980];
  const csPeer=[.42,.31,.28,.22,.18,.35,.12,.25,.20,-.05,.14,.08,.44,.29,.17,.05,.37,.19,.26,.11];
  const dpmPeer=[120,95,80,72,60,110,45,70,65,20,55,40,130,88,48,15,105,58,75,35];
  const now=Date.now();
  return champs.map((champion,i)=>{
    const risky=(i%4===1||i%7===0),repeat=(i%6===1),deteriorating=(g15[i]>100&&g25[i]<=100)||(Math.abs(g15[i])<=100&&g25[i]<-100)||(g15[i]<-100&&g25[i]<-100&&(g25[i]-g15[i])<=-500);
    const matchId='EUW1_VISUAL_'+String(i+1).padStart(2,'0');
    const baseX=5200+(i%4)*900,baseY=5200+(i%5)*750;
    const badDeaths=risky?[{time:18.3+(i%3),zone:i%2?'mid outer-tower area':'bot lane central',tags:['isolated','objective-adjacent'],currentGold:900+(i%4)*180,traded:false,position:{x:baseX+1200,y:baseY+800}}]:[];
    const fightEvents=[
      {active:true,startMin:17.8+(i%4),fightPosition:{x:7600+(i%3)*600,y:7800+(i%2)*700},playerPosition:{x:baseX,y:baseY},fightZone:'mid river',survived:!risky,diedBeforeContribution:risky&&i%2===1,firstAllyDeath:risky&&i%3===0,outnumbered:i%5===0,highUnspent:i%6===0,currentGoldAtStart:i%6===0?1250:650,goldDiffAtStart:g15[i],kills:i%3,contributed:!risky}
    ];
    const absenceEvents=i%5===0?[{active:false,startMin:22.2,fightPosition:{x:8800,y:9100},playerPosition:{x:4500,y:3900},fightZone:'top river',joinReviewPriority:'high',crossMapTradeSupported:i%10===0,playerStructureGains:i%10===0?1:0,playerNeutralObjectiveGains:0}]:[];
    const objectiveEvents=[
      {time:19.2,objectiveType:'DRAGON',contested:true,teamSecured:i%3===0,enemySecured:i%3!==0,present:i%4!==0,absent:i%4===0,earlySetup:i%5!==0,recentShopAbsence:deteriorating&&i%2===0,secondsSinceShop:deteriorating&&i%2===0?42:110},
      {time:24.1,objectiveType:'BARON',contested:true,teamSecured:i%4===0,enemySecured:i%4!==0,present:i%3!==1,absent:i%3===1,earlySetup:i%4===0,recentShopAbsence:false}
    ];
    return{
      matchId,
      gameStartTimestamp:now-i*7_200_000,
      queueId:420,
      queueLabel:'Ranked Solo',
      role:'ADC',
      champion,
      teamId:i%2?200:100,
      win:g25[i]>100?true:g25[i]<-400?false:i%2===0,
      kills:4+(i%6),
      deaths:3+(i%5),
      assists:5+(i%8),
      kp:48+(i%7)*3,
      csMin:7.0+csPeer[i],
      dpm:620+dpmPeer[i],
      gpm:430+(i%7)*8,
      vpm:.72+(i%5)*.04,
      goldDiff15:g15[i],
      goldDiff25:g25[i],
      csDiff15:Math.round(g15[i]/80),
      csDiff25:Math.round(g25[i]/75),
      directPeerComparable:true,
      peer:{champion:opponents[i],csMinDelta:csPeer[i],dpmDelta:dpmPeer[i],gpmDelta:(i%5-2)*9,deathsDelta:(i%4)*.18-.12,kpDelta:(i%5-2)*1.4},
      timelineAvailable:true,
      phaseRules:{key:'sr_standard_15_25',lane15Comparable:true,fixed15to25Comparable:true,closing25Comparable:true,phaseComparable:true,season:'2026',publicPatchKey:'26.20'},
      roleQuestContext:{revision:'v316-visual-fixture',enabled:true,known:true,reward:'ADC role quest'},
      firstMajorItem:{itemId:3031,name:'Infinity Edge',time:13.6+(i%5)*.5},
      secondMajorItem:{itemId:3006,name:'Berserker’s Greaves',time:19.5+(i%4)*.6},
      itemSpikeDeltaVsOpponent:-.8+(i%4)*.25,
      firstResetSequence:{time:7.2+(i%4)*.5,measured:true,deathInWindow:false,economyGain:i%3===0,economyLoss:i%7===0,csSwingAfter:i%3===0?5:i%7===0?-7:1,goldSwingAfter:i%3===0?220:i%7===0?-410:40,spent:1150},
      itemSpikeWindow:{eligible:i%3!==2,used:i%4!==1,diedBeforeImpact:i%8===1,events:i%4!==1?[{time:15.4,type:'kill'}]:[]},
      earlyLeadWindow:{eligible:g15[i]>=500,peakMin:11.5,peakGoldDiff:Math.max(650,g15[i]+150),giveback:g15[i]>=500&&g25[i]<g15[i]-500},
      badDeaths,
      badDeathCount:badDeaths.length,
      deathConsequences:{costly:risky?1:0,severe:risky&&i%3===0?1:0,events:badDeaths.map(d=>({time:d.time,costly:true,severe:i%3===0,enemyObjectiveAfter:i%2===0,enemyStructureAfter:false}))},
      deathRecovery:{repeatDeaths:repeat?1:0,events:repeat?[{firstMin:16.2,secondMin:19.4,gapSec:192}]:[]},
      fightProfile:{events:fightEvents,absenceEvents,diedBeforeContribution:fightEvents.filter(x=>x.diedBeforeContribution).length},
      objectiveReadiness:{contestedObjectives:2,contestedJoined:i%4===0?1:2,earlySetupJoins:i%5===0?0:1,recentShopAbsences:objectiveEvents.filter(x=>x.recentShopAbsence).length,events:objectiveEvents},
      sideLaneRisk:{preNeutralObjectiveSideLaneDeaths:deteriorating&&i%3===0?1:0,events:deteriorating&&i%3===0?[{time:21.4,neutralObjectiveSoon:true,zone:'bot side lane'}]:[]},
      closing25:{highRiskDeaths:risky&&i%2===0?1:0,costlyDeaths:risky?1:0},
      impactTimeMin:9.5+(i%5)*.7,
      impactType:i%2?'kill_assist':'objective',
      impactDeltaVsOpponent:-.6+(i%4)*.4,
      frameSamples:[
        {time:14,position:{x:baseX,y:baseY}},
        {time:17,position:{x:baseX+600,y:baseY+500}},
        {time:20,position:{x:baseX+1300,y:baseY+900}},
        {time:23,position:{x:baseX+1900,y:baseY+1400}}
      ],
      judgments:risky?[{tone:'improve',category:'risk',title:'Review the second commitment',evidence:'A high-risk death appears inside the tracked transition window.',action:'Check wave, reset and objective timing before recommitting.'}]:[{tone:'strength',category:'economy',title:'Farm pressure held up',evidence:'Role-relative CS/min stayed positive in this game.',action:'Preserve the wave collection pattern.'}]
    };
  });
}

function analytic(id,title,evidence={},rows=[],status='supported'){
  return{id,title,status,sample:Math.max(rows.length,Number(evidence.sample||0),5),summary:title+' visual fixture.',evidence:{...evidence,rows}};
}
function buildDecisionIntelligence(games){
  const m=id=>games[Math.max(0,Math.min(games.length-1,id))].matchId;
  const tradeRows=[0,4,7,10,14,18].map((i,j)=>({matchId:m(i),minute:18+j,zone:j%2?'mid river':'bot river',goldSwing:[-180,320,90,-260,410,-80][j],csSwing:[2,7,4,-1,9,1][j],tradeSupported:j===1||j===2||j===4,joinReviewPriority:j===0||j===3?'high':'medium',fightLost:j!==4,structureHits:j===4?1:0,neutralObjectives:j===1?1:0}));
  const preRows=[0,3,6,9,12,15].map((i,j)=>({matchId:m(i),minute:18+j*.8,fightZone:'mid river',fightPosition:{x:7900+j*120,y:8100-j*80},checkpoints:[{actualLeadSec:42,zone:'bot jungle',distance:3800+j*140,position:{x:5600+j*100,y:5900+j*80}},{actualLeadSec:21,zone:'mid approach',distance:2200+j*90,position:{x:6800+j*90,y:7000+j*70}}]}));
  const formation=preRows.flatMap((x,i)=>x.checkpoints.map(cp=>({matchId:x.matchId,zone:cp.zone,sampleLeadSec:cp.actualLeadSec,distanceToAnchor:cp.distance,contributed:i%3!==1})));
  const objectiveRows=[1,5,9,13,17].map((i,j)=>({matchId:m(i),objective:j%2?'BARON':'DRAGON',joined:j!==2,shopLeadMin:1.8+j*.2,approachZone:'river entrance',actualApproachLeadSec:58,approachSamples:[{actualLeadSec:88,zone:'lane exit',position:{x:5200+j*250,y:5200+j*220}},{actualLeadSec:58,zone:'river entrance',position:{x:6800+j*230,y:6900+j*200}},{actualLeadSec:31,zone:'objective edge',position:{x:7900+j*180,y:8000+j*180}}]}));
  const leads=[0,1,2,3,12,16].map(i=>({matchId:m(i),gold15:games[i].goldDiff15,gold25:games[i].goldDiff25}));
  const deficits=[10,11,15,19,9,14].map(i=>({matchId:m(i),gold15:games[i].goldDiff15,gold25:games[i].goldDiff25}));
  const residual=[0,2,4,6,8,10,12,14,16,18].map((i,j)=>({matchId:m(i),champion:games[i].champion,opponent:games[i].peer.champion,expected:30+(j%3)*20,actual:games[i].peer.dpmDelta,residual:games[i].peer.dpmDelta-(30+(j%3)*20)}));
  const shortlist=[
    {matchId:m(3),minute:18.7,type:'lead transition',reason:'Lead state deteriorated before 25',zone:'mid river',score:91},
    {matchId:m(11),minute:19.4,type:'repeat death',reason:'Rapid repeat-death review',zone:'bot jungle',score:87},
    {matchId:m(5),minute:20.1,type:'objective setup',reason:'Recent-shop objective absence',zone:'dragon river',score:82},
    {matchId:m(14),minute:22.2,type:'missed join',reason:'Skipped fight without supported compensation',zone:'top river',score:76}
  ];
  const analytics=[
    analytic('fight_decision_ledger','Fight decision ledger',{supportedTrades:3,unsupportedTrades:3},tradeRows),
    analytic('arrival_feasibility','Arrival feasibility',{near:3,borderline:2,far:3,medianPositionSampleDeltaSec:22},tradeRows.map((x,i)=>({...x,distance:[3200,4700,7100,3800,5600,7600][i]})),'proxy'),
    analytic('pre_fight_positioning','Pre-fight positioning',{sample:preRows.length},preRows),
    analytic('fight_formation','Fight formation',{withheldCoarseFrames:2,medianSampleLeadSec:31,medianDistanceToAnchor:2800},formation),
    analytic('numbers_aware_participation','Numbers-aware participation',{states:[{label:'+1 ally',fights:8,lossRate:37},{label:'even',fights:11,lossRate:39},{label:'-1 ally',fights:7,lossRate:36}],minStateLossRate:36,maxStateLossRate:39,stateLossRateRangePp:3,medianNumberSampleLeadSec:18},[],'proxy'),
    analytic('cross_map_efficiency','Cross-map efficiency',{supportedRate:50,supportedWindows:3,unsupportedWindows:3,medianGoldSwing:85,medianCsSwing:4.5,structureWindows:1,objectiveWindows:1,economyOnlyWindows:1},tradeRows),
    analytic('wave_fight_conflict','Wave / fight conflict',{sample:6},tradeRows),
    analytic('nothing_gained_isolation','Nothing-gained isolation',{highPriority:2},tradeRows.filter(x=>!x.tradeSupported)),
    analytic('post_recall_tempo','Recall-to-next-action timing',{totalShopVisits:28,pairedEventVisits:13,pairedVisitRate:46,medianGapMin:2.2},[1.1,1.6,2.0,2.4,2.8,3.2].map((gapMin,i)=>({matchId:m(i),gapMin,nextKind:i%2?'fight':'objective',approachZone:i%2?'mid':'river'}))),
    analytic('objective_setup_path','Objective setup path',{sample:objectiveRows.length},objectiveRows),
    analytic('lead_utilisation','Lead utilisation',{leadBands:{'500–999g':5,'1000–1499g':1,'1500g+':0},stillAheadAt25:4,flippedBehindAt25:1,medianMovement:130},leads),
    analytic('deficit_recovery','Deficit recovery',{narrowedGames:2,crossedAheadAt25:1,medianMovement:-410},deficits),
    analytic('death_chains','Consecutive-death recovery',{repeatEvents:9,totalOpportunities:11,repeatRate:81.8,opponentRepeatEvents:8,opponentOpportunities:11,opponentRepeatRate:72.7,repeatRateDeltaPp:9.1,windowMinutes:4,medianGapSec:188,gameRows:[{matchId:m(1),repeatDeaths:2,opportunities:2,repeatRate:100},{matchId:m(7),repeatDeaths:1,opportunities:2,repeatRate:50},{matchId:m(11),repeatDeaths:2,opportunities:2,repeatRate:100}]},[]),
    analytic('resource_to_impact','Resource-to-impact conversion',{preContributionDeathRate:28,survivalRate:56,highUnspentRate:22},[0,3,5,9,12,16].map((i,j)=>({matchId:m(i),goldDiffAtStart:420+j*110,currentGold:650+j*140,diedBeforeContribution:j===2||j===5,survived:j%3===0}))),
    analytic('fight_lead_conversion','Fight-win follow-up',{followUpRate:77,objectiveFollowUpWindows:4,towerFollowUpWindows:3,plateFollowUpWindows:2,playerKillFollowUpWindows:5},[0,2,4,6,8,10,12,14].map((i,j)=>({matchId:m(i),followUp:j!==2&&j!==6}))),
    analytic('fight_loss_containment','Post-loss risk before next fight',{noExtraRiskDeathRate:92},[1,3,5,7,9,11,13,15,17,19].map((i,j)=>({matchId:m(i),noExtraRiskDeath:j!==4}))),
    analytic('objective_trading','Objective / structure overlap after skipped fights',{sample:tradeRows.length},tradeRows.map(x=>({...x,fightZone:x.zone}))),
    analytic('geographical_clusters','Geographical review clusters',{mapEvents:[{matchId:m(3),type:'bad_death',zone:'their mid outer-tower area',minute:19.1,position:{x:9800,y:8200}},{matchId:m(7),type:'bad_death',zone:'bot lane central',minute:18.4,position:{x:7200,y:4800}},{matchId:m(14),type:'missed_join',zone:'their mid outer-tower area',minute:22.2,position:{x:10100,y:8400}}]},[{zone:'their mid outer-tower area',count:6,sampledExposureMin:15.2,signalsPer30SampledMin:11.84},{zone:'bot lane central',count:9,sampledExposureMin:42.5,signalsPer30SampledMin:6.35},{zone:'mid river',count:5,sampledExposureMin:28.4,signalsPer30SampledMin:5.28}],'proxy'),
    analytic('champion_tendencies','Champion tendencies',{sample:3},[{champion:'Jinx',games:8,riskyDeathsPerGame:1.1,crossMapTradeRate:55,skippedFightSamples:9,activeFightSurvivalRate:68,activeFightSamples:12},{champion:'KaiSa',games:6,riskyDeathsPerGame:.8,crossMapTradeRate:48,skippedFightSamples:6,activeFightSurvivalRate:73,activeFightSamples:9},{champion:'Ashe',games:4,riskyDeathsPerGame:1.3,crossMapTradeRate:60,skippedFightSamples:5,activeFightSurvivalRate:64,activeFightSamples:7}],'thin'),
    analytic('matchup_adjusted_lane','Matchup-adjusted lane context',{sample:2},[{matchup:'Jinx vs Jhin',games:4,avgGold15:-120,avgDpmVsPeer:85},{matchup:'KaiSa vs Ezreal',games:3,avgGold15:180,avgDpmVsPeer:40},{matchup:'Ashe vs Sivir',games:3,avgGold15:-260,avgDpmVsPeer:62}],'thin'),
    analytic('expected_performance_residual','Expected-performance residual',{medianResidual:28},residual),
    analytic('session_components','Later-session components',{sample:4},[{label:'Gold@15 vs role',rawDelta:-310,baselineN:8,recentN:7,normalized:-2.1},{label:'CS/min vs role',rawDelta:.23,baselineN:8,recentN:7,normalized:1.5},{label:'DPM vs role',rawDelta:72,baselineN:8,recentN:7,normalized:1.2},{label:'Deaths vs role',rawDelta:.18,baselineN:8,recentN:7,normalized:-.7}]),
    analytic('requeue_sweet_spot','Requeue-gap context',{rows:[{bucket:'<5m',games:6,supported:true,dpmDelta:75,csMinDelta:.26,deathsDelta:.35,kpDelta:1.2,gpmDelta:8},{bucket:'5–15m',games:7,supported:true,dpmDelta:48,csMinDelta:.18,deathsDelta:.05,kpDelta:2.1,gpmDelta:14},{bucket:'15m+',games:4,supported:false,dpmDelta:20,csMinDelta:.09,deathsDelta:-.1,kpDelta:.5,gpmDelta:4}]},[],'thin'),
    analytic('mistake_recurrence','Review-signal recurrence',{sample:10},games.slice(0,10).map((g,i)=>({matchId:g.matchId,issues:Math.max(0,4-Math.floor(i/3))}))),
    analytic('automatic_replay_shortlist','Automatic replay shortlist',{sample:shortlist.length},shortlist)
  ];
  return{version:'decision-intelligence-v7',generatedFromGames:20,deepGames:20,historyGames:86,headline:{thin:4,unavailable:0},analytics,replayShortlist:shortlist};
}

function buildFixtureReport(){
  const games=buildGames(),decisionIntelligence=buildDecisionIntelligence(games),wins=games.filter(g=>g.win).length;
  const replayReviewQueue=decisionIntelligence.replayShortlist.map((x,i)=>({...x,rank:i+1,title:x.reason,evidence:'Fixture evidence preserved for production-render QA.',prompt:'What decision would improve this sequence next time?',tab:'fights',category:x.type}));
  const trajectory=[
    {label:'Latest 20',games:20,peerCsMinDelta:metric(.31,20),peerDpmDelta:metric(82,20),peerGpmDelta:metric(12,20),peerDeathsDelta:metric(.35,20)},
    {label:'Games 21–40',games:20,peerCsMinDelta:metric(.18,20),peerDpmDelta:metric(46,20),peerGpmDelta:metric(22,20),peerDeathsDelta:metric(.18,20)},
    {label:'Games 41–60',games:20,peerCsMinDelta:metric(.12,20),peerDpmDelta:metric(35,20),peerGpmDelta:metric(18,20),peerDeathsDelta:metric(.05,20)},
    {label:'Games 61–80',games:20,peerCsMinDelta:metric(.06,20),peerDpmDelta:metric(14,20),peerGpmDelta:metric(5,20),peerDeathsDelta:metric(-.04,20)},
    {label:'Games 81–86',games:6,peerCsMinDelta:metric(.02,6),peerDpmDelta:metric(5,6),peerGpmDelta:metric(2,6),peerDeathsDelta:metric(-.08,6)}
  ];
  return{
    analyzerVersion:EXPECTED_ANALYZER,
    generatedAt:new Date().toISOString(),
    profile:{displayName:'Visual QA · ADC report',gameName:'VisualQA',tagLine:'V316',rank:{tier:'PLATINUM',rank:'II',leaguePoints:42}},
    summary:{games:20,wins,winRate:wins/20*100,primaryRole:'ADC',csMin:7.28,dpm:690,kp:57,kda:2.9,avgDeaths:5.0},
    coachingSummary:{games:20,wins,primaryRole:'ADC',csMin:7.28,dpm:690,kp:57,kda:2.9,avgDeaths:5.0},
    dataQuality:{selectedRole:'ADC',analyzedGames:20,timelineGames:20,mechanicsCohortApplied:false,currentMechanicsKey:null,historyRoleScopeViolations:0},
    peerComparison:{sameRoleGames:20,avgGoldDiff15:-180,laneGames15:20,avgCsMinDelta:.23,csMinGames:20,avgDpmDelta:68,dpmGames:20,avgGpmDelta:11,gpmGames:20,avgDeathsDelta:.22,deathsGames:20,avgKpDelta:1.8,kpGames:20,avgMajorItemDeltaMin:-.35,majorItemGames:16,avgImpactDeltaMin:-.3,impactGames:18},
    behaviorSummary:{timelineGames:20,badDeathsPerTimelineGame:1.2,earlyLeadGivebackRate:33,earlyLeadGames:6,damageGoldEfficiency:2.4,midRouting:{games:8,avgCsSwing15to25:8.4,coachingObjectivePresenceRate:62},closing25:{leadWinRate:80,leadGames:5},preContributionFightDeathRate:22,fightSamples:18,fightSurvivalRate:61,survivedFightSamples:11,repeatDeathRate:81.8,repeatDeathOpportunities:11,itemSpikeUtilizationRate:75,itemSpikeEligibleWindows:8,neutralObjectiveEvents:28,objectiveContestEncounters:28,objectiveContestGames:15,objectiveContestJoinedEncounters:19,objectiveCoachingPresenceRate:64,neutralObjectiveJoins:19,objectiveSetupGames:12,earlySetupObjectiveJoins:12,objectiveSetupCoachingRate:63,recentShopObjectiveAbsenceRate:21,preNeutralObjectiveSideLaneDeathsPerGame:.15},
    recentTrend:{
      goldDiff15:{recent:-420,prior:-100,recentN:5,priorN:15},
      peerCsMinDelta:{recent:.35,prior:.12,recentN:5,priorN:15},
      peerDpmDelta:{recent:94,prior:36,recentN:5,priorN:15},
      peerDeathsDelta:{recent:.48,prior:.10,recentN:5,priorN:15},
      badDeaths:{recent:1.05,prior:1.28,recentN:5,priorN:15}
    },
    priorityThemes:[
      {key:'early-gold-state',priority:1,score:92,title:'Stabilize early gold-state creation',evidence:'Opponent-relative CS/min and DPM are positive, but Gold@15 is negative and the latest-five Gold@15 window deteriorated. The current evidence points to how early economy is created rather than a lack of output.',action:'Review the first reset, early deaths and plate/wave decisions in the games with the largest negative Gold@15 movement.',supportCount:5,independentSupportCount:3,confidence:'high'},
      {key:'deficit-recovery',priority:2,score:78,title:'Improve deficit stabilization',evidence:'Only part of the large-deficit sample narrows by 25 and the paired movement is negative on balance.',action:'In deficit games, review the first decision that deepens the role-gold gap after 15 rather than forcing a comeback play.',supportCount:3,independentSupportCount:2,confidence:'medium'},
      {key:'repeat-deaths',priority:3,score:70,title:'Reduce rapid repeat deaths',evidence:'The four-minute repeat-death rate remains above the direct-role opponent comparison.',action:'After a death, identify the next safe wave/reset/objective state before re-entering contested space.',supportCount:3,independentSupportCount:2,confidence:'medium'}
    ],
    recentFocus:[],
    overallHighlights:[],
    practiceTargets:[],
    advanced:{objectivePresence:64},
    externalBenchmarks:{eligible:false,eligibilityReason:'matching_rank_queue_tier_unavailable'},
    longHorizon:{
      selectedRole:'ADC',
      sampleGames:86,
      roleCounts:{ADC:86},
      deepTimelineGames:20,
      patches:['26.19','26.20'],
      summary:{laneCs10:metric(78.4,82),soloKills:metric(.18,86),soloKillsPer30:metric(.19,86),firstTurretParticipationRate:metric(37,86),deadTimePct:metric(10.8,86),damageEfficiencyPp:metric(2.1,86),turretDamagePerMin:metric(118,86),compromisedOutcomeGames:0},
      trend:{
        peerCsMinDelta:{recent:.31,prior:.08,recentN:20,priorN:20,delta:.23},
        peerDpmDelta:{recent:82,prior:18,recentN:20,priorN:20,delta:64},
        peerGpmDelta:{recent:12,prior:22,recentN:20,priorN:20,delta:-10},
        peerDeathsDelta:{recent:.35,prior:.05,recentN:20,priorN:20,delta:.30}
      },
      trajectoryWindows:trajectory,
      championHistory:[
        {champion:'Jinx',games:36,cleanGames:34,cleanWinRate:56,historyShare:42,csMin:metric(7.4,36),dpm:metric(720,36),deaths:metric(5.1,36),laneCs10:metric(80,34),recentDpm:metric(748,12),priorDpm:metric(690,12)},
        {champion:'KaiSa',games:24,cleanGames:23,cleanWinRate:52,historyShare:28,csMin:metric(7.2,24),dpm:metric(682,24),deaths:metric(4.8,24),laneCs10:metric(76,23),recentDpm:metric(700,8),priorDpm:metric(665,8)},
        {champion:'Ashe',games:14,cleanGames:14,cleanWinRate:50,historyShare:16,csMin:metric(7.0,14),dpm:metric(645,14),deaths:metric(5.0,14),laneCs10:metric(74,14),recentDpm:metric(660,5),priorDpm:metric(630,5)}
      ],
      topChampions:[{champion:'Jinx',games:36},{champion:'KaiSa',games:24},{champion:'Ashe',games:14}]
    },
    decisionIntelligence,
    replayReviewQueue,
    sessionBehavior:{
      firstGame:{games:6,lane15Games:6,goldDiff15:40,peerDpmDelta:35,peerDpmGames:6,peerCsMinDelta:.12,peerCsMinGames:6,timelineGames:6,badDeaths:1.1},
      game3Plus:{games:7,lane15Games:7,goldDiff15:-270,peerDpmDelta:106,peerDpmGames:7,peerCsMinDelta:.34,peerCsMinGames:7,timelineGames:7,badDeaths:1.3}
    },
    games,
    byRole:{ADC:{games:20}},
    byChampion:{},
    supportSynergy:[],
    sourceStatus:{note:'Deterministic production-render fixture; deployed analyzer version is verified separately through the live Edge health endpoint.'},
    charts:{}
  };
}

function apiFixtureResponse(action,report){
  const profile={id:PROFILE_ID,profile_key:'visual-qa-v316',display_name:'Visual QA · ADC report',game_name:'VisualQA',tag_line:'V316',platform_region:'euw1',routing_region:'europe',notes:'role=ADC',puuid:'visual-fixture-puuid',updated_at:new Date().toISOString()};
  if(action==='health')return{ok:true,analyzer_version:EXPECTED_ANALYZER,public_workspace:true,riot_configured:false,server_riot_key:false,player:'Visual QA workspace',site_scope:'friends'};
  if(action==='profiles_list')return{ok:true,profiles:[profile]};
  if(action==='cache_status')return{ok:true,cached_games:86,selected_role_cached_games:86,role_counts:{ADC:86},last_game_at:new Date().toISOString()};
  if(action==='report_latest')return{ok:true,analysis:{id:'visual-fixture-analysis-v316',report_data:report,data_quality:report.dataQuality,created_at:new Date().toISOString()},previous:null};
  return{ok:false,error:'visual_fixture_unhandled_action_'+String(action||'unknown')};
}

async function installFixtureApi(page,report){
  await page.route('**/functions/v1/printify-gildan-diff-diag-v1',async route=>{
    const req=route.request();
    const cors={
      'access-control-allow-origin':'https://kalenel.nl',
      'access-control-allow-methods':'GET, POST, OPTIONS',
      'access-control-allow-headers':'authorization, apikey, content-type, x-gejast-session, x-league-workspace, x-riot-api-key',
      'cache-control':'no-store',
      'content-type':'application/json; charset=utf-8'
    };
    if(req.method()==='OPTIONS'){
      await route.fulfill({status:204,headers:cors,body:''});
      return;
    }
    let body={};
    try{body=req.postData()?JSON.parse(req.postData()):{};}catch{}
    const payload=apiFixtureResponse(body.action,report);
    await route.fulfill({status:payload.ok===false?400:200,headers:cors,body:JSON.stringify(payload)});
  });
}

async function auditViewport(browser,report,width,height,label){
  const context=await browser.newContext({viewport:{width,height},deviceScaleFactor:1});
  const page=await context.newPage();
  const pageErrors=[];
  const consoleErrors=[];
  page.on('pageerror',e=>pageErrors.push(String(e.message||e)));
  page.on('console',m=>{if(m.type()==='error')consoleErrors.push(m.text());});
  await installFixtureApi(page,report);
  await page.addInitScript(({workspace,profile})=>{
    localStorage.setItem('bruisienator_public_workspace_v1',workspace);
    localStorage.setItem('bruisienator_saved_profile_selection_v1',profile);
  },{workspace:WORKSPACE_ID,profile:PROFILE_ID});

  await page.goto(BASE+'league/?league_fixture_audit='+Date.now(),{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForSelector('#report:not([hidden])',{timeout:30000});
  await page.waitForFunction(()=>document.querySelector('#coachingSynthesisLead')?.textContent?.trim().length>20,{timeout:20000});
  const before=await page.evaluate(()=>({
    decisionCards:document.querySelectorAll('#decisionIntelligence .di-card').length,
    decisionPlaceholder:!!document.querySelector('#decisionIntelligence .deferred-report-placeholder'),
    matchPlaceholder:!!document.querySelector('#matchHistoryList .deferred-report-placeholder')
  }));
  assert(before.decisionCards===0,label+': decision dashboard rendered synchronously instead of staying deferred');
  assert(before.decisionPlaceholder,label+': deferred decision placeholder missing on initial paint');
  assert(before.matchPlaceholder,label+': deferred match-history placeholder missing on initial paint');

  const decisions=page.locator('#decisions');
  if(!(await decisions.evaluate(el=>el.open===true)))await decisions.locator('summary').click();
  await page.waitForTimeout(160);
  await page.locator('#decisionIntelligencePanel').evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest'}));
  await page.waitForTimeout(320);
  await page.waitForFunction(()=>document.querySelectorAll('#decisionIntelligence .di-card').length===25,{timeout:20000});
  await page.locator('#match-history').evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest'}));
  await page.waitForTimeout(320);
  await page.waitForFunction(()=>document.querySelectorAll('#matchHistoryList .match-history-row').length>0,{timeout:20000});
  await page.locator('#player-review').evaluate(el=>el.scrollIntoView({block:'center',inline:'nearest'}));
  await page.waitForTimeout(350);

  const metrics=await page.evaluate(()=>{
    const font=s=>{const e=document.querySelector(s);return e?parseFloat(getComputedStyle(e).fontSize):0;};
    const cards=[...document.querySelectorAll('.coaching-synthesis-card')].map(e=>{const r=e.getBoundingClientRect();return{x:r.x,y:r.y,right:r.right,bottom:r.bottom};});
    let overlaps=0;
    for(let i=0;i<cards.length;i++)for(let j=i+1;j<cards.length;j++){
      if(Math.min(cards[i].right,cards[j].right)-Math.max(cards[i].x,cards[j].x)>2&&Math.min(cards[i].bottom,cards[j].bottom)-Math.max(cards[i].y,cards[j].y)>2)overlaps++;
    }
    return{
      overflow:document.documentElement.scrollWidth-document.documentElement.clientWidth,
      decisionCards:document.querySelectorAll('#decisionIntelligence .di-card').length,
      purposeBadges:document.querySelectorAll('#decisionIntelligence .di-purpose-badge').length,
      purposeLegend:(document.querySelector('.di-purpose-key')?.textContent||'').trim(),
      synthesisCards:cards.length,
      agreementCards:document.querySelectorAll('.evidence-agreement-card').length,
      trajectoryCards:document.querySelectorAll('.trajectory-card').length,
      transitionMatrix:!!document.querySelector('.transition-matrix'),
      transitionPrecursorCards:document.querySelectorAll('.transition-precursor-card').length,
      matchRows:document.querySelectorAll('#matchHistoryList .match-history-row').length,
      reviewSections:document.querySelectorAll('.player-review-section').length,
      conclusionChars:(document.querySelector('.player-review-conclusion')?.textContent||'').trim().length,
      fonts:{decision:font('.di-interpretation p'),review:font('.player-review-section p'),synthesis:font('.coaching-synthesis-card p')},
      initialMs:Number(document.querySelector('#report')?.dataset.initialRenderMs||0),
      perf:globalThis.state?.reportRenderPerformance||{},
      overlaps
    };
  });

  assert(metrics.overflow<=4,label+': horizontal page overflow '+metrics.overflow+'px');
  assert(metrics.decisionCards===25&&metrics.purposeBadges===25,label+': expected all 25 decision cards and purpose badges');
  assert(/Act on this/i.test(metrics.purposeLegend)&&/Useful context/i.test(metrics.purposeLegend)&&/Diagnostic \/ exploratory/i.test(metrics.purposeLegend),label+': coaching-purpose legend incomplete: '+metrics.purposeLegend);
  assert(metrics.synthesisCards===4&&metrics.agreementCards===3,label+': synthesis/evidence-agreement surface incomplete');
  assert(metrics.trajectoryCards===4,label+': expected four longer-history trajectory cards');
  assert(metrics.transitionMatrix,label+': 15→25 transition matrix missing');
  assert(metrics.transitionPrecursorCards>=1,label+': transition precursor co-occurrence cards missing');
  assert(metrics.matchRows>0,label+': deferred match stories did not render');
  assert(metrics.reviewSections>=5&&metrics.conclusionChars>=120,label+': whole-player review/conclusion incomplete');
  assert(metrics.overlaps===0,label+': coaching-synthesis cards overlap');
  assert(metrics.fonts.decision>=16,label+': decision explanation text below 16px');
  assert(metrics.fonts.review>=16,label+': player-review body text below 16px');
  assert(metrics.fonts.synthesis>=15,label+': synthesis body text below 15px');
  assert(pageErrors.length===0,label+': page errors: '+pageErrors.join(' | '));

  await page.screenshot({path:path.join(OUT,'league-'+label+'-full.png'),fullPage:true});
  for(const [name,selector] of [['synthesis','#coaching-synthesis'],['history','#long-horizon'],['decisions','#decisionIntelligencePanel'],['review','#player-review']]){
    const loc=page.locator(selector);
    if(await loc.count()){
      await loc.scrollIntoViewIfNeeded();
      await page.waitForTimeout(200);
      await loc.screenshot({path:path.join(OUT,'league-'+label+'-'+name+'.png')});
    }
  }
  await context.close();
  return{label,before,...metrics,pageErrors,consoleErrors};
}

let browser,primary=null;
try{
  mark('production_convergence');
  const production=await converge();
  mark('production_converged',{production});
  const report=buildFixtureReport();
  mark('fixture_ready',{deepGames:report.games.length,historyGames:report.longHorizon.sampleGames,decisionAnalytics:report.decisionIntelligence.analytics.length});
  browser=await chromium.launch({headless:true,executablePath:process.env.GEJAST_SYSTEM_CHROME||undefined,args:['--no-sandbox','--disable-dev-shm-usage']});
  mark('desktop_render');
  const desktop=await auditViewport(browser,report,1920,1080,'1920x1080');
  mark('desktop_pass',{initialMs:desktop.initialMs,deferred:desktop.perf,trajectoryCards:desktop.trajectoryCards,transitionPrecursorCards:desktop.transitionPrecursorCards});
  mark('mobile_render');
  const mobile=await auditViewport(browser,report,430,932,'430x932');
  mark('mobile_pass',{initialMs:mobile.initialMs,deferred:mobile.perf,trajectoryCards:mobile.trajectoryCards,transitionPrecursorCards:mobile.transitionPrecursorCards});
  const result={ok:true,production,fixtureBasis:'deterministic ADC report injected only at the browser League-API boundary',desktop,mobile,generatedAt:new Date().toISOString()};
  fs.writeFileSync(path.join(OUT,'report.json'),JSON.stringify(result,null,2));
  mark('audit_complete',{production,desktop:{initialMs:desktop.initialMs,deferred:desktop.perf,pageErrors:desktop.pageErrors.length,consoleErrors:desktop.consoleErrors.length},mobile:{initialMs:mobile.initialMs,deferred:mobile.perf,pageErrors:mobile.pageErrors.length,consoleErrors:mobile.consoleErrors.length}});
  console.log('LEAGUE_VISUAL_AUDIT_PASS '+JSON.stringify(diagnostic));
}catch(e){
  primary=e;
  mark('audit_failed',{error:errText(e)});
}finally{
  if(browser){try{await browser.close();}catch(e){mark('browser_close_warning',{browserCloseError:errText(e)});}}
}
if(primary)throw primary;
