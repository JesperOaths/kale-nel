import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync('league/app.js','utf8'),html=fs.readFileSync('league/index.html','utf8');
function source(name){
  const start=app.indexOf('function '+name+'(');assert.notEqual(start,-1,'Missing '+name);
  const body=app.indexOf('{',start);let depth=0,quote='',escaped=false;
  for(let i=body;i<app.length;i++){
    const c=app[i];
    if(quote){if(escaped)escaped=false;else if(c==='\\')escaped=true;else if(c===quote)quote='';continue;}
    if(c==='\''||c==='"'||c==='`'){quote=c;continue;}
    if(c==='{')depth++;
    if(c==='}'&&--depth===0)return app.slice(start,i+1);
  }
  throw Error('Unclosed '+name);
}
const context={state:{selectedRole:'ADC'}};vm.createContext(context);
const functions=['hasNum','canonicalRole','reportSelectedRole','explicitGameRole','gameMechanicsKey','reportCoachingGames','spendingFightPhase','spendingOutcomeComparison','buildSpendingFightComparison'];
vm.runInContext(functions.map(source).join('\n')+'\nthis.build=buildSpendingFightComparison;',context);
const fight=(start,gold,died,before=died,extra={})=>({startMin:start,endMin:start+.001,active:true,currentGoldAtStart:gold,playerDied:died,diedBeforeContribution:before,...extra});
const game=(id,events,extra={})=>({matchId:id,role:'ADC',champion:'Jinx',timelineAvailable:true,outcomeCompromised:false,
  phaseRules:{key:'standard_sr_2026',phaseComparable:true,earlyEndMin:14,lateStartMin:20},roleQuestContext:{revision:'adc_26.9'},fightProfile:{events},...extra});
const report=(games,extra={})=>({games,dataQuality:{selectedRole:'ADC'},...extra});
const build=r=>JSON.parse(JSON.stringify(context.build(r)));
const paired=(id,high=true,low=false,n=2)=>game(id,[...Array.from({length:n},(_,i)=>fight(10+i*.01,1000,high)),...Array.from({length:n},(_,i)=>fight(11+i*.01,999,low))]);
const readyGames=(high=true,low=false)=>Array.from({length:5},(_,i)=>paired('g'+i,high,low));
const close=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);

// One comparison population, a measured zero, and descriptive direction gates.
let m=build(report(readyGames()));
assert.equal(m.ready,true);assert.equal(m.signal,'review');assert.equal(m.pairedGames,5);
assert.equal(m.highStarts,10);assert.equal(m.lowStarts,10);
assert.equal(m.beforeContribution.high,100);assert.equal(m.beforeContribution.low,0);assert.equal(m.fightDeaths.games,5);
assert.equal(build(report(readyGames(false,true))).signal,'reverse');
assert.equal(build(report(readyGames(false,false))).signal,'similar');
assert.equal(build(report(readyGames().slice(0,4).map(g=>paired(g.matchId,true,false,3)))).signal,'thin','four games cannot pass on event volume');
assert.equal(build(report(readyGames().map(g=>paired(g.matchId,true,false,1)))).signal,'thin','five games cannot pass without ten starts on each side');
m=build(report([]));assert.equal(m.signal,'thin');assert.equal(m.beforeContribution.high,null);assert.equal(m.beforeContribution.delta,null);
assert.equal(build(report([paired('zero',false,false,1)].map(g=>({...g,fightProfile:{events:[fight(10,0,false),fight(11,1000,true)]}})))).lowStarts,1,'0g is measured, not missing');

// Role/mechanics scope, compromised outcomes, missing timelines and duplicated IDs.
assert.equal(build(report(readyGames().map(g=>({...g,role:'TOP'})))).pairedGames,0);
assert.equal(build(report(readyGames().map(g=>({...g,role:null})))).pairedGames,0);
assert.equal(build(report(readyGames(),{dataQuality:{selectedRole:'ADC',mechanicsCohortApplied:true,currentMechanicsKey:'legacy|legacy'}})).pairedGames,0);
m=build(report([...readyGames(),paired('afk',true,false,30)].map(g=>g.matchId==='afk'?{...g,outcomeCompromised:true}:g)));
assert.equal(m.excludedGames,1);assert.equal(m.pairedGames,5);assert.equal(m.highStarts,10);
assert.equal(build(report(readyGames().map(g=>({...g,timelineAvailable:false})))).pairedGames,0);
assert.equal(build(report(Array.from({length:20},()=>paired('duplicate')))).pairedGames,1);
assert.equal(build(report(readyGames().map(g=>({...g,matchId:''})))).pairedGames,0);

