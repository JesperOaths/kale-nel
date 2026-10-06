import fs from 'node:fs';
import vm from 'node:vm';
import assert from 'node:assert/strict';

const context={window:{}};
vm.createContext(context);
vm.runInContext(fs.readFileSync('league/learning-review.js','utf8'),context,{filename:'league/learning-review.js'});
const build=r=>JSON.parse(JSON.stringify(context.window.LeagueLearningReview.build(r)));
const game=(id,extra={})=>({matchId:id,role:'ADC',mapId:11,queueId:420,timelineAvailable:true,win:true,outcomeCompromised:false,
  champion:'Jinx',gameStartTimestamp:1700000000000,durationMinutes:30,
  phaseRules:{key:'standard_sr_2026'},roleQuestContext:{revision:'adc_26.9'},...extra});
const report=(games,extra={})=>({games,dataQuality:{selectedRole:'ADC'},...extra});
const fight=(extra={})=>({active:true,startMin:10,currentGoldAtStart:1500,highUnspent:true,diedBeforeContribution:false,...extra});
const habit=(r,key)=>r.habits.find(h=>h.key===key);

// Missing data, no opportunities and observed zeros remain distinct.
let r=build(report([game('missing'),game('no-timeline',{timelineAvailable:false}),game('zero',{fightProfile:{events:[fight({highUnspent:false,currentGoldAtStart:0})]}})]));
assert.equal(r.timelineGames,2);
assert.equal(r.missingTimelineGames,1);
assert.equal(habit(r,'unspent-fights').eligibleGames,1);
assert.equal(habit(r,'unspent-fights').meanGameRate,0);
assert.equal(habit(r,'unspent-fights').unknownOrNoOpportunityGames,1);
assert.equal(habit(r,'repeat-deaths').meanGameRate,null);
assert.equal(habit(r,'repeat-deaths').pooledEventRate,null);

// Game weighting must not become event weighting.
r=build(report([game('one',{fightProfile:{events:[fight()]}}),game('many',{fightProfile:{events:Array.from({length:99},()=>fight({highUnspent:false,currentGoldAtStart:0}))}})]));
assert.equal(habit(r,'unspent-fights').meanGameRate,50);
assert.equal(habit(r,'unspent-fights').pooledEventRate,1);
assert.equal(habit(r,'unspent-fights').opportunities,100);
assert.equal(habit(r,'unspent-fights').ready,false,'many events in only two games cannot support a recurring-game read');

// An unknown gold state must not become a zero or a no-flag reference.
r=build(report([game('unknown',{fightProfile:{events:[fight({currentGoldAtStart:null,highUnspent:null}),fight({active:false})]}})]));
assert.equal(habit(r,'unspent-fights').eligibleGames,0);

// Roles, maps, duplicate IDs and mechanics stay upstream of every calculation.
const eligible=game('adc',{fightProfile:{events:[fight()]}});
r=build(report([eligible,eligible,game('top',{role:'TOP'}),game('unknown',{role:null}),game('ambiguous',{roleEvidence:{confidence:'ambiguous'}}),game('aram',{mapId:12}),game('bottom',{role:'BOTTOM'})]));
assert.equal(r.roleGames,3);
assert.equal(r.timelineGames,2);
assert.deepEqual(habit(r,'unspent-fights').affectedMatchIds,['adc']);
r=build(report([eligible,game('old',{phaseRules:{key:'legacy'},roleQuestContext:{revision:'legacy'}})],{dataQuality:{selectedRole:'ADC',mechanicsCohortApplied:true,currentMechanicsKey:'standard_sr_2026|adc_26.9'}}));
assert.equal(r.timelineGames,1);
assert.equal(build({games:[eligible]}).timelineGames,0,'unknown requested role must not silently default to ADC');

