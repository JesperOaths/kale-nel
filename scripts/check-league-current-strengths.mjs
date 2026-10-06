import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

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
const context={state:{selectedRole:'ADC'}};
vm.createContext(context);
const functions=['hasNum','fmt','fmtPct','signed','gameTimestampMs','canonicalRole','reportSelectedRole','explicitGameRole','gameMechanicsKey','reportCoachingGames','trustedDirectPeer','currentStrengthFindings'];
vm.runInContext(functions.map(source).join('\n')+'\nthis.build=currentStrengthFindings;',context);
const game=(id,extra={})=>({matchId:id,role:'ADC',timelineAvailable:true,directPeerComparable:true,win:true,outcomeCompromised:false,gameStartTimestamp:1700000000000,
  peer:{csMinDelta:1},goldDiff15:500,goldDiff25:1200,csDiff15:5,csDiff25:20,
  phaseRules:{key:'standard_sr_2026',lane15Comparable:true,closing25Comparable:true,fixed15to25Comparable:true},roleQuestContext:{revision:'adc_26.9'},
  firstResetSequence:{measured:true,deathInWindow:false,economyGain:true,economyLoss:false,csSwingAfter:4,goldSwingAfter:200},
  itemSpikeWindow:{eligible:true,used:true},...extra});
const report=(games,extra={})=>({games,dataQuality:{selectedRole:'ADC'},...extra});
const build=r=>JSON.parse(JSON.stringify(context.build(r)));
const find=(rows,key)=>rows.find(x=>x.key===key);
const games=(n,extra={})=>Array.from({length:n},(_,i)=>game('game-'+i,extra));

// Metric opportunities, roles, duplicate matches and mechanics precede every card.
assert.deepEqual(build(report([])),[]);
assert.deepEqual(build(report(games(4))),[],'four games do not establish a displayed strength');
let rows=build(report(games(5)));
assert.equal(rows.length,7);
assert.equal(find(rows,'lane-lead-wins').value,'5/5');
assert.equal(find(rows,'farm-edge').value,'+1.00');
assert.equal(find(rows,'farm-edge').smallSample,true);
assert.equal(find(build(report(games(10))),'farm-edge').smallSample,false);
assert.deepEqual(build(report(Array.from({length:20},()=>game('same')))),[],'repeated IDs cannot manufacture a sample');
assert.deepEqual(build(report(games(10,{role:'TOP'}))),[]);
assert.deepEqual(build(report(games(10,{role:null}))),[]);
assert.deepEqual(build(report(games(10),{dataQuality:{selectedRole:'ADC',mechanicsCohortApplied:true,currentMechanicsKey:'legacy|legacy'}})),[]);
assert.deepEqual(build(report(games(10,{directPeerComparable:false}))),[],'untrusted peers must not support opponent-relative strengths');
rows=build(report(games(10,{timelineAvailable:false})));
assert.deepEqual(rows.map(x=>x.key),['farm-edge'],'match-level farm remains valid without a timeline');

// Missing observations and unknown flags are not zeros, neutral resets or successful windows.
const missing=games(10,{peer:{csMinDelta:null},goldDiff15:null,goldDiff25:null,csDiff15:null,csDiff25:null,firstResetSequence:{measured:true},itemSpikeWindow:{eligible:true}});
assert.deepEqual(build(report(missing)),[]);
for(const v of [undefined,'',NaN])assert.ok(!find(build(report(games(10,{peer:{csMinDelta:v}}))),'farm-edge'));
assert.ok(!find(build(report(games(10,{firstResetSequence:{measured:true,deathInWindow:true,economyGain:true,economyLoss:false,csSwingAfter:4,goldSwingAfter:200}}))),'first-recalls'));
assert.ok(!find(build(report(games(10,{firstResetSequence:{measured:true,deathInWindow:false,economyGain:true,economyLoss:true,csSwingAfter:4,goldSwingAfter:200}}))),'first-recalls'));
assert.ok(!find(build(report(games(10,{itemSpikeWindow:{eligible:true,used:null}}))),'item-windows'));

