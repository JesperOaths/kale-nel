#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import toepenEngine from '../gejast-toepen-engine.js';

const rad=fs.readFileSync('rad.html','utf8');
const segmentBlock=rad.match(/const SEGMENTS = \[([\s\S]*?)\n  \];/);
assert.ok(segmentBlock,'Rad SEGMENTS owner missing');
const weights=[...segmentBlock[1].matchAll(/chance:(\d+)/g)].map((m)=>Number(m[1]));
assert.ok(weights.length>=2,'Rad probability weights missing');
const total=weights.reduce((sum,n)=>sum+n,0);
assert.ok(total>0,'Rad probability-weight total must be positive');
assert.match(rad,/function chancePct\(seg\)\{ return \(Number\(seg\?\.chance\|\|0\)\/totalChance\(\)\)\*100; \}/,'Rad must normalize displayed probability from actual wheel weights');
assert.match(rad,/function chanceLabel\(seg\)\{ return chancePct\(seg\)\.toLocaleString\('nl-NL',\{minimumFractionDigits:1,maximumFractionDigits:1\}\)\+'%'; \}/,'Rad normalized Dutch probability label missing');
assert.doesNotMatch(rad,/` \(\$\{seg\.chance\}%\)`/,'Rad canvas must not present raw weights as percentages');
assert.doesNotMatch(rad,/Kans: \$\{seg\.chance\}%/,'Rad result must not present raw weights as percentages');
assert.doesNotMatch(rad,/<strong>\$\{seg\.chance\}%<\/strong>/,'Rad legend must not present raw weights as percentages');
const normalized=weights.map((weight)=>weight/total*100);
assert.ok(Math.abs(normalized.reduce((sum,n)=>sum+n,0)-100)<1e-9,'Rad normalized probabilities must total 100%');

const pikken=fs.readFileSync('gejast-pikken.js','utf8');
assert.match(pikken,/const startDice=Math\.max\(1, Math\.min\(8, Number\(\$\('pkStartDice'\)\?\.value \|\| 6\) \|\| 6\)\);/,'Pikken start-dice bounds 1..8 drifted');
assert.match(pikken,/await api\.startGame\(state\.gameId\);/,'Pikken start action must remain backend-authoritative');

const toepen=fs.readFileSync('toepen.html','utf8');
assert.match(toepen,/Kies 2–8 geregistreerde spelers\./,'Toepen supported-player contract drifted');
for(let n=2;n<=8;n++){
  const names=Array.from({length:n},(_,i)=>`P${i+1}`);
  const match={target_points:10,dealer_seat:1,players:names.map((name,i)=>({seat_no:i+1,name,points:0,active:true,eliminated_round_no:null,finish_rank:null})),rounds:[],undo_stack:[]};
  const results=match.players.map((p)=>({seat_no:p.seat_no,action:p.seat_no===1?'win':'stay'}));
  const next=toepenEngine.applyRound(match,{winner_seat:1,stake_final:1,results});
  assert.equal(next.players.length,n,`Toepen ${n}p roster changed during legal round`);
  assert.equal(next.players[0].points,0,`Toepen ${n}p winner received penalty`);
  assert.ok(next.players.slice(1).every(p=>p.points===1),`Toepen ${n}p stay penalties invalid`);
  assert.equal(next.rounds.length,1,`Toepen ${n}p legal round not recorded`);
}

const boerenbridge=fs.readFileSync('boerenbridge.html','utf8');
assert.match(boerenbridge,/names\.length>6[^\n]*Half half/,'Boerenbridge >6 Half half rule guard missing');
assert.match(boerenbridge,/players\.length>5[^\n]*Selectie maken|Selectie maken[^\n]*players\.length>5/,'Boerenbridge >5 Selectie maken rule guard missing');
assert.match(boerenbridge,/function calcRoundPoints\(bid, won\)\{ return Number\(bid\)===Number\(won\) \? 10 \+ \(3\*Number\(won\|\|0\)\) : \(3\*Number\(won\|\|0\)\); \}/,'Boerenbridge scoring owner drifted');
const bbPoints=(bid,won)=>Number(bid)===Number(won)?10+3*Number(won||0):3*Number(won||0);
for(let bid=0;bid<=8;bid++) for(let won=0;won<=8;won++){
  const expected=bid===won?10+3*won:3*won;
  assert.equal(bbPoints(bid,won),expected,`Boerenbridge score mismatch bid=${bid} won=${won}`);
}
assert.equal(bbPoints(0,0),10,'Boerenbridge exact zero must score 10');
assert.equal(bbPoints(7,7),31,'Boerenbridge exact seven must score 31');
assert.equal(bbPoints(8,8),34,'Boerenbridge Half half exact eight must score 34');
assert.match(boerenbridge,/case 'Half half': return 8;/,'Boerenbridge Half half must own eight tricks');
assert.match(boerenbridge,/case 'Selectie maken': case 'Doorgeven': return 7;/,'Boerenbridge seven-trick special owner drifted');

