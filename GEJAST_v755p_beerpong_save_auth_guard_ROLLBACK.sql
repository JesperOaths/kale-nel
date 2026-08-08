-- GEJAST v755p rollback / forward-fix fallback
-- This intentionally does NOT restore the vulnerable owner-bypass behavior.
-- It preserves valid-session, owner-only update, frontend/backend payload normalization,
-- table-DML hardening, and current no-rating-rebuild behavior.

begin;

revoke all on function public.save_beerpong_match(text, text, jsonb) from public;
revoke insert, update, delete on table public.beerpong_matches from public, anon, authenticated;
revoke insert, update, delete on table public.beerpong_player_ratings from public, anon, authenticated;
do $$
begin
  if to_regclass('public.beerpong_player_rating_history') is not null then
    revoke insert, update, delete on table public.beerpong_player_rating_history from public, anon, authenticated;
  end if;
end $$;

create or replace function public.save_beerpong_match(
  session_token text default null,
  client_match_id text default null,
  payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  p public.players%rowtype;
  v_client text := nullif(trim(coalesce(save_beerpong_match.client_match_id, '')), '');
  v_payload jsonb := coalesce(save_beerpong_match.payload, '{}'::jsonb);
  v_match_format text := lower(trim(coalesce(nullif(v_payload->>'match_format',''), nullif(v_payload->>'format',''), '1v1')));
  v_status text := lower(trim(coalesce(nullif(v_payload->>'status',''), 'finished')));
  v_team_a text[] := coalesce((select array_agg(value::text) from jsonb_array_elements_text(coalesce(v_payload->'team_a_player_names', '[]'::jsonb))), '{}'::text[]);
  v_team_b text[] := coalesce((select array_agg(value::text) from jsonb_array_elements_text(coalesce(v_payload->'team_b_player_names', '[]'::jsonb))), '{}'::text[]);
  v_winner_team text := lower(trim(coalesce(v_payload->>'winner_team', '')));
  v_team_a_cups_left integer := nullif(coalesce(v_payload->>'team_a_cups_left', v_payload->>'cups_left_team_a'), '')::integer;
  v_team_b_cups_left integer := nullif(coalesce(v_payload->>'team_b_cups_left', v_payload->>'cups_left_team_b'), '')::integer;
  v_finished_at timestamptz := coalesce(nullif(v_payload->>'finished_at','')::timestamptz, now());
  v_match public.beerpong_matches%rowtype;
  v_match_id bigint;
  v_existing boolean := false;
begin
  if v_client is null then
    raise exception 'client_match_id ontbreekt';
  end if;

  if nullif(trim(coalesce(save_beerpong_match.session_token, '')), '') is null then
    raise exception 'Niet ingelogd.';
  end if;

  p := public._tier3_player_from_any_session_v740(save_beerpong_match.session_token);
  if p.id is null then
    raise exception 'Niet ingelogd.';
  end if;

  if v_match_format not in ('1v1','2v2') then
    raise exception 'match_format ongeldig';
  end if;

  if v_match_format = '1v1' then
    if coalesce(array_length(v_team_a, 1), 0) <> 1 or coalesce(array_length(v_team_b, 1), 0) <> 1 then
      raise exception 'Bij 1v1 moet elk team precies 1 speler hebben';
    end if;
  else
    if coalesce(array_length(v_team_a, 1), 0) <> 2 or coalesce(array_length(v_team_b, 1), 0) <> 2 then
      raise exception 'Bij 2v2 moet elk team precies 2 spelers hebben';
    end if;
  end if;

  if exists (
    select 1
    from unnest(v_team_a) a
    join unnest(v_team_b) b on lower(trim(a)) = lower(trim(b))
  ) then
    raise exception 'Een speler mag maar in een team staan';
  end if;

  if v_winner_team = 'a' then v_winner_team := 'team_a'; end if;
  if v_winner_team = 'b' then v_winner_team := 'team_b'; end if;
  if v_winner_team not in ('team_a','team_b') then
    raise exception 'winner_team ongeldig';
  end if;

  v_payload := jsonb_set(v_payload, '{match_format}', to_jsonb(v_match_format), true);
  v_payload := jsonb_set(v_payload, '{format}', to_jsonb(v_match_format), true);
  if v_team_a_cups_left is not null then
    v_payload := jsonb_set(v_payload, '{team_a_cups_left}', to_jsonb(v_team_a_cups_left), true);
    v_payload := jsonb_set(v_payload, '{cups_left_team_a}', to_jsonb(v_team_a_cups_left), true);
  end if;
  if v_team_b_cups_left is not null then
    v_payload := jsonb_set(v_payload, '{team_b_cups_left}', to_jsonb(v_team_b_cups_left), true);
    v_payload := jsonb_set(v_payload, '{cups_left_team_b}', to_jsonb(v_team_b_cups_left), true);
  end if;

  select * into v_match
  from public.beerpong_matches m
  where m.client_match_id = v_client
  limit 1;

  v_existing := v_match.id is not null;

  if v_existing then
    if v_match.created_by_player_id is null or v_match.created_by_player_id <> p.id then
      raise exception 'beerpong_match_owner_mismatch';
    end if;

    update public.beerpong_matches m
       set match_format = v_match_format,
           team_a_player_names = v_team_a,
           team_b_player_names = v_team_b,
           winner_team = v_winner_team,
           team_a_cups_left = v_team_a_cups_left,
           team_b_cups_left = v_team_b_cups_left,
           finished_at = case when v_status = 'finished' then v_finished_at else m.finished_at end,
           match_status = case when v_status = 'finished' then 'finished' else 'draft' end,
           payload = v_payload,
           updated_at = now()
     where m.id = v_match.id
       and m.created_by_player_id = p.id
     returning m.id into v_match_id;
  else
    insert into public.beerpong_matches(
      client_match_id,
      created_by_player_id,
      match_status,
      match_format,
      team_a_player_names,
      team_b_player_names,
      winner_team,
      team_a_cups_left,
      team_b_cups_left,
      finished_at,
      payload,
      updated_at
    ) values (
      v_client,
      p.id,
      case when v_status = 'finished' then 'finished' else 'draft' end,
      v_match_format,
      v_team_a,
      v_team_b,
      v_winner_team,
      v_team_a_cups_left,
      v_team_b_cups_left,
      case when v_status = 'finished' then v_finished_at else null end,
      v_payload,
      now()
    )
    returning id into v_match_id;
  end if;

  return jsonb_build_object(
    'ok', true,
    'match_id', v_match_id,
    'client_match_id', v_client,
    'already_saved', v_existing,
    'ratings_applied', false,
    'ratings_disabled_by_forward_fix', true
  );
end;
$fn$;

revoke all on function public.save_beerpong_match(text, text, jsonb) from public;
grant execute on function public.save_beerpong_match(text, text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
