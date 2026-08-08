-- GEJAST v755n: admin allowed-username security guard (PREPARED ONLY).
-- Do not apply to production until reviewed/approved.
--
-- Evidence from controlled matrix 2026-08-08:
--   * admin_reserve_allowed_username correctly rejected an invalid admin token.
--   * admin_remove_allowed_username accepted an invalid admin token because it only performed
--     admin_check_session(...) and did not require the returned JSON ok=true.
--   * public REST DELETE on allowed_usernames succeeded for an exact controlled row.
--
-- Minimal SQL-only repair:
--   * require admin_check_session(...).ok before mutating in remove/permanent-delete functions
--   * revoke direct table DML on allowed_usernames from public web roles; keep RPC execute grants

begin;

create or replace function public.admin_remove_allowed_username(
  admin_session_token text,
  allowed_username_id_input bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_admin_state jsonb;
  v_row record;
begin
  if to_regprocedure('public.admin_check_session(text)') is null then
    raise exception 'admin_check_session_missing';
  end if;

  select to_jsonb(public.admin_check_session(admin_session_token)) into v_admin_state;
  if coalesce((v_admin_state->>'ok')::boolean, false) is not true then
    raise exception 'Ongeldige admin-sessie';
  end if;

  if allowed_username_id_input is null then
    raise exception 'allowed_username_id ontbreekt';
  end if;

  select * into v_row from public.allowed_usernames where id = allowed_username_id_input;
  if not found then
    raise exception 'Naam niet gevonden';
  end if;

  perform public._clear_player_account_access(v_row.player_id);

  update public.allowed_usernames
     set status = 'archived',
         reserved_for_email = null,
         updated_at = now()
   where id = allowed_username_id_input;

  return jsonb_build_object('ok', true, 'removed', true, 'mode', 'archived_account', 'player_id', v_row.player_id);
end;
$fn$;

create or replace function public.admin_permanently_delete_allowed_username(
  admin_session_token text,
  allowed_username_id_input bigint
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_admin_state jsonb;
  v_row record;
  v_old_name text;
  v_placeholder text;
  v_sets text[] := array[]::text[];
  v_sql text;
  v_slug text;
begin
  if to_regprocedure('public.admin_check_session(text)') is null then
    raise exception 'admin_check_session_missing';
  end if;

  select to_jsonb(public.admin_check_session(admin_session_token)) into v_admin_state;
  if coalesce((v_admin_state->>'ok')::boolean, false) is not true then
    raise exception 'Ongeldige admin-sessie';
  end if;

  if allowed_username_id_input is null then
    raise exception 'allowed_username_id ontbreekt';
  end if;

  select * into v_row from public.allowed_usernames where id = allowed_username_id_input;
  if not found then
    raise exception 'Naam niet gevonden';
  end if;

  v_old_name := coalesce(v_row.display_name, v_row.username, 'Onbekend');
  v_placeholder := public._next_spookinoza_name();
  v_slug := lower(replace(v_placeholder, ' ', '-'));

  perform public._clear_player_account_access(v_row.player_id);
  perform public._replace_player_name_references(v_old_name, v_placeholder, v_row.player_id);

  if v_row.player_id is not null and exists (select 1 from information_schema.tables where table_schema='public' and table_name='players') then
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='display_name') then v_sets := array_append(v_sets, format('display_name = %L', v_placeholder)); end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='username') then v_sets := array_append(v_sets, format('username = %L', v_slug)); end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='slug') then v_sets := array_append(v_sets, format('slug = %L', v_slug)); end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='status') then v_sets := array_append(v_sets, 'status = ''ghosted'''); end if;
    if exists (select 1 from information_schema.columns where table_schema='public' and table_name='players' and column_name='updated_at') then v_sets := array_append(v_sets, 'updated_at = now()'); end if;
    if array_length(v_sets,1) is not null then
      v_sql := 'update public.players set ' || array_to_string(v_sets, ', ') || ' where id = $1';
      execute v_sql using v_row.player_id;
    end if;
  end if;

  update public.allowed_usernames
     set status = 'retired_permanently',
         reserved_for_email = null,
         reserved_for_person_note = coalesce(reserved_for_person_note, '') || case when coalesce(reserved_for_person_note,'')='' then '' else ' · ' end || 'permanent verwijderd',
         updated_at = now()
   where id = allowed_username_id_input;

  return jsonb_build_object('ok', true, 'placeholder_name', v_placeholder, 'player_id', v_row.player_id, 'hidden_from_public', true);
end;
$fn$;

grant execute on function public.admin_remove_allowed_username(text, bigint) to anon, authenticated;
grant execute on function public.admin_permanently_delete_allowed_username(text, bigint) to anon, authenticated;

revoke insert, update, delete on table public.allowed_usernames from public, anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
