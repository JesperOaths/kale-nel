-- GEJAST session/runtime audit v550a
-- Read-only inspection script for Supabase SQL editor.
-- Purpose: verify whether the live database has a server-side session-expiry owner path
-- underneath the frontend/session fixes, and whether player_touch_session exists.

begin;

-- 1) Session-related functions that likely own auth/session truth.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_args,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    p.proname ilike '%session%'
    or p.proname in (
      'get_public_state',
      'player_touch_session',
      '_gejast_player_from_session',
      '_resolve_player_id_from_session_token'
    )
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- 2) Table/view names that look session-related.
select
  table_schema,
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
  and (
    table_name ilike '%session%'
    or table_name ilike '%login%'
    or table_name ilike '%token%'
  )
order by table_name;

-- 3) Column-level view of session-like tables.
select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and (
    table_name ilike '%session%'
    or table_name ilike '%login%'
    or table_name ilike '%token%'
  )
order by table_name, ordinal_position;

-- 4) Check whether the canonical client-side RPC exists.
select
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'player_touch_session'
  ) as has_player_touch_session;

-- 5) If public.sessions exists, show its row count.
select
  case
    when to_regclass('public.sessions') is null then null
    else (select count(*)::bigint from public.sessions)
  end as sessions_row_count;

-- 6) If public.sessions exists, show its columns again in a compact JSON view.
select jsonb_agg(jsonb_build_object(
  'column_name', c.column_name,
  'data_type', c.data_type,
  'is_nullable', c.is_nullable,
  'column_default', c.column_default
) order by c.ordinal_position) as public_sessions_columns
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'sessions';

-- 7) Timestamp-like columns in public.sessions that could control expiry.
select
  c.column_name,
  c.data_type,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'sessions'
  and (
    c.column_name ilike '%expire%'
    or c.column_name ilike '%touch%'
    or c.column_name ilike '%seen%'
    or c.column_name ilike '%active%'
    or c.column_name ilike '%updated%'
    or c.column_name ilike '%created%'
    or c.column_name ilike '%valid%'
  )
order by c.ordinal_position;

-- 8) Session-like cleanup triggers or trigger functions.
select
  event_object_table as table_name,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where trigger_schema = 'public'
  and (
    event_object_table ilike '%session%'
    or trigger_name ilike '%session%'
    or action_statement ilike '%session%'
  )
order by event_object_table, trigger_name;

-- 9) Policies that mention sessions or session-like tables.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and (
    tablename ilike '%session%'
    or coalesce(qual,'') ilike '%session%'
    or coalesce(with_check,'') ilike '%session%'
  )
order by tablename, policyname;

rollback;
