-- v766 Klaverjas live-alias production preflight.
-- READ ONLY against persistent production state/catalogs.
-- No INSERT/UPDATE/DELETE on public production tables.

create temp table if not exists _v766_live_preflight(
  check_name text primary key,
  result text not null,
  detail text not null
) on commit preserve rows;
truncate _v766_live_preflight;

-- Exact current runtime RPC inventory.
with targets(name) as (
  values
    ('start_klaverjas_live_match_v687'::text),
    ('update_klaverjas_live_match_v687'::text),
    ('finish_klaverjas_live_match_v687'::text),
    ('get_klaverjas_live_state_public_v687'::text),
    ('save_klaverjas_match_v687'::text),
    ('klaverjas_upsert_match_state_scoped'::text),
    ('klaverjas_get_live_match_public'::text)
), f as (
  select t.name,
         p.oid,
         pg_get_function_identity_arguments(p.oid) as args,
         p.prosecdef,
         lower(pg_get_functiondef(p.oid)) as def
    from targets t
    left join pg_proc p on p.proname=t.name
    left join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
   where p.oid is null or n.nspname='public'
)
insert into _v766_live_preflight(check_name,result,detail)
select 'function_'||name,
       case when count(oid)>0 then 'PASS' else 'INFO' end,
       case when count(oid)=0 then 'not deployed'
            else string_agg(name||'('||coalesce(args,'')||') SECURITY DEFINER='||prosecdef::text, '; ' order by args)
       end
  from f
 group by name;

-- Definition fingerprints for auth/client-id/owner/scope/write/read behavior.
with f as (
  select p.proname,
         pg_get_function_identity_arguments(p.oid) as args,
         lower(pg_get_functiondef(p.oid)) as def
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in (
       'start_klaverjas_live_match_v687','update_klaverjas_live_match_v687',
       'finish_klaverjas_live_match_v687','get_klaverjas_live_state_public_v687',
       'save_klaverjas_match_v687','klaverjas_upsert_match_state_scoped',
       'klaverjas_get_live_match_public'
     )
)
insert into _v766_live_preflight(check_name,result,detail)
select 'function_behavior_fingerprint','INFO',
       coalesce(string_agg(
         proname||'('||args||'):'||
         ' session_guard='||(def like '%_jas_session_player%')::text||
         ', client_match_id='||(def like '%client_match_id%')::text||
         ', owner='||(def like '%created_by_player_id%' or def like '%owner%')::text||
         ', scope='||(def like '%site_scope%')::text||
         ', match_write='||(def like '%insert into public.klaverjas_matches%' or def like '%update public.klaverjas_matches%' or def like '%klaverjas_upsert_match_state_scoped%')::text||
         ', classic_write='||(def like '%insert into public.jas_games%' or def like '%create_jas_game%')::text,
         '; ' order by proname,args
       ),'no target functions deployed')
  from f;

-- Function execution ACLs. Public read functions may intentionally be executable; write functions
-- must remain non-PUBLIC after v765.
with f as (
  select p.oid,p.proname,pg_get_function_identity_arguments(p.oid) args,
         exists(
           select 1
             from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
            where a.grantee=0 and a.privilege_type='EXECUTE'
         ) public_exec,
         case when exists(select 1 from pg_roles where rolname='anon') then has_function_privilege('anon',p.oid,'EXECUTE') else false end anon_exec,
         case when exists(select 1 from pg_roles where rolname='authenticated') then has_function_privilege('authenticated',p.oid,'EXECUTE') else false end auth_exec
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in (
       'start_klaverjas_live_match_v687','update_klaverjas_live_match_v687',
       'finish_klaverjas_live_match_v687','get_klaverjas_live_state_public_v687',
       'save_klaverjas_match_v687','klaverjas_upsert_match_state_scoped',
       'klaverjas_get_live_match_public'
     )
)
insert into _v766_live_preflight(check_name,result,detail)
select 'rpc_execute_acl_inventory','INFO',
       coalesce(string_agg(proname||'('||args||'): PUBLIC='||public_exec::text||', anon='||anon_exec::text||', authenticated='||auth_exec::text, '; ' order by proname,args),'no target RPCs')
  from f;

