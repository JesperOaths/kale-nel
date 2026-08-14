-- GEJAST v792f — Online Klaverjas authoritative persistence guard
-- SQL-only continuation of v792b-v792e. Frontend VERSION intentionally remains v792.
--
-- The transition guards make the card/game state legal, but v792b still forwarded
-- caller-provided summary_payload/final_jas_payload and trusted caller metadata used by
-- persistent stats. This layer keeps the v792e transition engine intact while deriving
-- all consequential persistence inputs from the validated state and stored room.

begin;

-- Preserve the already-hardened v792b-v792e implementation behind a private entry point.
do $do$
begin
  if to_regprocedure('public._klaverjas_online_save_state_v792e_inner(text,uuid,jsonb,jsonb,jsonb)') is null then
    alter function public.klaverjas_online_save_state(text,uuid,jsonb,jsonb,jsonb)
      rename to _klaverjas_online_save_state_v792e_inner;
  end if;
end
$do$;

create or replace function public.klaverjas_online_save_state(
  session_token text,
  game_id_input uuid,
  state_input jsonb,
  summary_payload jsonb default null,
  final_jas_payload jsonb default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  game_row public.klaverjas_online_games%rowtype;
  canonical_state jsonb := coalesce(state_input, '{}'::jsonb);
  players_state jsonb;
  participant jsonb;
  human_names jsonb := '[]'::jsonb;
  team_wij_names jsonb := '[]'::jsonb;
  team_zij_names jsonb := '[]'::jsonb;
  winner_names jsonb := '[]'::jsonb;
  jas_participants jsonb := '[]'::jsonb;
  canonical_summary jsonb;
  canonical_final jsonb := null;
  canonical_action_seat integer := null;
  canonical_action_deadline timestamptz := null;
  canonical_finished_at timestamptz := null;
  canonical_winner_team integer := 0;
  canonical_kruip text := null;
  phase_state text;
  finish_mode text;
  total_wij integer := 0;
  total_zij integer := 0;
  hi integer := 0;
  lo integer := 0;
  seat_no integer;
  team_no integer;
  has_bots boolean := false;
  action_is_human boolean := false;
begin
  -- Validate the session before touching room data. The inner implementation repeats this
  -- check and owns membership/roster/transition enforcement; this pre-read only provides the
  -- stored room identity required to build canonical persistence payloads.
  perform public._jas_session_player(session_token);

  select * into game_row
    from public.klaverjas_online_games
   where id = game_id_input
   for update;
  if not found then
    raise exception 'Klaverjas room niet gevonden';
  end if;

  players_state := coalesce(canonical_state -> 'players', game_row.state -> 'players', '[]'::jsonb);
  if jsonb_typeof(players_state) <> 'array' then
    raise exception 'klaverjas_online_roster_invalid';
  end if;
  canonical_state := jsonb_set(canonical_state, '{players}', players_state, true);

  for participant in
    select item from jsonb_array_elements(players_state) as roster(item)
    order by coalesce(nullif(item ->> 'seat','')::integer, 99)
  loop
    seat_no := nullif(participant ->> 'seat','')::integer;
    team_no := nullif(participant ->> 'team','')::integer;
    if coalesce((participant ->> 'is_bot')::boolean, false)
       or coalesce(participant ->> 'player_type','') = 'bot' then
      has_bots := true;
    end if;
    human_names := human_names || jsonb_build_array(participant ->> 'name');
    if team_no = 1 then
      team_wij_names := team_wij_names || jsonb_build_array(participant ->> 'name');
    elsif team_no = 2 then
      team_zij_names := team_zij_names || jsonb_build_array(participant ->> 'name');
    end if;
  end loop;

  phase_state := coalesce(nullif(canonical_state ->> 'phase',''), game_row.status, 'lobby');
  total_wij := coalesce(nullif(canonical_state #>> '{totals,0}','')::integer, 0);
  total_zij := coalesce(nullif(canonical_state #>> '{totals,1}','')::integer, 0);

  if total_wij > total_zij then canonical_winner_team := 1;
  elsif total_zij > total_wij then canonical_winner_team := 2;
  else canonical_winner_team := 0;
  end if;

  if canonical_winner_team <> 0 then
    select coalesce(jsonb_agg(item ->> 'name' order by nullif(item ->> 'seat','')::integer), '[]'::jsonb)
      into winner_names
      from jsonb_array_elements(players_state) as roster(item)
     where nullif(item ->> 'team','')::integer = canonical_winner_team;
  end if;

  -- Match the current client action owner exactly. Deadline is server-owned: a human action
  -- gets seven days from the accepted save; bot/no-action states get no deadline.
  if phase_state = 'bidding' and coalesce(canonical_state ->> 'bidder_turn','') ~ '^[0-3]$' then
    canonical_action_seat := (canonical_state ->> 'bidder_turn')::integer;
  elsif phase_state = 'playing'
        and jsonb_typeof(canonical_state -> 'pending_trick') = 'object'
        and coalesce(canonical_state #>> '{pending_trick,winner}','') ~ '^[0-3]$' then
    canonical_action_seat := (canonical_state #>> '{pending_trick,winner}')::integer;
  elsif phase_state = 'playing' and coalesce(canonical_state ->> 'turn','') ~ '^[0-3]$' then
    canonical_action_seat := (canonical_state ->> 'turn')::integer;
  end if;

  if canonical_action_seat is not null then
    select exists(
      select 1
        from jsonb_array_elements(players_state) as roster(item)
       where nullif(item ->> 'seat','')::integer = canonical_action_seat
         and not coalesce((item ->> 'is_bot')::boolean, false)
         and coalesce(item ->> 'player_type','human') <> 'bot'
    ) into action_is_human;
  end if;
  if action_is_human then
    canonical_action_deadline := now() + interval '7 days';
  end if;

  canonical_state := jsonb_set(canonical_state, '{action_needed_seat}',
    case when canonical_action_seat is null then 'null'::jsonb else to_jsonb(canonical_action_seat) end, true);
  canonical_state := jsonb_set(canonical_state, '{action_deadline_at}',
    case when canonical_action_deadline is null then 'null'::jsonb else to_jsonb(canonical_action_deadline) end, true);

  -- finished_at and kruip feed persistent history/stats and may not be supplied by the caller.
  if phase_state = 'finished' then
    canonical_finished_at := coalesce(game_row.finished_at, now());
    hi := greatest(total_wij, total_zij);
    lo := least(total_wij, total_zij);
    if hi + lo > 0 then
      if lo::numeric <= hi::numeric / 2 then canonical_kruip := 'naakt_kruipen';
      elsif hi::numeric >= (hi + lo)::numeric * (2::numeric / 3::numeric) then canonical_kruip := 'kruipen';
      end if;
    end if;
  end if;
  canonical_state := jsonb_set(canonical_state, '{finished_at}',
    case when canonical_finished_at is null then 'null'::jsonb else to_jsonb(canonical_finished_at) end, true);
  canonical_state := jsonb_set(canonical_state, '{kruip}',
    case when canonical_kruip is null then 'null'::jsonb else to_jsonb(canonical_kruip) end, true);
  canonical_state := jsonb_set(
    canonical_state,
    '{summary}',
    (case when jsonb_typeof(canonical_state -> 'summary') = 'object' then canonical_state -> 'summary' else '{}'::jsonb end)
      || jsonb_build_object('winner_team', canonical_winner_team),
    true
  );

  finish_mode := case when canonical_state #>> '{settings,finish_mode}' = 'first_to_162'
                      then 'Eerste tot 162' else '16 rondes' end;

  canonical_summary := jsonb_build_object(
    'match_ref', coalesce(game_row.lobby_code, ''),
    'client_match_id', game_row.id::text,
    'participants', human_names,
    'winner_names', winner_names,
    'teams', jsonb_build_object('wij', team_wij_names, 'zij', team_zij_names),
    'totals', jsonb_build_object('wij', total_wij, 'zij', total_zij),
    'rounds', coalesce(canonical_state -> 'rounds', '[]'::jsonb),
    'online', true,
    'has_bots', has_bots,
    'finish_mode', finish_mode,
    'action_needed_seat', canonical_action_seat,
    'action_deadline_at', canonical_action_deadline,
    'kruip', canonical_kruip,
    'coach_recaps', '[]'::jsonb,
    'ai_mmr', case when has_bots then coalesce(canonical_state -> 'ai_mmr','{}'::jsonb) else '{}'::jsonb end,
    'live_state', jsonb_build_object(
      'status', case when phase_state = 'finished' then 'finished' else phase_state end,
      'updated_at', now(),
      'rounds_played', case when jsonb_typeof(canonical_state -> 'rounds') = 'array'
                            then jsonb_array_length(canonical_state -> 'rounds') else 0 end
    ),
    'finished_at', canonical_finished_at
  );

  if phase_state = 'finished' and not has_bots then
    for participant in
      select item from jsonb_array_elements(players_state) as roster(item)
      order by nullif(item ->> 'seat','')::integer
    loop
      team_no := nullif(participant ->> 'team','')::integer;
      jas_participants := jas_participants || jsonb_build_array(jsonb_build_object(
        'name', participant ->> 'name',
        'seat_no', nullif(participant ->> 'seat','')::integer + 1,
        'team_no', team_no,
        'total_points', case when team_no = 1 then total_wij else total_zij end,
        'is_winner', canonical_winner_team <> 0 and team_no = canonical_winner_team
      ));
    end loop;

    canonical_final := jsonb_build_object(
      'title', trim('Online klaverjas ' || coalesce(game_row.lobby_code, '')),
      'played_at', to_char(current_date, 'YYYY-MM-DD'),
      'variant', '4_player',
      'scoreboard_mode', 'teams',
      'source', 'klaverjas_online',
      'client_match_id', game_row.id::text,
      'lobby_code', coalesce(game_row.lobby_code, ''),
      'participants', jas_participants,
      'summary', canonical_summary,
      'online_stats', jsonb_build_object(
        'kruip', canonical_kruip,
        'round_count', case when jsonb_typeof(canonical_state -> 'rounds') = 'array'
                            then jsonb_array_length(canonical_state -> 'rounds') else 0 end,
        'finish_mode', finish_mode,
        'coach_recaps', '[]'::jsonb,
        'ai_mmr', '{}'::jsonb
      ),
      'rounds', coalesce(canonical_state -> 'rounds', '[]'::jsonb)
    );
  end if;

  -- Deliberately ignore caller summary_payload/final_jas_payload. Their parameters remain in
  -- the public signature for compatibility with the deployed frontend, but persistent output
  -- is now a function only of the stored room and the state accepted by the transition guard.
  return public._klaverjas_online_save_state_v792e_inner(
    session_token,
    game_id_input,
    canonical_state,
    case when has_bots then null else canonical_summary end,
    canonical_final
  );
end;
$function$;

revoke execute on function public._klaverjas_online_save_state_v792e_inner(text,uuid,jsonb,jsonb,jsonb)
  from public, anon, authenticated;
revoke execute on function public.klaverjas_online_save_state(text,uuid,jsonb,jsonb,jsonb) from public;
grant execute on function public.klaverjas_online_save_state(text,uuid,jsonb,jsonb,jsonb) to anon, authenticated;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
