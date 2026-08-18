-- GEJAST v806b — game match summary PL/pgSQL ambiguity repair
-- PREPARED ONLY. Do not apply to production without explicit authorization.
-- Grounded production defect: save_game_match_summary has PL/pgSQL parameters
-- named game_type/client_match_id while its ON CONFLICT target uses the same
-- unqualified column names. Bind function inputs positionally and name the
-- existing unique constraint explicitly.

begin;

create or replace function public.save_game_match_summary(
  session_token text default null::text,
  game_type text default null::text,
  client_match_id text default null::text,
  summary_payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_player public.players%rowtype;
  v_game_type text := lower(trim(coalesce($2,'')));
  v_client_match_id text := nullif(trim(coalesce($3,'')), '');
  v_winner_names text[] := coalesce((select array_agg(value::text) from jsonb_array_elements_text(coalesce($4->'winner_names','[]'::jsonb))), '{}'::text[]);
  v_participants text[] := coalesce((select array_agg(value::text) from jsonb_array_elements_text(coalesce($4->'participants','[]'::jsonb))), '{}'::text[]);
  v_finished_at timestamptz := nullif($4->>'finished_at','')::timestamptz;
begin
  if v_game_type not in ('klaverjas','boerenbridge','beerpong','paardenrace') then
    raise exception 'game_type ongeldig';
  end if;
  if v_client_match_id is null then
    raise exception 'client_match_id ontbreekt';
  end if;

  begin
    if nullif(trim(coalesce($1,'')), '') is not null then
      select * into v_player from public._gejast_player_from_session($1);
    end if;
  exception when others then
    null;
  end;

  insert into public.game_match_summaries(
    game_type,
    client_match_id,
    finished_at,
    created_by_player_id,
    winner_names,
    participant_names,
    recap_text,
    summary_payload
  ) values (
    v_game_type,
    v_client_match_id,
    v_finished_at,
    v_player.id,
    v_winner_names,
    v_participants,
    nullif(trim(coalesce($4->>'recap_text','')), ''),
    coalesce($4, '{}'::jsonb)
  )
  on conflict on constraint game_match_summaries_game_type_client_match_id_key
  do update set
    finished_at = excluded.finished_at,
    created_by_player_id = coalesce(excluded.created_by_player_id, public.game_match_summaries.created_by_player_id),
    winner_names = excluded.winner_names,
    participant_names = excluded.participant_names,
    recap_text = excluded.recap_text,
    summary_payload = excluded.summary_payload;

  return jsonb_build_object('ok', true);
end;
$function$;

comment on function public.save_game_match_summary(text,text,text,jsonb)
  is 'v806b prepared repair: positional PL/pgSQL inputs plus named match-summary unique constraint remove game_type/client_match_id ambiguity.';

commit;
