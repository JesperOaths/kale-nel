begin;

create or replace function public._scope_pick_name_v352(row_input jsonb, candidate_keys text[])
returns text
language plpgsql
stable
set search_path to 'public'
as $fn$
declare
  v_key text;
  v_value text;
begin
  foreach v_key in array coalesce(candidate_keys, array[]::text[])
  loop
    v_value := nullif(trim(coalesce(row_input->>v_key, '')), '');
    if v_value is not null then
      return v_value;
    end if;
  end loop;
  return '';
end;
$fn$;

create or replace function public._scope_filter_rows_v352(rows_input jsonb, candidate_keys text[], site_scope_input text)
returns jsonb
language sql
stable
set search_path to 'public'
as $$
  select coalesce(jsonb_agg(item), '[]'::jsonb)
  from jsonb_array_elements(coalesce(rows_input, '[]'::jsonb)) item
  where public._name_in_site_scope(public._scope_pick_name_v352(item, candidate_keys), site_scope_input);
$$;

create or replace function public._scope_count_bad_rows_v352(rows_input jsonb, candidate_keys text[], site_scope_input text)
returns integer
language sql
stable
set search_path to 'public'
as $$
  select count(*)::int
  from jsonb_array_elements(coalesce(rows_input, '[]'::jsonb)) item
  where not public._name_in_site_scope(public._scope_pick_name_v352(item, candidate_keys), site_scope_input);
$$;

