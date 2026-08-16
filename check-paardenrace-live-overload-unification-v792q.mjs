#!/usr/bin/env node
import fs from 'node:fs';

const migration = fs.readFileSync('GEJAST_v792q_paardenrace_live_overload_unification.sql', 'utf8');
const reshuffleMigration = fs.readFileSync('GEJAST_v792r_paardenrace_draw_pile_reshuffle.sql', 'utf8');
const helper = fs.readFileSync('gejast-paardenrace.js', 'utf8');
const live = fs.readFileSync('paardenrace_live.html', 'utf8');

function fail(message) {
  console.error(`Paardenrace v792q/r live RPC invariant failed: ${message}`);
  process.exit(1);
}

function requireText(text, needle, label) {
  if (!text.includes(needle)) fail(`${label} missing ${needle}`);
}

function functionBlock(sql, name) {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = sql.indexOf(marker);
  if (start < 0) fail(`migration missing ${name}`);
  const end = sql.indexOf('$function$;', start);
  if (end < 0) fail(`migration ${name} body terminator missing`);
  return sql.slice(start, end + '$function$;'.length);
}

const tick = functionBlock(migration, 'tick_paardenrace_room_safe');
const draw = functionBlock(migration, 'draw_paardenrace_card_safe');
const nominations = functionBlock(migration, 'submit_paardenrace_nominations_safe');

for (const [label, block, delegatedCall] of [
  ['tick', tick, 'RETURN public.tick_paardenrace_room_safe(\n    session_token,\n    session_token_input,\n    room_code_input'],
  ['draw', draw, 'RETURN public.draw_paardenrace_card_safe(\n    session_token,\n    session_token_input,\n    room_code_input'],
  ['nominations', nominations, 'RETURN public.submit_paardenrace_nominations_safe(\n    session_token,\n    session_token_input,\n    room_code_input,\n    allocations_input'],
]) {
  requireText(block, delegatedCall, `${label} wrapper`);
  requireText(block, 'public._scope_norm(site_scope_input)', `${label} scope guard`);
  requireText(block, "RAISE EXCEPTION 'Deze kamer hoort bij een andere site-scope.'", `${label} scope rejection`);
  requireText(block, 'session_token text DEFAULT NULL::text', `${label} default args`);
  requireText(block, 'session_token_input text DEFAULT NULL::text', `${label} default args`);
  requireText(block, 'site_scope_input text DEFAULT NULL::text', `${label} default args`);
  for (const retired of [
    '_pr_require_host_v667',
    '_pr_require_player_in_room_v667',
    'paardenrace_rooms_v667',
    'paardenrace_players_v667',
    'paardenrace_nominations_v667',
  ]) {
    if (block.includes(retired)) fail(`${label} wrapper still references retired ${retired}`);
  }
}

const reshuffle = functionBlock(reshuffleMigration, 'reshuffle_paardenrace_draw_pile_safe');
for (const needle of [
  'session_token text DEFAULT NULL::text',
  'session_token_input text DEFAULT NULL::text',
  'room_code_input text DEFAULT NULL::text',
  "site_scope_input text DEFAULT 'friends'::text",
  'public._paardenrace_require_name',
  'public._scope_norm(site_scope_input)',
  'jsonb_array_elements_text(v_discard)',
  'ORDER BY random()',
  "jsonb_set(v_match, '{draw_deck}'",
  "jsonb_set(v_match, '{draw_index}'",
  "jsonb_set(v_match, '{revealed_draw_cards}'",
  "jsonb_set(v_match, '{reshuffle_count}'",
]) requireText(reshuffle, needle, 'reshuffle RPC');
if (/return\s+public\.get_paardenrace_room_state_safe/i.test(reshuffle)) fail('reshuffle RPC is still a state-read no-op');

requireText(helper, 'site_scope_input: scope()', 'Paardenrace RPC helper');
requireText(helper, 'session_token: token || null', 'Paardenrace RPC helper');
requireText(helper, 'session_token_input: token || null', 'Paardenrace RPC helper');

for (const rpc of [
  'tick_paardenrace_room_safe',
  'draw_paardenrace_card_safe',
  'reshuffle_paardenrace_draw_pile_safe',
  'submit_paardenrace_nominations_safe',
]) {
  requireText(live, rpc, 'paardenrace_live.html');
}

console.log('Paardenrace v792q/r live RPC and draw-pile invariants ok.');
