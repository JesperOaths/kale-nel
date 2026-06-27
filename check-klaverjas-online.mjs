import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./gejast-klaverjas-online.js', import.meta.url), 'utf8');
const lobbyHtml = fs.readFileSync(new URL('./klaverjas_online.html', import.meta.url), 'utf8');
const roomHtml = fs.readFileSync(new URL('./klaverjas_room.html', import.meta.url), 'utf8');
const roomControlSql = fs.readFileSync(new URL('./GEJAST_v752_klaverjas_online_room_control.sql', import.meta.url), 'utf8');
const hostFlagSql = fs.readFileSync(new URL('./GEJAST_v753_klaverjas_lobby_host_flag.sql', import.meta.url), 'utf8');
const window = {
  GEJAST_CONFIG: {},
  localStorage: { getItem: () => null },
  sessionStorage: { getItem: () => null },
  location: { search: '' }
};
vm.runInNewContext(source, { window, URLSearchParams, fetch, console });
const K = window.GEJAST_KLAVERJAS_ONLINE;

assert.ok(K, 'Klaverjas runtime should load');

function finishOneDeterministicRound(state) {
  state.accepted_bid = {
    action: 'bid',
    mode: 'suit',
    suit: 'clubs',
    points: 80,
    player: 0,
    team: 1
  };
  state.current_bid = state.accepted_bid;
  state.phase = 'playing';
  state.turn = (state.dealer + 1) % 4;
  state.action_needed_seat = state.turn;
  state.trick = [];
  state.taken = [];
  state.roem_by_team = [0, 0];
  state.plays = [];

  for (let trickNumber = 0; trickNumber < 8; trickNumber += 1) {
    const trick = [];
    for (let playNumber = 0; playNumber < 4; playNumber += 1) {
      const seat = state.turn;
      const hand = state.hands[seat];
      const card = K.aiChoice(hand, trick, seat, state.accepted_bid.suit, state);
      assert.ok(card, 'every player should have a legal deterministic card');
      const legal = new Set(K.legalCards(hand, trick, seat, state.accepted_bid.suit).map((item) => item.id));
      assert.equal(legal.has(card.id), true, 'AI choice should always be legal');
      state.hands[seat] = hand.filter((item) => item.id !== card.id);
      trick.push({ player: seat, card });
      state.plays.push({ trick_no: trickNumber + 1, player: seat, player_name: state.players[seat].name, card, ai_card: card, delta: 0 });
      state.turn = (seat + 1) % 4;
    }
    const winner = K.currentWinner(trick, state.accepted_bid.suit).player;
    const roem = K.detectRoem(trick.map((play) => play.card), state.accepted_bid.suit);
    state.roem_by_team[K.TEAM_OF[winner] - 1] += roem.points;
    state.taken.push({ winner, cards: trick, roem, klopped: true });
    state.turn = winner;
  }

  const result = K.scoreRound(state.taken, state.accepted_bid.team, state.accepted_bid, state.roem_by_team);
  state.totals[0] += result.scores[0];
  state.totals[1] += result.scores[1];
  const round = {
    round: state.rounds.length + 1,
    bid: state.accepted_bid,
    bidder_team: state.accepted_bid.team,
    result,
    totals: state.totals.slice(),
    roem_by_team: state.roem_by_team.slice(),
    plays: state.plays,
    dealer: state.dealer
  };
  round.coach_recap = K.buildCoachRecap(round);
  K.updateAiMmr(state, round);
  round.ai_mmr_after = state.ai_mmr;
  state.rounds.push(round);
  state.phase = 'roundOver';
  state.action_needed_seat = null;
  state.plays = [];
  state.dealer = K.nextDealer(state.dealer);
  return round;
}

const deck = K.createDeck();
assert.equal(deck.length, 32);
assert.equal(new Set(deck.map((card) => card.id)).size, 32);

const hands = K.deal(deck, 0);
assert.deepEqual(Array.from(hands, (hand) => hand.length), [8, 8, 8, 8]);

const c = (suit, rank) => ({ suit, rank, id: `${suit}-${rank}` });

{
  const hand = [c('clubs', '7'), c('hearts', 'J'), c('spades', 'A')];
  const trick = [{ player: 0, card: c('clubs', 'A') }];
  assert.deepEqual(Array.from(K.legalCards(hand, trick, 1, 'hearts'), (card) => card.id), ['clubs-7']);
}

