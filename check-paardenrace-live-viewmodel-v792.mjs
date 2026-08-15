#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const version = fs.readFileSync('VERSION', 'utf8').trim();
const versionNumber = Number(version.match(/^v(\d+)$/)?.[1] || 0);
assert.ok(versionNumber >= 792, 'Paardenrace live viewmodel acceptance requires frontend v792+');

const source = fs.readFileSync('paardenrace_live.html', 'utf8');
const api = {
  suitLabel: (suit) => ({ hearts: 'Harten', diamonds: 'Ruiten', clubs: 'Klaveren', spades: 'Schoppen' }[suit] || suit || '-'),
  getDrawRemaining: (match) => Number(match?.draw_remaining ?? 0),
};
const context = vm.createContext({ api, encodeURIComponent });

function extractFunction(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`\n  function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `Paardenrace shipped function ${name} owner missing`);
  const fn = vm.runInContext(`(${source.slice(start, end).trim()})`, context);
  context[name] = fn;
  return fn;
}

const buildLogItems = extractFunction('buildLogItems', 'kickButtonFor');
const kickButtonFor = extractFunction('kickButtonFor', 'buildPlayerRows');
const buildPlayerRows = extractFunction('buildPlayerRows', 'buildNominationSummary');
const buildNominationSummary = extractFunction('buildNominationSummary', 'openDrawer');

const log = buildLogItems(
  { stage: 'race', stage_label: 'Race' },
  { last_draw_card: 'H7', winner_suit: 'hearts', resolved_gates: [1, 2, 3], draw_remaining: 17 }
);
assert.match(log, /Laatste kaart:\s*<strong>H7<\/strong>/, 'Paardenrace last-card presentation changed');
assert.match(log, /Winnaar:\s*<strong>Harten<\/strong>/, 'Paardenrace winner presentation changed');
assert.match(log, /Fase:\s*<strong>Race<\/strong>/, 'Paardenrace phase presentation changed');
assert.match(log, /Kaarten over:\s*<strong>17<\/strong>/, 'Paardenrace draw-remaining presentation changed');
assert.match(log, /Dichte gates:\s*<strong>7<\/strong>/, 'Paardenrace pending-gate presentation changed');
assert.match(buildLogItems({}, {}), /Fase:\s*<strong>lobby<\/strong>/, 'missing Paardenrace phase must fall back to lobby');
assert.match(buildLogItems({}, {}), /Dichte gates:\s*<strong>10<\/strong>/, 'empty race must expose all ten gates as closed');

assert.equal(kickButtonFor({ player_name: 'Ben' }, { is_host: false, player_name: 'Ada' }), '', 'non-host must not receive kick controls');
assert.equal(kickButtonFor({ player_name: 'ADA' }, { is_host: true, player_name: 'ada' }), '', 'host must not be able to kick self by case variant');
assert.match(kickButtonFor({ player_name: 'Ben de Boer' }, { is_host: true, player_name: 'Ada' }), /data-kick-player="Ben%20de%20Boer"/, 'host kick target encoding changed');

const rows = buildPlayerRows([
  { player_name: 'Ada', selected_suit: 'hearts', wager_bakken: 2, total_bakken_owed: 3, is_host: true, is_ready: true, is_winner: true },
  { player_name: 'Ben', selected_suit: 'spades', wager_bakken: 1, total_bakken_owed: 1, is_host: false, is_ready: false, is_winner: false },
], { is_host: true, player_name: 'Ada' });
assert.match(rows, /<strong>Ada<\/strong>/, 'Paardenrace player row must retain player name');
assert.match(rows, /Harten - inzet 2 Bakken - totaal 3 Bakken/, 'Paardenrace wager/owed summary changed');
assert.match(rows, /Host/, 'Paardenrace host marker changed');
assert.match(rows, /Winner/, 'Paardenrace winner marker changed');
assert.match(rows, /Ready/, 'Paardenrace ready marker changed');
assert.match(rows, /Niet ready/, 'Paardenrace non-ready marker changed');
assert.match(rows, /data-kick-player="Ben"/, 'host must retain kick action for another player');
assert.doesNotMatch(rows, /data-kick-player="Ada"/i, 'host must never receive self-kick action');
assert.match(buildPlayerRows(null, {}), /Nog geen spelers\./, 'empty Paardenrace player list fallback changed');

assert.match(
  buildNominationSummary({ stage: 'race' }, [], { can_nominate: true }),
  /Nog geen open nominaties voor jou\./,
  'nomination UI must stay closed outside nominations stage'
);
assert.match(
  buildNominationSummary({ stage: 'nominations' }, [], { can_nominate: false }),
  /Nog geen open nominaties voor jou\./,
  'viewer without nomination authority must not receive nomination form'
);
const nominations = buildNominationSummary(
  { stage: 'nominations' },
  [
    { player_name: 'Ada', selected_suit: 'hearts', total_bakken_owed: 2 },
    { player_name: 'Ben', selected_suit: 'spades', total_bakken_owed: 4 },
  ],
  { can_nominate: true, player_name: 'ADA', nomination_budget_bakken: 6 }
);
assert.match(nominations, /Jouw budget/, 'nomination budget heading changed');
assert.match(nominations, />6 Bakken te verdelen</, 'nomination budget value changed');
assert.match(nominations, /<strong>Ben<\/strong>/, 'other player must remain nominatable');
assert.doesNotMatch(nominations, /<strong>Ada<\/strong>/, 'viewer must remain excluded from own nomination targets case-insensitively');
assert.match(nominations, /Verdeling invullen/, 'nomination action changed');

assert.match(source, /rpcAny\(\['get_paardenrace_room_state_fast_v687','get_paardenrace_room_state_safe'\]/, 'Paardenrace state fetch must retain fast-v687 to safe fallback');
assert.match(source, /livePlayers\.length\s*<\s*2/, 'Paardenrace live state must retain two-player minimum sanity guard');
assert.match(source, /room\.stage\s*===\s*'finished'\s*&&\s*viewer\?\.is_host\s*&&\s*!viewer\?\.can_nominate/, 'finished host state must retain automatic close handoff after nominations');
assert.match(source, /\['disband_paardenrace_room_safe','destroy_paardenrace_room_safe','close_paardenrace_room_safe'\]/, 'Paardenrace close path must retain cleanup RPC fallback chain');
assert.match(source, /leave_paardenrace_room_safe/, 'Paardenrace explicit leave handoff must remain wired');

const checklist = JSON.parse(fs.readFileSync('beta-live-write-checklist.json', 'utf8'));
assert.equal(checklist.site_version, version, 'live-write checklist must follow release version');
assert.deepEqual(checklist.items, [], 'Paardenrace deterministic viewmodel acceptance must not arm production writes');

console.log('RESULT=PAARDENRACE_LIVE_VIEWMODEL_ACCEPTANCE_PASS');
console.log('Paardenrace v792 live viewmodel acceptance: log/player/nomination presentation, host kick boundaries, two-player live-state sanity and close/leave handoffs are protected without claiming backend play-to-completion.');
