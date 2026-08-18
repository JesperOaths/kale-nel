-- GEJAST v812c — generic game summary write boundary hardening
-- SQL-only compatibility/security repair. Product VERSION remains v812.
--
-- Repairs:
--   * ambiguous ON CONFLICT identifiers in save_game_match_summary*;
--   * unauthenticated generic summary writes;
--   * cross-scope overwrite risk in contract_live_write_v1;
--   * global (game_type, client_match_id) uniqueness that prevented scope isolation;
--   * direct anon/authenticated access to game_match_summaries/live_match_summaries.

begin;

-- Match identity is scope-local. Existing production data is already single-scope per key.
alter table public.game_match_summaries
  drop constraint if exists game_match_summaries_game_type_client_match_id_key;

alter table public.game_match_summaries
  drop constraint if exists game_match_summaries_scope_game_match_key;

alter table public.game_match_summaries
  add constraint game_match_summaries_scope_game_match_key
  unique (site_scope, game_type, client_match_id);

create or replace function public.save_game_match_summary_scoped(
  session_token text default null,
  game_type text default null,
  client_match_id text default null,
  summary_payload jsonb default '{}'::jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_player public.players%rowtype;
  v_scope text := public._scope_norm(site_scope_input);
  v_player_scope text;
  v_game_type text := lower(trim(coalesce(game_type, '')));
  v_client_match_id text := nullif(trim(coalesce(client_match_id, '')), '');
  v_summary jsonb := coalesce(summary_payload, '{}'::jsonb);
  v_finished_at timestamptz := null;
  v_participants text[] := '{}'::text[];
  v_winner_names text[] := '{}'::text[];
  v_participant_scope text;
  v_match_id bigint;
  v_updated_at timestamptz;
  v_effective_finished_at timestamptz;
begin
  v_player := public._gejast_player_from_session(session_token);
  if v_player.id is null then
    raise exception 'Niet ingelogd.';
  end if;

  v_player_scope := public._scope_from_player_id(v_player.id);
  if v_player_scope is distinct from v_scope then
    raise exception 'game_summary_scope_mismatch';
  end if;

  if v_game_type not in ('klaverjas', 'boerenbridge', 'beerpong') then
    raise exception 'game_type ongeldig';
  end if;
  if v_client_match_id is null then
    raise exception 'client_match_id ontbreekt';
  end if;

  v_participants := public._jsonb_text_array(v_summary->'participants');
  if coalesce(array_length(v_participants, 1), 0) = 0 then
    v_participants := public._jsonb_text_array(v_summary->'players');
  end if;
  if coalesce(array_length(v_participants, 1), 0) = 0 then
    v_participants := array[v_player.display_name];
  end if;

  v_participant_scope := public._derive_scope_from_name_array(v_participants);
  if v_participant_scope is null or v_participant_scope is distinct from v_scope then
    raise exception 'game_summary_participant_scope_mismatch';
  end if;

  if not exists (
    select 1
    from unnest(v_participants) as p(name)
    where lower(trim(p.name)) = lower(trim(v_player.display_name))
  ) then
    raise exception 'game_summary_owner_not_participant';
  end if;

  v_winner_names := public._jsonb_text_array(v_summary->'winner_names');
  if coalesce(array_length(v_winner_names, 1), 0) = 0 then
    v_winner_names := public._jsonb_text_array(v_summary->'winners');
  end if;

  if exists (
    select 1
    from unnest(v_winner_names) as w(name)
    where not exists (
      select 1
      from unnest(v_participants) as p(name)
      where lower(trim(p.name)) = lower(trim(w.name))
    )
  ) then
    raise exception 'game_summary_winner_not_participant';
  end if;

  begin
    v_finished_at := nullif(trim(coalesce(v_summary->>'finished_at', '')), '')::timestamptz;
  exception when invalid_datetime_format then
    raise exception 'finished_at ongeldig';
  end;
  if v_finished_at is null and lower(coalesce(v_summary->>'finished', 'false')) = 'true' then
    v_finished_at := now();
  end if;

  v_summary := jsonb_set(
    v_summary,
    '{submitter_meta}',
    coalesce(v_summary->'submitter_meta', '{}'::jsonb) || jsonb_build_object(
      'submitted_by_name', v_player.display_name,
      'player_id', v_player.id,
      'source', 'save_game_match_summary_scoped'
    ),
    true
  );

  insert into public.game_match_summaries as g (
    site_scope,
    game_type,
    client_match_id,
    finished_at,
    created_by_player_id,
    winner_names,
    participant_names,
    recap_text,
    summary_payload,
    updated_at
  ) values (
    v_scope,
    v_game_type,
    v_client_match_id,
    v_finished_at,
    v_player.id,
    v_winner_names,
    v_participants,
    nullif(trim(coalesce(v_summary->>'recap_text', '')), ''),
    v_summary,
    now()
  )
  on conflict on constraint game_match_summaries_scope_game_match_key
  do update set
    finished_at = coalesce(excluded.finished_at, g.finished_at),
    winner_names = excluded.winner_names,
    participant_names = excluded.participant_names,
    recap_text = excluded.recap_text,
    summary_payload = excluded.summary_payload,
    updated_at = now()
  where g.created_by_player_id = excluded.created_by_player_id
  returning g.id, g.updated_at, g.finished_at
    into v_match_id, v_updated_at, v_effective_finished_at;

  if v_match_id is null then
    raise exception 'game_summary_owner_mismatch';
  end if;

  return jsonb_build_object(
    'ok', true,
    'site_scope', v_scope,
    'game_type', v_game_type,
    'client_match_id', v_client_match_id,
    'updated_at', v_updated_at,
    'finished_at', v_effective_finished_at
  );
end;
$function$;

create or replace function public.save_game_match_summary(
  session_token text default null,
  game_type text default null,
  client_match_id text default null,
  summary_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_player public.players%rowtype;
  v_scope text;
begin
  v_player := public._gejast_player_from_session(session_token);
  if v_player.id is null then
    raise exception 'Niet ingelogd.';
  end if;
  v_scope := public._scope_from_player_id(v_player.id);

  return public.save_game_match_summary_scoped(
    session_token => session_token,
    game_type => game_type,
    client_match_id => client_match_id,
    summary_payload => coalesce(summary_payload, '{}'::jsonb),
    site_scope_input => v_scope
  );
end;
$function$;

create or replace function public.contract_live_write_v1(
  session_token text,
  game_type text,
  client_match_id text,
  summary_payload jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_scope text := public._scope_norm(site_scope_input);
begin
  if nullif(trim(coalesce(session_token, '')), '') is null then
    return public._contract_err('live', 'write', 'MISSING_SESSION', 'Niet ingelogd.');
  end if;

  v_result := public.save_game_match_summary_scoped(
    session_token => session_token,
    game_type => lower(trim(coalesce(game_type, ''))),
    client_match_id => trim(coalesce(client_match_id, '')),
    summary_payload => coalesce(summary_payload, '{}'::jsonb),
    site_scope_input => v_scope
  );

  return public._contract_ok(
    'live',
    'write',
    jsonb_build_object(
      'saved', true,
      'game_type', lower(trim(coalesce(game_type, ''))),
      'client_match_id', trim(coalesce(client_match_id, '')),
      'site_scope', v_scope,
      'result', coalesce(v_result, '{}'::jsonb)
    )
  );
exception when others then
  return public._contract_err('live', 'write', 'LIVE_WRITE_FAILED', SQLERRM);
end;
$function$;

-- Public clients use scoped SECURITY DEFINER RPCs. Direct table/view access bypasses
-- the session/owner/scope contract and is therefore intentionally removed.
revoke all on table public.game_match_summaries from anon, authenticated;
revoke all on table public.live_match_summaries from anon, authenticated;

revoke execute on function public.save_game_match_summary(text,text,text,jsonb) from public;
revoke execute on function public.save_game_match_summary_scoped(text,text,text,jsonb,text) from public;
revoke execute on function public.contract_live_write_v1(text,text,text,jsonb,text) from public;

grant execute on function public.save_game_match_summary(text,text,text,jsonb) to anon, authenticated, service_role;
grant execute on function public.save_game_match_summary_scoped(text,text,text,jsonb,text) to anon, authenticated, service_role;
grant execute on function public.contract_live_write_v1(text,text,text,jsonb,text) to anon, authenticated, service_role;

commit;
