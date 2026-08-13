#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (name) => fs.readFileSync(name, 'utf8');
const version = read('VERSION').trim();
const privacy = read('GEJAST_v792a_klaverjas_online_privacy_guard.sql');
const base = read('GEJAST_v792b_klaverjas_online_state_transition_guard.sql');
const bridge = read('GEJAST_v792b1_klaverjas_online_redacted_state_bridge.sql');
const deck = read('GEJAST_v792b2_klaverjas_online_canonical_deck_fix.sql');
const deal = read('GEJAST_v792b3_klaverjas_online_deal_guard.sql');
const history = read('GEJAST_v792b4_klaverjas_online_history_guard.sql');
const bid = read('GEJAST_v792b5_klaverjas_online_bid_guard.sql');
const play = read('GEJAST_v792b6_klaverjas_online_play_guard.sql');
const effective = read('GEJAST_v792b7_klaverjas_online_effective_state.sql');
const chain = read('GEJAST_v792b8_klaverjas_online_save_guard_chain.sql');
const bidNull = read('GEJAST_v792b9_klaverjas_online_bid_null_guard.sql');
const strength = read('GEJAST_v792b10_klaverjas_card_strength.sql');
const legality = read('GEJAST_v792b11_klaverjas_card_legality.sql');
const legalityGuard = read('GEJAST_v792b12_klaverjas_human_card_legality_guard.sql');
const partialWinner = read('GEJAST_v792b13_klaverjas_partial_trick_winner.sql');

assert.equal(version, 'v792', 'v792b is SQL-only and must not bump frontend VERSION');

// v792a remains the private-state owner and the first v792b migration preserves it as an
// internal worker rather than re-implementing privacy/stat persistence.
assert.match(privacy, /redacted_recovery_hands/i);
assert.match(privacy, /revoke\s+select\s+on\s+table\s+public\.klaverjas_online_games/i);
assert.match(base, /rename\s+to\s+_klaverjas_online_save_state_v792a/i);
assert.match(base, /_klaverjas_online_save_state_v792a\(text,uuid,jsonb,jsonb,jsonb\)[\s\S]*?from\s+public,\s*anon,\s*authenticated/i);

// Redacted browser state must be reconstructed from the locked authoritative row before guards
// run, including the nested recovery copy. A new deal is deliberately not reconstructed.
assert.match(effective, /deal_nonce[\s\S]*?game_row\.state[\s\S]*?return\s+result_state/i);
assert.match(effective, /idx\s*<>\s*actor_seat[\s\S]*?is_bot/i);
assert.match(effective, /array\['hands',idx::text\]/i);
assert.match(effective, /array\['recovery_snapshot','hands',idx::text\]/i);
assert.match(bridge, /recovery_snapshot/i, 'earlier bridge documents the same compatibility owner');

// Canonical deck means 32 physical cards, no duplicate ids, and id/suit/rank agreement.
assert.match(deck, /count\(\*\)\s*=\s*32/i);
assert.match(deck, /count\(distinct\s+id\)\s*=\s*32/i);
assert.match(deck, /suit\s+in\s*\('clubs','spades','hearts','diamonds'\)/i);
assert.match(deck, /rank\s+in\s*\('A','10','K','Q','J','9','8','7'\)/i);
assert.match(deck, /id\s*=\s*suit\s*\|\|\s*'-'\s*\|\|\s*rank/i);

