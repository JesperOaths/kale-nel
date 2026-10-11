-- Step 3: audited production hardening mirror (2026-10-11).
-- Database changes were applied and verified in the connected Supabase project.
-- No credential values, personal records, or legacy function bodies are included.
begin;

create schema if not exists security_audit authorization postgres;
revoke all on schema security_audit from public, anon, authenticated, service_role;

create table if not exists security_audit.function_hardening_20261011 (
  function_oid oid primary key,
  function_signature text not null,
  previous_acl aclitem[],
  previous_config text[],
  previous_definer boolean not null,
  recorded_at timestamptz not null default now()
);
revoke all on security_audit.function_hardening_20261011 from public,anon,authenticated,service_role;

insert into security_audit.function_hardening_20261011
  (function_oid,function_signature,previous_acl,previous_config,previous_definer)
select p.oid,p.oid::regprocedure::text,p.proacl,p.proconfig,p.prosecdef
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public'
and ((p.prosecdef and p.proconfig is null)
 or p.proname in ('_badge_verified_drink_rows','_badge_verified_speed_rows','paardenrace_cleanup_idle_lobbies_v621')
 or (p.proname='despimarkt_run_background_maintenance'
   and pg_get_function_identity_arguments(p.oid)=''))
on conflict(function_oid) do nothing;

-- Pin paths for all remaining DEFIner routines that lack a fixed path.
do $$
declare r record;
begin
 for r in select p.oid::regprocedure as signature
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prosecdef and p.proconfig is null
 loop
   execute format('alter function %s set search_path = pg_catalog, public, extensions, pg_temp',r.signature);
 end loop;
end $$;

-- These four old/helper interfaces don't need direct anonymous invocation.
-- Privileged internal function-to-function calls remain permitted.
revoke execute on function public._badge_verified_drink_rows(text)
  from public, anon, authenticated;
revoke execute on function public._badge_verified_speed_rows(text)
  from public, anon, authenticated;
revoke execute on function public.paardenrace_cleanup_idle_lobbies_v621()
  from public, anon, authenticated;
revoke execute on function public.despimarkt_run_background_maintenance()
  from public, anon, authenticated;

create table if not exists security_audit.invoker_search_path_backup_20261011(
  function_oid oid primary key,
  signature text not null,
  old_config text[],
  old_acl aclitem[],
  saved_at timestamptz not null default now()
);
revoke all on security_audit.invoker_search_path_backup_20261011
  from public,anon,authenticated,service_role;

insert into security_audit.invoker_search_path_backup_20261011(function_oid,signature,old_config,old_acl)
select p.oid,p.oid::regprocedure::text,p.proconfig,p.proacl
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where n.nspname='public' and p.proconfig is null
  and not p.prosecdef and p.proowner='postgres'::regrole
on conflict(function_oid) do nothing;

do $$
declare r record;
begin
 for r in select p.oid::regprocedure as signature
   from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proconfig is null
     and not p.prosecdef and p.proowner='postgres'::regrole
 loop
   execute format('alter function %s set search_path = pg_catalog, public, extensions, pg_temp',r.signature);
 end loop;
end $$;

create or replace view security_audit.posture_v1
with (security_invoker = true) as
select now() as observed_at,
 (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r')::int as public_tables,
 (select count(*) from pg_class c join pg_namespace n on n.oid=c.relnamespace
   where n.nspname='public' and c.relkind='r' and c.relrowsecurity)::int as public_tables_rls,
 (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.prosecdef and has_function_privilege('anon',p.oid,'EXECUTE'))::int as anon_definer_count,
 (select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public' and p.proconfig is null)::int as missing_fixed_search_paths,
 (select count(*) from security_audit.function_hardening_20261011)::int as targeted_function_backups,
 (select count(*) from security_audit.invoker_search_path_backup_20261011)::int as invoker_function_backups;
revoke all on security_audit.posture_v1 from public,anon,authenticated,service_role;

commit;
