-- v755q Klaverjas direct-write boundary post-apply verification.
-- READ ONLY. Run only after GEJAST_v755q_klaverjas_write_boundary_guard.sql has been applied.

create temp table if not exists _v755q_verify(
  check_name text primary key,
  result text not null,
  detail text not null
) on commit preserve rows;
truncate _v755q_verify;

with grants as (
  select table_name,grantee,privilege_type
    from information_schema.table_privileges
   where table_schema='public'
     and table_name in ('jas_games','jas_game_entries','game_rating_rebuild_queue','klaverjas_online_games','klaverjas_online_player_stats')
     and grantee in ('PUBLIC','anon','authenticated')
     and privilege_type in ('INSERT','UPDATE','DELETE')
)
insert into _v755q_verify
select 'direct_table_dml_revoked',
       case when count(*)=0 then 'PASS' else 'FAIL' end,
       case when count(*)=0 then 'no PUBLIC/anon/authenticated direct DML grants remain'
            else string_agg(table_name||':'||grantee||':'||privilege_type, ', ' order by table_name,grantee,privilege_type)
       end
  from grants;

with f as (
  select p.oid,p.proname,pg_get_function_identity_arguments(p.oid) args,
         exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a where a.grantee=0 and a.privilege_type='EXECUTE') public_exec,
         has_function_privilege('anon',p.oid,'EXECUTE') anon_exec,
         has_function_privilege('authenticated',p.oid,'EXECUTE') auth_exec
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('create_jas_game','klaverjas_upsert_match_state_scoped')
)
insert into _v755q_verify
select 'rpc_execute_boundary',
       case when count(*)=2 and bool_and(not public_exec and anon_exec and auth_exec) then 'PASS' else 'FAIL' end,
       coalesce(string_agg(proname||'('||args||'): PUBLIC='||public_exec::text||', anon='||anon_exec::text||', authenticated='||auth_exec::text, '; ' order by proname),'target RPC missing')
  from f;

insert into _v755q_verify
select 'baseline_counts','PASS',
       'jas_games='||(select count(*) from public.jas_games)::text||
       ', jas_game_entries='||(select count(*) from public.jas_game_entries)::text||
       ', rebuild_queue='||(select count(*) from public.game_rating_rebuild_queue)::text||
       ', online_games='||(select count(*) from public.klaverjas_online_games)::text||
       ', online_player_stats='||(select count(*) from public.klaverjas_online_player_stats)::text;

insert into _v755q_verify
select 'controlled_v765_push_jobs',
       case when count(*)=0 then 'PASS' else 'FAIL' end,
       'OC_V765 push rows='||count(*)::text
  from public.web_push_jobs
 where to_jsonb(web_push_jobs)::text ilike '%OC_V765%';

insert into _v755q_verify
select 'ice_invariant',
       case when unit_value=2.8 then 'PASS' else 'FAIL' end,
       'Ice='||coalesce(unit_value::text,'missing')
  from public.drink_event_types
 where key='ice'
 limit 1;

select check_name,result,detail from _v755q_verify order by check_name;
