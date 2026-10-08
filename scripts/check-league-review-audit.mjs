import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { buildDecisionIntelligence } from '../supabase/functions/league-api-v1/decision-intelligence.ts';

const app=fs.readFileSync('league/app.js','utf8');
function source(name){
  const start=app.indexOf('function '+name+'(');
  assert.notEqual(start,-1,'Missing '+name);
  const body=app.indexOf('{',start);
  let depth=0,quote='',escaped=false;
  for(let i=body;i<app.length;i++){
    const c=app[i];
    if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote='';continue;}
    if(c==='\''||c==='"'||c==='`'){quote=c;continue;}
    if(c==='{')depth++;
    if(c==='}'&&--depth===0)return app.slice(start,i+1);
  }
  throw Error('Unclosed '+name);
}
const nodes=new Map(),context={
  state:{selectedRole:'ADC'},
  esc:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),
  $:id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:''});return nodes.get(id);},
  reportSelectedRole:()=> 'ADC',roleLabel:r=>r,
  topPracticeThemes:r=>r.priority?[r.priority]:[],currentStrengthFindings:()=>[],
  recentDirectionSummary:()=>({copy:'No supported recent direction.',value:'Thin',tone:'neutral'}),
  recentEvidenceBalance:()=>({state:'thin',total:0}),
  playerStyleEvidence:r=>r.styleSignals||[],decisionEvidenceChip:()=>''
};
vm.createContext(context);
const names=['hasNum','fmt','fmtPct','signed','wilsonInterval','renderObjectiveFamilyGraph','renderChampionHistoryGraph','renderSupportSynergyGraph','gameTimestampMs','longitudinalMetricSpecs','trajectoryMetricReady','trajectoryComparison','longitudinalTrajectoryRead','trajectoryValueLabel','trajectoryDateRange','trajectorySparkline','renderLongitudinalProgress','transitionWindowSignals','transitionQuality','transitionMatrixHtml','arcOutcomeContext','arcOutcomeLabel','arcTurningPointContext','synthesisAgreementModel','playerStyleModel','reviewEvidenceChip','decisionAnalytic','renderPlayerReview'];
vm.runInContext(names.map(source).join('\n'),context);
const plain=x=>JSON.parse(JSON.stringify(x));
const directionContext={hasNum:context.hasNum,fmt:context.fmt,fmtPct:context.fmtPct,signed:context.signed,fmtInt:v=>Math.round(Number(v)),roleRecentTrendSpecs:r=>r.specs};
vm.createContext(directionContext);
vm.runInContext(source('recentTrendSpecReady')+'\n'+source('recentDirectionSummary'),directionContext);
const directionSpec=(label,delta)=>({label,unit:'num',threshold:1,obj:{recent:delta,prior:0,recentN:5,priorN:15}});
let direction=directionContext.recentDirectionSummary({specs:[directionSpec('Largest decline',-4),directionSpec('Smaller gain',2),directionSpec('Another gain',1.5),directionSpec('Third gain',1)]});
assert.ok(direction.value.includes('slipping'));
assert.equal(direction.tone,'bad','a slipping headline must not turn green because other metrics improve');
direction=directionContext.recentDirectionSummary({specs:[directionSpec('Largest gain',4),directionSpec('Smaller decline',-2),directionSpec('Another decline',-1.5),directionSpec('Third decline',-1)]});
assert.ok(direction.value.includes('improving'));
assert.equal(direction.tone,'good','headline tone follows the described metric rather than majority counts');
assert.equal(directionContext.recentDirectionSummary({specs:[directionSpec('Stable',.5)]}).tone,'neutral');
assert.equal(directionContext.recentDirectionSummary({specs:[]}).tone,'neutral');
let countedPlot=null;
context.visualGraphEmpty=x=>x;
context.visualCompositionSvg=()=>'<svg>Pick mix</svg>';
context.visualIntervalPlotSvg=rows=>{countedPlot=plain(rows);return '<svg>Measured intervals</svg>';};
context.objectiveFamilyLabel=x=>x;
for(const [wins,total] of [[null,8],[undefined,8],[3,null],[true,8],[1.5,8],[3,8.5],[9,8]])assert.equal(context.wilsonInterval(wins,total),null,'unknown or invalid counts cannot produce an interval');
assert.ok(context.wilsonInterval(0,5).high>40,'known zero wins retain measured uncertainty');
const champ=(champion,cleanWins,cleanGames=10)=>({champion,games:10,cleanGames,cleanWins,cleanWinRate:99});
context.renderChampionHistoryGraph({longHorizon:{championHistory:[champ('Jinx',undefined),champ('Ashe',null)]}});
assert.ok(nodes.get('championHistoryGraph').innerHTML.includes('Pick mix'),'missing exact win counts retain pick mix rather than fabricated zero-win intervals');
context.renderChampionHistoryGraph({longHorizon:{championHistory:[champ('Jinx',6),champ('Ashe',0)]}});
assert.equal(countedPlot.find(x=>x.label==='Jinx').value,60,'win-rate dot and uncertainty must use the same exact counts');
assert.equal(countedPlot.find(x=>x.label==='Ashe').value,0);
assert.ok(countedPlot.find(x=>x.label==='Ashe').high>20);
context.renderSupportSynergyGraph({supportChampions:[{supportChampion:'Lulu',cleanGames:8,cleanWinRate:75,rankingEligible:true}]});
assert.ok(nodes.get('supportSynergyGraph').innerHTML.includes('needs at least three'));
context.renderSupportSynergyGraph({supportChampions:[{supportChampion:'Lulu',cleanWins:2,cleanGames:3,cleanWinRate:99,rankingEligible:true}]});
assert.equal(countedPlot[0].ready,false,'three-game support groups cannot become established from a stale flag');
assert.equal(countedPlot[0].value,200/3);
context.renderObjectiveFamilyGraph({behaviorSummary:{objectiveFamilySummary:{DRAGON:{contestedEncounters:6,contestPresenceRate:80}}}});
assert.ok(nodes.get('objectiveFamilyGraph').innerHTML.includes('No objective family'));
context.renderObjectiveFamilyGraph({behaviorSummary:{objectiveFamilySummary:{DRAGON:{joinedContestedEncounters:3,contestedEncounters:6,contestPresenceRate:80}}}});
assert.equal(countedPlot[0].value,50,'objective-presence dot and range must use the same observed counts');
// Evaluate the real app wrapper: helper declarations inside an IIFE are not window exports.
const genericNode={addEventListener:()=>{},value:'ADC'},bridgeContext={
  window:{GEJAST_CONFIG:{}},document:{getElementById:()=>genericNode,querySelectorAll:()=>[],addEventListener:()=>{}},
  localStorage:{getItem:()=>null,setItem:()=>{},removeItem:()=>{}},location:{hash:''},
  crypto:{randomUUID:()=> '00000000-0000-4000-8000-000000000001'},console,URL,TextEncoder
};
vm.createContext(bridgeContext);
vm.runInContext(app.replace('boot().catch(e=>','if(false)boot().catch(e=>'),bridgeContext);
for(const helper of ['openReplayReviewMatch','worldToMapPoint','map11Image','map11FallbackImage','championIcon','bindMapFallbacks'])assert.equal(typeof bridgeContext.window[helper],'function','Decision dashboard bridge: '+helper);
assert.equal(bridgeContext.window.worldToMapPoint(100000,100000),null,'dashboard maps must use the core coordinate validity gate');
assert.ok(bridgeContext.window.map11Image().includes('16.19.1'));
const w=(label,value,games=20,count=games)=>({label,games,peerCsMinDelta:{value,n:count},oldestGameStartTimestamp:1700000000000,newestGameStartTimestamp:1700100000000});
const spec={key:'peerCsMinDelta',label:'Farm vs opponent',unit:'csmin',threshold:.15};