{
  const hand = [c('hearts', 'J'), c('hearts', '7'), c('spades', 'A')];
  const trick = [
    { player: 0, card: c('clubs', 'A') },
    { player: 1, card: c('hearts', '9') }
  ];
  assert.deepEqual(Array.from(K.legalCards(hand, trick, 2, 'hearts'), (card) => card.id), ['hearts-J']);
}

{
  const hand = [c('hearts', '7'), c('spades', 'A')];
  const trick = [
    { player: 0, card: c('clubs', 'A') },
    { player: 1, card: c('hearts', 'J') }
  ];
  assert.deepEqual(Array.from(K.legalCards(hand, trick, 2, 'hearts'), (card) => card.id), ['hearts-7']);
}

{
  const hand = [c('hearts', '7'), c('spades', 'A')];
  const trick = [
    { player: 0, card: c('clubs', 'A') },
    { player: 1, card: c('clubs', '7') }
  ];
  assert.deepEqual(
    Array.from(K.legalCards(hand, trick, 2, 'hearts'), (card) => card.id).sort(),
    ['hearts-7', 'spades-A']
  );
}

{
  const players = ['A', 'B', 'C', 'D'].map((name) => ({ name }));
  const state = K.newClientState(players, 0, null, { finish_mode: 'fixed_rounds' });
  assert.equal(state.phase, 'bidding');
  assert.equal(state.players.length, 4);
  assert.deepEqual(Array.from(state.hands, (hand) => hand.length), [8, 8, 8, 8]);
  assert.equal(state.action_needed_seat, 1);
}

{
  const hand = [
    c('clubs', 'A'),
    c('hearts', 'J'),
    c('diamonds', 'A'),
    c('spades', 'A'),
    c('hearts', '9')
  ];
  assert.deepEqual(
    K.sortHandForBid(hand, 'hearts').map((card) => card.id),
    ['hearts-J', 'hearts-9', 'spades-A', 'diamonds-A', 'clubs-A']
  );
  assert.deepEqual(
    K.sortHandForBid(hand, 'spades').map((card) => card.id),
    ['spades-A', 'hearts-J', 'hearts-9', 'clubs-A', 'diamonds-A']
  );
}

{
  const players = ['A', 'B', 'C', 'D'].map((name, index) => ({ name, is_bot: index > 1, bot_difficulty: index === 2 ? 'easy' : 'hard' }));
  const original = K.newClientState(players, 2, null, { finish_mode: 'fixed_rounds' });
  original.passes_since_bid = 4;
  const redeal = K.newClientState(players, original.dealer, original, original.settings);
  assert.equal(redeal.dealer, 2, 'four passes should redeal with the same dealer');
  assert.equal(redeal.bidder_turn, 3, 'same player should start bidding again after same-dealer redeal');
  assert.equal(redeal.rounds.length, 0, 'four-pass redeal should not add a round');
}

{
  const state = K.newClientState([
    { name: 'Human' },
    { name: 'Easy', is_bot: true, bot_difficulty: 'easy' },
    { name: 'Partner' },
    { name: 'Hard', is_bot: true, bot_difficulty: 'hard' }
  ], 0, null, { finish_mode: 'fixed_rounds' });
  const round = {
    round: 1,
    bid: { action: 'bid', mode: 'suit', suit: 'hearts', points: 80, team: 1 },
    bidder_team: 1,
    result: { made: true, nat: false, target: 82, cardScores: [100, 62], scores: [100, 62] },
    plays: [
      { player: 0, card: c('clubs', 'A'), ai_card: c('clubs', '7') },
      { player: 2, card: c('spades', '7'), ai_card: c('spades', 'A') }
    ]
  };
  K.updateAiMmr(state, round);
  assert.equal(state.ai_mmr.Human.rating > 1200, true);
  assert.equal(state.ai_mmr.Partner.rating < 1200, true);
}

{
  const taken = Array.from({ length: 8 }, (_, index) => ({
    winner: index % 2 === 0 ? 0 : 1,
    cards: [
      { player: 0, card: c('clubs', 'A') },
      { player: 1, card: c('clubs', '10') },
      { player: 2, card: c('clubs', 'K') },
      { player: 3, card: c('clubs', 'Q') }
    ]
  }));
  const result = K.scoreRound(taken, 1, { action: 'bid', mode: 'suit', suit: 'hearts', points: 80 }, [0, 0]);
  assert.equal(result.scores.length, 2);
  assert.ok(result.scores.every(Number.isFinite));
}

