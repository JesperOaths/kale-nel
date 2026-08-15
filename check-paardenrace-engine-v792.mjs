#!/usr/bin/env node
/* Deterministic acceptance proof for the shipped Paardenrace runtime helpers.
   Extracts pure race-state helpers from gejast-paardenrace.js and exercises a complete
   four-horse / ten-gate progression model, card parsing, gate events, deck accounting,
   and winner/room summaries. No DOM, credentials, or writes. */
import assert from 'node:assert/strict';
import fs from 'node:fs';

const source=fs.readFileSync('gejast-paardenrace.js','utf8');
function extractFunction(name){
  const start=source.indexOf(`function ${name}(`); assert.ok(start>=0,`Missing shipped function: ${name}`);
  const braceStart=source.indexOf('{',start); let depth=0,quote=null,escaped=false;
  for(let i=braceStart;i<source.length;i+=1){
    const ch=source[i],next=source[i+1];
    if(quote){ if(escaped){escaped=false;continue;} if(ch==='\\'){escaped=true;continue;} if(ch===quote)quote=null;continue; }
    if(ch==='\''||ch==='"'||ch==='`'){quote=ch;continue;}
    if(ch==='{')depth+=1; else if(ch==='}'&&--depth===0)return source.slice(start,i+1);
  }
  throw new Error(`Unclosed function: ${name}`);
}

const names=['suitKey','suitLabel','suitSymbol','parseCard','getDrawRemaining','resolvedGateSet','normalizedGateEvents','gateEventMap','getGridColumnForProgress','summarizeLiveRoom'];
const declarations=names.map(extractFunction).join('\n');
const api=new Function(`const SUIT_META={hearts:{label:'♥ Harten',symbol:'♥',color:'#a11f35',short:'Harten'},diamonds:{label:'♦ Ruiten',symbol:'♦',color:'#a11f35',short:'Ruiten'},clubs:{label:'♣ Klaveren',symbol:'♣',color:'#1f1b1a',short:'Klaveren'},spades:{label:'♠ Schoppen',symbol:'♠',color:'#1f1b1a',short:'Schoppen'}}; ${declarations}\nreturn {suitKey,suitLabel,suitSymbol,parseCard,getDrawRemaining,resolvedGateSet,normalizedGateEvents,gateEventMap,getGridColumnForProgress,summarizeLiveRoom};`)();

for(const code of ['AH','10D','2C','KS']){
  const parsed=api.parseCard(code);
  assert.ok(parsed.suitKey,`card parser rejected ${code}`);
  assert.ok(parsed.rank,`card parser lost rank for ${code}`);
}
assert.equal(api.parseCard('ZZ').suitKey,'');
console.log('Paardenrace card parsing: ok');

for(const [input,expected] of [[0,0],[-2,0],[1,1],[10,10],[11,11],[99,11]]) assert.equal(api.getGridColumnForProgress(input),expected);
console.log('Paardenrace progress clamping: ok');

const deck=Array.from({length:14},(_,i)=>`C${i}`);
const match={
  stage:'race',
  draw_deck:deck,
  draw_index:4,
  last_draw_card:'10H',
  winner_suit:'spades',
  horse_positions:{spades:11,hearts:9,clubs:7,diamonds:10},
  gate_cards:['2H','3D','4C','5S','6H','7D','8C','9S','10H','JD'],
  resolved_gates:[1,2,3,4,5,6,7,8,9,10],
  gate_events:[{gate_no:3,suit:'hearts',card:'4C'},{gate_no:8,suit:'spades',card:'9S'}]
};
assert.equal(api.getDrawRemaining(match),10);
assert.equal(api.resolvedGateSet(match).size,10);
assert.equal(api.gateEventMap(match).get(3).suit,'hearts');
assert.equal(api.gateEventMap(match).has(99),false);
console.log('Paardenrace deck/gate accounting: ok');

const summary=api.summarizeLiveRoom(
  {stage:'race'},
  match,
  [
    {player_name:'A',wager_bakken:2,wager_verified:true,is_ready:true},
    {player_name:'B',wager_bakken:3,wager_verified:true,is_ready:true},
    {player_name:'C',wager_bakken:1,wager_verified:true,is_ready:true},
    {player_name:'D',wager_bakken:4,wager_verified:false,is_ready:true},
  ],
  {is_host:true},
);
assert.equal(summary.totalPot,10);
assert.equal(summary.verified,3);
assert.equal(summary.ready,4);
assert.equal(summary.pendingGate,0);
assert.equal(summary.winnerSuit,'spades');
assert.equal(summary.deckLeft,10);
assert.equal(summary.stage,'race');
console.log('Paardenrace four-player room/winner summary: ok');

console.log('RESULT=PAARDENRACE_ENGINE_ACCEPTANCE_PASS');
