#!/usr/bin/env node
import fs from 'node:fs';

const path='GEJAST_v813i_read_path_timeout_hardening.sql';
if(!fs.existsSync(path)) throw new Error(`V813I_READ_PATH_FAIL missing ${path}`);
const sql=fs.readFileSync(path,'utf8');
const stripSqlComments=(text)=>text
  .replace(/\/\*[\s\S]*?\*\//g,'')
  .replace(/--[^\r\n]*/g,'');
const executableSql=stripSqlComments(sql);
const need=(token,label)=>{if(!executableSql.includes(token)) throw new Error(`V813I_READ_PATH_FAIL ${label}`);};
const forbid=(text,regex,label)=>{if(regex.test(text)) throw new Error(`V813I_READ_PATH_FAIL ${label}`);};
const section=(text,start,end)=>{
  const a=text.indexOf(start);
  if(a<0) throw new Error(`V813I_READ_PATH_FAIL missing section ${start}`);
  const b=end ? text.indexOf(end,a+start.length) : text.length;
  if(b<0) throw new Error(`V813I_READ_PATH_FAIL unterminated section ${start}`);
  return text.slice(a,b);
};

need('create or replace function public.get_paardenrace_open_rooms_fast_v687(','Paardenrace fast-read replacement missing');
need('create or replace function public._gejast_active_profile_rows_v697(','profile helper replacement missing');
need("set search_path to 'public'",'fixed search_path missing');
need("notify pgrst, 'reload schema';",'PostgREST reload missing');

const paardenrace=section(
  executableSql,
  'create or replace function public.get_paardenrace_open_rooms_fast_v687(',
  'create or replace function public._gejast_active_profile_rows_v697('
);
forbid(paardenrace,/cleanup_stale_paardenrace|paardenrace_cleanup_idle_lobbies/i,'mutating cleanup remains in Paardenrace read path');
if(!paardenrace.includes('left join public.paardenrace_room_players rp on rp.room_id = r.id')) throw new Error('V813I_READ_PATH_FAIL Paardenrace aggregation join missing');
if(!paardenrace.includes("in ('countdown','race','nominations')")) throw new Error('V813I_READ_PATH_FAIL active-stage stale filter missing');
if(!paardenrace.includes("now() - interval '8 minutes'")) throw new Error('V813I_READ_PATH_FAIL stale-lobby filter missing');
if(!paardenrace.includes("now() - interval '15 minutes'")) throw new Error('V813I_READ_PATH_FAIL recent-room visibility bound missing');
if(!paardenrace.includes('count(rp.*) < 2')) throw new Error('V813I_READ_PATH_FAIL player-count stale filter missing');

const profiles=section(executableSql,'create or replace function public._gejast_active_profile_rows_v697(',null);
forbid(profiles,/_gejast_has_col_v697|information_schema|execute\s+v_sql/i,'metadata introspection/dynamic SQL remains in profile hot path');
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
]) {
  if(!profiles.includes(token)) throw new Error(`V813I_READ_PATH_FAIL profile output contract missing: ${token}`);
}
if(!profiles.includes('coalesce(p.active,true) = true')) throw new Error('V813I_READ_PATH_FAIL active profile filter missing');
if(!profiles.includes('coalesce(p.approved,true) = true')) throw new Error('V813I_READ_PATH_FAIL approved profile filter missing');

forbid(executableSql,/alter\s+role[\s\S]{0,200}statement_timeout/i,'role statement_timeout must not be loosened');
forbid(executableSql,/grant\s+execute[^;]*(?:cleanup_stale_paardenrace|paardenrace_cleanup_idle_lobbies)[^;]*\b(?:anon|authenticated)\b/i,'browser cleanup execution widened');

console.log('RESULT=V813I_READ_PATH_TIMEOUT_HARDENING_PASS');