// Team-only conversion is not a failure or personal conversion credit.
r=build(report([game('convert',{killConversion:{events:[
  {playerSupportedConverted:false,teamConverted:true,endMin:10},
  {playerSupportedConverted:false,teamConverted:false,endMin:12},
  {playerSupportedConverted:true,teamConverted:true,endMin:14},
  {converted:false,endMin:16}
]}})]));
assert.equal(habit(r,'kill-conversion').flaggedEvents,1);
assert.equal(habit(r,'kill-conversion').opportunities,3);

// Repeat-death risk/consequence flags overlap: count their union once.
r=build(report([game('repeat',{deathRecovery:{opportunities:4,repeatDeaths:2,events:[
  {costly:true,highRisk:true,secondMin:10},{costly:false,highRisk:true,secondMin:13}
]}}),game('broken',{deathRecovery:{opportunities:1,repeatDeaths:2,events:[{costly:true,highRisk:true,secondMin:4}]}})]));
assert.equal(habit(r,'repeat-deaths').flaggedEvents,2);
assert.equal(habit(r,'repeat-deaths').opportunities,4);
assert.equal(habit(r,'repeat-deaths').eligibleGames,1);

// Reset contamination, low-confidence peers and unavailable lead windows are excluded.
r=build(report([
  game('reset',{directPeerComparable:true,firstResetSequence:{measured:true,deathInWindow:false,economyLoss:false,time:5}}),
  game('death',{directPeerComparable:true,firstResetSequence:{measured:true,deathInWindow:true,economyLoss:false,time:5}}),
  game('peer',{directPeerComparable:false,firstResetSequence:{measured:true,deathInWindow:false,economyLoss:true,time:5}}),
  game('legacy',{directPeerComparable:true,phaseRules:{lane15Comparable:false},earlyLeadWindow:{eligible:true,giveback:true,peakMin:8}})
]));
assert.equal(habit(r,'first-reset').eligibleGames,1);
assert.equal(habit(r,'lead-giveback').eligibleGames,0);

// Lost objectives enter only when the team contested and the death timing is explicit.
r=build(report([game('objectives',{objectiveReadiness:{events:[
  {scope:'team_contested',present:false,recentDeath:true,time:15},
  {scope:'team_contested',present:true,recentDeath:true,time:20},
  {scope:'team_contested',present:false,recentDeath:null,time:25},
  {scope:'team_secured',present:false,recentDeath:true,time:30}
]}})]));
assert.equal(habit(r,'objective-death').flaggedEvents,1);
assert.equal(habit(r,'objective-death').opportunities,2);

// Role-specific reviews never import carry-lane gold/reset judgments.
const support=game('support',{role:'SUPPORT',roams:{events:[
  {adcLaneCostCs:-8,killOrAssist:false,objective:false,startMin:8,teamKills:2},
  {adcLaneCostCs:-8,killOrAssist:true,objective:false,startMin:10},
  {laneCostCs:-10,killOrAssist:false,objective:false,startMin:12}
]}});
r=build(report([support],{dataQuality:{selectedRole:'SUPPORT'}}));
assert.equal(habit(r,'empty-costly-roam').flaggedEvents,1);
assert.equal(habit(r,'empty-costly-roam').opportunities,2);
assert.equal(habit(r,'first-reset'),undefined);
assert.equal(habit(r,'lead-giveback'),undefined);
r=build(report([game('jungle',{role:'JUNGLE',fightProfile:{events:[fight({numbersDelta:-2,outnumberedAtFirstKill:true}),fight({numbersDelta:null,outnumberedAtFirstKill:null})]}})],{dataQuality:{selectedRole:'JUNGLE'}}));
assert.equal(habit(r,'outnumbered-entry').opportunities,1);
assert.equal(habit(r,'first-reset'),undefined);

