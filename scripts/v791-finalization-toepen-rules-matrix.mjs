#!/usr/bin/env node
import assert from 'node:assert/strict';
import '../gejast-toepen-engine.js';

const engine = globalThis.GEJAST_TOEPEN_ENGINE;
assert.ok(engine, 'GEJAST_TOEPEN_ENGINE did not initialize');

function matchFor(n, target=10) {
  return {
    schema_version: 1,
    client_match_id: `audit-${n}`,
    game_type: 'toepen',
    created_at: '2026-08-13T00:00:00.000Z',
    target_points: target,
    dealer_seat: 1,
    ruleset: {},
    players: Array.from({ length:n }, (_,i) => ({
      seat_no:i+1,
      name:`P${i+1}`,
      points:0,
      active:true,
      eliminated_round_no:null,
      finish_rank:null
    })),
    rounds:[],
    undo_stack:[]
  };
}

function validRound(n, stake=3) {
  return {
    winner_seat:1,
    stake_final:stake,
    special_tags:[],
    note:'audit',
    created_at:'2026-08-13T00:01:00.000Z',
    results:Array.from({ length:n }, (_,i) => ({
      seat_no:i+1,
      action:i===0?'win':'stay'
    }))
  };
}

for (let n=2; n<=8; n+=1) {
  const original=matchFor(n);
  const next=engine.applyRound(original, validRound(n,3));
  assert.equal(next.rounds.length,1,`${n}p: round must be recorded`);
  assert.equal(next.dealer_seat,1,`${n}p: fourth-trick winner becomes dealer`);
  assert.equal(next.players[0].points,0,`${n}p: winner must get zero penalty`);
  for (let i=1;i<n;i+=1) assert.equal(next.players[i].points,3,`${n}p: staying loser ${i+1} must receive final stake`);
  assert.equal(original.rounds.length,0,`${n}p: engine must not mutate original match`);
  const restored=engine.undo(next);
  assert.equal(restored.rounds.length,0,`${n}p: undo must restore pre-round state`);
  assert.ok(restored.players.every((p)=>p.points===0),`${n}p: undo must restore points`);
  console.log(`PASS Toepen ${n} players: valid round + scoring + dealer + immutability + undo`);
}

assert.throws(
  ()=>engine.applyRound(matchFor(1), validRound(1,1)),
  (e)=>e?.code==='too_few_players',
  '1-player Toepen must be rejected by the engine'
);
assert.throws(
  ()=>engine.applyRound(matchFor(2), {...validRound(2,1),winner_seat:3}),
  (e)=>e?.code==='illegal_winner',
  'inactive/nonexistent winner must be rejected'
);
for (const stake of [0,11,1.5]) {
  assert.throws(
    ()=>engine.applyRound(matchFor(2), validRound(2,stake)),
    (e)=>e?.code==='illegal_stake',
    `illegal stake ${stake} must be rejected`
  );
}
assert.throws(
  ()=>engine.applyRound(matchFor(2),{
    ...validRound(2,1),
    results:[{seat_no:1,action:'win'},{seat_no:2,action:'fold',folded_at_stake:1}]
  }),
  (e)=>e?.code==='illegal_fold_stake',
  'fold at stake 1 must be rejected'
);
assert.throws(
  ()=>engine.applyRound(matchFor(2),{
    ...validRound(2,3),
    results:[{seat_no:1,action:'win'},{seat_no:2,action:'fold',folded_at_stake:3}]
  }),
  (e)=>e?.code==='illegal_fold_value',
  'fold value must be below final stake'
);
assert.throws(
  ()=>engine.applyRound(matchFor(3),{
    ...validRound(3,3),
    results:[{seat_no:1,action:'win'},{seat_no:2,action:'win'},{seat_no:3,action:'stay'}]
  }),
  (e)=>e?.code==='illegal_winner_action',
  'only the declared winner may have win action'
);

const elimination=engine.applyRound(matchFor(2,3), validRound(2,3));
assert.equal(elimination.players[1].active,false,'player reaching target must be eliminated');
assert.equal(elimination.players[0].finish_rank,1,'last active player must be ranked first');
assert.equal(elimination.players[1].finish_rank,2,'eliminated player must receive final rank');
assert.ok(elimination.finished_at,'finished two-player match must receive finished_at');

console.log('v791 Toepen exhaustive rules matrix: PASS');
