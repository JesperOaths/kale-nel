#!/usr/bin/env node
import fs from 'node:fs';

const sql = fs.readFileSync(new URL('./GEJAST_v755_toepen_backend.sql', import.meta.url), 'utf8');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const required = [
  /create table if not exists public\.toepen_games/i,
  /create table if not exists public\.toepen_game_participants/i,
  /create table if not exists public\.toepen_rounds/i,
  /create table if not exists public\.toepen_round_results/i,
  /client_match_id text not null unique/i,
  /site_scope text not null default 'friends' check \(site_scope in \('friends','family'\)\)/i,
  /create unique index if not exists toepen_participants_game_name_uidx/i,
  /alter table public\.toepen_games enable row level security/i,
  /revoke all on public\.toepen_games from anon, authenticated/i,
  /security definer[\s\S]*set search_path to 'public'/i,
  /public\._tier3_player_from_any_session_v740\(session_token\)/i,
  /select id into existing_id from public\.toepen_games where client_match_id=client_id/i,
  /already_saved',true/i,
  /participant_count < 2 or participant_count > 8/i,
  /stake_value > 10/i,
  /Rondewinnaar is geen actieve Toepen-speler/i,
  /Toepen-ronde bevat niet exact alle actieve spelers/i,
  /Alleen de rondewinnaar mag als winnaar worden opgeslagen/i,
  /Ongeldige Toepen-foldwaarde/i,
  /Een Toepen-rondewinnaar krijgt geen strafpunten/i,
  /Blijven moet exact de eindinzet als strafpunten krijgen/i,
  /Folden moet exact de foldwaarde als strafpunten krijgen/i,
  /grant execute on function public\.create_toepen_game\(text,jsonb,text\) to anon, authenticated/i,
  /grant execute on function public\.get_toepen_app_state\(text,text\) to anon, authenticated/i,
  /revoke all on function public\._v755_admin_session_ok\(text\) from public/i,
  /grant execute on function public\.get_toepen_vault_summary\(text,integer,text\) to anon, authenticated/i,
  /notify pgrst, 'reload schema'/i
];

for (const pattern of required) {
  assert(pattern.test(sql), `Missing backend contract marker: ${pattern}`);
}

assert(!/insert into public\.jas_games/i.test(sql), 'Toepen SQL must not write to Klaverjas jas_games');
assert(!/create_jas_game/i.test(sql), 'Toepen SQL must not call Klaverjas save RPC');

console.log('Toepen backend SQL contract regression ok.');
