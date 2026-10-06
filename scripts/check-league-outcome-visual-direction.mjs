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
let plot=null;
const box={innerHTML:''};
const context={
  $:()=>box,
  visualGraphEmpty:x=>x,
  esc:x=>String(x),
  niceCeil:(v,step)=>Math.ceil(v/step)*step,
  clamp:(v,a,b)=>Math.min(b,Math.max(a,v)),
  visualDivergingSvg:(rows,options)=>{plot={rows,options};return '';},
};
vm.createContext(context);
vm.runInContext(['hasNum','fmt','fmtInt','fmtPct','signed','standardizedMeanGap','wilsonInterval','visualOutcomeMeanFormat','renderOutcomeEffectGraph'].map(source).join('\n')+'\nthis.draw=renderOutcomeEffectGraph;this.gap=standardizedMeanGap;this.interval=wilsonInterval;',context);
const summary=(mean,n=8,sd=2)=>({mean,n,sd});
const metric=(label,win,loss,inverse=false,n=8,sd=2)=>({label,wins:summary(win,n,sd),losses:summary(loss,n,sd),inverse,unit:'num'});
context.draw({longHorizon:{longOutcomeFingerprint:{directionalEligible:true,minPerSideForDirectional:5,metrics:[
  metric('More damage in wins',12,8),
  metric('Less damage in wins',8,12),
  metric('Fewer deaths in wins',3,7,true),
  metric('More deaths in wins',7,3,true),
  metric('No mean difference',4,4),
  metric('Very large difference',50,0,false,8,1),
  metric('Thin result split',12,8,false,2),
]}}});
const row=name=>plot.rows.find(x=>x.label===name);
assert.ok(row('More damage in wins').value>0);
assert.ok(row('Less damage in wins').value<0,'a lower higher-is-better mean in wins must point left');
assert.ok(row('Fewer deaths in wins').value>0,'a lower inverse metric in wins must point right');
assert.ok(row('More deaths in wins').value<0);
assert.equal(row('No mean difference').value,0);
assert.equal(row('Thin result split').ready,false);
assert.equal(row('Thin result split').tone,'neutral');
assert.ok(plot.options.maxAbs>Math.abs(row('Very large difference').value),'the axis must not clip large measured gaps at 3');
assert.ok(row('Less damage in wins').rawLine.includes('Wins 8.00 (n=8)'));
const expected=2*(1-3/(4*14-1));
assert.ok(Math.abs(context.gap(summary(12),summary(8))-expected)<1e-12);
assert.equal(context.gap(summary(4,8,0),summary(4,8,0)),0);
assert.equal(context.gap(summary(4,8,0),summary(5,8,0)),null,'different constant samples cannot yield a finite standardized gap');

const half=context.interval(10,20);
assert.ok(Math.abs(half.low-29.9298)<.001&&Math.abs(half.high-70.0702)<.001,'the glossary 10/20 example must match the actual Wilson method');
const zero=context.interval(0,5);
assert.ok(zero.low<1e-10&&zero.high>40,'zero observed success in a small sample must retain uncertainty');
assert.equal(context.interval(0,0),null,'no denominator is unknown, not zero');
console.log('League outcome chart direction, unclipped scale, thin evidence and Wilson examples: PASS');
