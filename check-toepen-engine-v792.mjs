#!/usr/bin/env node
/* Deterministic, non-production Toepen gameplay acceptance proof.
   Exercises the real shared engine through a complete elimination match for every
   supported player count (2..8), plus fold/stake/undo rule boundaries. */
import assert from 'node:assert/strict';
import engine from './gejast-toepen-engine.js';

function matchFor(count, target_points = 1) {
  return {
    schema_version: 1,
    game_type: 'toepen',
    target_points,
    dealer_seat: 1,
    players: Array.from({ length: count }, (_, i) => ({
      seat_no: i + 1,
      name: `P${i + 1}`,
      points: 0,
      active: true,
      eliminated_round_no: null,
      finish_rank: null,
    })),
    rounds: [],
    undo_stack: [],
  };
}

function playToCompletion(count) {
  let match = matchFor(count);
  let round = 0;
  while (engine.activePlayers(match).length > 1) {
    round += 1;
    const active = engine.activePlayers(match);
    const winner = active[0];
    match = engine.applyRound(match, {
      winner_seat: winner.seat_no,
      stake_final: 1,
      results: active.map((p) => ({
        seat_no: p.seat_no,
        action: p.seat_no === winner.seat_no ? 'win' : 'stay',
      })),
      special_tags: [],
      note: `acceptance-${count}-${round}`,
      created_at: `2026-08-15T00:00:${String(round).padStart(2, '0')}Z`,
    });
  }
  const active = engine.activePlayers(match);
  assert.equal(active.length, 1, `${count}p match did not finish with one active player`);
  assert.equal(match.finished_at !== undefined, true, `${count}p match missing finished_at`);
  assert.equal(match.rounds.length, count - 1, `${count}p match unexpected round count`);
  assert.equal(match.players.filter((p) => p.finish_rank === 1).length, 1, `${count}p missing winner rank`);
  assert.equal(new Set(match.players.map((p) => p.finish_rank)).size, count, `${count}p finish ranks are not unique`);
  assert.equal(match.dealer_seat, active[0].seat_no, `${count}p dealer did not rotate to round winner`);
  return match;
}

for (let count = 2; count <= 8; count += 1) {
  const match = playToCompletion(count);
  console.log(`Toepen ${count}-player completion: ok (${match.rounds.length} rounds)`);
}

{
  const match = matchFor(4, 10);
  const folded = engine.applyRound(match, {
    winner_seat: 1,
    stake_final: 4,
    results: [
      { seat_no: 1, action: 'win' },
      { seat_no: 2, action: 'fold', folded_at_stake: 2 },
      { seat_no: 3, action: 'stay' },
      { seat_no: 4, action: 'fold', folded_at_stake: 3 },
    ],
  });
  assert.deepEqual(
    folded.rounds[0].results.map((r) => r.penalty_points),
    [0, 2, 4, 3],
    'fold penalties are incorrect',
  );
  console.log('Toepen fold/stake scoring: ok');
}

{
  const match = matchFor(3, 10);
  assert.throws(
    () => engine.applyRound(match, {
      winner_seat: 1,
      stake_final: 1,
      results: [
        { seat_no: 1, action: 'win' },
        { seat_no: 2, action: 'fold', folded_at_stake: 0 },
        { seat_no: 3, action: 'stay' },
      ],
    }),
    (error) => error.code === 'illegal_fold_stake',
  );
  assert.throws(
    () => engine.applyRound(match, {
      winner_seat: 1,
      stake_final: 11,
      results: [],
    }),
    (error) => error.code === 'illegal_stake',
  );
  console.log('Toepen illegal fold/stake guards: ok');
}

{
  const match = matchFor(4, 10);
  const next = engine.applyRound(match, {
    winner_seat: 1,
    stake_final: 2,
    results: [
      { seat_no: 1, action: 'win' },
      { seat_no: 2, action: 'stay' },
      { seat_no: 3, action: 'stay' },
      { seat_no: 4, action: 'stay' },
    ],
  });
  const prior = engine.undo(next);
  assert.equal(prior.rounds.length, 0, 'undo did not remove latest round');
  assert.deepEqual(prior.players.map((p) => p.points), [0, 0, 0, 0], 'undo did not restore points');
  console.log('Toepen undo: ok');
}

console.log('RESULT=TOEPEN_ENGINE_ACCEPTANCE_PASS');
