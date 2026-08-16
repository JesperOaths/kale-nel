#!/usr/bin/env node
import fs from 'node:fs';

const migration = fs.readFileSync('GEJAST_v792q_paardenrace_live_overload_unification.sql', 'utf8');
const helper = fs.readFileSync('gejast-paardenrace.js', 'utf8');
const live = fs.readFileSync('paardenrace_live.html', 'utf8');

function fail(message) {
  console.error(`Paardenrace v792q overload invariant failed: ${message}`);
  process.exit(1);
}

function requireText(text, needle, label) {
  if (!text.includes(needle)) fail(`${label} missing ${needle}`);
}

function functionBlock(name) {
  const marker = `CREATE OR REPLACE FUNCTION public.${name}(`;
  const start = migration.indexOf(marker);
  if (start < 0) fail(`migration missing ${name}`);
  const end = migration.indexOf('$function$;', start);
  if (end < 0) fail(`migration ${name} body terminator missing`);
  return migration.slice(start, end + '$function$;'.length);
}

const tick = functionBlock('tick_paardenrace_room_safe');
const draw = functionBlock('draw_paardenrace_card_safe');
const nominations = functionBlock('submit_paardenrace_nominations_safe');

for (const [label, block, delegatedCall] of [
  ['tick', tick, 'RETURN public.tick_paardenrace_room_safe(\n    session_token,\n    session_token_input,\n    room_code_input'],
  ['draw', draw, 'RETURN public.draw_paardenrace_card_safe(\n    session_token,\n    session_token_input,\n    room_code_input'],
  ['nominations', nominations, 'RETURN public.submit_paardenrace_nominations_safe(\n    session_token,\n    session_token_input,\n    room_code_input,\n    allocations_input'],
]) {
  requireText(block, delegatedCall, `${label} wrapper`);
  requireText(block, 'public._scope_norm(site_scope_input)', `${label} scope guard`);
  requireText(block, "RAISE EXCEPTION 'Deze kamer hoort bij een andere site-scope.'", `${label} scope rejection`);
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

requireText(helper, 'site_scope_input: scope()', 'Paardenrace RPC helper');
requireText(helper, 'session_token: token || null', 'Paardenrace RPC helper');
requireText(helper, 'session_token_input: token || null', 'Paardenrace RPC helper');

for (const rpc of [
  'tick_paardenrace_room_safe',
  'draw_paardenrace_card_safe',
  'submit_paardenrace_nominations_safe',
]) {
  requireText(live, rpc, 'paardenrace_live.html');
}

console.log('Paardenrace v792q browser/live overload unification invariant ok.');
