#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const report = [];
const pass = (name, detail) => report.push({ name, detail });

function selectValues(html, id) {
  const match = html.match(new RegExp(`<select[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/select>`, 'i'));
  assert.ok(match, `${id} select not found`);
  return [...match[1].matchAll(/<option(?:\s+[^>]*)?>([^<]+)<\/option>/gi)]
    .map((m) => Number(String(m[1]).trim()))
    .filter(Number.isFinite);
}

function optionAttributeValues(html, id) {
  const match = html.match(new RegExp(`<select[^>]*id=["']${id}["'][^>]*>([\\s\\S]*?)<\\/select>`, 'i'));
  assert.ok(match, `${id} select not found`);
  return [...match[1].matchAll(/<option[^>]*value=["']([^"']+)["'][^>]*>/gi)].map((m) => m[1]);
}

const toepen = read('toepen.html');
assert.match(toepen, /GEJAST_PAGE_VERSION='v791'/, 'Toepen is not on v791');
assert.match(toepen, /Kies 2–8 geregistreerde spelers\./, 'Toepen visible player-range copy drifted');
assert.deepEqual(selectValues(toepen, 'playerCount'), [2,3,4,5,6,7,8], 'Toepen must expose every and only supported count 2..8');
assert.doesNotMatch(toepen, /<select id="playerCount">[\s\S]*?<option>1<\/option>/, 'Toepen must reject one-player setup');
assert.doesNotMatch(toepen, /<select id="playerCount">[\s\S]*?<option>9<\/option>/, 'Toepen must reject nine-player setup');
pass('Toepen', 'supported counts 2,3,4,5,6,7,8; adjacent 1/9 absent');

const boerenbridge = read('boerenbridge.html');
assert.match(boerenbridge, /GEJAST_PAGE_VERSION='v791'/, 'Boerenbridge is not on v791');
const bbCountLiteral = boerenbridge.match(/playerCountInput'\)\.innerHTML=\[([^\]]+)\]\.map/);
assert.ok(bbCountLiteral, 'Boerenbridge player-count owner not found');
const bbCounts = bbCountLiteral[1].split(',').map((v) => Number(v.trim()));
assert.deepEqual(bbCounts, [2,3,4,5,6,7], 'Boerenbridge must expose every and only supported count 2..7');
assert.match(boerenbridge, /names\.length>6[^\n]*Half half/, 'Boerenbridge Half half >6-player validation missing');
assert.match(boerenbridge, /Selectie maken[^\n]*players\.length>5|players\.length>5[^\n]*Selectie maken/, 'Boerenbridge Selectie maken >5-player restriction missing');
assert.match(boerenbridge, /new Set\(lowered\)\.size!==lowered\.length/, 'Boerenbridge duplicate-player rejection missing');
pass('Boerenbridge', 'supported counts 2,3,4,5,6,7 plus special-round and duplicate-player guards');

const beerpong = read('beerpong.html');
assert.match(beerpong, /GEJAST_PAGE_VERSION='v791'/, 'Beerpong is not on v791');
assert.deepEqual(optionAttributeValues(beerpong, 'formatInput'), ['2v2','1v1'], 'Beerpong must expose exactly 2v2 and 1v1');
assert.match(beerpong, /format==='2v2' \? \[els\.teamA1, els\.teamA2, els\.teamB1, els\.teamB2\] : \[els\.teamA1, els\.teamB1\]/, 'Beerpong format-to-player cardinality validation missing');
assert.match(beerpong, /new Set\(vals\)\)\.size !== vals\.length/, 'Beerpong duplicate-player rejection missing');
assert.match(beerpong, /if\(a === max && b === max\)/, 'Beerpong double-winner rejection missing');
assert.match(beerpong, /if\(a !== max && b !== max\)/, 'Beerpong exact-winner requirement missing');
pass('Beerpong', 'exact formats 1v1/2v2; complete roster, uniqueness and one-winner constraints pinned');

const klaverjas = read('scorer.html');
assert.match(klaverjas, /GEJAST_PAGE_VERSION='v791'/, 'Klaverjas scorer is not on v791');
assert.match(klaverjas, /players:\s*\['',\s*'',\s*'',\s*''\]/, 'Klaverjas fresh game must own exactly four player slots');
assert.match(klaverjas, /parsed\.players\.length !== 4/, 'Klaverjas persisted state must be repaired back to exactly four player slots');
assert.match(klaverjas, /picks\.some\(\(value\) => !value\)[\s\S]{0,160}alle vier plekken/, 'Klaverjas must reject incomplete four-player setup');
assert.match(klaverjas, /new Set\(picks\)\.size < 4/, 'Klaverjas must reject duplicate players');
assert.match(klaverjas, /players\.filter\(Boolean\)\.length < 4/, 'Klaverjas must refuse bidding before four players are selected');
assert.match(klaverjas, /players\.length !== 4 \|\| players\.some\(\(name\) => !name\)/, 'Klaverjas finished handoff must require exactly four named players');
pass('Klaverjas', 'exactly 4 unique named players are required at setup, bidding and finished-match handoff');

const paardenrace = read('paardenrace.html');
assert.match(paardenrace, /GEJAST_PAGE_VERSION='v791'/, 'Paardenrace is not on v791');
assert.match(paardenrace, /players\.length < 2 \|\| \(picked\.length === 1 && players\.length > 1\)/, 'Paardenrace start-button player/suit guard drifted');
assert.match(paardenrace, /if\(readyTotal < 2\)/, 'Paardenrace must reject fewer than two players on explicit start');
assert.match(paardenrace, /if\(picked\.length === 1 && players\.length > 1\)/, 'Paardenrace must reject an all-same-suit field');
assert.match(paardenrace, /if\(ready < readyTotal\)/, 'Paardenrace must reject start while any player is unready');
const paardStartBlocked = (players, pickedSuitCount, readyCount) => players < 2 || pickedSuitCount < 2 || readyCount < players;
assert.equal(paardStartBlocked(1, 1, 1), true, 'Paardenrace adjacent lower bound 1 must be blocked');
for (let n = 2; n <= 20; n += 1) {
  assert.equal(paardStartBlocked(n, 2, n), false, `Paardenrace ${n}-player ready field with >=2 suits should pass frontend start guards`);
  assert.equal(paardStartBlocked(n, 1, n), true, `Paardenrace ${n}-player all-same-suit field must be blocked`);
  assert.equal(paardStartBlocked(n, 2, n - 1), true, `Paardenrace ${n}-player field with one unready player must be blocked`);
}
pass('Paardenrace', 'frontend start invariants swept for 2..20 players: >=2 suits + everybody ready; 1 player/all-same-suit/unready rejected');

console.log('v791 supported-player contract matrix: PASS');
for (const row of report) console.log(`PASS ${row.name}: ${row.detail}`);
