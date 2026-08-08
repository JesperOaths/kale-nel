import fs from 'node:fs';

const path = 'GEJAST_v755r_klaverjas_save_contract_guard.sql';
const sql = fs.readFileSync(path, 'utf8');
const lower = sql.toLowerCase();

const required = [
  'create or replace function public.save_klaverjas_match_v687',
  'create or replace function public.klaverjas_upsert_match_state_scoped',
  'v_actor := public._jas_session_player',
  'klaverjas_match_owner_mismatch',
  'klaverjas_client_match_id_required',
  "where client_match_id = v_client_match_id",
  "'already_saved', v_already_saved",
  'revoke insert, update, delete on table public.klaverjas_matches from public, anon, authenticated',
  'revoke insert, update, delete on table public.klaverjas_rounds from public, anon, authenticated',
  'revoke insert, update, delete on table public.klaverjas_match_snapshots from public, anon, authenticated',
  'revoke insert, update, delete on table public.jas_games from public, anon, authenticated',
  'revoke insert, update, delete on table public.jas_game_entries from public, anon, authenticated',
  'revoke insert, update, delete on table public.game_rating_rebuild_queue from public, anon, authenticated',
  'revoke execute on function public.save_klaverjas_match_v687(text,text,text,jsonb,text) from public',
  'revoke execute on function public.klaverjas_upsert_match_state_scoped',
  'revoke execute on function public.create_jas_game(text,jsonb) from public'
];

for (const needle of required) {
  if (!lower.includes(needle.toLowerCase())) {
    throw new Error(`v755r missing required guard: ${needle}`);
  }
}

const forbidden = [
  'process_game_rating_rebuild_queue',
  '_enqueue_rating_rebuild',
  'insert into public.jas_games',
  'insert into public.jas_game_entries',
  'grant insert',
  'grant update',
  'grant delete'
];
for (const needle of forbidden) {
  if (lower.includes(needle)) throw new Error(`v755r current save contract must not contain: ${needle}`);
}

const saveStart = lower.indexOf('create or replace function public.save_klaverjas_match_v687');
const saveEnd = lower.indexOf('$function$;', saveStart);
const saveBody = lower.slice(saveStart, saveEnd > saveStart ? saveEnd : undefined);
if (!saveBody.includes('public._jas_session_player')) throw new Error('v755r save RPC must authenticate before writes');
if (!saveBody.includes('client_match_id')) throw new Error('v755r save RPC must use text client_match_id');
if (!saveBody.includes('created_by_player_id')) throw new Error('v755r save RPC must enforce creator ownership');

const legacyStart = lower.indexOf('create or replace function public.klaverjas_upsert_match_state_scoped');
const legacyEnd = lower.indexOf('$function$;', legacyStart);
const legacyBody = lower.slice(legacyStart, legacyEnd > legacyStart ? legacyEnd : undefined);
if (!legacyBody.includes('public._jas_session_player')) throw new Error('legacy upsert must authenticate');
if (!legacyBody.includes('klaverjas_match_owner_mismatch')) throw new Error('legacy upsert must reject cross-owner writes');
if (!legacyBody.includes('created_by_player_id = v_actor.id')) throw new Error('legacy upsert must scope updates to the creator');

console.log('Klaverjas v755r save-contract regression: PASS');
