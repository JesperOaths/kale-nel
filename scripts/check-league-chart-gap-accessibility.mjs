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

const helpers=['esc','hasNum','fmt','fmtInt','fmtPct','signed','gameTimestampMs','shortGameDate','clamp','niceCeil','formatChartValue','chartSvg','chartSummary','chartMeta','chartDataTable'];
const context={};
vm.createContext(context);
vm.runInContext(`${helpers.map(functionSource).join('\n')}\nthis.chartSvg=chartSvg;this.chartSummary=chartSummary;this.chartMeta=chartMeta;this.chartDataTable=chartDataTable;`,context,{filename:'league/app.js#chart-gap-fixture'});

const day=24*60*60*1000,start=Date.UTC(2026,9,1);
const points=[
  {champion:'Jinx',gameStartTimestamp:start,value:120},
  {champion:'Ashe',gameStartTimestamp:start+day,value:null},
  {champion:'KaiSa',gameStartTimestamp:start+2*day,value:-80},
  {champion:'Caitlyn',gameStartTimestamp:start+3*day,value:40}
];
const spec={title:'Gold gap fixture',unit:'signedGold',formatUnit:'signed',signedAxis:true,fixedMin:-500,fixedMax:500};
const svg=context.chartSvg(points,spec);

assert.match(svg,/aria-label="Gold gap fixture\. 3 valid observations; 1 unavailable\. Line breaks and x marks show unavailable observations; unavailable is not zero\."/,'chart SVG must announce valid and unavailable observations');
assert.equal((svg.match(/class="chart-line"/g)||[]).length,1,'a missing middle observation must break the line instead of being bridged');
assert.equal((svg.match(/class="chart-missing-mark"/g)||[]).length,1,'each unavailable observation must receive a non-zero-position x-axis mark');
assert.match(svg,/cx="560\.0"/,'post-gap points must keep their original chronological x position rather than compressing the gap');
assert.doesNotMatch(svg,/cy="141\.0" r="5"/,'null observations must never be coerced into zero-valued chart dots');

const summary=context.chartSummary(points,spec);
assert.match(summary,/Sample average \+27/,'chart summaries must exclude unavailable observations rather than averaging them as zero');

const meta=context.chartMeta(points,{summary:'games 3/3'});
assert.match(meta,/3 valid plotted observations · 1 unavailable \(shown as line gaps, not zero\)/,'chart metadata must explain missing observations');

const table=context.chartDataTable(points,spec);
assert.match(table,/View plotted values · 3 valid \/ 4 games/,'chart disclosure must state valid and total game counts');
assert.match(table,/Underlying values for Gold gap fixture\. Unavailable values are unknown, not zero\./,'chart table must preserve unknown-not-zero semantics');
assert.equal((table.match(/<tr class="value-unavailable">/g)||[]).length,1,'chart table must retain unavailable rows');
assert.match(table,/>Ashe<\/td><td>Unavailable<\/td>/,'chart table must identify the game whose metric is unavailable');

console.log('League chart gap/accessibility fixture OK');