// Comparable checkpoints and uncompromised known outcomes have distinct denominators.
const clean=games(8),extras=[game('afk',{outcomeCompromised:true,win:false}),game('unknown',{win:null})];
rows=build(report([...clean,...extras]));
assert.equal(find(rows,'lane-lead-wins').value,'8/8');
assert.equal(find(rows,'late-lead-wins').value,'8/8');
assert.equal(find(rows,'lead-growth').n,10,'economy observations need not discard a compromised final outcome');
rows=build(report(games(10,{phaseRules:{lane15Comparable:false,closing25Comparable:false,fixed15to25Comparable:false}})));
assert.ok(!rows.some(x=>['lane-lead-wins','late-lead-wins','mid-farm','lead-growth'].includes(x.key)));
rows=build(report(games(10,{phaseRules:{lane15Comparable:true,closing25Comparable:true,fixed15to25Comparable:false}})));
assert.ok(find(rows,'lane-lead-wins')&&find(rows,'late-lead-wins'));
assert.ok(!find(rows,'mid-farm')&&!find(rows,'lead-growth'));
assert.ok(!find(build(report(games(10,{csDiff25:null}))),'mid-farm'));
assert.ok(!find(build(report(games(10,{goldDiff25:null}))),'lead-growth'));
assert.ok(!find(build(report(games(10,{role:'SUPPORT'}),{dataQuality:{selectedRole:'SUPPORT'}})),'farm-edge'));
assert.ok(!find(build(report(games(10,{role:'JUNGLE'}),{dataQuality:{selectedRole:'JUNGLE'}})),'mid-farm'));

// Averages include unfavorable observations; show strengths only above practical gates.
rows=build(report([...games(6),...games(4,{peer:{csMinDelta:-2}}).map((g,i)=>({...g,matchId:'negative-'+i}))]));
assert.ok(!find(rows,'farm-edge'),'six positive games cannot hide a negative overall mean');
assert.ok(!find(build(report(games(10,{peer:{csMinDelta:.1}}))),'farm-edge'));
assert.ok(!find(build(report(games(10,{win:false}))),'lane-lead-wins'));
assert.ok(!find(build(report(games(10,{itemSpikeWindow:{eligible:true,used:false}}))),'item-windows'));
const neutral={measured:true,deathInWindow:false,economyGain:false,economyLoss:false,csSwingAfter:0,goldSwingAfter:0};
rows=build(report([...games(5),...games(9,{firstResetSequence:neutral}).map((g,i)=>({...g,matchId:'neutral-'+i}))]));
assert.equal(find(rows,'first-recalls').value,'0/14');
assert.deepEqual(find(rows,'first-recalls').resetMix,{gains:5,neutral:9,losses:0});
assert.ok(find(rows,'first-recalls').copy.includes('5 gains · 9 neutral · 0 losses'));
assert.ok(!find(build(report(games(10,{firstResetSequence:neutral}))),'first-recalls'),'all-neutral resets are not promoted as positive gains');

// A current favorable level is not a positive trend; missing latest-five data cannot use older games.
const recent=games(10).map((g,i)=>({...g,gameStartTimestamp:1700000000000+i*1000,peer:{csMinDelta:i<5?2:.5}}));
rows=build(report(recent));
assert.ok(find(rows,'farm-edge').copy.includes('Latest 5: +0.50'));
assert.ok(!find(rows,'farm-edge').copy.includes('improving'));
rows=build(report(recent.map((g,i)=>i>=7?{...g,peer:{csMinDelta:null}}:g)));
assert.ok(!find(rows,'farm-edge').copy.includes('Latest 5:'));

// Many events in one game do not constitute independent support or a recurring-game sample.
const event={result:'solo_kill',conversionEligibleTo15:true,goldSwingTo15:400};
assert.ok(!find(build(report([game('one',{laneDuel:{events:Array.from({length:20},()=>event)}})])),'solo-kill-followup'));
rows=build(report([game('one',{laneDuel:{events:[event,event,event]}}),game('two',{laneDuel:{events:[event]}}),game('three',{laneDuel:{events:[event]}})]));
const solo=find(rows,'solo-kill-followup');
assert.equal(solo.value,'5/5');assert.equal(solo.n,3);assert.equal(solo.eventCount,5);assert.equal(solo.smallSample,true);
assert.ok(solo.method.includes('not independent trials'));
assert.equal(new Set(solo.exampleMatchIds).size,solo.exampleMatchIds.length);
assert.ok(!find(build(report(games(10,{laneDuel:{events:[{...event,conversionEligibleTo15:false}]}}))),'solo-kill-followup'));

console.log('League current strengths: cohort, deduplication, missing data, checkpoint/outcome gates, neutral recalls, recent levels and event denominators PASS');