create or replace function public.get_homepage_ladders_public_scoped(
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_base jsonb := public.get_homepage_ladders_public();
begin
  return jsonb_build_object(
    'klaverjas', public._scope_filter_rows_v352(v_base->'klaverjas', array['player_name','display_name'], v_scope),
    'boerenbridge', public._scope_filter_rows_v352(v_base->'boerenbridge', array['player_name','display_name'], v_scope),
    'beerpong', public._scope_filter_rows_v352(v_base->'beerpong', array['player_name','display_name'], v_scope)
  );
end;
$fn$;

create or replace function public.get_drinks_homepage_public_scoped(
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  with base as (
    select
      coalesce(nullif(trim(coalesce(de.player_name, p.display_name, '')), ''), 'Onbekend') as player_name,
      coalesce(de.verified_at, de.created_at, now()) as event_ts,
      coalesce(de.status, '') as status
    from public.drink_events de
    left join public.players p on p.id = de.player_id
  )
  select jsonb_build_object(
    'totals',
    jsonb_build_object(
      'today_events', count(*) filter (where status = 'verified' and event_ts >= date_trunc('day', now()) and public._name_in_site_scope(player_name, site_scope_input)),
      'all_events', count(*) filter (where status = 'verified' and public._name_in_site_scope(player_name, site_scope_input)),
      'pending_events', count(*) filter (where status = 'pending' and public._name_in_site_scope(player_name, site_scope_input))
    )
  )
  from base;
$$;

create or replace function public.get_drinks_homepage_top5_public_scoped(
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  with event_types as (
    select lower(det.key) as key, coalesce(det.label, initcap(replace(det.key,'_',' '))) as label, coalesce(det.unit_value, 0) as unit_value
    from public.drink_event_types det
  ),
  verified_events as (
    select
      coalesce(nullif(trim(coalesce(de.player_name, p.display_name, '')), ''), 'Onbekend') as player_name,
      coalesce(nullif(trim(coalesce(p.display_name, de.player_name, '')), ''), 'Onbekend') as display_name,
      coalesce(de.total_units, et.unit_value * coalesce(de.quantity,1), 0)::numeric as total_units,
      coalesce(de.verified_at, de.created_at, now()) as event_ts
    from public.drink_events de
    left join public.players p on p.id = de.player_id
    left join event_types et on et.key = lower(coalesce(nullif(to_jsonb(de)->>'event_type_key',''), et.key))
    where coalesce(de.status,'') = 'verified'
      and public._name_in_site_scope(coalesce(nullif(trim(coalesce(de.player_name, p.display_name, '')), ''), 'Onbekend'), site_scope_input)
  ),
  session_top as (
    select player_name, max(display_name) as display_name, round(sum(total_units)::numeric,1) as total_units
    from verified_events
    where event_ts >= date_trunc('day', now())
    group by player_name
    order by sum(total_units) desc, player_name asc
    limit 5
  ),
  all_time_top as (
    select player_name, max(display_name) as display_name, round(sum(total_units)::numeric,1) as total_units
    from verified_events
    group by player_name
    order by sum(total_units) desc, player_name asc
    limit 5
  ),
  speed_base as (
    select
      lower(coalesce(nullif(to_jsonb(dsa)->>'event_type_key',''), nullif(to_jsonb(dsa)->>'speed_type_key',''), dst.key, 'speed')) as speed_type_key,
      coalesce(nullif(to_jsonb(dsa)->>'event_type_label',''), nullif(to_jsonb(dsa)->>'speed_type_label',''), dst.label, 'Snelheid') as speed_type_label,
      coalesce(nullif(trim(coalesce(to_jsonb(dsa)->>'player_name', p.display_name, '')), ''), 'Onbekend') as player_name,
      coalesce(nullif(trim(coalesce(p.display_name, to_jsonb(dsa)->>'player_name', '')), ''), 'Onbekend') as display_name,
      round(min(coalesce(dsa.duration_seconds,0))::numeric,1) as duration_seconds
    from public.drink_speed_attempts dsa
    left join public.players p on p.id = dsa.player_id
    left join public.drink_speed_types dst on dst.id = dsa.speed_type_id
    where coalesce(dsa.status,'') = 'verified'
      and public._name_in_site_scope(coalesce(nullif(trim(coalesce(to_jsonb(dsa)->>'player_name', p.display_name, '')), ''), 'Onbekend'), site_scope_input)
    group by 1,2,3,4
  ),
  speed_ranked as (
    select *, row_number() over (partition by speed_type_key order by duration_seconds asc, player_name asc) as rn
    from speed_base
    where speed_type_key <> 'shot'
  ),
  speed_sets as (
    select jsonb_agg(jsonb_build_object(
      'key', speed_type_key,
      'speed_type_key', speed_type_key,
      'label', max(speed_type_label),
      'speed_type_label', max(speed_type_label),
      'rows', jsonb_agg(jsonb_build_object(
        'player_name', player_name,
        'display_name', display_name,
        'duration_seconds', duration_seconds
      ) order by duration_seconds asc, player_name asc)
    ) order by max(speed_type_label) asc) as payload
    from speed_ranked
    where rn <= 5
    group by speed_type_key
  )
  select jsonb_build_object(
    'session_top5', coalesce((select jsonb_agg(to_jsonb(t) order by t.total_units desc, t.player_name) from session_top t), '[]'::jsonb),
    'all_time_top5', coalesce((select jsonb_agg(to_jsonb(t) order by t.total_units desc, t.player_name) from all_time_top t), '[]'::jsonb),
    'speed_top5_by_type', coalesce((select payload from speed_sets), '[]'::jsonb)
  );
$$;

create or replace function public.get_verified_drinks_history_public_scoped(
  limit_count integer default 25,
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  with event_types as (
    select lower(det.key) as key, coalesce(det.label, initcap(replace(det.key,'_',' '))) as label
    from public.drink_event_types det
  ),
  base as (
    select
      de.id,
      coalesce(nullif(trim(coalesce(de.player_name, p.display_name, '')), ''), 'Onbekend') as player_name,
      coalesce(et.label, initcap(replace(coalesce(nullif(to_jsonb(de)->>'event_type_key',''),'drank'),'_',' '))) as event_type_label,
      coalesce(de.total_units, 0)::numeric as total_units,
      coalesce(de.verified_at, de.created_at, now()) as verified_at
    from public.drink_events de
    left join public.players p on p.id = de.player_id
    left join event_types et on et.key = lower(coalesce(nullif(to_jsonb(de)->>'event_type_key',''), et.key))
    where coalesce(de.status,'') = 'verified'
      and public._name_in_site_scope(coalesce(nullif(trim(coalesce(de.player_name, p.display_name, '')), ''), 'Onbekend'), site_scope_input)
  )
  select coalesce(jsonb_agg(to_jsonb(x) order by x.verified_at desc, x.id desc), '[]'::jsonb)
  from (
    select *
    from base
    order by verified_at desc, id desc
    limit greatest(1, least(coalesce(limit_count, 25), 250))
  ) x;
$$;

create or replace function public.get_drink_player_public_scoped(
  player_name text,
  site_scope_input text default 'friends'
)
returns jsonb
language sql
security definer
set search_path to 'public'
as $$
  select case
    when public._name_in_site_scope(player_name, site_scope_input) then public.get_drink_player_public(player_name)
    else jsonb_build_object(
      'player_name', player_name,
      'summary', jsonb_build_object('events', 0, 'units', 0, 'avg_night_units', 0, 'favorite_type', null),
      'top_types', '[]'::jsonb,
      'recent', '[]'::jsonb,
      'speed_records', '[]'::jsonb
    )
  end;
$$;

create or replace function public.get_scope_audit_bundle_v352(
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_players jsonb := coalesce(public.get_all_site_players_public_scoped(v_scope)->'players', '[]'::jsonb);
  v_ladders jsonb := public.get_homepage_ladders_public_scoped(v_scope);
  v_drinks_top5 jsonb := public.get_drinks_homepage_top5_public_scoped(v_scope);
  v_profiles_bad integer := 0;
  v_ladders_bad integer := 0;
  v_live_bad integer := 0;
  v_drinks_bad integer := 0;
begin
  v_profiles_bad := public._scope_count_bad_rows_v352(v_players, array['player_name','display_name','chosen_username','public_display_name'], v_scope);

  v_ladders_bad :=
    public._scope_count_bad_rows_v352(v_ladders->'klaverjas', array['player_name','display_name'], v_scope) +
    public._scope_count_bad_rows_v352(v_ladders->'boerenbridge', array['player_name','display_name'], v_scope) +
    public._scope_count_bad_rows_v352(v_ladders->'beerpong', array['player_name','display_name'], v_scope);

  v_live_bad := coalesce((
    select count(*)::int
    from public.game_match_summaries g
    where coalesce(lower(trim(g.site_scope)), 'friends') = v_scope
      and not public._match_jsonb_in_scope(
        jsonb_build_object(
          'winner_names', to_jsonb(coalesce(g.winner_names, '{}'::text[])),
          'participant_names', to_jsonb(coalesce(g.participant_names, '{}'::text[])),
          'summary_payload', coalesce(g.summary_payload, '{}'::jsonb)
        ),
        v_scope
      )
  ), 0);

  v_drinks_bad :=
    public._scope_count_bad_rows_v352(v_drinks_top5->'session_top5', array['player_name','display_name'], v_scope) +
    public._scope_count_bad_rows_v352(v_drinks_top5->'all_time_top5', array['player_name','display_name'], v_scope);

  return jsonb_build_object(
    'site_scope', v_scope,
    'counts', jsonb_build_object(
      'players_out_of_scope', v_profiles_bad,
      'homepage_ladders_out_of_scope', v_ladders_bad,
      'live_rows_out_of_scope', v_live_bad,
      'drinks_rows_out_of_scope', v_drinks_bad,
      'total_findings', v_profiles_bad + v_ladders_bad + v_live_bad + v_drinks_bad
    ),
    'proof', jsonb_build_object(
      'players_rpc', v_profiles_bad = 0,
      'homepage_ladders_rpc', v_ladders_bad = 0,
      'live_table_rows', v_live_bad = 0,
      'drinks_home_rows', v_drinks_bad = 0
    )
  );
end;
$fn$;

create or replace function public.assert_scope_clean_v352()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_friends jsonb := public.get_scope_audit_bundle_v352('friends');
  v_family jsonb := public.get_scope_audit_bundle_v352('family');
  v_total integer := coalesce((v_friends->'counts'->>'total_findings')::integer, 0) + coalesce((v_family->'counts'->>'total_findings')::integer, 0);
begin
  if v_total > 0 then
    raise exception 'Scope contamination detected: %', v_total;
  end if;
  return jsonb_build_object(
    'ok', true,
    'friends', v_friends,
    'family', v_family
  );
end;
$fn$;

grant execute on function public.get_homepage_ladders_public_scoped(text) to anon, authenticated;
grant execute on function public.get_drinks_homepage_public_scoped(text) to anon, authenticated;
grant execute on function public.get_drinks_homepage_top5_public_scoped(text) to anon, authenticated;
grant execute on function public.get_verified_drinks_history_public_scoped(integer, text) to anon, authenticated;
grant execute on function public.get_drink_player_public_scoped(text, text) to anon, authenticated;
grant execute on function public.get_scope_audit_bundle_v352(text) to anon, authenticated;
grant execute on function public.assert_scope_clean_v352() to anon, authenticated;

commit;
