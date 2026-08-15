#!/usr/bin/env node
/* Deterministic acceptance proof for the real Boerenbridge pure scoring/round functions.
   Functions are extracted from boerenbridge.html at test time, so this tests the shipped
   page logic rather than a copied implementation. No DOM, credentials, or writes are used. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source = fs.readFileSync('boerenbridge.html','utf8');
function extractFunction(name){
  const start = source.indexOf(`function ${name}(`);
  assert.ok(start >= 0, `Missing shipped function: ${name}`);
  const braceStart = source.indexOf('{', start);
  assert.ok(braceStart > start, `Missing body for ${name}`);
  let depth = 0, quote = null, escaped = false, lineComment = false, blockComment = false;
  for(let i=braceStart;i<source.length;i+=1){
    const ch=source[i], next=source[i+1];
    if(lineComment){ if(ch==='\n') lineComment=false; continue; }
    if(blockComment){ if(ch==='*'&&next==='/'){ blockComment=false; i+=1; } continue; }
    if(quote){ if(escaped){ escaped=false; continue; } if(ch==='\\'){ escaped=true; continue; } if(ch===quote) quote=null; continue; }
    if(ch==='/'&&next==='/'){ lineComment=true; i+=1; continue; }
    if(ch==='/'&&next==='*'){ blockComment=true; i+=1; continue; }
    if(ch==='\''||ch==='"'||ch==='`'){ quote=ch; continue; }
    if(ch==='{') depth+=1;
    else if(ch==='}' && --depth===0) return source.slice(start,i+1);
  }
  throw new Error(`Unclosed function: ${name}`);
}

const names=['getSpecialTrickCount','getRoundPlan','buildRoundOrder','calcRoundPoints','recalcMatch','forbiddenDealerBid'];
const declarations=names.map(extractFunction).join('\n');
const api=new Function(`${declarations}\nreturn {getSpecialTrickCount,getRoundPlan,buildRoundOrder,calcRoundPoints,recalcMatch,forbiddenDealerBid};`)();

assert.deepEqual([2,3,4,5,6,7], [...source.matchAll(/\[2,3,4,5,6,7\]/g)].map(()=>2).length ? [2,3,4,5,6,7] : [], 'Boerenbridge player-count contract changed unexpectedly');
for(const count of [2,3,4,5,6,7]){
  const match={players:Array.from({length:count},(_,i)=>`P${i+1}`),dealer_index:0,special_choices:[null,null,null,null],rounds:[]};
  const order=api.buildRoundOrder(match);
  assert.equal(order.length,18,`${count}p game must contain 18 rounds`);
  assert.deepEqual(order.slice(0,7).map(r=>r.trickCount),[1,2,3,4,5,6,7]);
  assert.deepEqual(order.slice(11).map(r=>r.trickCount),[7,6,5,4,3,2,1]);
  assert.deepEqual(order.map(r=>r.dealer_index),Array.from({length:18},(_,i)=>i%count));
  console.log(`Boerenbridge ${count}-player round cycle: ok (18 rounds)`);
}

assert.equal(api.getSpecialTrickCount('Half half'),8);
for(const special of ['Blind bieden','Nul bieden','Zonder troef','Voor troef','Selectie maken','Doorgeven']) assert.equal(api.getSpecialTrickCount(special),7);
console.log('Boerenbridge special-round trick counts: ok');

assert.equal(api.calcRoundPoints(0,0),10);
assert.equal(api.calcRoundPoints(2,2),16);
assert.equal(api.calcRoundPoints(2,1),3);
assert.equal(api.calcRoundPoints(7,0),0);
console.log('Boerenbridge scoring formula boundaries: ok');

{
  const match={players:['A','B','C','D'],dealer_index:0,special_choices:['Blind bieden','Nul bieden','Zonder troef','Voor troef'],rounds:[]};
  const order=api.buildRoundOrder(match);
  match.rounds=order.map((round)=>({players:match.players.map(name=>({name,bid:0,won:0}))}));
  api.recalcMatch(match);
  assert.equal(match.rounds.length,18);
  for(const player of match.players){
    const rows=match.rounds.map(r=>r.players.find(p=>p.name===player));
    assert.equal(rows.length,18);
    assert.ok(rows.every(r=>r.points===10),`${player} has an incorrect round score`);
    assert.equal(rows.at(-1).running_total,180,`${player} running total is incorrect`);
  }
  assert.deepEqual(match.rounds.map(r=>r.trick_count),order.map(r=>r.trickCount));
  console.log('Boerenbridge complete 18-round scoring pass: ok');
}

{
  const match={players:['A','B','C','D'],dealer_index:0,special_choices:[null,null,null,null],rounds:[]};
  const meta=api.buildRoundOrder(match)[3];
  const dealerIndex=meta.dealer_index;
  const bids={};
  for(let i=0;i<4;i+=1) bids[i]=i===dealerIndex?0:1;
  const forbidden=api.forbiddenDealerBid(meta,bids);
  assert.equal(forbidden.dealerIndex,dealerIndex);
  assert.equal(forbidden.value,meta.trickCount-3);
  console.log('Boerenbridge dealer-bid forbidden-value calculation: ok');
}

console.log('RESULT=BOERENBRIDGE_ENGINE_ACCEPTANCE_PASS');
