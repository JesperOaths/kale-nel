begin;

create or replace function public.get_requestable_names()
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  with src as (
    select distinct
      trim(au.display_name) as display_name,
      lower(trim(au.display_name)) as sort_name
    from public.allowed_usernames au
    where coalesce(trim(au.display_name), '') <> ''
      and lower(coalesce(au.status, 'available')) not in ('retired', 'deleted', 'blocked', 'suspended')
  )
  select jsonb_build_object(
    'names', coalesce(jsonb_agg(display_name order by sort_name), '[]'::jsonb)
  )
  from src;
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
      and (
        lower(coalesce(au.status, '')) in ('active', 'claimed', 'approved_pending_activation')
        or au.player_id is not null
      )
      and lower(coalesce(au.status, '')) not in ('retired', 'deleted', 'blocked', 'suspended')
  )
  select jsonb_build_object(
    'names', coalesce(jsonb_agg(display_name order by sort_name), '[]'::jsonb)
  )
  from src;
$$;

drop function if exists public.admin_reserve_allowed_username(text, text, text, text);
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
    username,
    display_name,
    status,
    reserved_for_email,
    reserved_for_person_note,
    approved_by_admin_id
  )
  values (
    v_username,
    trim(display_name_input),
    case when nullif(trim(coalesce(reserved_for_email_input, '')), '') is null then 'available' else 'reserved' end,
    nullif(lower(trim(coalesce(reserved_for_email_input, ''))), ''),
    nullif(trim(coalesce(reserved_for_person_note_input, '')), ''),
    v_admin_id
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

  if to_regprocedure('public._log_username_event(bigint,text,bigint,bigint,jsonb)') is not null then
    perform public._log_username_event(
      v_id,
      'username_reserved',
      v_admin_id,
      null,
      jsonb_build_object('reserved_for_email', nullif(lower(trim(coalesce(reserved_for_email_input, ''))), ''))
    );
  end if;

  return jsonb_build_object('ok', true, 'allowed_username_id', v_id);
end;
$$;

create or replace function public.admin_remove_allowed_username(
  admin_session_token text,
  allowed_username_id_input bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  sess record;
  sess_json jsonb;
  v_admin_id bigint;
  v_row record;
begin
  select * into sess from public._require_valid_admin_session(admin_session_token);
  sess_json := to_jsonb(sess);
  if coalesce((sess_json ->> 'ok')::boolean, false) is not true then
    raise exception 'Ongeldige admin-sessie';
  end if;

  if allowed_username_id_input is null then
    raise exception 'allowed_username_id ontbreekt';
  end if;

  v_admin_id := nullif(coalesce(sess_json ->> 'admin_id', sess_json ->> 'id', sess_json ->> 'admin_user_id'), '')::bigint;

  select * into v_row
  from public.allowed_usernames
  where id = allowed_username_id_input;

  if not found then
    raise exception 'Naam niet gevonden';
  end if;

  if v_row.player_id is null and v_row.current_claim_request_id is null then
    delete from public.allowed_usernames
    where id = allowed_username_id_input;

    if to_regprocedure('public._log_username_event(bigint,text,bigint,bigint,jsonb)') is not null then
      perform public._log_username_event(
        allowed_username_id_input,
        'username_deleted',
        v_admin_id,
        null,
        jsonb_build_object('display_name', v_row.display_name)
      );
    end if;

    return jsonb_build_object('ok', true, 'removed', true, 'mode', 'deleted');
  end if;

  update public.allowed_usernames
  set status = 'retired',
      updated_at = now(),
      approved_by_admin_id = v_admin_id
  where id = allowed_username_id_input;

  if to_regprocedure('public._log_username_event(bigint,text,bigint,bigint,jsonb)') is not null then
    perform public._log_username_event(
      allowed_username_id_input,
      'username_retired',
      v_admin_id,
      null,
      jsonb_build_object('display_name', v_row.display_name)
    );
  end if;

  return jsonb_build_object('ok', true, 'removed', true, 'mode', 'retired');
end;
$$;

create or replace function public.admin_get_allowed_usernames(admin_session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  sess record;
  sess_json jsonb;
begin
  select * into sess from public._require_valid_admin_session(admin_session_token);
  sess_json := to_jsonb(sess);
  if coalesce((sess_json ->> 'ok')::boolean, false) is not true then
    raise exception 'Ongeldige admin-sessie';
  end if;

  return jsonb_build_object(
    'items', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', au.id,
        'username', au.username,
        'display_name', au.display_name,
        'status', au.status,
        'reserved_for_email', au.reserved_for_email,
        'reserved_for_person_note', au.reserved_for_person_note,
        'player_id', au.player_id,
        'current_claim_request_id', au.current_claim_request_id,
        'updated_at', au.updated_at
      ) order by lower(au.display_name), au.id)
      from public.allowed_usernames au
      where lower(coalesce(au.status, 'available')) not in ('retired', 'deleted')
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.get_requestable_names() to anon, authenticated;
grant execute on function public.get_login_names() to anon, authenticated;
grant execute on function public.admin_reserve_allowed_username(text, text, text, text) to anon, authenticated;
grant execute on function public.admin_remove_allowed_username(text, bigint) to anon, authenticated;
grant execute on function public.admin_get_allowed_usernames(text) to anon, authenticated;

commit;