// The actual latest window is compulsory. A remainder cannot become a 20-game baseline.
const windows=[w('Games 1–20',1),w('Games 21–40',.7),w('Games 41–60',.4),w('Games 61–80',.1),w('Games 81–86',3,6)];
let comparison=context.trajectoryComparison(windows,spec);
assert.equal(comparison.oldest.label,'Games 61–80');
assert.equal(comparison.delta,.9);
assert.equal(comparison.state,'good');
assert.equal(context.trajectoryComparison([w('Latest',null),...windows.slice(1)],spec),null);
assert.equal(context.trajectoryComparison([w('Latest',2,6),...windows.slice(1)],spec),null);
assert.equal(context.trajectoryComparison([w('Latest',2,20,4),...windows.slice(1)],spec),null);
assert.equal(context.trajectoryComparison([w('Latest',1),w('Older',.5)],{...spec,inverse:true}).state,'bad');
let html=context.trajectorySparkline([w('Latest',1),w('Gap',null),w('Older',.5)],spec);
assert.ok(!html.includes('<polyline'),'a missing chronological observation must break the line');
assert.ok(html.includes('Gap lacks five supported observations'));
html=context.trajectorySparkline(windows,spec);
assert.ok(html.includes('class="partial"')&&html.includes('G81–86 *'));
assert.ok(html.includes('tabindex="0"')&&html.includes('aria-label='));
context.renderLongitudinalProgress({longHorizon:{trajectoryWindows:windows}});
assert.ok(nodes.get('longitudinalProgress').innerHTML.includes('historical reference'));
assert.ok(nodes.get('longitudinalProgress').innerHTML.includes('2023'),'window dates show distant history explicitly');

