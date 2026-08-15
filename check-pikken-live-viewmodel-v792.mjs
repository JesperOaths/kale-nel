#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const version = fs.readFileSync('VERSION', 'utf8').trim();
const versionNumber = Number(version.match(/^v(\d+)$/)?.[1] || 0);
assert.ok(versionNumber >= 792, 'Pikken live viewmodel acceptance requires frontend v792+');

const source = fs.readFileSync('gejast-pikken-live.js', 'utf8');

function extractFunction(name, nextName) {
  const start = source.indexOf(`function ${name}(`);
  const end = source.indexOf(`\n  function ${nextName}(`, start);
  assert.ok(start >= 0 && end > start, `Pikken shipped function ${name} owner missing`);
  return vm.runInNewContext(`(${source.slice(start, end).trim()})`);
}

const faceOrderLine = source.match(/const faceOrder = [^\n]+;/)?.[0];
const sortDiceLine = source.match(/const sortDice = [^\n]+;/)?.[0];
assert.ok(faceOrderLine && sortDiceLine, 'Pikken dice ordering helpers missing');
const diceHelpers = vm.runInNewContext(`${faceOrderLine}\n${sortDiceLine}\n({ faceOrder, sortDice })`);

const bidText = extractFunction('bidText', 'revealText');
const winnerFrom = extractFunction('winnerFrom', 'playerName');
const phase = extractFunction('phase', 'setText');
const seatClass = extractFunction('seatClass', 'legalOptions');
const viewerActive = extractFunction('viewerActive', 'showRoundOverlay');

assert.deepEqual(
  Array.from(diceHelpers.sortDice([1, 6, 2, 0, null, 5, 3, 4])),
  [2, 3, 4, 5, 6, 1],
  'Pikken live dice display must keep pik after 2-6 and discard empty values'
);
assert.equal(diceHelpers.faceOrder(1), 7, 'pik must remain the highest display face');
assert.equal(diceHelpers.faceOrder(6), 6, 'regular face ordering changed');

assert.equal(bidText({ count: 3, face: 1 }), '3 x pik', 'pik bid label changed');
assert.equal(bidText({ count: 2, face: 6 }), '2 x 6', 'regular bid label changed');
assert.equal(bidText(null), '--', 'empty bid label changed');

assert.equal(winnerFrom({ game: { state: { winner_name: 'Ada' } }, players: [] }), 'Ada', 'authoritative winner_name must win');
assert.equal(
  winnerFrom({ players: [{ name: 'Ada', alive: false, dice_count: 0 }, { name: 'Ben', alive: true, dice_count: 2 }] }),
  'Ben',
  'sole alive player must be recognized as winner'
);
assert.equal(
  winnerFrom({ players: [{ name: 'Ada', alive: true, dice_count: 1 }, { name: 'Ben', alive: true, dice_count: 2 }] }),
  '',
  'multiple alive players must not produce a premature winner'
);

assert.equal(phase({ game: { state: { phase: 'Voting' } } }), 'voting', 'state phase normalization changed');
assert.equal(phase({ game: { status: 'LIVE' } }), 'live', 'game status phase fallback changed');
assert.equal(phase({}), 'lobby', 'missing phase must fall back to lobby');

assert.deepEqual(
  Array.from({ length: 8 }, (_, index) => seatClass(index)),
  ['top', 'right', 'bottom', 'left', 'extra1', 'extra2', 'extra3', 'extra4'],
  'Pikken live presentation seat map changed'
);
assert.equal(seatClass(8), 'top', 'presentation seat map must remain cyclic; this is not a backend player-limit assertion');

assert.equal(viewerActive({ viewer: { is_host: true }, players: [] }), true, 'host must remain active in own room');
assert.equal(
  viewerActive({ viewer: { player_id: 'p2' }, players: [{ player_id: 'p1' }, { player_id: 'p2' }] }),
  true,
  'viewer player-id membership matching changed'
);
assert.equal(
  viewerActive({ viewer: { seat: 3 }, players: [{ seat: 2 }, { seat: 3 }] }),
  true,
  'viewer seat membership matching changed'
);
assert.equal(
  viewerActive({ viewer: { name: 'Alice' }, players: [{ name: 'ALICE' }] }),
  true,
  'viewer name membership fallback must remain case-insensitive'
);
assert.equal(
  viewerActive({ viewer: { player_id: 'missing' }, players: [{ player_id: 'p1' }] }),
  false,
  'non-member viewer must not remain active'
);
assert.equal(viewerActive({ viewer: {}, players: [] }), false, 'empty room must not keep a non-host viewer active');

assert.match(source, /api\.recordCompleted\(id\)/, 'completed Pikken matches must retain canonical persistence handoff');
assert.match(source, /abandonAndRecordKeepalive\(gameId, 'page_left'\)/, 'page-exit abandonment handoff must remain wired');

const checklist = JSON.parse(fs.readFileSync('beta-live-write-checklist.json', 'utf8'));
assert.equal(checklist.site_version, version, 'live-write checklist must follow release version');
assert.deepEqual(checklist.items, [], 'Pikken deterministic viewmodel acceptance must not arm production writes');

console.log('RESULT=PIKKEN_LIVE_VIEWMODEL_ACCEPTANCE_PASS');
console.log('Pikken v792 live viewmodel acceptance: dice/bid presentation, winner detection, phase normalization, viewer membership and persistence handoffs are protected without claiming backend play-to-completion.');
