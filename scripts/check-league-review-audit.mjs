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
const names=['hasNum','fmt','fmtPct','signed','gameTimestampMs','longitudinalMetricSpecs','trajectoryMetricReady','trajectoryComparison','longitudinalTrajectoryRead','trajectoryValueLabel','trajectoryDateRange','trajectorySparkline','renderLongitudinalProgress','transitionWindowSignals','transitionQuality','transitionMatrixHtml','synthesisAgreementModel','playerStyleModel','reviewEvidenceChip','decisionAnalytic','renderPlayerReview'];
vm.runInContext(names.map(source).join('\n'),context);
const plain=x=>JSON.parse(JSON.stringify(x));
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

// A risky-death rate is not a variance estimate; no strength is manufactured by the conclusion.
assert.ok(!context.playerStyleModel({styleSignals:[{label:'High-risk deaths',tone:'bad'}]}).headline.includes('variance'));
assert.ok(context.playerStyleModel({styleSignals:[{label:'High-risk deaths',tone:'bad'}]}).headline.includes('classified risky deaths'));
context.renderPlayerReview({priority:{title:'Review resets'},decisionIntelligence:{analytics:[]}});
assert.ok(!nodes.get('playerReview').innerHTML.includes('identifiable strengths'));
assert.ok(!nodes.get('playerReview').innerHTML.includes('Preserve the measured strength:'));
const agreement=plain(context.synthesisAgreementModel({priority:{title:'Review resets',supportCount:4,independentSupportCount:2}}));
assert.equal(agreement[0].value,'2 additional evidence views');
assert.ok(agreement[1].copy.includes('does not yet have enough'));

const uiSource=fs.readFileSync('league/decision-intelligence.js','utf8').replace('  window.renderDecisionIntelligence=function(report){','  window.audit={conclusion,barRows,scatter,slope,numbersVisual,requeueContextVisual};\n  window.renderDecisionIntelligence=function(report){');
const ui={window:{},document:{getElementById:()=>null}};vm.createContext(ui);vm.runInContext(uiSource,ui);
const view=ui.window.audit;
html=view.barRows([{label:'Zero',value:0},{label:'Positive',value:10}]);
assert.ok(html.includes('width:0%'),'zero observations must not receive visible positive-width bars');
assert.ok(view.barRows(Array.from({length:10},(_,i)=>({label:i,value:i}))).includes('Showing 8 of 10'));
assert.ok(view.scatter(Array.from({length:35},(_,i)=>({x:i,y:i})),'x','y').includes('Showing 30 of 35'));
assert.ok(view.slope(Array.from({length:13},(_,i)=>({matchId:'g'+i,a:-500,b:100})),'a','b').includes('Showing 12 of 13'));
assert.ok(view.slope([{matchId:'g',a:-500,b:100}],'a','b').includes('shared gold scale'));
const pre={id:'pre_fight_positioning',moments:[{checkpoints:[{actualLeadSec:60,distance:1000},{actualLeadSec:10,distance:500}]},{checkpoints:[{actualLeadSec:10,distance:10000}]}]};
assert.ok(view.conclusion(pre).includes('Across 1 fights'));
assert.ok(view.conclusion(pre).includes('averages 500u'),'single-frame fights cannot dilute a paired distance change');

const game=(id,extra={})=>({matchId:'g'+id,champion:'Jinx',role:'ADC',teamId:100,timelineAvailable:true,directPeerComparable:true,
  gameStartTimestamp:1700000000000+id*35*60000,durationMinutes:30,
  phaseRules:{fixed15to25Comparable:true},peer:{champion:'Ashe',dpmDelta:id*10,gpmDelta:20},
  fightProfile:{events:[],absenceEvents:[]},deathRecovery:{deaths:0,opportunities:0,repeatDeaths:0,events:[]},...extra});
const games=(n,extra={})=>Array.from({length:n},(_,i)=>game(i,extra));
const build=(gs,history=gs)=>buildDecisionIntelligence(gs,null,'ADC',history);
const analytic=(d,id)=>d.analytics.find(a=>a.id===id);
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