-- v765 direct-DML boundary must still be intact before v766.
with grants as (
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
insert into _v766_live_preflight(check_name,result,detail)
select 'v765_direct_dml_boundary',
       case when count(*)=0 then 'PASS' else 'FAIL' end,
       case when count(*)=0 then 'web-role direct DML grants=0'
            else string_agg(table_name||':'||grantee||':'||privilege_type, ', ' order by table_name,grantee,privilege_type)
       end
  from grants;

-- Schema invariants required for safe text-client live aliases.
insert into _v766_live_preflight
select 'client_id_schema',
       case when
         exists(select 1 from information_schema.columns where table_schema='public' and table_name='klaverjas_matches' and column_name='client_match_id' and data_type='text')
         and exists(
           select 1
             from pg_constraint c join pg_class r on r.oid=c.conrelid join pg_namespace n on n.oid=r.relnamespace
            where n.nspname='public' and r.relname='klaverjas_matches' and c.contype='u'
              and pg_get_constraintdef(c.oid) ilike '%client_match_id%'
         )
         and exists(select 1 from information_schema.columns where table_schema='public' and table_name='klaverjas_matches' and column_name='created_by_player_id')
       then 'PASS' else 'FAIL' end,
       'requires client_match_id text UNIQUE + created_by_player_id';

-- Current legacy/live baseline without exposing player names or payloads.
insert into _v766_live_preflight
select 'legacy_live_baseline','PASS',
       'matches='||(select count(*) from public.klaverjas_matches)::text||
       ', active='||(select count(*) from public.klaverjas_matches where status='active' and deleted_at is null)::text||
       ', finished='||(select count(*) from public.klaverjas_matches where status='finished' and deleted_at is null)::text||
       ', abandoned='||(select count(*) from public.klaverjas_matches where status='abandoned' and deleted_at is null)::text||
       ', rounds='||(select count(*) from public.klaverjas_rounds)::text||
       ', snapshots='||(select count(*) from public.klaverjas_match_snapshots)::text;

-- v765 save function must still contain the session and ownership boundary.
with f as (
  select lower(pg_get_functiondef(p.oid)) def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='save_klaverjas_match_v687'
)
insert into _v766_live_preflight
select 'v765_save_guard',
       case when count(*)=1 and bool_and(def like '%_jas_session_player%' and def like '%created_by_player_id%' and def like '%client_match_id%') then 'PASS' else 'FAIL' end,
       case when count(*)=1 then 'save RPC present; session/owner/client-id guard fingerprint checked' else 'save RPC missing/ambiguous' end
  from f;

-- Controlled residue and push residue must be zero before any v766 proof.
insert into _v766_live_preflight
select 'controlled_v766_residue',
       case when count(*)=0 then 'PASS' else 'FAIL' end,
       'OC_V766 legacy match rows='||count(*)::text
  from public.klaverjas_matches
 where to_jsonb(klaverjas_matches)::text ilike '%OC_V766%';

insert into _v766_live_preflight
select 'controlled_v766_push_jobs',
       case when count(*)=0 then 'PASS' else 'FAIL' end,
       'OC_V766 push rows='||count(*)::text
  from public.web_push_jobs
 where to_jsonb(web_push_jobs)::text ilike '%OC_V766%';

insert into _v766_live_preflight
select 'ice_invariant',
       case when unit_value=2.8 then 'PASS' else 'FAIL' end,
       'Ice='||coalesce(unit_value::text,'missing')
  from public.drink_event_types
 where key='ice'
 limit 1;

select check_name,result,detail
  from _v766_live_preflight
 order by check_name;