// Behind→behind includes both deterioration and other movement, and empty cells stay neutral.
const transition=(from,to,swing)=>({t:{from:{key:from},to:{key:to},swing}});
assert.equal(context.transitionQuality(transition('behind','behind',-600).t),'bad');
assert.equal(context.transitionQuality(transition('behind','behind',600).t),'neutral');
html=context.transitionMatrixHtml([transition('behind','behind',-600),transition('behind','behind',100)]);
assert.ok(html.includes('<table')&&html.includes('scope="row"')&&html.includes('scope="col"'));
assert.ok(html.includes('0 favorable · 1 deteriorating · 1 other'));
assert.ok(html.includes('tone-neutral"><strong>0</strong>'));
html=context.transitionMatrixHtml([transition('behind','behind',-600)]);
assert.ok(html.includes('tone-bad"><strong>1</strong>'));
const deathFight=(start,end,death)=>({deathPositions:death==null?[]:[{time:death}],fightProfile:{events:[{active:true,startMin:start,endMin:end,diedBeforeContribution:true,firstAllyDeath:true}]}});
assert.ok(context.transitionWindowSignals(deathFight(14.9,15.3,15.1)).has('Fight death before contribution'));
assert.ok(!context.transitionWindowSignals(deathFight(24.9,25.3,25.1)).has('Fight death before contribution'));
assert.ok(!context.transitionWindowSignals(deathFight(15,16,null)).has('First allied death in active fight'));
assert.ok(!context.transitionWindowSignals(deathFight(14.5,15,15)).has('Fight death before contribution'));
assert.deepEqual(plain(context.arcOutcomeContext([{win:true},{win:false},{win:null},{win:true,outcomeCompromised:true}])),{wins:1,knownGames:2,excludedGames:2,winRate:50});
assert.equal(context.arcOutcomeLabel([{win:null}]),'Outcome not measurable');
const arcDef={test:g=>g.signal===true};
let arc=context.arcTurningPointContext([{signal:true,win:true},{signal:true,win:false},{signal:true,win:null},{signal:true,win:true,outcomeCompromised:true},...Array.from({length:3},()=>({signal:false,win:true}))],arcDef);
assert.equal(arc.count,4);assert.equal(arc.knownGames,2);assert.equal(arc.withWr,50);assert.equal(arc.associationReady,false);assert.equal(arc.winRateDelta,null,'unknown and compromised outcomes cannot meet an association minimum');
arc=context.arcTurningPointContext([...Array.from({length:3},()=>({signal:true,win:false})),...Array.from({length:3},()=>({signal:false,win:true}))],arcDef);
assert.equal(arc.associationReady,true);assert.equal(arc.winRateDelta,-100,'known zero wins remain a real outcome rate');

// A risky-death rate is not a variance estimate; no strength is manufactured by the conclusion.
assert.ok(!context.playerStyleModel({styleSignals:[{label:'High-risk deaths',tone:'bad'}]}).headline.includes('variance'));
assert.ok(context.playerStyleModel({styleSignals:[{label:'High-risk deaths',tone:'bad'}]}).headline.includes('classified risky deaths'));
context.renderPlayerReview({priority:{title:'Review resets'},decisionIntelligence:{analytics:[]}});
assert.ok(!nodes.get('playerReview').innerHTML.includes('identifiable strengths'));
assert.ok(!nodes.get('playerReview').innerHTML.includes('Preserve the measured strength:'));
const agreement=plain(context.synthesisAgreementModel({priority:{title:'Review resets',supportCount:4,independentSupportCount:2}}));
assert.equal(agreement[0].value,'2 additional evidence views');
assert.ok(agreement[1].copy.includes('does not yet have enough'));