// Unknown inputs must never become a lower-gold start or a favorable outcome.
const valid=[fight(10,1000,true),fight(11,0,false)];
const invalid=[
  ...[null,undefined,'',NaN,-1].map((gold,i)=>fight(12+i*.01,gold,true)),
  fight(12.1,1000,true,null),fight(12.2,1000,null,false),fight(12.3,1000,false,true),
  fight(12.4,1000,true,true,{endMin:12}),fight(-1,1000,true),fight(12.6,1000,true,true,{startMin:null}),
];
m=build(report([game('missing',[...valid,...invalid,fight(13,1000,true,true,{active:false,proximityOnly:true})])]));
assert.equal(m.measuredStarts,2);assert.equal(m.excludedStarts,invalid.length);assert.equal(m.highStarts,1);assert.equal(m.lowStarts,1);
m=build(report([game('dupe-events',[...valid,...valid])]));assert.equal(m.measuredStarts,2);assert.equal(m.highStarts,1);assert.equal(m.lowStarts,1);

// Pair within each game and its own queue-aware phase; never pair across games/phases.
assert.equal(build(report([game('one',[fight(10,1000,true)]),game('two',[fight(11,0,false)])])).pairedGames,0);
assert.equal(build(report([game('unmatched',[fight(10,1000,true),fight(21,0,false)])])).pairedGames,0);
for(const phaseRules of [{phaseComparable:false,earlyEndMin:14,lateStartMin:20},{}, {earlyEndMin:20,lateStartMin:14}]){
  assert.equal(build(report([game('bad-phase',valid,{phaseRules})])).pairedGames,0);
}
const swiftRules={key:'swiftplay_sr_2026',phaseComparable:true,earlyEndMin:12,lateStartMin:12};
m=build(report([game('swift',[fight(12,1000,true),fight(13,0,false)],{phaseRules:swiftRules})]));
assert.equal(m.phasePairs,1);assert.equal(m.pairs[0].phases[0].key,'late','Swiftplay has no transition phase');
m=build(report([game('boundary',[fight(13.9,1000,true),fight(14,0,false),fight(14.1,1000,true),fight(20,0,false),fight(20.1,1000,true)])]));
assert.equal(m.phasePairs,2);assert.equal(m.highStarts,2);assert.equal(m.lowStarts,2,'unpaired early starts must stay out of comparison counts');

// Equal game/phase weights: long games and many events cannot dominate the result.
const many=Array.from({length:100},(_,i)=>fight(10+i*.01,1000,true));
m=build(report([game('many',[...many,fight(11.5,0,false)]),paired('other',false,true,1)]));
close(m.beforeContribution.high,50);close(m.beforeContribution.low,50);close(m.beforeContribution.delta,0);
const phases=game('two-phases',[...Array.from({length:3},(_,i)=>fight(10+i*.01,1000,true)),...Array.from({length:3},(_,i)=>fight(11+i*.01,0,false)),fight(15,1000,false),fight(16,0,true)]);
m=build(report([phases,paired('one-phase',true,false,1)]));
close(m.beforeContribution.high,75);close(m.beforeContribution.low,25);close(m.beforeContribution.delta,50);
assert.equal(m.phasePairs,3);assert.equal(m.beforeContribution.rows[0].delta,0);

// Large aggregate differences alone do not establish a repeated game-level cue.
const mixed=[paired('a'),paired('b'),game('c',[fight(10,1000,false),fight(10.1,1000,false),fight(11,0,true),fight(11.1,0,false)]),game('d',[fight(10,1000,false),fight(10.1,1000,false),fight(11,0,true),fight(11.1,0,false)]),paired('e',false,false)];
m=build(report(mixed));close(m.beforeContribution.delta,20);assert.equal(m.beforeContribution.higherGames,2);assert.equal(m.signal,'similar');
const smallDifference=n=>Array.from({length:5},(_,i)=>game('small-'+i,[...Array.from({length:n},(_,j)=>fight(10+j*.01,1000,j===0)),...Array.from({length:n},(_,j)=>fight(11+j*.01,0,false))]));
assert.equal(build(report(smallDifference(11))).signal,'similar','repeat alone cannot pass the ten-point floor');
assert.equal(build(report(smallDifference(10))).signal,'review','the ten-point gate is inclusive');

// Final team rankings cannot change spending analysis or resurrect the retired widgets.
const withRanks=readyGames().map((g,i)=>({...g,goldRank:i+1,damageRank:5-i}));
assert.deepEqual(build(report(withRanks)),build(report(readyGames())));
for(const id of ['resourceOutputArchetypes','resourceOutputContrast','highResourceBehaviorContrast','resourceOutputArchetypeDetail'])assert.ok(!html.includes('id="'+id+'"'));
assert.ok(!app.includes('archetypeDeepDiagnostic')&&!app.includes('matchHistoryArchetypeKey'));
assert.ok(!app.includes('Top-2 gold → top-2 damage')&&!app.includes('Lower gold → top-2 damage'));
assert.ok(html.indexOf('id="decisions"')<html.indexOf('id="spendingFightComparison"')&&html.indexOf('id="spendingFightComparison"')<html.indexOf('id="long-horizon"'));
assert.ok(app.includes("openReplayReviewMatch(btn.dataset.spendingMatch,'fights')"));
assert.ok(app.includes('not proof that shopping would have changed a fight')&&app.includes('the percentages are not pooled event fractions')&&app.includes('not a significance test'));
console.log('League spending comparison: matched games/phases, game weights, cohort/missing-data guards, duplicate evidence, Swiftplay, display gates and rank-independent analysis PASS');
