begin;

create extension if not exists pgcrypto with schema extensions;

create or replace function public._coerce_bigint_input(input_text text)
returns bigint
language sql
immutable
as $$
  select case
    when trim(coalesce(input_text, '')) = '' then null
    when trim(input_text) ~ '^[0-9]+$' then trim(input_text)::bigint
    when trim(input_text) ~ '^\(?\s*[0-9]+' then substring(trim(input_text) from '^\(?\s*([0-9]+)')::bigint
    else null
  end;
$$;

create or replace function public.get_requestable_names()
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  with curated as (
    select distinct
      trim(au.display_name) as display_name,
      lower(trim(au.display_name)) as sort_name
    from public.allowed_usernames au
    where coalesce(trim(au.display_name), '') <> ''
      and lower(coalesce(au.status, 'available')) in ('available','reserved','approved_pending_activation','claimed','active')
      and (
        au.approved_by_admin_id is not null
        or au.player_id is not null
        or nullif(trim(coalesce(au.reserved_for_email, '')), '') is not null
        or nullif(trim(coalesce(au.reserved_for_person_note, '')), '') is not null
        or au.current_claim_request_id is not null
      )
  )
  select jsonb_build_object(
    'names', coalesce(jsonb_agg(display_name order by sort_name), '[]'::jsonb)
  )
  from curated;
$$;

create or replace function public.get_login_names()
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  with src as (
    select distinct
      trim(coalesce(au.display_name, p.display_name)) as display_name,
      lower(trim(coalesce(au.display_name, p.display_name))) as sort_name
    from public.allowed_usernames au
    left join public.players p on p.id = au.player_id
    where coalesce(trim(coalesce(au.display_name, p.display_name)), '') <> ''
      and lower(coalesce(au.status, '')) not in ('retired', 'deleted', 'blocked', 'suspended')
      and (
        au.player_id is not null
        or lower(coalesce(au.status, '')) in ('active', 'claimed', 'approved_pending_activation')
      )
  )
  select jsonb_build_object(
    'names', coalesce(jsonb_agg(display_name order by sort_name), '[]'::jsonb)
  )
  from src;
$$;

grant execute on function public.get_requestable_names() to anon, authenticated;
grant execute on function public.get_login_names() to anon, authenticated;