const uiSource=fs.readFileSync('league/decision-intelligence.js','utf8').replace('  window.renderDecisionIntelligence=function(report){','  window.audit={conclusion,barRows,scatter,slope,sparkline,matchupVisual,visualFor,numbersVisual,requeueContextVisual};\n  window.renderDecisionIntelligence=function(report){');
const ui={window:{},document:{getElementById:()=>null}};vm.createContext(ui);vm.runInContext(uiSource,ui);
const view=ui.window.audit;
html=view.barRows([{label:'Zero',value:0},{label:'Positive',value:10}]);
assert.ok(html.includes('width:0%'),'zero observations must not receive visible positive-width bars');
assert.ok(view.barRows(Array.from({length:10},(_,i)=>({label:i,value:i}))).includes('Showing 8 of 10'));
assert.ok(view.scatter(Array.from({length:35},(_,i)=>({x:i,y:i})),'x','y').includes('Showing 30 of 35'));
assert.ok(view.slope(Array.from({length:13},(_,i)=>({matchId:'g'+i,a:-500,b:100})),'a','b').includes('Showing 12 of 13'));
assert.ok(view.slope([{matchId:'g',a:-500,b:100}],'a','b').includes('shared gold scale'));
assert.ok(view.slope([{matchId:'g',a:-500,b:100}],'a','b').includes('tabindex="0"'),'scrollable charts must be keyboard accessible');
html=view.matchupVisual([{matchup:'Zero vs Peer',games:3,laneGames15:3,avgGold15:0},{matchup:'Missing vs Peer',games:3,avgGold15:null},{matchup:'Small vs Peer',games:3,laneGames15:3,avgGold15:1},{matchup:'Large vs Peer',games:3,laneGames15:3,avgGold15:1000}]);
assert.ok(html.includes('width:0%'),'an exactly even matchup must draw zero movement');
assert.ok(html.includes('Gold@15 not measurable'),'missing lane gold must stay visibly missing');
assert.ok(html.includes('width:0.05%'),'small matchup differences must retain their exact proportional size');
const legacyMatchups={id:'matchup_adjusted_lane',evidence:{rows:[{matchup:'A vs B',games:8,avgGold15:900},{matchup:'C vs D',games:8,avgGold15:-900}]}};
assert.ok(!view.conclusion(legacyMatchups).includes('strongest'),'total games without verified lane counts cannot rank saved-report matchups');
html=view.sparkline([{matchId:'older',issues:2},{matchId:'gap',issues:null},{matchId:'newer',issues:4}],'issues',{labelKey:'matchId',valueLabel:'Review signals / game'});
assert.ok(!html.includes('<polyline'),'unknown recurrence observations must break the chronological line');
assert.ok(html.includes('gap')&&html.includes('not measurable'),'missing chronological observations remain labelled');
assert.ok(html.includes('di-axis-value')&&html.includes('Review signals / game'),'recurrence graphs need a numeric value scale and unit');
assert.ok(view.sparkline([{issues:0},{issues:0}],'issues').includes('<polyline'),'known zero recurrence remains measurable');
assert.ok(view.sparkline(Array.from({length:35},(_,i)=>({issues:i})),'issues').includes('Showing latest 30 of 35'),'truncated recurrence history must disclose coverage');
const partialBooleanRows=[{joined:true,followUp:true,noExtraRiskDeath:true,csSwing:2,goldSwing:50,fightLost:false},{joined:false,followUp:false,noExtraRiskDeath:false,csSwing:4,goldSwing:100,fightLost:true},{joined:null,followUp:null,noExtraRiskDeath:null,csSwing:6,goldSwing:150,fightLost:null}];
for(const id of ['objective_setup_path','fight_lead_conversion','fight_loss_containment']){
  html=view.visualFor({id,moments:partialBooleanRows},{});
  assert.ok(html.includes('Unknown')&&html.includes('33%'),'unknown '+id+' outcomes need their own category');
}
assert.ok(view.conclusion({id:'objective_setup_path',moments:partialBooleanRows}).includes('1/2 known'),'objective presence excludes unknown observations from its rate');
assert.ok(view.visualFor({id:'wave_fight_conflict',moments:partialBooleanRows},{}).includes('di-scatter-dot neutral'),'unknown fight outcomes cannot be colored as favorable');
assert.ok(!view.visualFor({id:'wave_fight_conflict',moments:partialBooleanRows},{}).includes('undefined'),'partial saved rows cannot leak missing labels into graph text');
assert.ok(view.visualFor({id:'expected_performance_residual',moments:[{expected:100,actual:120,residual:null},{expected:110,actual:100,residual:-10}]},{}).includes('di-scatter-dot neutral'),'unknown residuals cannot be colored as above expectation');
assert.ok(view.visualFor({id:'resource_to_impact',moments:[{goldDiffAtStart:400,currentGold:800},{goldDiffAtStart:500,currentGold:900,survived:true}]},{}).includes('di-scatter-dot neutral'),'missing survival/contribution evidence cannot be labeled as contributed then died');
assert.ok(view.requeueContextVisual({rows:[{bucket:'legacy',games:8,supported:true,dpmDelta:20,csMinDelta:.2}]}).includes('article class="thin"'),'a saved bucket support flag cannot override missing metric denominators');
const pre={id:'pre_fight_positioning',moments:[{checkpoints:[{actualLeadSec:60,distance:1000},{actualLeadSec:10,distance:500}]},{checkpoints:[{actualLeadSec:10,distance:10000}]}]};
assert.ok(view.conclusion(pre).includes('Across 1 fights'));
assert.ok(view.conclusion(pre).includes('averages 500u'),'single-frame fights cannot dilute a paired distance change');