{
  const players = ['A', 'B', 'C', 'D'].map((name) => ({ name }));
  const state = K.newClientState(players, 0, null, { finish_mode: 'fixed_rounds' });
  const start = new Date();
  const deadline = new Date(state.action_deadline_at);
  assert.equal(deadline > start, true, 'new turns should receive a future deadline');
  assert.equal(deadline.getTime() - start.getTime() > 6.5 * 24 * 60 * 60 * 1000, true, 'deadline should be roughly seven days out');
  assert.equal(deadline.getTime() - start.getTime() < 7.5 * 24 * 60 * 60 * 1000, true, 'deadline should not drift past the seven-day policy');
}

{
  const players = ['A', 'B', 'C', 'D'].map((name) => ({ name }));
  const state = K.newClientState(players, 0, null, { finish_mode: 'fixed_rounds' });
  const round = finishOneDeterministicRound(state);
  assert.equal(state.rounds.length, 1, 'a normal round should persist in round recap data');
  assert.equal(round.coach_recap.length, 0, 'perfect deterministic play should not produce false coach deltas');
  assert.equal(Object.keys(state.ai_mmr).length, 4, 'human MMR snapshot should cover every human player');
  state.phase = 'finished';
  state.finished_at = new Date().toISOString();
  const payload = K.finalJasPayload(state, { id: 'local-human-game', lobby_code: 'LOCAL' });
  assert.ok(payload, 'four-human finished games should produce a final score payload');
  assert.equal(payload.source, 'klaverjas_online');
  assert.equal(payload.participants.length, 4);
  assert.equal(payload.rounds.length, 1);
  assert.deepEqual(payload.participants.map((player) => player.team_no), [1, 2, 1, 2]);
}

{
  const state = K.newClientState([
    { name: 'Human' },
    { name: 'Easy', is_bot: true, bot_difficulty: 'easy' },
    { name: 'Partner' },
    { name: 'Hard', is_bot: true, bot_difficulty: 'hard' }
  ], 0, null, { finish_mode: 'fixed_rounds', bot_count: 2 });
  finishOneDeterministicRound(state);
  state.phase = 'finished';
  state.finished_at = new Date().toISOString();
  assert.equal(K.hasBots(state), true);
  assert.equal(K.finalJasPayload(state, { id: 'local-bot-game', lobby_code: 'BOT' }), null, 'bot games must stay out of score forms and stats');
}

{
  const state = K.newClientState(['A', 'B', 'C', 'D'].map((name) => ({ name })), 1, null, { finish_mode: 'first_to_162' });
  const summary = K.publicSummary(state, { id: 'summary-test', lobby_code: 'SUM' });
  assert.deepEqual(summary.teams.wij, ['A', 'C'], 'public summaries should keep team 1 visible');
  assert.deepEqual(summary.teams.zij, ['B', 'D'], 'public summaries should keep team 2 visible');
  assert.equal(summary.action_needed_seat, state.action_needed_seat);
  assert.equal(summary.finish_mode, 'Eerste tot 162');
}

{
  assert.match(lobbyHtml, /location\.replace\(roomUrl\(incomingGame, incomingRoom\)\)/, 'lobby should redirect room URLs to the room page');
  assert.match(lobbyHtml, /klaverjas_room\.html/, 'lobby should link created and joined games to the table page');
  assert.match(lobbyHtml, /data-delete-room/, 'host delete button should exist in the lobby list');
  assert.match(roomHtml, /if \(UI\.saving\) throw new Error\('De vorige zet wordt nog opgeslagen\.'\)/, 'room should block duplicate client saves');
  assert.match(roomHtml, /if \(UI\.actionBusy\) return;/, 'room should block duplicate client actions');
  assert.match(roomHtml, /klaverjas_online_get_state/, 'room should support reconnect/rejoin through server state reload');
  assert.match(roomHtml, /final_jas_payload: st\.finished_at && !hasBots \? K\.finalJasPayload/, 'room should only submit final score payloads for non-bot games');
  assert.match(roomHtml, /@media\(max-width:760px\)/, 'room should include mobile layout rules');
  assert.match(lobbyHtml, /@media\(max-width:760px\)/, 'lobby should include mobile layout rules');
  assert.match(roomControlSql, /_klaverjas_online_player_active_room/, 'SQL should contain one-active-room enforcement');
  assert.match(roomControlSql, /Alleen de host kan deze klaverjastafel sluiten/, 'SQL should enforce host-only room deletion');
  assert.match(hostFlagSql, /created_by_player_id = viewer_id/, 'SQL should expose id-based host flags');
}

console.log('Online Klaverjas regression smoke ok.');
