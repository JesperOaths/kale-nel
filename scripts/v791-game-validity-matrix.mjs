#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

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
const normalizedTotal=normalized.reduce((sum,n)=>sum+n,0);
assert.ok(Math.abs(normalizedTotal-100)<1e-9,`Rad normalized probabilities must total 100%, got ${normalizedTotal}`);

const pikken=fs.readFileSync('gejast-pikken.js','utf8');
assert.match(pikken,/const startDice=Math\.max\(1, Math\.min\(8, Number\(\$\('pkStartDice'\)\?\.value \|\| 6\) \|\| 6\)\);/,'Pikken start-dice bounds 1..8 drifted');
assert.match(pikken,/await api\.startGame\(state\.gameId\);/,'Pikken start action must remain backend-authoritative');

const toepen=fs.readFileSync('toepen.html','utf8');
assert.match(toepen,/Kies 2–8 geregistreerde spelers\./,'Toepen supported-player contract drifted');

const boerenbridge=fs.readFileSync('boerenbridge.html','utf8');
assert.match(boerenbridge,/names\.length>6[^\n]*Half half/,'Boerenbridge >6 Half half rule guard missing');
assert.match(boerenbridge,/players\.length>5[^\n]*Selectie maken|Selectie maken[^\n]*players\.length>5/,'Boerenbridge >5 Selectie maken rule guard missing');

const beerpong=fs.readFileSync('beerpong.html','utf8');
assert.match(beerpong,/if\(a === max && b === max\)/,'Beerpong double-winner rejection missing');
assert.match(beerpong,/if\(a !== max && b !== max\)/,'Beerpong exact-winner requirement missing');

const scorer=fs.readFileSync('scorer.html','utf8');
assert.match(scorer,/players\.filter\(Boolean\)\.length < 4/,'Klaverjas must refuse bidding before all four players are selected');
assert.match(scorer,/new Set\(picks\)\.size < 4/,'Klaverjas duplicate-player rejection missing');

const paardenrace=fs.readFileSync('paardenrace.html','utf8');
assert.match(paardenrace,/if\(readyTotal < 2\)/,'Paardenrace lower-player start guard missing');
assert.match(paardenrace,/if\(picked\.length === 1 && players\.length > 1\)/,'Paardenrace distinct-suit start guard missing');
assert.match(paardenrace,/if\(ready < readyTotal\)/,'Paardenrace all-ready start guard missing');

console.log(`v792 game validity matrix PASS: Rad ${weights.length} weighted segments normalize to 100%; Pikken, Toepen, Boerenbridge, Beerpong, Klaverjas and Paardenrace core validity owners are present.`);