const game=(id,extra={})=>({matchId:'g'+id,champion:'Jinx',role:'ADC',teamId:100,timelineAvailable:true,directPeerComparable:true,
  gameStartTimestamp:1700000000000+id*35*60000,durationMinutes:30,
  phaseRules:{fixed15to25Comparable:true,lane15Comparable:true},peer:{champion:'Ashe',dpmDelta:id*10,gpmDelta:20},
  fightProfile:{events:[],absenceEvents:[]},deathRecovery:{deaths:0,opportunities:0,repeatDeaths:0,events:[]},...extra});
const games=(n,extra={})=>Array.from({length:n},(_,i)=>game(i,extra));
const build=(gs,history=gs)=>buildDecisionIntelligence(gs,null,'ADC',history);
const analytic=(d,id)=>d.analytics.find(a=>a.id===id);
let matchup=analytic(build(games(3,{goldDiff15:0})),'matchup_adjusted_lane');
assert.equal(matchup.sample,3);assert.equal(matchup.evidence.rows[0].laneGames15,3);assert.equal(matchup.evidence.rows[0].dpmGames,3);
assert.equal(matchup.evidence.rows[0].avgGold15,0);
for(const phaseRules of [{lane15Comparable:false},{}])assert.equal(analytic(build(games(6,{goldDiff15:1000,phaseRules})),'matchup_adjusted_lane').sample,0,'ineligible or unverified checkpoints cannot enter matchup comparisons');
matchup=analytic(build(games(3,{goldDiff15:200,peer:{champion:'Ashe',dpmDelta:null}})),'matchup_adjusted_lane');
assert.equal(matchup.evidence.rows[0].dpmGames,0);assert.equal(matchup.evidence.rows[0].avgDpmVsPeer,null);
let d=build(games(10));
assert.equal(d.analytics.length,25);
assert.equal(new Set(d.analytics.map(a=>a.id)).size,25);
assert.equal(build(games(10,{timelineAvailable:false})).deepGames,0);
assert.equal(analytic(build(games(4)),'mistake_recurrence').evidence.recentFive,null);
assert.equal(analytic(build(games(6)),'mistake_recurrence').evidence.priorFive,null);
assert.equal(analytic(build(games(10)),'mistake_recurrence').evidence.priorFive,0);
assert.equal(analytic(build(games(3),games(20)),'expected_performance_residual').evidence.recentResidual,null);
assert.equal(analytic(build(games(3),games(20)),'expected_performance_residual').status,'thin');

