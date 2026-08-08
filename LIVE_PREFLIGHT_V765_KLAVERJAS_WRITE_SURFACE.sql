-- v765 Klaverjas finished-write surface preflight.
-- READ ONLY against persistent production data/catalogs.
-- Temp tables are session-local. No INSERT/UPDATE/DELETE is performed on public production tables.

create temp table if not exists _v765_klaverjas_preflight (
  check_name text primary key,
  result text not null,
  detail text not null
) on commit preserve rows;
truncate _v765_klaverjas_preflight;

-- Function inventory: current v687 path, compatibility fallback, historical classic save,
-- and live finish path. Missing functions are informational because the frontend has fallbacks.
with targets(name) as (
  values
    ('save_klaverjas_match_v687'::text),
    ('klaverjas_upsert_match_state_scoped'::text),
    ('create_jas_game'::text),
    ('finish_klaverjas_live_match_v687'::text),
    ('start_klaverjas_live_match_v687'::text)
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
insert into _v765_klaverjas_preflight(check_name,result,detail)
select 'function_'||name,
       case when count(oid)>0 then 'PASS' else 'INFO' end,
       case when count(oid)=0 then 'not deployed'
            else string_agg(name||'('||coalesce(args,'')||') SECURITY DEFINER='||prosecdef::text, '; ' order by args)
       end
  from f
 group by name;

-- Determine which current save path production can actually expose.
with f as (
  select proname
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and proname in ('save_klaverjas_match_v687','klaverjas_upsert_match_state_scoped','create_jas_game')
)
insert into _v765_klaverjas_preflight values (
  'deployed_save_path_inventory',
  case when exists(select 1 from f where proname='save_klaverjas_match_v687') then 'PASS'
       when exists(select 1 from f where proname='klaverjas_upsert_match_state_scoped') then 'REVIEW'
       else 'FAIL' end,
  'save_v687='||(exists(select 1 from f where proname='save_klaverjas_match_v687'))::text||
  ', fallback_upsert='||(exists(select 1 from f where proname='klaverjas_upsert_match_state_scoped'))::text||
  ', historical_create_jas_game='||(exists(select 1 from f where proname='create_jas_game'))::text
);

-- Static behavior fingerprints from deployed definitions. These do not claim the guard is
-- correct; they identify where a targeted review is required.
with f as (
  select proname,
         lower(pg_get_functiondef(p.oid)) as def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and proname in ('save_klaverjas_match_v687','klaverjas_upsert_match_state_scoped','create_jas_game','finish_klaverjas_live_match_v687')
)
insert into _v765_klaverjas_preflight(check_name,result,detail)
select 'function_behavior_fingerprint',
       'INFO',
       coalesce(string_agg(
         proname||': session_ref='||(
           def like '%session_token%' or def like '%_tier3_player_from_any_session%' or def like '%_jas_session_player%' or def like '%_gejast_player_from_session%'
         )::text||
         ', client_id_ref='||(def like '%client_match_id%')::text||
         ', owner_ref='||(
           def like '%created_by%' or def like '%owner%' or def like '%created_by_player_id%'
         )::text||
         ', jas_games_ref='||(def like '%jas_games%')::text||
         ', entries_ref='||(def like '%jas_game_entries%')::text||
         ', rating_ref='||(def like '%rating%')::text||
         ', rebuild_ref='||(def like '%rebuild%' or def like '%game_rating_rebuild_queue%')::text,
         '; ' order by proname
       ), 'no target functions deployed')
  from f;

-- Execution grants for the RPCs. PUBLIC is derived from the function ACL; anon/authenticated
-- use PostgreSQL privilege resolution so inherited/default grants are visible.
with f as (
  select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args,
         exists(
           select 1
             from aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
            where a.grantee=0 and a.privilege_type='EXECUTE'
         ) as public_exec,
         case when exists(select 1 from pg_roles where rolname='anon')
              then has_function_privilege('anon',p.oid,'EXECUTE') else false end as anon_exec,
         case when exists(select 1 from pg_roles where rolname='authenticated')
              then has_function_privilege('authenticated',p.oid,'EXECUTE') else false end as auth_exec
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('save_klaverjas_match_v687','klaverjas_upsert_match_state_scoped','create_jas_game','finish_klaverjas_live_match_v687','start_klaverjas_live_match_v687')
)
insert into _v765_klaverjas_preflight(check_name,result,detail)
select 'rpc_execute_acl_inventory',
       'INFO',
       coalesce(string_agg(proname||'('||args||'): PUBLIC='||public_exec::text||', anon='||anon_exec::text||', authenticated='||auth_exec::text, '; ' order by proname,args),'no target RPCs')
  from f;

-- Direct write grants on the primary Klaverjas persistence surfaces.
with grants as (
  select table_name, grantee, privilege_type
    from information_schema.table_privileges
   where table_schema='public'
     and table_name in ('jas_games','jas_game_entries','game_rating_rebuild_queue','klaverjas_online_games','klaverjas_online_player_stats')
     and grantee in ('PUBLIC','anon','authenticated')
     and privilege_type in ('INSERT','UPDATE','DELETE')
)
insert into _v765_klaverjas_preflight(check_name,result,detail)
select 'direct_table_dml_grants',
       case when count(*)=0 then 'PASS' else 'REVIEW' end,
       case when count(*)=0 then 'no PUBLIC/anon/authenticated INSERT/UPDATE/DELETE grants on target tables'
            else string_agg(table_name||':'||grantee||':'||privilege_type, ', ' order by table_name,grantee,privilege_type)
       end
  from grants;

-- RLS status is inventory, not a substitute for RPC authorization.
with rls as (
  select c.relname, c.relrowsecurity, c.relforcerowsecurity
    from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public'
     and c.relkind in ('r','p')
     and c.relname in ('jas_games','jas_game_entries','game_rating_rebuild_queue','klaverjas_online_games','klaverjas_online_player_stats')
)
insert into _v765_klaverjas_preflight(check_name,result,detail)
select 'rls_inventory','INFO',
       coalesce(string_agg(relname||': rls='||relrowsecurity::text||', force='||relforcerowsecurity::text, '; ' order by relname),'no target tables found')
  from rls;

-- Trigger names on persistence/rating surfaces. Trigger definitions are not printed to avoid
-- an oversized result, but the names tell us which effects need transaction-only proof.
with trg as (
  select c.relname as table_name, t.tgname
    from pg_trigger t
    join pg_class c on c.oid=t.tgrelid
    join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public'
     and not t.tgisinternal
     and c.relname in ('jas_games','jas_game_entries','game_rating_rebuild_queue','klaverjas_online_games','klaverjas_online_player_stats')
)
insert into _v765_klaverjas_preflight(check_name,result,detail)
select 'trigger_inventory','INFO',
       case when count(*)=0 then 'no non-internal triggers on target tables'
            else string_agg(table_name||'.'||tgname, ', ' order by table_name,tgname)
       end
  from trg;

-- Baseline counts for known tables. Dynamic SQL keeps the preflight robust if a compatibility
-- table is absent.
create temp table if not exists _v765_klaverjas_counts(
  table_name text primary key,
  row_count bigint not null
) on commit preserve rows;
truncate _v765_klaverjas_counts;

do $$
declare
  r record;
  n bigint;
begin
  for r in
    select relname
      from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
     where ns.nspname='public'
       and c.relkind in ('r','p')
       and (
         c.relname in ('jas_games','jas_game_entries','game_rating_rebuild_queue','klaverjas_online_games','klaverjas_online_player_stats')
         or c.relname ilike '%klaver%rating%'
         or c.relname ilike '%jas%rating%'
       )
     order by relname
  loop
    execute format('select count(*) from public.%I',r.relname) into n;
    insert into _v765_klaverjas_counts(table_name,row_count) values (r.relname,n)
    on conflict (table_name) do update set row_count=excluded.row_count;
  end loop;
end $$;

insert into _v765_klaverjas_preflight(check_name,result,detail)
select 'klaverjas_baseline_counts','INFO',
       coalesce(string_agg(table_name||'='||row_count::text, ', ' order by table_name),'no Klaverjas persistence/rating tables found')
  from _v765_klaverjas_counts;

-- Global v765 residue scan. This is expected to be zero before any controlled live proof.
create temp table if not exists _v765_global_scan(
  table_name text primary key,
  controlled_rows bigint not null
) on commit preserve rows;
truncate _v765_global_scan;

do $$
declare
  r record;
  n bigint;
begin
  for r in
    select quote_ident(ns.nspname) qschema, quote_ident(c.relname) qtable, c.relname table_name
      from pg_class c join pg_namespace ns on ns.oid=c.relnamespace
     where ns.nspname='public' and c.relkind in ('r','p')
     order by c.relname
  loop
    begin
      execute format('select count(*) from %s.%s t where to_jsonb(t)::text ilike %L',r.qschema,r.qtable,'%OC_V765%') into n;
      if n>0 then
        insert into _v765_global_scan(table_name,controlled_rows) values(r.table_name,n)
        on conflict(table_name) do update set controlled_rows=excluded.controlled_rows;
      end if;
    exception when others then
      null;
    end;
  end loop;
end $$;

insert into _v765_klaverjas_preflight(check_name,result,detail)
select 'controlled_v765_residue',
       case when coalesce(sum(controlled_rows),0)=0 then 'PASS' else 'FAIL' end,
       'OC_V765 rows='||coalesce(sum(controlled_rows),0)::text||'; '||coalesce(string_agg(table_name||'='||controlled_rows::text, ', ' order by table_name),'none')
  from _v765_global_scan;

-- No new real push should be created by a read-only audit.
insert into _v765_klaverjas_preflight(check_name,result,detail)
select 'controlled_v765_push_jobs',
       case when count(*)=0 then 'PASS' else 'FAIL' end,
       'OC_V765 push rows='||count(*)::text
  from public.web_push_jobs
 where to_jsonb(web_push_jobs)::text ilike '%OC_V765%';

-- Preserve the established global drinks invariant while auditing another game.
insert into _v765_klaverjas_preflight(check_name,result,detail)
select 'ice_invariant',
       case when unit_value=2.8 then 'PASS' else 'FAIL' end,
       'Ice='||coalesce(unit_value::text,'missing')
  from public.drink_event_types
 where key='ice'
 limit 1;

select check_name,result,detail
  from _v765_klaverjas_preflight
 order by check_name;
