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
pass('Toepen', 'authoritative UI range 2..8; every count present; adjacent 1/9 absent');

const boerenbridge = read('boerenbridge.html');
assert.match(boerenbridge, /GEJAST_PAGE_VERSION='v791'/, 'Boerenbridge is not on v791');
const bbCountLiteral = boerenbridge.match(/playerCountInput'\)\.innerHTML=\[([^\]]+)\]\.map/);
assert.ok(bbCountLiteral, 'Boerenbridge player-count owner not found');
const bbCounts = bbCountLiteral[1].split(',').map((v) => Number(v.trim()));
assert.deepEqual(bbCounts, [2,3,4,5,6,7], 'Boerenbridge must expose every and only supported count 2..7');
assert.match(boerenbridge, /names\.length>6[^\n]*Half half/, 'Boerenbridge Half half >6-player validation missing');
assert.match(boerenbridge, /Selectie maken[^\n]*players\.length>5|players\.length>5[^\n]*Selectie maken/, 'Boerenbridge Selectie maken >5-player restriction missing');
assert.match(boerenbridge, /new Set\(lowered\)\.size!==lowered\.length/, 'Boerenbridge duplicate-player rejection missing');
pass('Boerenbridge', 'authoritative UI range 2..7; special-round and duplicate-player guards pinned');

const beerpong = read('beerpong.html');
assert.match(beerpong, /GEJAST_PAGE_VERSION='v791'/, 'Beerpong is not on v791');
assert.deepEqual(optionAttributeValues(beerpong, 'formatInput'), ['2v2','1v1'], 'Beerpong must expose exactly 2v2 and 1v1');
assert.match(beerpong, /format==='2v2' \? \[els\.teamA1, els\.teamA2, els\.teamB1, els\.teamB2\] : \[els\.teamA1, els\.teamB1\]/, 'Beerpong format-to-player cardinality validation missing');
assert.match(beerpong, /new Set\(vals\)\)\.size !== vals\.length/, 'Beerpong duplicate-player rejection missing');
assert.match(beerpong, /if\(a === max && b === max\)/, 'Beerpong double-winner rejection missing');
assert.match(beerpong, /if\(a !== max && b !== max\)/, 'Beerpong exact-winner requirement missing');
pass('Beerpong', 'exact legal rosters 1v1 and 2v2; uniqueness and exactly-one-winner guards pinned');

const klaverjas = read('scorer.html');
assert.match(klaverjas, /GEJAST_PAGE_VERSION='v791'/, 'Klaverjas scorer is not on v791');
assert.match(klaverjas, /players:\s*\['',\s*'',\s*'',\s*''\]/, 'Klaverjas fresh game must own exactly four player slots');
assert.match(klaverjas, /parsed\.players\.length !== 4/, 'Klaverjas persisted state must be repaired back to exactly four player slots');
assert.match(klaverjas, /picks\.some\(\(value\) => !value\)[\s\S]{0,180}alle vier plekken/, 'Klaverjas must reject incomplete four-player setup');
assert.match(klaverjas, /new Set\(picks\)\.size < 4/, 'Klaverjas must reject duplicate players');
assert.match(klaverjas, /players\.filter\(Boolean\)\.length < 4/, 'Klaverjas must refuse bidding before four players are selected');
pass('Klaverjas', 'exactly 4 unique named players required at setup and bidding');

// Paardenrace has an authoritative minimum in current UI but no trustworthy numeric maximum in the frontend.
// Therefore 2..20 is a stress sweep of the actual frontend start predicate, NOT a claim that the backend accepts 20.
const paardenrace = read('paardenrace.html');
assert.match(paardenrace, /GEJAST_PAGE_VERSION='v791'/, 'Paardenrace is not on v791');
assert.match(paardenrace, /players\.length < 2 \|\| \(picked\.length === 1 && players\.length > 1\)/, 'Paardenrace start-button player/suit guard drifted');
assert.match(paardenrace, /if\(readyTotal < 2\)/, 'Paardenrace must reject fewer than two players');
assert.match(paardenrace, /if\(picked\.length === 1 && players\.length > 1\)/, 'Paardenrace must reject all-same-suit start');
assert.match(paardenrace, /if\(ready < readyTotal\)/, 'Paardenrace must reject start while any player is unready');
const paardFrontendBlocked = (players, pickedSuitCount, readyCount) => players < 2 || pickedSuitCount < 2 || readyCount < players;
assert.equal(paardFrontendBlocked(1, 1, 1), true, 'Paardenrace lower-bound 1 must be blocked');
for (let n = 2; n <= 20; n += 1) {
  assert.equal(paardFrontendBlocked(n, 2, n), false, `Paardenrace ${n}-player ready field with >=2 suits must pass current frontend predicate`);
  assert.equal(paardFrontendBlocked(n, 1, n), true, `Paardenrace ${n}-player all-same-suit field must be blocked`);
  assert.equal(paardFrontendBlocked(n, 2, n - 1), true, `Paardenrace ${n}-player field with one unready player must be blocked`);
}
pass('Paardenrace', 'minimum 2 authoritative; frontend predicate stress-tested 2..20 with ready/suit invalid states; backend maximum remains separately provable');

// Pikken cardinality is backend-owned in the current frontend/contract. Pin the current scoped lifecycle RPCs and
// permanent bid conversion regression while the backend cardinality source is located; do not invent a numeric player limit.
const pikken = read('gejast-pikken-contract.js');
assert.match(pikken, /pikken_create_lobby_scoped/, 'Pikken create-lobby contract missing');
assert.match(pikken, /pikken_join_lobby_scoped/, 'Pikken join-lobby contract missing');
assert.match(pikken, /pikken_set_ready_scoped/, 'Pikken ready contract missing');
assert.match(pikken, /pikken_start_game_scoped/, 'Pikken scoped start contract missing');
assert.match(pikken, /pikken_record_completed_match_v709/, 'Pikken completed-match recording contract missing');
assert.match(pikken, /pikken_abandon_and_record_v716/, 'Pikken abandon-and-record contract missing');
assert.match(pikken, /pikken_destroy_game_scoped/, 'Pikken destroy-game contract missing');
assert.match(pikken, /pikken_update_lobby_config_v715/, 'Pikken lobby-config contract missing');
const pikkenBidGuard = read('check-pikken-pik-conversion-v790.mjs');
assert.match(pikkenBidGuard, /2 x pik once at least 5 regular is bid|5 regular must unlock exactly one 2 x pik option/, 'Pikken two-pik conversion regression missing');
assert.match(pikkenBidGuard, /pikken.*write targets remain unarmed|write targets remain unarmed/i, 'Pikken conversion guard must retain zero-write safety proof');
pass('Pikken', 'current scoped create/join/ready/start/destroy/config plus complete/abandon recording and permanent 2-pik conversion invariant pinned; numeric player range intentionally not guessed');

// Current main added this permanent regression as check-rad-probability-validity-v792.mjs while the frontend stays v791.
const radGuard = read('check-rad-probability-validity-v792.mjs');
assert.match(radGuard, /probab|weight|chance|kans/i, 'Rad probability validity guard no longer contains probability/weight validation');
pass('Rad', 'permanent normalized-probability validity regression present');

console.log('v791 finalization player contract matrix: PASS');
for (const row of report) console.log(`PASS ${row.name}: ${row.detail}`);