const fight=(numbersDelta,lostFight)=>({active:true,startMin:15,endMin:15.3,numbersDelta,lostFight,numberSampleLeadSec:10});
d=build([game(0,{fightProfile:{events:[...Array.from({length:10},()=>fight(-2,true)),...Array.from({length:10},()=>fight(1,false)),fight(null,true),fight(0,null)]}})]);
let a=analytic(d,'numbers_aware_participation');
assert.equal(a.sample,20,'unknown numbers and outcomes are not zero/even or wins');
assert.equal(a.evidence.stateLossRateRangePp,100);
assert.ok(view.conclusion(a).includes('100 pp apart'));
assert.ok(!view.conclusion(a).includes('no clear directional'),'the conclusion must respond to a large observed spread');
d=build([game(0,{fightProfile:{events:[...Array.from({length:5},()=>fight(-2,true)),fight(1,false)]}})]);
a=analytic(d,'numbers_aware_participation');
assert.equal(a.evidence.stateLossRateRangePp,null,'one sampled state cannot define a between-state range');
assert.ok(view.conclusion(a).includes('At least two states'));

// A large bucket cannot promote a metric observed in only one of its games.
const gapGames=games(10).map((g,i)=>({...g,peer:{...g.peer,csMinDelta:i===1?2:null}}));
a=analytic(build(gapGames),'requeue_sweet_spot');
const bucket=a.evidence.rows.find(x=>x.bucket==='<10m');
assert.equal(bucket.games,9);assert.equal(bucket.metricSamples.csMinDelta,1);assert.equal(bucket.csMinDelta,null);
assert.equal(bucket.dpmDelta,50);assert.equal(bucket.supported,true);
assert.ok(view.requeueContextVisual(a.evidence).includes('n=1 · thin'));
assert.equal(analytic(build(games(10,{gameStartTimestamp:null})),'requeue_sweet_spot').sample,0);

// Zero repeats with known opportunities remain a measured zero; absent timelines never do.
d=build(games(5,{deathRecovery:{deaths:2,opportunities:1,repeatDeaths:0,events:[]}}));
a=analytic(d,'death_chains');assert.equal(a.status,'supported');assert.equal(a.sample,5);assert.equal(a.evidence.repeatRate,0);
const untrusted=game(0,{directPeerComparable:false,goldDiff15:1000,goldDiff25:2000,fightProfile:{events:[{active:true,goldDiffAtStart:1000}]}});
d=build([untrusted]);assert.equal(analytic(d,'lead_utilisation').sample,0);assert.equal(analytic(d,'resource_to_impact').sample,0);
assert.equal(analytic(build([game(0,{goldDiff15:-1000,goldDiff25:0,phaseRules:{fixed15to25Comparable:false}})]),'deficit_recovery').sample,0);

// Follow-up stops at game end and ignores unknown fight starts and null shop times.
const terminal=game(0,{durationMinutes:20,fightProfile:{events:[{active:true,startMin:19.5,endMin:19.8,teamFightKills:3,enemyFightKills:1}]},objectives:[{time:20.3,type:'BUILDING_KILL',ownerTeam:100}]});
a=analytic(build([terminal]),'fight_lead_conversion');
assert.equal(a.sample,1);assert.equal(a.evidence.rows[0].windowSec,12);assert.equal(a.evidence.rows[0].followUp,false);
assert.equal(analytic(build([game(0,{fightProfile:{events:[{active:true,startMin:null,endMin:null,teamFightKills:3,enemyFightKills:1}]}})]),'fight_lead_conversion').sample,0);
assert.equal(analytic(build([game(0,{shopVisits:[{startMin:null,lastMin:null}],fightProfile:{events:[{startMin:1}]}})]),'post_recall_tempo').sample,0);

// Diversity limits apply even when they produce fewer than ten recommendations.
d=build(games(8).map(g=>({...g,fightProfile:{events:[],absenceEvents:Array.from({length:8},(_,i)=>({startMin:10+i,joinReviewPriority:'high'}))}})));
assert.equal(d.replayShortlist.length,4);
for(const mid of new Set(d.replayShortlist.map(x=>x.matchId)))assert.ok(d.replayShortlist.filter(x=>x.matchId===mid).length<=2);
assert.ok(!/NaN|Infinity/.test(JSON.stringify(d)));
console.log('League review audit: complete history, graph gaps/scales, transition timing, evidence language, all 25 analytics, missing data, metric denominators and strict replay diversity PASS');
