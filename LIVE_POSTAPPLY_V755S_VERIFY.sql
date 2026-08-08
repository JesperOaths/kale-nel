-- v755s Klaverjas live alias post-apply verification. READ ONLY.
--
-- pg_get_functiondef preserves/reformats PL/pgSQL declaration whitespace. Verify semantic
-- guard calls/filters instead of depending on a particular declaration rendering.

create temp table if not exists _v755s_post(
  check_name text primary key,
  result text not null,
  detail text not null
) on commit preserve rows;
truncate _v755s_post;

with expected(signature) as (values
  ('public.start_klaverjas_live_match_v687(text,text,jsonb,text)'),
  ('public.update_klaverjas_live_match_v687(text,text,jsonb,text)'),
  ('public.finish_klaverjas_live_match_v687(text,text,jsonb,text)'),
  ('public.get_klaverjas_live_state_public_v687(text,text)')
)
insert into _v755s_post
select 'live_aliases_exist',
       case when count(*) filter(where to_regprocedure(signature) is not null)=4 then 'PASS' else 'FAIL' end,
       string_agg(signature||'='||case when to_regprocedure(signature) is null then 'missing' else 'present' end, '; ' order by signature)
from expected;

with f as (
  select p.proname,p.oid,
         exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_exec,
         has_function_privilege('anon',p.oid,'EXECUTE') anon_exec,
         has_function_privilege('authenticated',p.oid,'EXECUTE') auth_exec,
         lower(pg_get_functiondef(p.oid)) def
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname in ('start_klaverjas_live_match_v687','update_klaverjas_live_match_v687','finish_klaverjas_live_match_v687')
)
insert into _v755s_post
select 'live_write_rpc_boundary',
       case when count(*)=3 and bool_and(not public_exec and anon_exec and auth_exec and def like '%_jas_session_player%' and def like '%klaverjas_match_owner_mismatch%') then 'PASS' else 'FAIL' end,
       coalesce(string_agg(proname||': PUBLIC='||public_exec||', anon='||anon_exec||', authenticated='||auth_exec||', session_guard='||(def like '%_jas_session_player%')::text||', owner_guard='||(def like '%klaverjas_match_owner_mismatch%')::text,'; ' order by proname),'missing aliases')
from f;

with f as (
  select p.oid,
         exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_exec,
         lower(pg_get_functiondef(p.oid)) def,
         regexp_replace(lower(pg_get_functiondef(p.oid)), '[[:space:]]+', '', 'g') def_compact
  from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='get_klaverjas_live_state_public_v687'
)
insert into _v755s_post
select 'public_live_getter_boundary',
       case when count(*)=1 and bool_and(
         public_exec
         and def_compact like '%_klaverjas_safe_scope(site_scope_input)%'
         and def_compact like '%wherem.site_scope=v_scope%'
         and def not like '%insert into%'
         and def not like '%delete from%'
         and def not like '%update public.%'
       ) then 'PASS' else 'FAIL' end,
       case when count(*)=1 then
         'PUBLIC='||bool_or(public_exec)::text||
         ', safe_scope='||bool_or(def_compact like '%_klaverjas_safe_scope(site_scope_input)%')::text||
         ', scope_filter='||bool_or(def_compact like '%wherem.site_scope=v_scope%')::text||
         ', read_only='||bool_and(def not like '%insert into%' and def not like '%delete from%' and def not like '%update public.%')::text
       else 'getter missing' end
from f;

with g as (
  select table_name,grantee,privilege_type
  from information_schema.table_privileges
  where table_schema='public'
    and table_name in ('klaverjas_matches','klaverjas_rounds','klaverjas_match_snapshots','jas_games','jas_game_entries','game_rating_rebuild_queue','klaverjas_online_games','klaverjas_online_player_stats')
    and grantee in ('PUBLIC','anon','authenticated')
    and privilege_type in ('INSERT','UPDATE','DELETE')
)
insert into _v755s_post
select 'direct_dml_boundary',case when count(*)=0 then 'PASS' else 'FAIL' end,
       case when count(*)=0 then 'web-role direct DML grants=0' else string_agg(table_name||':'||grantee||':'||privilege_type,', ' order by table_name,grantee,privilege_type) end
from g;

insert into _v755s_post
select 'controlled_v766_residue',
       case when (select count(*) from public.klaverjas_matches where to_jsonb(klaverjas_matches)::text ilike '%OC_V766%')=0
                  and (select count(*) from public.gejast_player_sessions_v746 where session_token ilike 'OC_V766_KLAVERJAS_%')=0 then 'PASS' else 'FAIL' end,
       'matches='||(select count(*) from public.klaverjas_matches where to_jsonb(klaverjas_matches)::text ilike '%OC_V766%')::text||
       ', sessions='||(select count(*) from public.gejast_player_sessions_v746 where session_token ilike 'OC_V766_KLAVERJAS_%')::text;

insert into _v755s_post
select 'controlled_push_jobs',case when count(*)=0 then 'PASS' else 'FAIL' end,'OC_V766 push rows='||count(*)::text
from public.web_push_jobs where to_jsonb(web_push_jobs)::text ilike '%OC_V766%';

insert into _v755s_post
select 'ice_invariant',case when unit_value=2.8 then 'PASS' else 'FAIL' end,'Ice='||coalesce(unit_value::text,'missing')
from public.drink_event_types where key='ice' limit 1;

insert into _v755s_post values(
  'baseline_snapshot','PASS',
  'legacy matches='||(select count(*) from public.klaverjas_matches)::text||
  ', active='||(select count(*) from public.klaverjas_matches where status='active')::text||
  ', finished='||(select count(*) from public.klaverjas_matches where status='finished')::text||
  ', rounds='||(select count(*) from public.klaverjas_rounds)::text||
  ', snapshots='||(select count(*) from public.klaverjas_match_snapshots)::text||
  ', jas_games='||(select count(*) from public.jas_games)::text||
  ', jas_entries='||(select count(*) from public.jas_game_entries)::text||
  ', rebuild_queue='||(select count(*) from public.game_rating_rebuild_queue)::text
);

select check_name,result,detail from _v755s_post order by check_name;
