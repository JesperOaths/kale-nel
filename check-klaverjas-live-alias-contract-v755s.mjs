import fs from 'node:fs';

const path = 'GEJAST_v755s_klaverjas_live_alias_contract.sql';
const sql = fs.readFileSync(path, 'utf8');
const lower = sql.toLowerCase();

const required = [
  'create or replace function public.start_klaverjas_live_match_v687',
  'create or replace function public.update_klaverjas_live_match_v687',
  'create or replace function public.finish_klaverjas_live_match_v687',
  'create or replace function public.get_klaverjas_live_state_public_v687',
  'public._jas_session_player(session_token_input)',
  'klaverjas_match_owner_mismatch',
  'klaverjas_match_scope_mismatch',
  'klaverjas_client_match_id_required',
  'where client_match_id = v_client',
  "m.client_match_id = v_client",
  'revoke execute on function public.start_klaverjas_live_match_v687(text,text,jsonb,text) from public',
  'revoke execute on function public.update_klaverjas_live_match_v687(text,text,jsonb,text) from public',
  'revoke execute on function public.finish_klaverjas_live_match_v687(text,text,jsonb,text) from public',
  'grant execute on function public.get_klaverjas_live_state_public_v687(text,text) to public, anon, authenticated',
  'revoke insert, update, delete on table public.klaverjas_matches from public, anon, authenticated'
];
for (const needle of required) {
  if (!lower.includes(needle.toLowerCase())) throw new Error(`v755s missing required guard: ${needle}`);
}

for (const fn of ['start_klaverjas_live_match_v687','update_klaverjas_live_match_v687','finish_klaverjas_live_match_v687']) {
  const start = lower.indexOf(`create or replace function public.${fn}`);
  const end = lower.indexOf('$function$;', start);
  if (start < 0 || end < start) throw new Error(`v755s missing function body: ${fn}`);
  const body = lower.slice(start, end);
  if (!body.includes('public._jas_session_player')) throw new Error(`${fn} must authenticate before writes`);
  if (!body.includes('created_by_player_id') && !body.includes('v_existing_owner')) {
    throw new Error(`${fn} must enforce creator ownership`);
  }
  if (body.includes('insert into public.jas_games') || body.includes('insert into public.jas_game_entries') || body.includes('process_game_rating_rebuild_queue')) {
    throw new Error(`${fn} must not mutate classic/rating persistence`);
  }
}

const getStart = lower.indexOf('create or replace function public.get_klaverjas_live_state_public_v687');
const getEnd = lower.indexOf('$function$;', getStart);
const getBody = lower.slice(getStart, getEnd > getStart ? getEnd : undefined);
if (!getBody.includes('m.site_scope = v_scope')) throw new Error('public live getter must scope-filter');
for (const writeNeedle of ['insert into','update public.','delete from']) {
  if (getBody.includes(writeNeedle)) throw new Error(`public live getter must be read-only: ${writeNeedle}`);
}

const forbidden = [
  'grant insert',
  'grant update',
  'grant delete',
  'insert into public.jas_games',
  'insert into public.jas_game_entries',
  'process_game_rating_rebuild_queue'
];
for (const needle of forbidden) {
  if (lower.includes(needle)) throw new Error(`v755s must not contain: ${needle}`);
}

console.log('Klaverjas v755s live-alias regression: PASS');
