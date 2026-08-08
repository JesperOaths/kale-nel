-- v765 final read-only capture for the active Klaverjas compatibility persistence path.
-- READ ONLY. No production table writes.
-- Captures the legacy match schema, indexes/constraints/RLS/grants, session resolver,
-- and v687 read surfaces needed to implement save_klaverjas_match_v687 without guessing.

with f as (
  select p.proname,
         pg_get_function_identity_arguments(p.oid) as args,
         p.prosecdef,
         pg_get_functiondef(p.oid) as definition
    from pg_proc p
    join pg_namespace n on n.oid=p.pronamespace
   where n.nspname='public'
     and p.proname in (
       '_jas_session_player',
       '_klaverjas_safe_scope',
       'get_klaverjas_runtime_bundle_v687',
       'get_klaverjas_leaderboard_public_v687',
       'klaverjas_get_live_match_public'
     )
)
select 'function_definition'::text as section,
       proname as item,
       args as identity,
       'security_definer='||prosecdef::text as metadata,
       definition as detail
  from f
union all
select 'table_columns',
       c.table_name,
       c.column_name||' '||c.data_type,
       'nullable='||c.is_nullable||coalesce(', default='||c.column_default,''),
       ''
  from information_schema.columns c
 where c.table_schema='public'
   and c.table_name in (
     'klaverjas_matches',
     'klaverjas_rounds',
     'klaverjas_match_snapshots'
   )
union all
select 'constraints',
       rel.relname,
       con.conname,
       con.contype::text,
       pg_get_constraintdef(con.oid)
  from pg_constraint con
  join pg_class rel on rel.oid=con.conrelid
  join pg_namespace n on n.oid=rel.relnamespace
 where n.nspname='public'
   and rel.relname in (
     'klaverjas_matches',
     'klaverjas_rounds',
     'klaverjas_match_snapshots'
   )
union all
select 'index_definition',
       tablename,
       indexname,
       '',
       indexdef
  from pg_indexes
 where schemaname='public'
   and tablename in (
     'klaverjas_matches',
     'klaverjas_rounds',
     'klaverjas_match_snapshots'
   )
union all
select 'rls',
       c.relname,
       '',
       'rls='||c.relrowsecurity::text||', force='||c.relforcerowsecurity::text,
       ''
  from pg_class c
  join pg_namespace n on n.oid=c.relnamespace
 where n.nspname='public'
   and c.relkind in ('r','p')
   and c.relname in (
     'klaverjas_matches',
     'klaverjas_rounds',
     'klaverjas_match_snapshots'
   )
union all
select 'dml_grant',
       table_name,
       grantee,
       privilege_type,
       ''
  from information_schema.table_privileges
 where table_schema='public'
   and table_name in (
     'klaverjas_matches',
     'klaverjas_rounds',
     'klaverjas_match_snapshots'
   )
   and grantee in ('PUBLIC','anon','authenticated')
   and privilege_type in ('INSERT','UPDATE','DELETE')
union all
select 'row_count',
       'klaverjas_matches',
       'count',
       '',
       count(*)::text
  from public.klaverjas_matches
union all
select 'row_count',
       'klaverjas_rounds',
       'count',
       '',
       count(*)::text
  from public.klaverjas_rounds
union all
select 'row_count',
       'klaverjas_match_snapshots',
       'count',
       '',
       count(*)::text
  from public.klaverjas_match_snapshots
union all
select 'baseline',
       'ice',
       'unit_value',
       '',
       coalesce((select unit_value::text from public.drink_event_types where key='ice' limit 1),'missing')
union all
select 'baseline',
       'controlled_v765_push_jobs',
       'expected_zero',
       '',
       (select count(*)::text from public.web_push_jobs where to_jsonb(web_push_jobs)::text ilike '%OC_V765%')
order by section,item,identity;
