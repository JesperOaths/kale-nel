(function(root){
  'use strict';
  const MAX_STAKE = 10;
  function clone(value){ return JSON.parse(JSON.stringify(value)); }
  function activePlayers(match){ return (match && Array.isArray(match.players) ? match.players : []).filter((p)=>p && p.active !== false); }
  function assertRule(condition, message, code){ if(!condition){ const err = new Error(message); err.code = code || 'toepen_rule_error'; throw err; } }
  function finishRanks(match, roundNo){
    const stillActive = activePlayers(match);
    if(stillActive.length !== 1) return match;
    stillActive[0].finish_rank = 1;
    let rank = match.players.length;
    match.players
      .filter((p)=>p.active === false)
      .sort((a,b)=>(a.eliminated_round_no || roundNo) - (b.eliminated_round_no || roundNo) || a.seat_no - b.seat_no)
      .forEach((p)=>{ p.finish_rank = rank--; });
    match.finished_at = match.finished_at || new Date().toISOString();
    return match;
  }
  function normalizeRound(match, input){
    assertRule(match && Array.isArray(match.players), 'Match is missing players.', 'bad_match');
    const active = activePlayers(match);
    assertRule(active.length >= 2, 'At least two active players are required.', 'too_few_players');
    const activeSeats = new Set(active.map((p)=>Number(p.seat_no)));
    const winnerSeat = Number(input && input.winner_seat);
    const stake = Number(input && input.stake_final);
    assertRule(Number.isInteger(winnerSeat) && activeSeats.has(winnerSeat), 'Winner must be an active player.', 'illegal_winner');
    assertRule(Number.isInteger(stake) && stake >= 1 && stake <= MAX_STAKE, 'Stake must be between 1 and 10.', 'illegal_stake');
    const bySeat = new Map();
    for (const row of Array.isArray(input.results) ? input.results : []) bySeat.set(Number(row.seat_no), row);
    const results = active.map((player)=>{
      const raw = bySeat.get(Number(player.seat_no)) || {};
      const action = Number(player.seat_no) === winnerSeat ? 'win' : String(raw.action || 'stay').toLowerCase();
      assertRule(['win','stay','fold'].includes(action), `${player.name}: illegal action.`, 'illegal_action');
      assertRule((action === 'win') === (Number(player.seat_no) === winnerSeat), `${player.name}: only the winner may have win action.`, 'illegal_winner_action');
      let foldedAt = null;
      let penalty = 0;
      if(action === 'stay') penalty = stake;
      if(action === 'fold'){
        foldedAt = Number(raw.folded_at_stake ?? raw.foldAt ?? raw.fold_at);
        assertRule(stake > 1, `${player.name}: cannot fold when stake is 1.`, 'illegal_fold_stake');
        assertRule(Number.isInteger(foldedAt) && foldedAt >= 1 && foldedAt < stake, `${player.name}: invalid fold stake.`, 'illegal_fold_value');
        penalty = foldedAt;
      }
      return { seat_no:Number(player.seat_no), name:player.name, action, penalty_points:penalty, folded_at_stake:foldedAt };
    });
    return { winnerSeat, stake, results };
  }
  function applyRound(match, input){
    const next = clone(match);
    const before = clone(next);
    const normalized = normalizeRound(next, input || {});
    next.undo_stack = Array.isArray(next.undo_stack) ? next.undo_stack : [];
    next.undo_stack.push(before);
    if(next.undo_stack.length > 20) next.undo_stack.shift();
    const roundNo = (Array.isArray(next.rounds) ? next.rounds.length : 0) + 1;
    next.rounds = Array.isArray(next.rounds) ? next.rounds : [];
    normalized.results.forEach((result)=>{
      const player = next.players.find((p)=>Number(p.seat_no) === Number(result.seat_no));
      player.points = Number(player.points || 0) + Number(result.penalty_points || 0);
      if(player.active !== false && player.points >= Number(next.target_points || 10)){
        player.active = false;
        player.eliminated_round_no = roundNo;
      }
    });
    const winner = next.players.find((p)=>Number(p.seat_no) === normalized.winnerSeat);
    next.rounds.push({
      round_no: roundNo,
      dealer_seat: next.dealer_seat,
      dealer_name: (next.players.find((p)=>Number(p.seat_no) === Number(next.dealer_seat)) || {}).name || '',
      winner_seat: normalized.winnerSeat,
      winner_name: winner.name,
      stake_final: normalized.stake,
      knock_count: Math.max(0, normalized.stake - 1),
      special_tags: Array.isArray(input.special_tags) ? input.special_tags.slice() : [],
      note: String(input.note || '').trim(),
      results: normalized.results,
      created_at: input.created_at || new Date().toISOString()
    });
    next.dealer_seat = normalized.winnerSeat;
    finishRanks(next, roundNo);
    return next;
  }
  function undo(match){
    assertRule(match && Array.isArray(match.undo_stack) && match.undo_stack.length, 'Nothing to undo.', 'empty_undo');
    const stack = match.undo_stack.slice();
    const prior = stack.pop();
    prior.undo_stack = stack;
    return prior;
  }
  const api = { MAX_STAKE, activePlayers, normalizeRound, applyRound, undo };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.GEJAST_TOEPEN_ENGINE = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
