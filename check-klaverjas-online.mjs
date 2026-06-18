import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = fs.readFileSync(new URL('./gejast-klaverjas-online.js', import.meta.url), 'utf8');
const window = {
  GEJAST_CONFIG: {},
  localStorage: { getItem: () => null },
  sessionStorage: { getItem: () => null },
  location: { search: '' }
};
vm.runInNewContext(source, { window, URLSearchParams, fetch, console });
const K = window.GEJAST_KLAVERJAS_ONLINE;

assert.ok(K, 'Klaverjas runtime should load');

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

console.log('Online Klaverjas rules smoke ok.');