// Deal replacement is limited to initial host start, all-pass redeal, or next round; state starts
// from a clean bidding baseline and keeps completed totals/rounds.
assert.match(deal, /new_nonce\s+is\s+distinct\s+from\s+old_nonce/i);
assert.match(deal, /old_phase\s*=\s*'lobby'[\s\S]*?actor_seat\s*<>\s*0/i);
assert.match(deal, /old_phase\s*=\s*'roundOver'/i);
assert.match(deal, /old_phase\s*=\s*'bidding'[\s\S]*?current_bid[\s\S]*?passes_since_bid[^\n]*3/i);
assert.match(deal, /bidder_turn[\s\S]*?dealer[\s\S]*?\+\s*1/i);
assert.match(deal, /current_bid'\s+is\s+not\s+null/i);
assert.match(deal, /accepted_bid'\s+is\s+not\s+null/i);
assert.match(deal, /_klaverjas_online_state_has_canonical_deck/i);
assert.match(deal, /settings_mutation_rejected/i);
assert.match(deal, /accepted_bid_mutation_rejected/i);
assert.match(deal, /dealer_advance_rejected/i);

// All-human completed history is append-only and totals only move with one final eighth trick.
assert.match(history, /new_rounds\s*<\s*old_rounds[\s\S]*?old_rounds\s*\+\s*1/i);
assert.match(history, /round_history_rewrite_rejected/i);
assert.match(history, /totals_without_round_rejected/i);
assert.match(history, /old_taken\s*<>\s*7[\s\S]*?new_taken\s*<>\s*8/i);
assert.match(history, /taken_history_rewrite_rejected/i);
assert.match(history, /pending_trick,cards/i);

// Human bids are one action by the stored bidder. Malformed/non-step bids are rejected; the v792b9
// replacement closes null/parse ambiguity in the helper used by v792b5.
assert.match(bid, /actor_seat\s*<>\s*action_seat/i);
assert.match(bid, /_klaverjas_online_bid_valid_v792b5/i);
assert.match(bid, /new_passes\s*<>\s*old_passes\s*\+\s*1/i);
assert.match(bid, /bidder_turn_rejected/i);
assert.match(bidNull, /if\s+points\s+is\s+null\s+then\s+return\s+false/i);
assert.match(bidNull, /points\s*%\s*10\s*<>\s*0/i);
assert.match(bidNull, /exception\s+when\s+others\s+then\s+return\s+false/i);

// Human card saves remove one exact card from the actor, preserve other hands/current trick prefix,
// and calculate the fourth-card winner server-side. No negative-index first-card shortcut remains in
// the effective play guard.
assert.match(play, /jsonb_array_length\(new_hand\)\s*<>\s*jsonb_array_length\(old_hand\)\s*-\s*1/i);
assert.match(play, /idx\s*<>\s*action_seat[\s\S]*?other_hand_mutation_rejected/i);
assert.match(play, /old_trick\s*>\s*0[\s\S]*?for\s+idx\s+in\s+0\.\.old_trick\s*-\s*1/i);
assert.doesNotMatch(play, /old_trick\s*-\s*1\)\s*is\s+distinct/i, 'first-card prefix must not use a negative JSON index');
assert.match(play, /where\s+card\s*=\s*appended_play\s*->\s*'card'/i);
assert.match(play, /_klaverjas_online_trick_winner_v792b6/i);
assert.match(play, /trick_winner_rejected/i);
assert.match(partialWinner, /jsonb_array_length\(cards\)\s*<\s*1[\s\S]*?jsonb_array_length\(cards\)\s*>\s*4/i);

// Server card legality mirrors follow suit, trumping, partner-winning exception and overtrump.
assert.match(strength, /category\s*\*\s*100\s*\+\s*rank_strength/i);
assert.match(legality, /has_follow/i);
assert.match(legality, /has_trump/i);
assert.match(legality, /winner\s+is\s+not\s+null[\s\S]*?player_seat/i);
assert.match(legality, /has_over/i);
assert.match(legalityGuard, /_klaverjas_online_card_legal_v792b11/i);
assert.match(legalityGuard, /illegal_card_rejected/i);

// The final public wrapper authenticates against the stored roster, builds effective state, invokes
// the corrected chain, keeps bot-test history batching compatible, and never calls the flawed draft
// transition helper from v792b.
assert.match(chain, /_jas_session_player\(session_token\)/i);
assert.match(chain, /game_row\.state\s*->\s*'players'/i);
assert.match(chain, /_klaverjas_online_effective_state_v792b7/i);
assert.match(chain, /_klaverjas_online_deal_guard_v792b3/i);
assert.match(chain, /if\s+not\s+has_bots[\s\S]*?_klaverjas_online_history_guard_v792b4/i);
assert.match(chain, /_klaverjas_online_bid_guard_v792b5/i);
assert.match(chain, /_klaverjas_online_play_guard_v792b6/i);
assert.match(chain, /_klaverjas_online_human_card_legality_guard_v792b12/i);
assert.doesNotMatch(chain, /_klaverjas_online_state_transition_guard\s*\(/i, 'final wrapper must bypass the superseded draft guard');
assert.match(chain, /_klaverjas_online_save_state_v792a\(/i);
assert.match(chain, /revoke\s+execute[\s\S]*?from\s+public/i);
assert.match(chain, /grant\s+execute[\s\S]*?to\s+anon,\s*authenticated/i);

console.log('Online Klaverjas v792b integrity guard chain ok.');