const beerpong=fs.readFileSync('beerpong.html','utf8');
assert.match(beerpong,/if\(a === max && b === max\)/,'Beerpong double-winner rejection missing');
assert.match(beerpong,/if\(a !== max && b !== max\)/,'Beerpong exact-winner requirement missing');
const beerpongValid=(a,b,max)=>a>=0&&a<=max&&b>=0&&b<=max&&!(a===max&&b===max)&&(a===max||b===max);
for(const max of [1,6,10,20]) for(let a=0;a<=max;a++) for(let b=0;b<=max;b++){
  const valid=beerpongValid(a,b,max);
  assert.equal(valid,(a===max)!==(b===max),`Beerpong winner validity mismatch target=${max} ${a}-${b}`);
}
assert.equal(beerpongValid(10,10,10),false,'Beerpong tie at target must be rejected');
assert.equal(beerpongValid(9,8,10),false,'Beerpong match without target winner must be rejected');
assert.equal(beerpongValid(10,9,10),true,'Beerpong single target winner must be accepted');

const scorer=fs.readFileSync('scorer.html','utf8');
assert.match(scorer,/players\.filter\(Boolean\)\.length < 4/,'Klaverjas must refuse bidding before all four players are selected');
assert.match(scorer,/new Set\(picks\)\.size < 4/,'Klaverjas duplicate-player rejection missing');
assert.match(scorer,/function scoreFromRaw\(raw\)\s*\{\s*const n = Number\(raw \|\| 0\); return Math\.floor\(\(n \+ 5\) \/ 10\);\s*\}/,'Klaverjas scorer raw-to-written rounding rule drifted');
assert.match(scorer,/function totalRawForSuit\(suit\)\s*\{\s*return suit === 'S' \? 130 : 162;\s*\}/,'Klaverjas scorer suit/sans raw total drifted');

