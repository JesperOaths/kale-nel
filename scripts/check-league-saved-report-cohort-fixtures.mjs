import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const app=fs.readFileSync('league/app.js','utf8');

function functionSource(name){
  const marker=`function ${name}(`,start=app.indexOf(marker);
  assert.notEqual(start,-1,`${name} must remain defined in league/app.js`);
  const bodyStart=app.indexOf('{',start);
  let depth=0,quote='',escaped=false,lineComment=false,blockComment=false;
  for(let i=bodyStart;i<app.length;i++){
    const ch=app[i],next=app[i+1];
    if(lineComment){if(ch==='\n')lineComment=false;continue;}
    if(blockComment){if(ch==='*'&&next==='/'){blockComment=false;i++;}continue;}
    if(quote){
      if(escaped){escaped=false;continue;}
      if(ch==='\\'){escaped=true;continue;}
      if(ch===quote)quote='';
      continue;
    }
    if(ch==='/'&&next==='/'){lineComment=true;i++;continue;}
    if(ch==='/'&&next==='*'){blockComment=true;i++;continue;}
    if(ch==='\''||ch==='"'||ch==='`'){quote=ch;continue;}
    if(ch==='{')depth++;
    if(ch==='}'&&--depth===0)return app.slice(start,i+1);
  }
  assert.fail(`${name} must have a complete function body`);
}

const helperNames=['canonicalRole','explicitGameRole','gameMechanicsKey','reportCoachingGames'];
const context={};
vm.createContext(context);
vm.runInContext(`${helperNames.map(functionSource).join('\n')}\nthis.reportCoachingGames=reportCoachingGames;`,context,{filename:'league/app.js#saved-report-cohort-fixture'});

const currentRules={key:'standard_sr_2026'};
const currentQuest={revision:'adc_26.9_40g_takedown'};
const oldQuest={revision:'adc_pre_26.9'};
const compactReport={
  schema:'league_saved_report_compact_v1',
  dataQuality:{selectedRole:'ADC',mechanicsCohortApplied:true,currentMechanicsKey:'standard_sr_2026|adc_26.9_40g_takedown'},
  games:[
    {matchId:'adc-current-bottom',role:'BOTTOM',phaseRules:currentRules,roleQuestContext:currentQuest,champion:'Jinx'},
    {matchId:'adc-current-alias',role:'DUO_CARRY',phaseRules:currentRules,roleQuestContext:currentQuest,champion:'Ashe'},
    {matchId:'adc-old-mechanics',role:'ADC',phaseRules:currentRules,roleQuestContext:oldQuest,champion:'Caitlyn'},
    {matchId:'support-current',role:'SUPPORT',phaseRules:currentRules,roleQuestContext:currentQuest,champion:'Lulu'},
    {matchId:'unknown-role-current',phaseRules:currentRules,roleQuestContext:currentQuest,champion:'Ezreal'}
  ]
};
const ids=report=>Array.from(context.reportCoachingGames(report),g=>g.matchId);

assert.deepEqual(ids(compactReport),['adc-current-bottom','adc-current-alias'],'compact saved reports must filter selected role before the verified mechanics cohort');
assert.deepEqual(ids({...compactReport,dataQuality:{...compactReport.dataQuality,mechanicsCohortApplied:false}}),['adc-current-bottom','adc-current-alias','adc-old-mechanics'],'mixed-mechanics fallback may widen mechanics only, never role scope');
assert.deepEqual(ids({...compactReport,dataQuality:{selectedRole:'SUPPORT',mechanicsCohortApplied:false}}),['support-current'],'selected-role changes must not retain another role in frontend-derived cohorts');
assert.deepEqual(ids({...compactReport,dataQuality:{mechanicsCohortApplied:false},coachingSummary:{primaryRole:'SUPPORT'}}),['support-current'],'compact reports must recover strict role scope from coaching summary metadata');
assert.deepEqual(ids({...compactReport,games:null}),[],'malformed compact report games must fail closed to an empty cohort');

for(const name of ['renderVisualSummary','renderMatchHistory','renderConsistencySummary','renderCharts']){
  assert.match(functionSource(name),/reportCoachingGames\(r\)/,`${name} must consume the shared strict saved-report cohort`);
}

console.log('League compact saved-report cohort fixtures OK');
