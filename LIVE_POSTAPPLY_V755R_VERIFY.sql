-- v755r Klaverjas independent post-apply verification. READ ONLY.
-- Run after LIVE_APPLY_AND_VERIFY_V755R_KLAVERJAS_SAVE_GUARD.sql succeeds.

create temp table if not exists _v755r_post(
  check_name text primary key,
  result text not null,
  detail text not null
) on commit preserve rows;
truncate _v755r_post;

insert into _v755r_post
select 'save_rpc_exists',
       case when to_regprocedure('public.save_klaverjas_match_v687(text,text,text,jsonb,text)') is not null then 'PASS' else 'FAIL' end,
       coalesce(to_regprocedure('public.save_klaverjas_match_v687(text,text,text,jsonb,text)')::text,'missing');

with f as (
  select p.oid,p.proname,
         exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_exec,
         has_function_privilege('anon',p.oid,'EXECUTE') anon_exec,
         has_function_privilege('authenticated',p.oid,'EXECUTE') auth_exec,
         lower(pg_get_functiondef(p.oid)) def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname in ('save_klaverjas_match_v687','klaverjas_upsert_match_state_scoped')
)
insert into _v755r_post
select 'rpc_auth_boundary',
       case when count(*)=2 and bool_and(not public_exec and anon_exec and auth_exec and def like '%_jas_session_player%') then 'PASS' else 'FAIL' end,
       coalesce(string_agg(proname||': PUBLIC='||public_exec||', anon='||anon_exec||', authenticated='||auth_exec||', session_guard='||(def like '%_jas_session_player%')::text,'; ' order by proname),'missing target RPC')
  from f;

with g as (
  select table_name,grantee,privilege_type
    from information_schema.table_privileges
   where table_schema='public'
     and table_name in (
       'klaverjas_matches','klaverjas_rounds','klaverjas_match_snapshots',
       'jas_games','jas_game_entries','game_rating_rebuild_queue',
       'klaverjas_online_games','klaverjas_online_player_stats'
     )
     and grantee in ('PUBLIC','anon','authenticated')
     and privilege_type in ('INSERT','UPDATE','DELETE')
)
insert into _v755r_post
select 'direct_dml_boundary',
       case when count(*)=0 then 'PASS' else 'FAIL' end,
       case when count(*)=0 then 'web-role direct DML grants=0'
            else string_agg(table_name||':'||grantee||':'||privilege_type,', ' order by table_name,grantee,privilege_type)
       end
  from g;

insert into _v755r_post
select 'controlled_v765_residue',
       case when (select count(*) from public.klaverjas_matches where to_jsonb(klaverjas_matches)::text ilike '%OC_V765%')=0
                  and (select count(*) from public.gejast_player_sessions_v746 where session_token ilike 'OC_V765_KLAVERJAS_%')=0
            then 'PASS' else 'FAIL' end,
       'matches='||(select count(*) from public.klaverjas_matches where to_jsonb(klaverjas_matches)::text ilike '%OC_V765%')::text||
       ', sessions='||(select count(*) from public.gejast_player_sessions_v746 where session_token ilike 'OC_V765_KLAVERJAS_%')::text;

insert into _v755r_post
select 'controlled_push_jobs',
       case when count(*)=0 then 'PASS' else 'FAIL' end,
       'OC_V765 push rows='||count(*)::text
  from public.web_push_jobs
 where to_jsonb(web_push_jobs)::text ilike '%OC_V765%';

insert into _v755r_post
select 'ice_invariant',
       case when unit_value=2.8 then 'PASS' else 'FAIL' end,
       'Ice='||coalesce(unit_value::text,'missing')
  from public.drink_event_types
 where key='ice'
 limit 1;

insert into _v755r_post values(
  'baseline_snapshot','PASS',
  'legacy matches='||(select count(*) from public.klaverjas_matches)::text||
  ', rounds='||(select count(*) from public.klaverjas_rounds)::text||
  ', snapshots='||(select count(*) from public.klaverjas_match_snapshots)::text||
  ', jas_games='||(select count(*) from public.jas_games)::text||
  ', jas_entries='||(select count(*) from public.jas_game_entries)::text||
  ', rebuild_queue='||(select count(*) from public.game_rating_rebuild_queue)::text||
  ', online_games='||(select count(*) from public.klaverjas_online_games)::text||
  ', online_player_stats='||(select count(*) from public.klaverjas_online_player_stats)::text
);

select check_name,result,detail from _v755r_post order by check_name;
