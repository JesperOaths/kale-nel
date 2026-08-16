#!/usr/bin/env node
import fs from 'node:fs';

const migration = fs.readFileSync('GEJAST_v792s_paardenrace_unambiguous_live_rpc.sql', 'utf8');
const reshuffleMigration = fs.readFileSync('GEJAST_v792r_paardenrace_draw_pile_reshuffle.sql', 'utf8');
const drinkMigration = fs.readFileSync('GEJAST_v792t_paardenrace_bak_drink_helper.sql', 'utf8');
const helper = fs.readFileSync('gejast-paardenrace.js', 'utf8');
const live = fs.readFileSync('paardenrace_live.html', 'utf8');

function fail(message) {
  console.error(`Paardenrace v792s/r/t live RPC invariant failed: ${message}`);
  process.exit(1);
}

function requireText(text, needle, label) {
  if (!text.includes(needle)) fail(`${label} missing ${needle}`);
}

function rejectText(text, needle, label) {
  if (text.includes(needle)) fail(`${label} still contains ${needle}`);
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

for (const [label, block] of [
  ['tick', tick],
  ['draw', draw],
  ['nominations', nominations],
]) {
  requireText(block, 'public._scope_norm(v_room.site_scope)', `${label} scope guard`);
  requireText(block, "RAISE EXCEPTION 'Deze kamer hoort bij een andere site-scope.'", `${label} scope rejection`);
  requireText(block, 'SECURITY DEFINER', `${label} security contract`);
  requireText(block, 'public.paardenrace_rooms', `${label} current room pipeline`);
  requireText(block, 'public.paardenrace_room_players', `${label} current player pipeline`);
  requireText(block, 'public._paardenrace_build_room_state', `${label} current state builder`);
  for (const retired of [
    '_pr_require_host_v667',
    '_pr_require_player_in_room_v667',
    'paardenrace_rooms_v667',
    'paardenrace_players_v667',
    'paardenrace_nominations_v667',
  ]) rejectText(block, retired, `${label} browser overload`);
}

requireText(tick, 'room_code_input text,', 'tick browser signature');
requireText(tick, 'session_token text DEFAULT NULL::text', 'tick default args');
requireText(tick, 'session_token_input text DEFAULT NULL::text', 'tick default args');
requireText(tick, 'site_scope_input text DEFAULT NULL::text', 'tick default args');
requireText(tick, 'public._paardenrace_make_decks()', 'tick race transition');
requireText(tick, "'match_ref', v_match_ref", 'tick match creation');
requireText(tick, 'public.paardenrace_obligations', 'tick wager obligations');
rejectText(tick, 'RETURN public.tick_paardenrace_room_safe(', 'tick browser overload');

requireText(draw, 'room_code_input text,', 'draw browser signature');
requireText(draw, 'session_token text DEFAULT NULL::text', 'draw default args');
requireText(draw, 'session_token_input text DEFAULT NULL::text', 'draw default args');
requireText(draw, 'site_scope_input text DEFAULT NULL::text', 'draw default args');
requireText(draw, 'public._paardenrace_require_name', 'draw host authentication');
requireText(draw, 'public._paardenrace_suit_from_card', 'draw suit advancement');
requireText(draw, "jsonb_set(m, '{horse_positions}'", 'draw positions persistence');
requireText(draw, "jsonb_set(m, '{winner_suit}'", 'draw winner persistence');
rejectText(draw, 'RETURN public.draw_paardenrace_card_safe(', 'draw browser overload');

requireText(nominations, 'allocations_input jsonb,', 'nominations browser signature');
requireText(nominations, 'session_token text DEFAULT NULL::text', 'nominations default args');
requireText(nominations, 'session_token_input text DEFAULT NULL::text', 'nominations default args');
requireText(nominations, 'site_scope_input text DEFAULT NULL::text', 'nominations default args');
requireText(nominations, 'public._paardenrace_player_id', 'nominations player authentication');
requireText(nominations, 'winner_submitted', 'nominations idempotency guard');
requireText(nominations, 'public.paardenrace_match_history', 'nominations completion history');
requireText(nominations, 'public._paardenrace_result_summary', 'nominations result summary');
rejectText(nominations, 'RETURN public.submit_paardenrace_nominations_safe(', 'nominations browser overload');

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

const drinkHelper = functionBlock(drinkMigration, '_gejast_create_bak_drink_request_v695');
for (const needle of [
  "source_kind_input text DEFAULT 'paardenrace'::text",
  'source_ref_input text DEFAULT NULL::text',
  "metadata_input jsonb DEFAULT '{}'::jsonb",
  'SECURITY DEFINER',
  'p.display_name',
  'p.profile_display_name',
  'p.chosen_username',
  'public._scope_norm(p.site_scope)',
  "RAISE EXCEPTION 'Speler voor Bak-verzoek niet gevonden.'",
  'v_client_event_id := coalesce(',
  'INSERT INTO public.drink_events(',
  'client_event_id,',
  'player_id,',
  'event_type_id,',
  'event_type_key,',
  'event_type_label,',
  'site_scope,',
  'raw_payload,',
  'metadata,',
  'WHEN unique_violation THEN',
]) requireText(drinkHelper, needle, 'Bak drink helper');
rejectText(drinkHelper, "coalesce(display_name,name,email,''", 'Bak drink helper historical player lookup');
rejectText(drinkHelper, "execute 'select id from public.players", 'Bak drink helper dynamic player lookup');

requireText(helper, 'site_scope_input: scope()', 'Paardenrace RPC helper');
requireText(helper, 'session_token: token || null', 'Paardenrace RPC helper');
requireText(helper, 'session_token_input: token || null', 'Paardenrace RPC helper');

for (const rpc of [
  'tick_paardenrace_room_safe',
  'draw_paardenrace_card_safe',
  'reshuffle_paardenrace_draw_pile_safe',
  'submit_paardenrace_nominations_safe',
]) requireText(live, rpc, 'paardenrace_live.html');

console.log('Paardenrace v792s/r/t live RPC, draw-pile and Bak/drink invariants ok.');
