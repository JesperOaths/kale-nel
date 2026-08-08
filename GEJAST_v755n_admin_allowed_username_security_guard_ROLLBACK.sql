-- GEJAST v755n rollback: restore pre-v755n allowed-username admin remove behavior.
-- Use only if v755n was applied and must be reverted. This restores the old
-- PERFORM-only admin_check_session behavior and direct table DML grants.

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
  v_row record;
begin
  perform public.admin_check_session(admin_session_token);

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
  v_row record;
  v_old_name text;
  v_placeholder text;
  v_sets text[] := array[]::text[];
  v_sql text;
  v_slug text;
begin
  perform public.admin_check_session(admin_session_token);

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

  return jsonb_build_object('ok', true, 'placeholder_name', v_placeholder, 'player_id', v_row.player_id);
end;
$fn$;

grant execute on function public.admin_remove_allowed_username(text, bigint) to anon, authenticated;
grant execute on function public.admin_permanently_delete_allowed_username(text, bigint) to anon, authenticated;
grant insert, update, delete on table public.allowed_usernames to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
