import fs from 'node:fs';

const sqlPath = 'GEJAST_v755q_klaverjas_write_boundary_guard.sql';
const sql = fs.readFileSync(sqlPath, 'utf8').toLowerCase();

const mustContain = [
  'revoke insert, update, delete on table public.jas_games from public, anon, authenticated',
  'revoke insert, update, delete on table public.jas_game_entries from public, anon, authenticated',
  'revoke insert, update, delete on table public.game_rating_rebuild_queue from public, anon, authenticated',
  'revoke insert, update, delete on table public.klaverjas_online_games from public, anon, authenticated',
  'revoke insert, update, delete on table public.klaverjas_online_player_stats from public, anon, authenticated',
  'revoke execute on function public.create_jas_game(text, jsonb) from public',
  'grant execute on function public.create_jas_game(text, jsonb) to anon, authenticated',
  'revoke execute on function public.klaverjas_upsert_match_state_scoped(',
  'grant execute on function public.klaverjas_upsert_match_state_scoped('
];

for (const needle of mustContain) {
  if (!sql.includes(needle)) throw new Error(`v755q missing required boundary statement: ${needle}`);
}

const forbidden = [
  'create or replace function',
  'drop function',
  'alter table',
  'enable row level security',
  'disable row level security',
  'rebuild_klaverjas',
  'insert into public.jas_games',
  'update public.jas_games',
  'delete from public.jas_games'
];

for (const needle of forbidden) {
  if (sql.includes(needle)) throw new Error(`v755q must remain ACL-only; found forbidden behavior: ${needle}`);
}

if (/grant\s+(?:insert|update|delete)/i.test(sql)) {
  throw new Error('v755q must not grant direct table DML');
}

console.log('Klaverjas v755q direct-write boundary regression: PASS');