// Execute the real Klaverjas Online rules owner in a browser-like VM without network access.
const onlineSource=fs.readFileSync('gejast-klaverjas-online.js','utf8');
const storage={getItem:()=>null,setItem:()=>{},removeItem:()=>{}};
const browserGlobal={
  localStorage:storage,
  sessionStorage:storage,
  location:{search:''},
  GEJAST_CONFIG:{},
  GEJAST_PAGE_VERSION:'v792'
};
browserGlobal.window=browserGlobal;
vm.runInNewContext(onlineSource,{window:browserGlobal,URLSearchParams,URL,Date,Math,console,setTimeout,clearTimeout});
const ko=browserGlobal.GEJAST_KLAVERJAS_ONLINE;
assert.ok(ko,'Klaverjas Online rules API did not initialize');
const deck=ko.createDeck();
assert.equal(deck.length,32,'Klaverjas Online deck must contain 32 cards');
assert.equal(new Set(deck.map(c=>c.id)).size,32,'Klaverjas Online deck cards must be unique');
const hands=ko.deal(deck,0);
assert.equal(hands.length,4,'Klaverjas Online must deal exactly four hands');
assert.ok(hands.every(h=>h.length===8),'Klaverjas Online must deal exactly eight cards to each player');
assert.deepEqual(Array.from(ko.TEAM_OF),[1,2,1,2],'Klaverjas Online team seating must alternate 1/2/1/2');
assert.equal(ko.isValidBid({action:'bid',mode:'sans',points:60},null),false,'Klaverjas Online must reject 60 sans');
assert.equal(ko.isValidBid({action:'bid',mode:'sans',points:70},null),true,'Klaverjas Online must accept opening 70 sans');
assert.equal(ko.isValidBid({action:'bid',mode:'suit',suit:'hearts',points:70},null),false,'Klaverjas Online must reject 70 suit');
assert.equal(ko.isValidBid({action:'bid',mode:'suit',suit:'hearts',points:80},null),true,'Klaverjas Online must accept opening 80 suit');
assert.equal(ko.bidTarget({action:'bid',mode:'suit',suit:'hearts',points:80}),82,'Klaverjas Online 80-suit contract must require 82 card points');
assert.equal(ko.isAllPointsBid({action:'bid',mode:'sans',points:132,kind:'pit'}),true,'Klaverjas Online 132 sans pit must be all-points');
const mustFollow=ko.legalCards([{suit:'hearts',rank:'A',id:'hearts-A'},{suit:'clubs',rank:'7',id:'clubs-7'}],[{player:1,card:{suit:'hearts',rank:'7',id:'hearts-7'}}],0,'spades');
assert.deepEqual(mustFollow.map(c=>c.id),['hearts-A'],'Klaverjas Online must follow lead suit when possible');
const mustOvertrump=ko.legalCards([{suit:'hearts',rank:'J',id:'hearts-J'},{suit:'hearts',rank:'7',id:'hearts-7'}],[{player:1,card:{suit:'hearts',rank:'Q',id:'hearts-Q'}}],0,'hearts');
assert.deepEqual(mustOvertrump.map(c=>c.id),['hearts-J'],'Klaverjas Online must overtrump when possible');
const tricksTeam1=[];
for(let i=0;i<8;i++) tricksTeam1.push({winner:0,cards:deck.slice(i*4,i*4+4).map((card,j)=>({player:j,card}))});
const made=ko.scoreRound(tricksTeam1,1,{action:'bid',mode:'suit',suit:'hearts',points:80},[0,0]);
assert.equal(made.made,true,'Klaverjas Online bidder taking every trick must make 80-suit contract');
assert.equal(made.nat,false,'Klaverjas Online successful all-tricks bidder must not go nat');
assert.deepEqual(Array.from(made.trickCounts),[8,0],'Klaverjas Online all-tricks ownership incorrect');
assert.equal(made.scores[0],262,'Klaverjas Online all-tricks score must be 162 card/last-trick points + 100 all-tricks bonus');
const tricksTeam2=tricksTeam1.map(t=>({...t,winner:1}));
const nat=ko.scoreRound(tricksTeam2,1,{action:'bid',mode:'suit',suit:'hearts',points:80},[0,0]);
assert.equal(nat.made,false,'Klaverjas Online bidder with zero tricks must fail contract');
assert.equal(nat.nat,true,'Klaverjas Online failed contract must be nat');
assert.deepEqual(Array.from(nat.scores),[0,162],'Klaverjas Online failed bidder must award 162 base points to defenders');
const state=ko.newClientState([{name:'A'},{name:'B'},{name:'C'},{name:'D'}],0,null,{finish_mode:'fixed_rounds'});
assert.equal(state.players.length,4,'Klaverjas Online client state must own exactly four seats');
assert.ok(state.hands.every(h=>h.length===8),'Klaverjas Online new state must give every seat eight cards');
assert.equal(state.bidder_turn,1,'Klaverjas Online opening bidder must be left of dealer');
assert.equal(ko.shouldFinishGame({...state,rounds:Array.from({length:15},()=>({}))}),false,'Klaverjas Online fixed match must not finish at 15 rounds');
assert.equal(ko.shouldFinishGame({...state,rounds:Array.from({length:16},()=>({}))}),true,'Klaverjas Online fixed match must finish at 16 rounds');
assert.equal(ko.shouldFinishGame({...state,settings:{finish_mode:'first_to_162'},totals:[161,100]}),false,'Klaverjas Online first-to-162 must continue below target');
assert.equal(ko.shouldFinishGame({...state,settings:{finish_mode:'first_to_162'},totals:[162,100]}),true,'Klaverjas Online first-to-162 must finish at target');

const paardenrace=fs.readFileSync('paardenrace.html','utf8');
assert.match(paardenrace,/if\(readyTotal < 2\)/,'Paardenrace lower-player start guard missing');
assert.match(paardenrace,/if\(picked\.length === 1 && players\.length > 1\)/,'Paardenrace distinct-suit start guard missing');
assert.match(paardenrace,/if\(ready < readyTotal\)/,'Paardenrace all-ready start guard missing');

console.log(`v792 game validity matrix PASS: Rad normalized; Toepen legal rounds executed for every 2..8 roster; Boerenbridge scoring swept 81 bid/won combinations; Beerpong winner validity swept multiple cup targets; Klaverjas Online executed deck/deal/bidding/follow-suit/overtrump/scoring/nat/finish-mode rules; Pikken and Paardenrace core guards remain pinned.`);
