-- v792a Online Klaverjas privacy/security preflight.
-- READ ONLY against persistent production data. Temp tables are session-local.
-- This script does not apply the v792a migration and performs no production table writes.

create temp table if not exists _v792a_klaverjas_preflight (
  check_name text primary key,
  result text not null,
  detail text not null
) on commit preserve rows;
truncate _v792a_klaverjas_preflight;

with targets(name) as (
  values
    ('_klaverjas_online_public'::text),
    ('_klaverjas_online_player_active_room'::text),
    ('klaverjas_online_get_state'::text),
    ('klaverjas_online_save_state'::text),
    ('klaverjas_online_cleanup_rooms'::text),
    ('klaverjas_online_delete_room'::text)
), f as (
  select t.name, p.oid, pg_get_function_identity_arguments(p.oid) as args, p.prosecdef,
         lower(pg_get_functiondef(p.oid)) as def
    from targets t
    left join pg_proc p on p.proname=t.name
    left join pg_namespace n on n.oid=p.pronamespace and n.nspname='public'
   where p.oid is null or n.nspname='public'
)
insert into _v792a_klaverjas_preflight(check_name,result,detail)
select 'function_'||name,
       case when count(oid)>0 then 'PASS' else 'FAIL' end,
       case when count(oid)=0 then 'not deployed'
            else string_agg(name||'('||coalesce(args,'')||') SECURITY DEFINER='||prosecdef::text, '; ' order by args)
       end
  from f
 group by name;

with f as (
  select p.oid, p.proname, pg_get_function_identity_arguments(p.oid) as args,
         exists(
           select 1 from aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
            where a.grantee=0 and a.privilege_type='EXECUTE'
         ) as public_exec,
         case when exists(select 1 from pg_roles where rolname='anon')
              then has_function_privilege('anon',p.oid,'EXECUTE') else false end as anon_exec,
         case when exists(select 1 from pg_roles where rolname='authenticated')
              then has_function_privilege('authenticated',p.oid,'EXECUTE') else false end as auth_exec,
         case when exists(select 1 from pg_roles where rolname='service_role')
              then has_function_privilege('service_role',p.oid,'EXECUTE') else false end as service_exec
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('_klaverjas_online_public','_klaverjas_online_player_active_room','klaverjas_online_get_state','klaverjas_online_save_state','klaverjas_online_cleanup_rooms','klaverjas_online_delete_room')
)
insert into _v792a_klaverjas_preflight(check_name,result,detail)
select 'rpc_execute_acl_inventory','INFO',
       coalesce(string_agg(proname||'('||args||'): PUBLIC='||public_exec::text||', anon='||anon_exec::text||', authenticated='||auth_exec::text||', service_role='||service_exec::text, '; ' order by proname,args),'no target functions')
  from f;

with grants as (
  select grantee, privilege_type
    from information_schema.table_privileges
   where table_schema='public'
     and table_name='klaverjas_online_games'
     and grantee in ('PUBLIC','anon','authenticated')
)
insert into _v792a_klaverjas_preflight(check_name,result,detail)
select 'online_games_web_grants',
       case when count(*) filter(where privilege_type='SELECT')=0 then 'PASS' else 'REVIEW' end,
       case when count(*)=0 then 'no direct PUBLIC/anon/authenticated table grants'
            else string_agg(grantee||':'||privilege_type, ', ' order by grantee,privilege_type)
       end
  from grants;

insert into _v792a_klaverjas_preflight(check_name,result,detail)
select 'online_games_rls','INFO',
       'rls='||c.relrowsecurity::text||', force='||c.relforcerowsecurity::text
  from pg_class c join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public' and c.relname='klaverjas_online_games' and c.relkind in ('r','p');

with f as (
  select p.proname, lower(pg_get_functiondef(p.oid)) as def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in ('_klaverjas_online_public','klaverjas_online_save_state','klaverjas_online_cleanup_rooms')
)
insert into _v792a_klaverjas_preflight(check_name,result,detail)
select 'deployed_behavior_fingerprint','INFO',
       coalesce(string_agg(
         proname||': recovery_snapshot='||(def like '%recovery_snapshot%')::text||
         ', recovery_hand_redaction='||(def like '%redacted_recovery_hands%')::text||
         ', roster_mutation_guard='||(def like '%klaverjas_online_roster_mutation_rejected%')::text||
         ', viewer_gate='||(def like '%viewer_seat is not null%')::text||
         ', close_all='||(def like '%close_all%')::text,
         '; ' order by proname
       ), 'no target definitions')
  from f;

with p as (
  select p.oid,
         exists(
           select 1 from aclexplode(coalesce(p.proacl, acldefault('f',p.proowner))) a
            where a.grantee=0 and a.privilege_type='EXECUTE'
         ) as public_exec,
         case when exists(select 1 from pg_roles where rolname='anon')
              then has_function_privilege('anon',p.oid,'EXECUTE') else false end as anon_exec,
         case when exists(select 1 from pg_roles where rolname='authenticated')
              then has_function_privilege('authenticated',p.oid,'EXECUTE') else false end as auth_exec,
         case when exists(select 1 from pg_roles where rolname='service_role')
              then has_function_privilege('service_role',p.oid,'EXECUTE') else false end as service_exec
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname='klaverjas_online_cleanup_rooms'
     and pg_get_function_identity_arguments(p.oid)='site_scope_input text, close_all boolean'
   limit 1
)
insert into _v792a_klaverjas_preflight(check_name,result,detail)
select 'cleanup_acl_target',
       case when not public_exec and not anon_exec and not auth_exec and service_exec then 'PASS' else 'REPAIR_FIRST' end,
       'PUBLIC='||public_exec::text||', anon='||anon_exec::text||', authenticated='||auth_exec::text||', service_role='||service_exec::text
  from p;

with f as (
  select lower(pg_get_functiondef(p.oid)) as def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='_klaverjas_online_public'
   order by p.oid desc limit 1
)
insert into _v792a_klaverjas_preflight(check_name,result,detail)
select 'nested_hand_redaction_target',
       case when def like '%recovery_snapshot%' and def like '%redacted_recovery_hands%' and def like '%viewer_seat is not null%' then 'PASS' else 'REPAIR_FIRST' end,
       'recovery_snapshot='||(def like '%recovery_snapshot%')::text||', nested_redaction='||(def like '%redacted_recovery_hands%')::text||', viewer_gate='||(def like '%viewer_seat is not null%')::text
  from f;

with f as (
  select lower(pg_get_functiondef(p.oid)) as def
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proname='klaverjas_online_save_state'
   order by p.oid desc limit 1
)
insert into _v792a_klaverjas_preflight(check_name,result,detail)
select 'roster_integrity_target',
       case when def like '%klaverjas_online_roster_mutation_rejected%' and def like '%klaverjas_online_roster_addition_rejected%' then 'PASS' else 'REPAIR_FIRST' end,
       'mutation_guard='||(def like '%klaverjas_online_roster_mutation_rejected%')::text||', addition_guard='||(def like '%klaverjas_online_roster_addition_rejected%')::text
  from f;

select check_name,result,detail
  from _v792a_klaverjas_preflight
 order by check_name;
