#!/usr/bin/env node
import engine from './gejast-toepen-engine.js';

function assert(condition, message){ if(!condition) throw new Error(message); }
function throws(fn, code){ let ok=false; try{ fn(); }catch(err){ ok = !code || err.code === code; } assert(ok, `Expected throw ${code || ''}`); }
function match(names=['A','B','C','D'], target=10){ return { target_points: target, dealer_seat:1, players:names.map((name,i)=>({ seat_no:i+1, name, points:0, active:true, eliminated_round_no:null, finish_rank:null })), rounds:[], undo_stack:[] }; }
function stayRound(m, winner=1, stake=1){ return engine.applyRound(m, { winner_seat:winner, stake_final:stake, results:engine.activePlayers(m).map((p)=>({ seat_no:p.seat_no, action:p.seat_no===winner?'win':'stay' })) }); }

// two-player round
let m = match(['A','B']);
m = stayRound(m, 1, 1);
assert(m.players[0].points === 0 && m.players[1].points === 1, 'two-player scoring failed');
assert(m.dealer_seat === 1 && m.rounds.length === 1, 'winner should become dealer');

// multi-player round
m = match();
m = stayRound(m, 2, 2);
assert(m.players.find(p=>p.name==='B').points === 0, 'winner should not get penalty');
assert(m.players.filter(p=>p.name!=='B').every(p=>p.points === 2), 'multi-player stay penalties failed');

// fold at every legal stake and max stake
for (let stake=2; stake<=engine.MAX_STAKE; stake++) {
  const fm = engine.applyRound(match(['A','B','C']), { winner_seat:1, stake_final:stake, results:[{seat_no:1,action:'win'},{seat_no:2,action:'fold',folded_at_stake:stake-1},{seat_no:3,action:'stay'}] });
  assert(fm.players[1].points === stake-1, `fold penalty failed at stake ${stake}`);
  assert(fm.players[2].points === stake, `stay penalty failed at stake ${stake}`);
}
throws(()=>engine.applyRound(match(), { winner_seat:1, stake_final:11, results:[] }), 'illegal_stake');
throws(()=>engine.applyRound(match(), { winner_seat:1, stake_final:1, results:[{seat_no:2,action:'fold',folded_at_stake:1}] }), 'illegal_fold_stake');
throws(()=>engine.applyRound(match(), { winner_seat:1, stake_final:3, results:[{seat_no:2,action:'fold',folded_at_stake:3}] }), 'illegal_fold_value');

// toep/overtoep values are stakes 2/3
m = match(['A','B','C']);
m = stayRound(m, 1, 2);
m = stayRound(m, 2, 3);
assert(m.players.find(p=>p.name==='C').points === 5, 'toep/overtoep accumulated penalties failed');

// illegal winner/responder/action
throws(()=>engine.applyRound(match(), { winner_seat:9, stake_final:1, results:[] }), 'illegal_winner');
throws(()=>engine.applyRound(match(), { winner_seat:1, stake_final:1, results:[{seat_no:2,action:'win'}] }), 'illegal_winner_action');
throws(()=>engine.applyRound(match(), { winner_seat:1, stake_final:1, results:[{seat_no:2,action:'raise'}] }), 'illegal_action');

// elimination and last-player win condition
m = match(['A','B'], 3);
m = stayRound(m, 1, 2);
m = stayRound(m, 1, 1);
assert(m.players[1].active === false && m.players[1].eliminated_round_no === 2, 'elimination failed');
assert(m.finished_at && m.players[0].finish_rank === 1 && m.players[1].finish_rank === 2, 'finish ranks failed');
throws(()=>stayRound(m, 1, 1), 'too_few_players');

// consecutive rounds and undo after raise/high stake
m = match(['A','B','C']);
m = stayRound(m, 1, 1);
const afterOne = JSON.stringify(m.players);
m = stayRound(m, 2, 4);
assert(m.rounds.length === 2, 'consecutive rounds failed');
m = engine.undo(m);
assert(m.rounds.length === 1 && JSON.stringify(m.players) === afterOne, 'undo after high-stake round failed');
m = engine.undo(m);
assert(m.rounds.length === 0 && m.undo_stack.length === 0, 'undo before/after raise failed');
throws(()=>engine.undo(m), 'empty_undo');

// malformed payload
throws(()=>engine.applyRound(null, {}), 'bad_match');
throws(()=>engine.applyRound(match(['A','B']), { winner_seat:1, stake_final:2, results:[{seat_no:2,action:'fold'}] }), 'illegal_fold_value');

console.log('Toepen deterministic engine regression ok.');
