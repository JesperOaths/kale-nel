#!/usr/bin/env node
import fs from 'node:fs';

const path='GEJAST_v813i_read_path_timeout_hardening.sql';
if(!fs.existsSync(path)) throw new Error(`V813I_READ_PATH_FAIL missing ${path}`);
const sql=fs.readFileSync(path,'utf8');
const need=(token,label)=>{if(!sql.includes(token)) throw new Error(`V813I_READ_PATH_FAIL ${label}`);};
const forbid=(regex,label)=>{if(regex.test(sql)) throw new Error(`V813I_READ_PATH_FAIL ${label}`);};
const section=(start,end)=>{
  const a=sql.indexOf(start);
  if(a<0) throw new Error(`V813I_READ_PATH_FAIL missing section ${start}`);
  const b=end ? sql.indexOf(end,a+start.length) : sql.length;
  if(b<0) throw new Error(`V813I_READ_PATH_FAIL unterminated section ${start}`);
  return sql.slice(a,b);
};

need('create or replace function public.get_paardenrace_open_rooms_fast_v687(','Paardenrace fast-read replacement missing');
need('create or replace function public._gejast_active_profile_rows_v697(','profile helper replacement missing');
need("set search_path to 'public'",'fixed search_path missing');
need("notify pgrst, 'reload schema';",'PostgREST reload missing');

const paardenrace=section(
  'create or replace function public.get_paardenrace_open_rooms_fast_v687(',
  'create or replace function public._gejast_active_profile_rows_v697('
);
forbid(/cleanup_stale_paardenrace|paardenrace_cleanup_idle_lobbies/i,'mutating cleanup remains in Paardenrace read path');
if(!paardenrace.includes('left join public.paardenrace_room_players rp on rp.room_id = r.id')) throw new Error('V813I_READ_PATH_FAIL Paardenrace aggregation join missing');
if(!paardenrace.includes("in ('countdown','race','nominations')")) throw new Error('V813I_READ_PATH_FAIL active-stage stale filter missing');
if(!paardenrace.includes("now() - interval '8 minutes'")) throw new Error('V813I_READ_PATH_FAIL stale-lobby filter missing');
if(!paardenrace.includes("now() - interval '15 minutes'")) throw new Error('V813I_READ_PATH_FAIL recent-room visibility bound missing');
if(!paardenrace.includes('count(rp.*) < 2')) throw new Error('V813I_READ_PATH_FAIL player-count stale filter missing');

const profiles=section('create or replace function public._gejast_active_profile_rows_v697(',null);
forbid(/_gejast_has_col_v697|information_schema|execute\s+v_sql/i,'metadata introspection/dynamic SQL remains in profile hot path');
for(const token of [
  'p.display_name::text as display_name',
  'p.display_name::text as name',
  'p.display_name::text as player_name',
  'p.id as player_id',
  "coalesce(nullif(p.site_scope,''),'friends')::text as site_scope",
  'true as active',
  'true as login_active',
  'true as has_pin',
  '0 as total_matches',
  '0 as total_wins',
  '1000 as best_rating'
]) need(token,`profile output contract missing: ${token}`);
need('coalesce(p.active,true) = true','active profile filter missing');
need('coalesce(p.approved,true) = true','approved profile filter missing');

forbid(/alter\s+role[\s\S]{0,200}statement_timeout/i,'role statement_timeout must not be loosened');
forbid(/grant\s+execute[^;]*(?:cleanup_stale_paardenrace|paardenrace_cleanup_idle_lobbies)[^;]*\b(?:anon|authenticated)\b/i,'browser cleanup execution widened');

console.log('RESULT=V813I_READ_PATH_TIMEOUT_HARDENING_PASS');