// A reference must have exposure, the same queue and known compatible mechanics;
// select the same champion when that option exists.
r=build(report([
  game('flag',{fightProfile:{events:[fight()]}}),
  game('different',{champion:'Ashe',fightProfile:{events:[fight({highUnspent:false,currentGoldAtStart:0})]}}),
  game('same',{fightProfile:{events:[fight({highUnspent:false,currentGoldAtStart:0})]}}),
  game('queue',{queueId:440,fightProfile:{events:[fight({highUnspent:false,currentGoldAtStart:0})]}}),
  game('missing-exposure'),
  game('compromised',{outcomeCompromised:true,fightProfile:{events:[fight({highUnspent:false,currentGoldAtStart:0})]}})
]));
assert.equal(habit(r,'unspent-fights').referenceExample.matchId,'same');
assert.equal(habit(r,'unspent-fights').sameChampionReference,true);

// The result matrix needs three measured habits for a no-flag row. Compromised
// outcomes can still supply behavioral evidence, but never a result comparison.
const reviewed=(id,flagged,extra={})=>game(id,{fightProfile:{events:[fight({highUnspent:flagged,currentGoldAtStart:flagged?1500:0}),fight({highUnspent:false,currentGoldAtStart:0})]},
  killConversion:{events:[{playerSupportedConverted:true,teamConverted:true,endMin:12},{playerSupportedConverted:true,teamConverted:true,endMin:15}]},...extra});
const input=report([reviewed('win-flag',true),reviewed('loss-flag',true,{win:false}),reviewed('win-none',false),reviewed('loss-none',false,{win:false}),reviewed('afk',true,{outcomeCompromised:true}),game('limited'),reviewed('unverified',true,{outcomeCompromised:undefined})]);
const before=JSON.stringify(input);
r=build(input);
assert.deepEqual(r.matrix.winFlagged,['win-flag']);
assert.deepEqual(r.matrix.lossFlagged,['loss-flag']);
assert.deepEqual(r.matrix.winNoFlag,['win-none']);
assert.deepEqual(r.matrix.lossNoFlag,['loss-none']);
assert.deepEqual(r.matrix.excludedOutcome,['afk','unverified']);
assert.deepEqual(r.matrix.limitedCoverage,['limited']);
assert.equal(JSON.stringify(input),before,'review construction must not mutate source evidence');
const allIds=Object.values(r.matrix).flat();
assert.equal(new Set(allIds).size,allIds.length,'result groups must be disjoint');

// Pairs require shared supported exposure and at least three shared flagged games.
r=build(report(Array.from({length:3},(_,i)=>reviewed('pair-'+i,true,{fightProfile:{events:[fight({diedBeforeContribution:true}),fight({diedBeforeContribution:true})]}}))));
assert.equal(r.combinations.find(x=>new Set([x.first,x.second]).has('unspent-fights')&&new Set([x.first,x.second]).has('opening-deaths')).games,3);
assert.ok(r.combinations.every(x=>x.games<=x.comparableGames));

// Opening the technical section used to fail with an undefined metric helper.
// Execute the real app in a minimal DOM; skip only network startup.
const nodes=new Map();
const node=id=>{if(!nodes.has(id))nodes.set(id,{innerHTML:'',textContent:'',addEventListener(){},querySelectorAll(){return []}});return nodes.get(id);};
const appContext={window:{},document:{getElementById:node,addEventListener(){}},console,setTimeout:()=>0};
vm.createContext(appContext);
const appSource=fs.readFileSync('league/app.js','utf8').replace('boot().catch(e=>','if(false)boot().catch(e=>').replace(/\}\)\(\);\s*$/, 'window.__checks={renderAdvanced,metric};})();');
vm.runInContext(appSource,appContext);
assert.doesNotThrow(()=>appContext.window.__checks.renderAdvanced({summary:{},dataQuality:{selectedRole:'ADC'}}));
assert.ok((node('advancedMetrics').innerHTML.match(/class="metric-row"/g)||[]).length>50);
assert.ok((node('benchmarkMetrics').innerHTML.match(/class="metric-row"/g)||[]).length>20);
assert.ok(appContext.window.__checks.metric('<label>','<value>').includes('&lt;label&gt;'));
assert.ok(!appContext.window.__checks.metric('<label>','<value>').includes('<value>'));

console.log('league-learning-review=PASS (role scope, missing evidence, weighting, overlap, outcome exclusions, comparison context)');
