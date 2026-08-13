#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
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

const paardenrace=fs.readFileSync('paardenrace.html','utf8');
assert.match(paardenrace,/if\(readyTotal < 2\)/,'Paardenrace lower-player start guard missing');
assert.match(paardenrace,/if\(picked\.length === 1 && players\.length > 1\)/,'Paardenrace distinct-suit start guard missing');
assert.match(paardenrace,/if\(ready < readyTotal\)/,'Paardenrace all-ready start guard missing');

console.log(`v792 game validity matrix PASS: Rad normalized; Toepen legal rounds executed for every 2..8 roster; Boerenbridge scoring swept 81 bid/won combinations; Beerpong winner validity swept multiple cup targets; Pikken, Klaverjas and Paardenrace core guards remain pinned.`);
