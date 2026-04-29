-- GEJAST v688 login dropdown complete SQL bundle
-- Safe to rerun in Supabase SQL editor.
-- Contains only required selector/helper functions and the v687-compatible login names RPC.

begin;

create or replace function public._gejast_phase5_norm_scope(site_scope_input text default null)
returns text
language sql
stable
as $fn$
  select case when lower(coalesce(nullif(btrim(site_scope_input), ''), 'friends')) = 'family' then 'family' else 'friends' end
$fn$;

create or replace function public._gejast_phase5_json_text(row_data jsonb, keys text[])
returns text
language plpgsql
stable
as $fn$
declare
  k text;
  v text;
begin
  foreach k in array keys loop
    v := nullif(btrim(coalesce(row_data ->> k, '')), '');
    if v is not null then
      return v;
    end if;
  end loop;
  return null;
end
$fn$;

create or replace function public._gejast_phase5_json_bool(row_data jsonb, keys text[])
returns boolean
language plpgsql
stable
as $fn$
declare
  k text;
  v text;
begin
  foreach k in array keys loop
    v := lower(nullif(btrim(coalesce(row_data ->> k, '')), ''));
    if v in ('true','t','1','yes','y','active','activated','approved') then return true; end if;
    if v in ('false','f','0','no','n') then return false; end if;
  end loop;
  return false;
end
$fn$;

create or replace function public._gejast_phase5_pick_rows(table_name text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_reg regclass;
  v_rows jsonb := '[]'::jsonb;
begin
  v_reg := to_regclass(table_name);
  if v_reg is null then
    return '[]'::jsonb;
  end if;
  execute format('select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from %s t', v_reg) into v_rows;
  return coalesce(v_rows, '[]'::jsonb);
exception when others then
  return '[]'::jsonb;
end
$fn$;

create or replace function public.get_player_selector_source_v1(
  session_token text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._gejast_phase5_norm_scope(site_scope_input);
  v_tables text[] := array['public.allowed_usernames','public.players','public.player_profiles','public.profiles'];
  v_table text;
  v_all_rows jsonb := '[]'::jsonb;
  v_source_rows jsonb;
  r jsonb;
  v_row_scope text;
  v_name text;
  v_status text;
  v_is_active boolean;
  v_is_requestable boolean;
  v_activated jsonb := '[]'::jsonb;
  v_requestable jsonb := '[]'::jsonb;
  v_rows jsonb := '[]'::jsonb;
  v_seen_active jsonb := '{}'::jsonb;
  v_seen_requestable jsonb := '{}'::jsonb;
begin
  foreach v_table in array v_tables loop
    v_source_rows := public._gejast_phase5_pick_rows(v_table);
    if jsonb_array_length(v_source_rows) > 0 then
      v_all_rows := v_all_rows || (
        select coalesce(jsonb_agg(x || jsonb_build_object('_phase5_source_table', v_table)), '[]'::jsonb)
        from jsonb_array_elements(v_source_rows) as e(x)
      );
    end if;
  end loop;

  for r in select value from jsonb_array_elements(v_all_rows) loop
    v_row_scope := public._gejast_phase5_norm_scope(public._gejast_phase5_json_text(r, array['site_scope','scope','group_scope','site_scope_input','scope_input']));
    if v_row_scope <> v_scope then
      continue;
    end if;

    v_name := public._gejast_phase5_json_text(r, array['public_display_name','chosen_username','nickname','display_name','player_name','desired_name','name','label','slug','username']);
    if v_name is null then
      continue;
    end if;
    v_name := regexp_replace(v_name, '\s+', ' ', 'g');
    v_status := lower(coalesce(public._gejast_phase5_json_text(r, array['status','activation_status','account_status','state','player_status','request_status']), ''));

    v_is_active := public._gejast_phase5_json_bool(r, array['has_pin','pin_is_set','pin_set','has_password','password_set','activation_completed','is_activated','activated','is_active','account_activated'])
      or v_status in ('active','approved','activated','legacy','legacy_active','legacy-approved','legacy_approved')
      or v_status like '%legacy%';

    v_is_requestable := v_status in ('available','requestable','open','free','claimable','unclaimed')
      or public._gejast_phase5_json_bool(r, array['is_requestable','requestable','claimable','available']);

    if v_is_active and not (v_seen_active ? lower(v_name)) then
      v_seen_active := v_seen_active || jsonb_build_object(lower(v_name), true);
      v_activated := v_activated || to_jsonb(v_name);
    end if;

    if v_is_requestable and not (v_seen_requestable ? lower(v_name)) then
      v_seen_requestable := v_seen_requestable || jsonb_build_object(lower(v_name), true);
      v_requestable := v_requestable || to_jsonb(v_name);
    end if;

    v_rows := v_rows || jsonb_build_array(jsonb_build_object(
      'name', v_name,
      'scope', v_scope,
      'status', nullif(v_status, ''),
      'is_active', v_is_active,
      'is_requestable', v_is_requestable,
      'source_table', coalesce(r ->> '_phase5_source_table', 'unknown')
    ));
  end loop;

  return jsonb_build_object(
    'ok', true,
    'phase', 5,
    'scope', v_scope,
    'activated_names', coalesce((select jsonb_agg(value order by lower(value::text)) from jsonb_array_elements_text(v_activated) as t(value)), '[]'::jsonb),
    'requestable_names', coalesce((select jsonb_agg(value order by lower(value::text)) from jsonb_array_elements_text(v_requestable) as t(value)), '[]'::jsonb),
    'rows', v_rows,
    'source_tables_checked', to_jsonb(v_tables),
    'generated_at', now()
  );
end
$fn$;

revoke all on function public.get_player_selector_source_v1(text,text) from public;
grant execute on function public.get_player_selector_source_v1(text,text) to anon, authenticated;

-- v688 compatibility wrapper expected by login.html/gejast-account-runtime.js.
-- Supabase/Postgres cannot change an existing function's return type with
-- CREATE OR REPLACE, so drop this wrapper first. It has no dependent objects
-- in this bundle and the browser only needs the recreated RPC endpoint.
drop function if exists public.get_login_active_names_v687(text);

create or replace function public.get_login_active_names_v687(
  site_scope_input text default 'friends'
)
returns table(display_name text)
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := case when lower(coalesce(nullif(btrim(site_scope_input), ''), 'friends')) = 'family' then 'family' else 'friends' end;
  v_selector jsonb;
begin
  if to_regprocedure('public.get_player_selector_source_v1(text,text)') is not null then
    select public.get_player_selector_source_v1(null, v_scope) into v_selector;
    return query
      select distinct btrim(value)::text as display_name
      from jsonb_array_elements_text(coalesce(v_selector -> 'activated_names', '[]'::jsonb)) as t(value)
      where nullif(btrim(value), '') is not null
      order by btrim(value);
    return;
  end if;

  return;
end
$fn$;

revoke all on function public.get_login_active_names_v687(text) from public;
grant execute on function public.get_login_active_names_v687(text) to anon, authenticated;

commit;