create or replace function public.admin_reserve_allowed_username(
  admin_session_token text,
  display_name_input text,
  reserved_for_email_input text default null,
  reserved_for_person_note_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  sess record;
  sess_json jsonb;
  v_id bigint;
  v_username text;
  v_admin_id bigint;
begin
  select * into sess from public._require_valid_admin_session(admin_session_token);
  sess_json := to_jsonb(sess);
  if coalesce((sess_json ->> 'ok')::boolean, false) is not true then
    raise exception 'Ongeldige admin-sessie';
  end if;
  if trim(coalesce(display_name_input, '')) = '' then
    raise exception 'Display name ontbreekt';
  end if;
  v_admin_id := nullif(coalesce(sess_json ->> 'admin_id', sess_json ->> 'id', sess_json ->> 'admin_user_id'), '')::bigint;
  v_username := public._normalize_allowed_username(display_name_input);
  if v_username = '' then
    raise exception 'Kon geen geldige username-slug maken';
  end if;

  insert into public.allowed_usernames (
    username, display_name, status, reserved_for_email, reserved_for_person_note, approved_by_admin_id, updated_at
  ) values (
    v_username,
    trim(display_name_input),
    case when nullif(trim(coalesce(reserved_for_email_input, '')), '') is null then 'available' else 'reserved' end,
    nullif(lower(trim(coalesce(reserved_for_email_input, ''))), ''),
    nullif(trim(coalesce(reserved_for_person_note_input, '')), ''),
    v_admin_id,
    now()
  )
  on conflict (username)
  do update set
    display_name = excluded.display_name,
    reserved_for_email = coalesce(excluded.reserved_for_email, public.allowed_usernames.reserved_for_email),
    reserved_for_person_note = coalesce(excluded.reserved_for_person_note, public.allowed_usernames.reserved_for_person_note),
    status = case
      when public.allowed_usernames.status in ('active', 'blocked', 'suspended') then public.allowed_usernames.status
      else excluded.status
    end,
    approved_by_admin_id = v_admin_id,
    updated_at = now()
  returning id into v_id;

  return jsonb_build_object('ok', true, 'allowed_username_id', v_id);
end;
$$;

grant execute on function public.admin_reserve_allowed_username(text, text, text, text) to anon, authenticated;

create or replace function public.create_player_activation_link_safe(
  admin_session_token text,
  request_id_input text,
  base_url text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id bigint;
  v_result jsonb;
begin
  v_id := public._coerce_bigint_input(request_id_input);
  if v_id is null then
    raise exception 'Kon request-id niet lezen';
  end if;
  execute 'select public.create_player_activation_link($1, $2::bigint, $3)'
    into v_result
    using admin_session_token, v_id, base_url;
  return v_result;
end;
$$;

create or replace function public.admin_decide_claim_request_safe(
  admin_session_token text,
  request_id_input text,
  decision text,
  decision_reason_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id bigint;
  v_result jsonb;
begin
  v_id := public._coerce_bigint_input(request_id_input);
  if v_id is null then
    raise exception 'Kon request-id niet lezen';
  end if;
  execute 'select public.admin_decide_claim_request($1, $2::bigint, $3, $4)'
    into v_result
    using admin_session_token, v_id, decision, decision_reason_input;
  return v_result;
end;
$$;

create or replace function public.admin_revoke_player_access_safe(
  admin_session_token text,
  request_id_input text,
  decision_reason_input text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id bigint;
  v_result jsonb;
begin
  v_id := public._coerce_bigint_input(request_id_input);
  if v_id is null then
    raise exception 'Kon request-id niet lezen';
  end if;
  execute 'select public.admin_revoke_player_access($1, $2::bigint, $3)'
    into v_result
    using admin_session_token, v_id, decision_reason_input;
  return v_result;
end;
$$;

create or replace function public.admin_requeue_expired_activation_safe(
  admin_session_token text,
  request_id_input text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id bigint;
  v_result jsonb;
begin
  v_id := public._coerce_bigint_input(request_id_input);
  if v_id is null then
    raise exception 'Kon request-id niet lezen';
  end if;
  execute 'select public.admin_requeue_expired_activation($1, $2::bigint)'
    into v_result
    using admin_session_token, v_id;
  return v_result;
end;
$$;

create or replace function public.admin_resend_expired_activation_safe(
  admin_session_token text,
  request_id_input text,
  base_url text
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_id bigint;
  v_result jsonb;
begin
  v_id := public._coerce_bigint_input(request_id_input);
  if v_id is null then
    raise exception 'Kon request-id niet lezen';
  end if;
  execute 'select public.admin_resend_expired_activation($1, $2::bigint, $3)'
    into v_result
    using admin_session_token, v_id, base_url;
  return v_result;
end;
$$;

create or replace function public.create_player_activation_link(
  admin_session_token text,
  request_id_input text,
  base_url text
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select public.create_player_activation_link_safe(admin_session_token, request_id_input, base_url);
$$;

create or replace function public.admin_decide_claim_request(
  admin_session_token text,
  request_id_input text,
  decision text,
  decision_reason_input text default null
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select public.admin_decide_claim_request_safe(admin_session_token, request_id_input, decision, decision_reason_input);
$$;

create or replace function public.admin_revoke_player_access(
  admin_session_token text,
  request_id_input text,
  decision_reason_input text default null
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select public.admin_revoke_player_access_safe(admin_session_token, request_id_input, decision_reason_input);
$$;

create or replace function public.admin_requeue_expired_activation(
  admin_session_token text,
  request_id_input text
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select public.admin_requeue_expired_activation_safe(admin_session_token, request_id_input);
$$;

create or replace function public.admin_resend_expired_activation(
  admin_session_token text,
  request_id_input text,
  base_url text
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select public.admin_resend_expired_activation_safe(admin_session_token, request_id_input, base_url);
$$;

revoke execute on function public.create_player_activation_link(text, bigint, text) from anon, authenticated;
revoke execute on function public.admin_decide_claim_request(text, bigint, text, text) from anon, authenticated;
revoke execute on function public.admin_revoke_player_access(text, bigint, text) from anon, authenticated;
revoke execute on function public.admin_requeue_expired_activation(text, bigint) from anon, authenticated;
revoke execute on function public.admin_resend_expired_activation(text, bigint, text) from anon, authenticated;

grant execute on function public.create_player_activation_link_safe(text, text, text) to anon, authenticated;
grant execute on function public.admin_decide_claim_request_safe(text, text, text, text) to anon, authenticated;
grant execute on function public.admin_revoke_player_access_safe(text, text, text) to anon, authenticated;
grant execute on function public.admin_requeue_expired_activation_safe(text, text) to anon, authenticated;
grant execute on function public.admin_resend_expired_activation_safe(text, text, text) to anon, authenticated;

grant execute on function public.create_player_activation_link(text, text, text) to anon, authenticated;
grant execute on function public.admin_decide_claim_request(text, text, text, text) to anon, authenticated;
grant execute on function public.admin_revoke_player_access(text, text, text) to anon, authenticated;
grant execute on function public.admin_requeue_expired_activation(text, text) to anon, authenticated;
grant execute on function public.admin_resend_expired_activation(text, text, text) to anon, authenticated;

notify pgrst, 'reload schema';

commit;
