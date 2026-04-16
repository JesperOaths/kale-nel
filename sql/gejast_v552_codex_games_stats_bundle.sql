-- GEJAST V552 CODEX GAMES/STATS BUNDLE
-- Built: 2026-04-16
-- Order: v521 Pikken live rewrite -> v548 admin/game analytics -> v550a session runtime audit

-- ===== BEGIN gejast_v521_pikken_live_state_rewrite.sql =====
-- GEJAST v521 â€” dedicated public pikken live state reader
begin;

create or replace function public.pikken_get_live_state_public(
  game_id_input uuid default null,
  lobby_code_input text default null,
  site_scope_input text default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $function$
declare
  g public.pikken_games%rowtype;
  st jsonb;
  current_round_no int;
  players jsonb := '[]'::jsonb;
  votes jsonb := '[]'::jsonb;
  totals jsonb;
  r record;
  scope_key text := case
    when site_scope_input is null or btrim(site_scope_input) = '' then null
    else public._scope_norm(site_scope_input)
  end;
begin
  if game_id_input is not null then
    select * into g
    from public.pikken_games
    where id = game_id_input
      and (scope_key is null or public._scope_norm(site_scope) = scope_key)
    limit 1;
  elsif lobby_code_input is not null and btrim(lobby_code_input) <> '' then
    select * into g
    from public.pikken_games
    where upper(coalesce(lobby_code,'')) = upper(btrim(lobby_code_input))
      and (scope_key is null or public._scope_norm(site_scope) = scope_key)
    order by updated_at desc nulls last
    limit 1;
  end if;

  if g.id is null then
    raise exception 'Pikken game niet gevonden.';
  end if;

  st := coalesce(g.state, '{}'::jsonb);
  current_round_no := coalesce(nullif(st->>'round_no','')::int,0);

  for r in
    select seat_index, player_name, ready, dice_count, (eliminated_at is null) as alive
    from public.pikken_game_players
    where game_id = g.id
    order by seat_index
  loop
    players := players || jsonb_build_array(jsonb_build_object(
      'seat', r.seat_index,
      'name', r.player_name,
      'ready', r.ready,
      'dice_count', r.dice_count,
      'alive', r.alive
    ));
  end loop;

  if lower(coalesce(st->>'phase','')) = 'voting' and current_round_no > 0 then
    for r in
      select
        gp.seat_index,
        gp.player_name,
        (
          select v.vote
          from public.pikken_round_votes v
          where v.game_id = g.id
            and v.round_no = current_round_no
            and v.player_id = gp.player_id
        ) as vote_value
      from public.pikken_game_players gp
      where gp.game_id = g.id
        and gp.eliminated_at is null
      order by gp.seat_index
    loop
      votes := votes || jsonb_build_array(jsonb_build_object(
        'seat', r.seat_index,
        'name', r.player_name,
        'status', case when r.vote_value is true then 'approved' when r.vote_value is false then 'rejected' else 'waiting' end
      ));
    end loop;
  end if;

  totals := jsonb_build_object(
    'start_total', (select count(*)*6 from public.pikken_game_players where game_id = g.id),
    'current_total', (select coalesce(sum(dice_count),0) from public.pikken_game_players where game_id = g.id),
    'lost_total', greatest(
      (select count(*)*6 from public.pikken_game_players where game_id = g.id)
      - (select coalesce(sum(dice_count),0) from public.pikken_game_players where game_id = g.id),
      0
    )
  );

  return jsonb_build_object(
    'ok', true,
    'game', jsonb_build_object(
      'id', g.id,
      'lobby_code', g.lobby_code,
      'site_scope', g.site_scope,
      'status', g.status,
      'config', coalesce(g.config, '{}'::jsonb),
      'state', coalesce(g.state, '{}'::jsonb),
      'state_version', g.state_version,
      'updated_at', g.updated_at,
      'finished_at', g.finished_at,
      'last_reveal', coalesce(g.state->'last_reveal', 'null'::jsonb)
    ),
    'players', players,
    'votes', votes,
    'dice_totals', totals
  );
end;
$function$;

grant execute on function public.pikken_get_live_state_public(uuid, text, text) to anon, authenticated, service_role;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;

-- ===== END gejast_v521_pikken_live_state_rewrite.sql =====

-- ===== BEGIN gejast_v548_admin_game_analytics.sql =====

begin;

-- ============================================================
-- GEJAST v548 â€” admin/game analytics + Rad storage
-- Built against repo version v547.
-- Adds richer public stats/admin dashboards for:
-- - Beurs d'Espinoza
-- - Pikken
-- - Paardenrace
-- - 't Rad / Caute Rad
-- ============================================================

create or replace function public._game_admin_require_session(admin_session_token text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_session jsonb;
begin
  v_session := to_jsonb(public.admin_check_session(admin_session_token));
  if v_session is null then
    raise exception 'Geen geldige adminsessie.';
  end if;
  return v_session;
end;
$fn$;

grant execute on function public._game_admin_require_session(text) to anon, authenticated;

create table if not exists public.rad_spin_events (
  spin_id bigint generated by default as identity primary key,
  site_scope text not null default 'friends',
  player_id bigint,
  player_name text not null,
  segment_key text not null,
  segment_label text not null,
  segment_type text,
  chance numeric(8,2),
  copy_text text,
  drinks jsonb not null default '[]'::jsonb,
  spun_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb,
  constraint rad_spin_events_scope_chk check (coalesce(lower(site_scope),'friends') in ('friends','family'))
);
create index if not exists idx_rad_spin_events_scope_time on public.rad_spin_events(site_scope, spun_at desc);
create index if not exists idx_rad_spin_events_scope_player on public.rad_spin_events(site_scope, lower(player_name), spun_at desc);
create index if not exists idx_rad_spin_events_scope_segment on public.rad_spin_events(site_scope, lower(segment_key), spun_at desc);

create table if not exists public.rad_target_events (
  target_event_id bigint generated by default as identity primary key,
  spin_id bigint references public.rad_spin_events(spin_id) on delete cascade,
  site_scope text not null default 'friends',
  nominator_player_name text not null,
  target_player_name text not null,
  segment_key text not null,
  segment_label text not null,
  created_at timestamptz not null default now(),
  meta jsonb not null default '{}'::jsonb,
  constraint rad_target_events_scope_chk check (coalesce(lower(site_scope),'friends') in ('friends','family'))
);
create index if not exists idx_rad_target_events_scope_time on public.rad_target_events(site_scope, created_at desc);
create index if not exists idx_rad_target_events_scope_target on public.rad_target_events(site_scope, lower(target_player_name), created_at desc);
create index if not exists idx_rad_target_events_scope_nominator on public.rad_target_events(site_scope, lower(nominator_player_name), created_at desc);

create or replace function public.rad_log_spin_scoped(
  session_token text default null,
  session_token_input text default null,
  segment_key_input text default null,
  segment_label_input text default null,
  segment_type_input text default null,
  chance_input numeric default null,
  copy_text_input text default null,
  drinks_input jsonb default '[]'::jsonb,
  meta_input jsonb default '{}'::jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_player public.players%rowtype;
  v_token text := nullif(trim(coalesce(session_token, session_token_input, '')), '');
  v_spin_id bigint;
  v_key text := nullif(trim(coalesce(segment_key_input,'')), '');
  v_label text := nullif(trim(coalesce(segment_label_input,'')), '');
begin
  if v_token is null then
    raise exception 'Log eerst in als speler.';
  end if;

  v_player := public._gejast_player_from_session(v_token);
  if v_player.id is null or nullif(trim(coalesce(v_player.chosen_username,'')), '') is null then
    raise exception 'Log eerst in als speler.';
  end if;

  if v_key is null then
    v_key := lower(regexp_replace(coalesce(v_label, 'rad-spin'), '[^a-z0-9]+', '_', 'gi'));
  end if;
  if v_label is null then
    v_label := replace(initcap(replace(v_key, '_', ' ')), ' Adt', ' adt');
  end if;

  insert into public.rad_spin_events(
    site_scope, player_id, player_name, segment_key, segment_label, segment_type, chance, copy_text, drinks, meta
  ) values (
    v_scope, v_player.id, v_player.chosen_username, v_key, v_label, nullif(trim(coalesce(segment_type_input,'')), ''), chance_input, nullif(trim(coalesce(copy_text_input,'')), ''), coalesce(drinks_input, '[]'::jsonb), coalesce(meta_input, '{}'::jsonb)
  ) returning spin_id into v_spin_id;

  return jsonb_build_object(
    'spin_id', v_spin_id,
    'player_name', v_player.chosen_username,
    'segment_key', v_key,
    'segment_label', v_label,
    'site_scope', v_scope
  );
end;
$fn$;

grant execute on function public.rad_log_spin_scoped(text,text,text,text,text,numeric,text,jsonb,jsonb,text) to anon, authenticated;

create or replace function public.rad_log_target_nomination_scoped(
  session_token text default null,
  session_token_input text default null,
  spin_id_input bigint default null,
  segment_key_input text default null,
  segment_label_input text default null,
  target_player_name_input text default null,
  meta_input jsonb default '{}'::jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_player public.players%rowtype;
  v_token text := nullif(trim(coalesce(session_token, session_token_input, '')), '');
  v_target text := nullif(trim(coalesce(target_player_name_input,'')), '');
  v_id bigint;
  v_spin public.rad_spin_events%rowtype;
begin
  if v_token is null then
    raise exception 'Log eerst in als speler.';
  end if;
  if v_target is null then
    raise exception 'Kies eerst een speler.';
  end if;

  v_player := public._gejast_player_from_session(v_token);
  if v_player.id is null or nullif(trim(coalesce(v_player.chosen_username,'')), '') is null then
    raise exception 'Log eerst in als speler.';
  end if;

  if spin_id_input is not null then
    select * into v_spin
    from public.rad_spin_events
    where spin_id = spin_id_input
      and site_scope = v_scope;
  end if;

  insert into public.rad_target_events(
    spin_id, site_scope, nominator_player_name, target_player_name, segment_key, segment_label, meta
  ) values (
    v_spin.spin_id,
    v_scope,
    v_player.chosen_username,
    v_target,
    coalesce(nullif(trim(coalesce(segment_key_input,'')), ''), v_spin.segment_key, 'target'),
    coalesce(nullif(trim(coalesce(segment_label_input,'')), ''), v_spin.segment_label, 'Uitdeel-opdracht'),
    coalesce(meta_input, '{}'::jsonb)
  ) returning target_event_id into v_id;

  return jsonb_build_object('target_event_id', v_id, 'target_player_name', v_target, 'site_scope', v_scope);
end;
$fn$;

grant execute on function public.rad_log_target_nomination_scoped(text,text,bigint,text,text,text,jsonb,text) to anon, authenticated;

create or replace function public.get_rad_stats_scoped(
  site_scope_input text default 'friends',
  limit_count integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_limit integer := greatest(5, least(coalesce(limit_count, 30), 120));
begin
  return jsonb_build_object(
    'overview_cards', jsonb_build_array(
      jsonb_build_object('label','Spins', 'value', coalesce((select count(*) from public.rad_spin_events where site_scope = v_scope),0), 'sub','Opgeslagen Caute Rad-draaien'),
      jsonb_build_object('label','Unieke draaiers', 'value', coalesce((select count(distinct lower(player_name)) from public.rad_spin_events where site_scope = v_scope),0), 'sub','Spelers met minstens Ã©Ã©n gelogde spin'),
      jsonb_build_object('label','Uitdeel-spins', 'value', coalesce((select count(*) from public.rad_spin_events where site_scope = v_scope and coalesce(lower(segment_type),'') = 'target'),0), 'sub','Spins waarbij iemand werd aangewezen'),
      jsonb_build_object('label','Aangewezen spelers', 'value', coalesce((select count(*) from public.rad_target_events where site_scope = v_scope),0), 'sub','Opgeslagen target-nominaties')
    ),
    'story_cards', jsonb_build_array(
      jsonb_build_object('label','Heetste segment', 'value', coalesce((select segment_label from public.rad_spin_events where site_scope = v_scope group by segment_label order by count(*) desc, max(spun_at) desc limit 1),'â€”'), 'sub', coalesce((select count(*)::text || ' keer geraakt' from public.rad_spin_events where site_scope = v_scope and segment_label = (select segment_label from public.rad_spin_events where site_scope = v_scope group by segment_label order by count(*) desc, max(spun_at) desc limit 1)),'Nog geen data')),
      jsonb_build_object('label','Chaoskapitein', 'value', coalesce((select player_name from public.rad_spin_events where site_scope = v_scope group by player_name order by count(*) desc, max(spun_at) desc limit 1),'â€”'), 'sub', coalesce((select count(*)::text || ' spins' from public.rad_spin_events where site_scope = v_scope and lower(player_name)=lower((select player_name from public.rad_spin_events where site_scope=v_scope group by player_name order by count(*) desc, max(spun_at) desc limit 1))),'Nog geen data')),
      jsonb_build_object('label','Meest geraakt', 'value', coalesce((select target_player_name from public.rad_target_events where site_scope = v_scope group by target_player_name order by count(*) desc, max(created_at) desc limit 1),'â€”'), 'sub', coalesce((select count(*)::text || ' keer uitgekozen' from public.rad_target_events where site_scope = v_scope and lower(target_player_name)=lower((select target_player_name from public.rad_target_events where site_scope=v_scope group by target_player_name order by count(*) desc, max(created_at) desc limit 1))),'Nog geen data'))
    ),
    'leaderboard_sections', jsonb_build_array(
      jsonb_build_object(
        'title','Populairste segmenten',
        'subtitle','Welke straffen of twists het vaakst landen.',
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object('label', segment_label, 'value', count(*), 'sub', coalesce(max(segment_type),'segment')) order by count(*) desc, max(spun_at) desc)
          from public.rad_spin_events
          where site_scope = v_scope
          group by segment_label
          order by count(*) desc, max(spun_at) desc
          limit 8
        ), '[]'::jsonb)
      ),
      jsonb_build_object(
        'title','Fanatiekste draaiers',
        'subtitle','Wie het rad het vaakst heeft getest.',
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object('label', player_name, 'value', count(*), 'sub', coalesce(sum(case when coalesce(lower(segment_type),'')='target' then 1 else 0 end),0)::text || ' target-spins') order by count(*) desc, max(spun_at) desc)
          from public.rad_spin_events
          where site_scope = v_scope
          group by player_name
          order by count(*) desc, max(spun_at) desc
          limit 8
        ), '[]'::jsonb)
      ),
      jsonb_build_object(
        'title','Vaakst aangewezen',
        'subtitle','De pechvogels van het rad.',
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object('label', target_player_name, 'value', count(*), 'sub', min(segment_label)) order by count(*) desc, max(created_at) desc)
          from public.rad_target_events
          where site_scope = v_scope
          group by target_player_name
          order by count(*) desc, max(created_at) desc
          limit 8
        ), '[]'::jsonb)
      )
    ),
    'table_sections', jsonb_build_array(
      jsonb_build_object(
        'title','Recente spins',
        'subtitle','Laatste opgeslagen uitkomsten van het rad.',
        'columns', jsonb_build_array('Tijd','Speler','Segment','Type'),
        'rows', coalesce((
          select jsonb_agg(jsonb_build_array(to_char(spun_at at time zone 'Europe/Amsterdam', 'DD-MM HH24:MI'), player_name, segment_label, coalesce(segment_type,'â€”')) order by spun_at desc)
          from (
            select spun_at, player_name, segment_label, segment_type
            from public.rad_spin_events
            where site_scope = v_scope
            order by spun_at desc
            limit v_limit
          ) q
        ), '[]'::jsonb)
      )
    ),
    'recent_rows', coalesce((
      select jsonb_agg(jsonb_build_object('title', segment_label, 'sub', player_name, 'value', coalesce(segment_type,'spin'), 'meta', to_char(spun_at at time zone 'Europe/Amsterdam','DD-MM HH24:MI')) order by spun_at desc)
      from (
        select spun_at, player_name, segment_label, segment_type
        from public.rad_spin_events
        where site_scope = v_scope
        order by spun_at desc
        limit v_limit
      ) q
    ), '[]'::jsonb)
  );
end;
$fn$;

grant execute on function public.get_rad_stats_scoped(text,integer) to anon, authenticated;

create or replace function public.admin_get_rad_dashboard_action(
  admin_session_token text,
  site_scope_input text default 'friends',
  limit_count integer default 40
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_admin jsonb := public._game_admin_require_session(admin_session_token);
begin
  return public.get_rad_stats_scoped(v_scope, limit_count) || jsonb_build_object(
    'ops_cards', jsonb_build_array(
      jsonb_build_object('label','Laatste 24u spins', 'value', coalesce((select count(*) from public.rad_spin_events where site_scope=v_scope and spun_at >= now()-interval '24 hours'),0), 'sub','Recente activiteit'),
      jsonb_build_object('label','Laatste 7d nominaties', 'value', coalesce((select count(*) from public.rad_target_events where site_scope=v_scope and created_at >= now()-interval '7 days'),0), 'sub','Target-penalties in de afgelopen week'),
      jsonb_build_object('label','Admin', 'value', coalesce(v_admin->>'admin_username', v_admin->>'username', 'admin'), 'sub','Ingelogde adminsessie')
    )
  );
end;
$fn$;

grant execute on function public.admin_get_rad_dashboard_action(text,text,integer) to anon, authenticated;

create or replace function public.get_pikken_stats_scoped(
  site_scope_input text default 'friends',
  limit_count integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_limit integer := greatest(5, least(coalesce(limit_count, 30), 120));
begin
  return jsonb_build_object(
    'summary', jsonb_build_object(
      'matches_played', coalesce((select count(*) from public.pikken_matches where site_scope = v_scope),0),
      'unique_players', coalesce((select count(distinct lower(player_name)) from public.pikken_game_players gp join public.pikken_games g on g.id = gp.game_id where g.site_scope = v_scope),0),
      'avg_players_per_game', coalesce((select round(avg(cnt)::numeric, 2) from (select count(*)::numeric cnt from public.pikken_game_players gp join public.pikken_games g on g.id = gp.game_id where g.site_scope = v_scope and g.status='finished' group by gp.game_id) q),0),
      'reject_rate', coalesce((select round((count(*) filter (where v.vote = false))::numeric / nullif(count(*),0), 4) from public.pikken_round_votes v join public.pikken_games g on g.id = v.game_id where g.site_scope = v_scope and g.status='finished'),0),
      'correct_reject_rate', coalesce((select round((count(*) filter (where v.vote = false))::numeric / nullif(count(*),0), 4) from public.pikken_round_votes v join public.pikken_games g on g.id = v.game_id where g.site_scope = v_scope and g.status='finished'),0),
      'bluff_callout_rate', coalesce((select round((count(*) filter (where v.vote = false))::numeric / nullif(count(*),0), 4) from public.pikken_round_votes v join public.pikken_games g on g.id = v.game_id where g.site_scope = v_scope and g.status='finished'),0),
      'pik_bid_rate', 0,
      'sixes_rolled', coalesce((select count(*) from public.pikken_round_hands h join public.pikken_games g on g.id = h.game_id cross join lateral unnest(h.dice_values) die where g.site_scope = v_scope and die = 6),0)
    ),
    'overview_cards', jsonb_build_array(
      jsonb_build_object('label','Finished matches','value', coalesce((select count(*) from public.pikken_matches where site_scope = v_scope),0), 'sub','Afgeronde Pikken-potjes'),
      jsonb_build_object('label','Gem. tafelgrootte','value', coalesce((select round(avg(cnt)::numeric,1)::text from (select count(*)::numeric cnt from public.pikken_game_players gp join public.pikken_games g on g.id = gp.game_id where g.site_scope = v_scope and g.status='finished' group by gp.game_id) q),'0'), 'sub','Spelers per afgerond spel'),
      jsonb_build_object('label','Reject-rate','value', coalesce((select concat(round(100 * ((count(*) filter (where v.vote = false))::numeric / nullif(count(*),0))), '%') from public.pikken_round_votes v join public.pikken_games g on g.id=v.game_id where g.site_scope=v_scope and g.status='finished'),'0%'), 'sub','Hoe vaak er werd afgekeurd'),
      jsonb_build_object('label','Gegooide zesjes','value', coalesce((select count(*)::text from public.pikken_round_hands h join public.pikken_games g on g.id=h.game_id cross join lateral unnest(h.dice_values) die where g.site_scope=v_scope and die=6),'0'), 'sub','Alle gelogde zesjes')
    ),
    'story_cards', jsonb_build_array(
      jsonb_build_object('label','Tafelkoning','value', coalesce((select payload->>'winner_name' from public.pikken_matches where site_scope = v_scope group by payload->>'winner_name' order by count(*) desc, max(finished_at) desc limit 1),'â€”'), 'sub', coalesce((select count(*)::text || ' winstpotjes' from public.pikken_matches where site_scope=v_scope and lower(coalesce(payload->>'winner_name','')) = lower((select payload->>'winner_name' from public.pikken_matches where site_scope = v_scope group by payload->>'winner_name' order by count(*) desc, max(finished_at) desc limit 1))),'Nog geen winnaar')),
      jsonb_build_object('label','Afkeur-koning','value', coalesce((select gp.player_name from public.pikken_round_votes v join public.pikken_games g on g.id=v.game_id join public.pikken_game_players gp on gp.game_id=v.game_id and gp.player_id=v.player_id where g.site_scope=v_scope and v.vote=false group by gp.player_name order by count(*) desc, max(v.voted_at) desc limit 1),'â€”'), 'sub', coalesce((select count(*)::text || ' afkeuren' from public.pikken_round_votes v join public.pikken_games g on g.id=v.game_id join public.pikken_game_players gp on gp.game_id=v.game_id and gp.player_id=v.player_id where g.site_scope=v_scope and v.vote=false and lower(gp.player_name)=lower((select gp.player_name from public.pikken_round_votes v join public.pikken_games g on g.id=v.game_id join public.pikken_game_players gp on gp.game_id=v.game_id and gp.player_id=v.player_id where g.site_scope=v_scope and v.vote=false group by gp.player_name order by count(*) desc, max(v.voted_at) desc limit 1))),'Nog geen afkeuren')),
      jsonb_build_object('label','Zesjesmagneet','value', coalesce((select gp.player_name from public.pikken_round_hands h join public.pikken_games g on g.id=h.game_id join public.pikken_game_players gp on gp.game_id=h.game_id and gp.player_id=h.player_id cross join lateral unnest(h.dice_values) die where g.site_scope=v_scope and die=6 group by gp.player_name order by count(*) desc, max(h.created_at) desc limit 1),'â€”'), 'sub', coalesce((select count(*)::text || ' zesjes' from public.pikken_round_hands h join public.pikken_games g on g.id=h.game_id join public.pikken_game_players gp on gp.game_id=h.game_id and gp.player_id=h.player_id cross join lateral unnest(h.dice_values) die where g.site_scope=v_scope and die=6 and lower(gp.player_name)=lower((select gp.player_name from public.pikken_round_hands h join public.pikken_games g on g.id=h.game_id join public.pikken_game_players gp on gp.game_id=h.game_id and gp.player_id=h.player_id cross join lateral unnest(h.dice_values) die where g.site_scope=v_scope and die=6 group by gp.player_name order by count(*) desc, max(h.created_at) desc limit 1))),'Nog geen zesjes'))
    ),
    'leaderboard_sections', jsonb_build_array(
      jsonb_build_object(
        'title','Winnaars','subtitle','Meeste afgeronde Pikken-wins.',
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object('label', coalesce(payload->>'winner_name','Onbekend'), 'value', count(*), 'sub', 'potjes gewonnen') order by count(*) desc, max(finished_at) desc)
          from public.pikken_matches
          where site_scope = v_scope
          group by payload->>'winner_name'
          order by count(*) desc, max(finished_at) desc
          limit 8
        ), '[]'::jsonb)
      ),
      jsonb_build_object(
        'title','Afkeurders','subtitle','Wie het vaakst de bluff callt.',
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object('label', gp.player_name, 'value', count(*), 'sub', 'afkeuren') order by count(*) desc, max(v.voted_at) desc)
          from public.pikken_round_votes v
          join public.pikken_games g on g.id = v.game_id
          join public.pikken_game_players gp on gp.game_id = v.game_id and gp.player_id = v.player_id
          where g.site_scope = v_scope and v.vote = false
          group by gp.player_name
          order by count(*) desc, max(v.voted_at) desc
          limit 8
        ), '[]'::jsonb)
      ),
      jsonb_build_object(
        'title','Zesjesmachine','subtitle','Wie er het vaakst een zes uit schudt.',
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object('label', gp.player_name, 'value', count(*), 'sub', 'zesjes') order by count(*) desc, max(h.created_at) desc)
          from public.pikken_round_hands h
          join public.pikken_games g on g.id = h.game_id
          join public.pikken_game_players gp on gp.game_id = h.game_id and gp.player_id = h.player_id
          cross join lateral unnest(h.dice_values) die
          where g.site_scope = v_scope and die = 6
          group by gp.player_name
          order by count(*) desc, max(h.created_at) desc
          limit 8
        ), '[]'::jsonb)
      )
    ),
    'table_sections', jsonb_build_array(
      jsonb_build_object(
        'title','Recente matches',
        'subtitle','Laatste afgeronde Pikken-potjes.',
        'columns', jsonb_build_array('Tijd','Lobby','Winnaar','Spelers','Rondes'),
        'rows', coalesce((
          select jsonb_agg(jsonb_build_array(
            to_char(coalesce(g.finished_at, m.finished_at) at time zone 'Europe/Amsterdam', 'DD-MM HH24:MI'),
            coalesce(g.lobby_code, m.payload->>'lobby_code', 'â€”'),
            coalesce(nullif(m.payload->>'winner_name',''),'â€”'),
            coalesce((select count(*)::text from public.pikken_game_players gp where gp.game_id = g.id),'0'),
            coalesce(g.state->>'round_no','0')
          ) order by coalesce(g.finished_at, m.finished_at) desc)
          from (
            select *
            from public.pikken_matches
            where site_scope = v_scope
            order by finished_at desc
            limit v_limit
          ) m
          left join public.pikken_games g on g.id = m.game_id
        ), '[]'::jsonb)
      )
    ),
    'recent_rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', coalesce(nullif(m.payload->>'winner_name',''),'Onbekend'),
        'sub', coalesce(g.lobby_code, m.payload->>'lobby_code', 'Lobby'),
        'value', coalesce((select count(*)::text from public.pikken_game_players gp where gp.game_id = g.id), '0') || ' spelers',
        'meta', to_char(coalesce(g.finished_at, m.finished_at) at time zone 'Europe/Amsterdam', 'DD-MM HH24:MI')
      ) order by coalesce(g.finished_at, m.finished_at) desc)
      from (
        select * from public.pikken_matches where site_scope = v_scope order by finished_at desc limit v_limit
      ) m
      left join public.pikken_games g on g.id = m.game_id
    ), '[]'::jsonb)
  );
end;
$fn$;

grant execute on function public.get_pikken_stats_scoped(text,integer) to anon, authenticated;

create or replace function public.admin_get_pikken_dashboard_action(
  admin_session_token text,
  site_scope_input text default 'friends',
  limit_count integer default 40
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_admin jsonb := public._game_admin_require_session(admin_session_token);
begin
  return public.get_pikken_stats_scoped(v_scope, limit_count) || jsonb_build_object(
    'ops_cards', jsonb_build_array(
      jsonb_build_object('label','Lobbytafels', 'value', coalesce((select count(*) from public.pikken_games where site_scope=v_scope and status='lobby'),0), 'sub','Open tafels die nog niet gestart zijn'),
      jsonb_build_object('label','Live tafels', 'value', coalesce((select count(*) from public.pikken_games where site_scope=v_scope and status='live'),0), 'sub','Actieve live potjes'),
      jsonb_build_object('label','Admin', 'value', coalesce(v_admin->>'admin_username', v_admin->>'username', 'admin'), 'sub','Ingelogde adminsessie')
    )
  );
end;
$fn$;

grant execute on function public.admin_get_pikken_dashboard_action(text,text,integer) to anon, authenticated;

create or replace function public.get_paardenrace_stats_scoped(
  site_scope_input text default 'friends',
  limit_count integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_limit integer := greatest(5, least(coalesce(limit_count, 30), 120));
begin
  return jsonb_build_object(
    'overview_cards', jsonb_build_array(
      jsonb_build_object('label','Races', 'value', coalesce((select count(*) from public.paardenrace_match_history),0), 'sub','Afgeronde paardenraces'),
      jsonb_build_object('label','Gem. starters', 'value', coalesce((select round(avg(player_count)::numeric,1)::text from (select jsonb_array_length(coalesce(summary_payload->'per_player','[]'::jsonb)) as player_count from public.paardenrace_match_history) q),'0'), 'sub','Spelers per race'),
      jsonb_build_object('label','Totaal bakken', 'value', coalesce((select sum(amount_bakken)::text from public.paardenrace_obligations), '0'), 'sub','Opgeslagen drankschuld uit paardenrace'),
      jsonb_build_object('label','Unieke jockeys', 'value', coalesce((select count(distinct lower(player_name)) from public.paardenrace_obligations),0), 'sub','Spelers die een bak opbouwden of kregen')
    ),
    'story_cards', jsonb_build_array(
      jsonb_build_object('label','Favoriete suit', 'value', coalesce((select winner_suit from public.paardenrace_match_history group by winner_suit order by count(*) desc, max(finished_at) desc limit 1),'â€”'), 'sub', coalesce((select count(*)::text || ' wins' from public.paardenrace_match_history where winner_suit = (select winner_suit from public.paardenrace_match_history group by winner_suit order by count(*) desc, max(finished_at) desc limit 1)),'Nog geen races')),
      jsonb_build_object('label','Topjockey', 'value', coalesce((
        select x.player_name
        from (
          select coalesce(pp->>'player_name','') as player_name, count(*) as wins
          from public.paardenrace_match_history h
          cross join lateral jsonb_array_elements(coalesce(h.summary_payload->'per_player','[]'::jsonb)) pp
          where coalesce((pp->>'is_winner')::boolean, false) is true
          group by coalesce(pp->>'player_name','')
        ) x order by x.wins desc, x.player_name asc limit 1
      ),'â€”'), 'sub', coalesce((
        select x.wins::text || ' winraces'
        from (
          select coalesce(pp->>'player_name','') as player_name, count(*) as wins
          from public.paardenrace_match_history h
          cross join lateral jsonb_array_elements(coalesce(h.summary_payload->'per_player','[]'::jsonb)) pp
          where coalesce((pp->>'is_winner')::boolean, false) is true
          group by coalesce(pp->>'player_name','')
        ) x order by x.wins desc, x.player_name asc limit 1
      ),'Nog geen races')),
      jsonb_build_object('label','Bakmagneet', 'value', coalesce((select player_name from public.paardenrace_obligations group by player_name order by sum(amount_bakken) desc, max(created_at) desc limit 1),'â€”'), 'sub', coalesce((select sum(amount_bakken)::text || ' bakken' from public.paardenrace_obligations where lower(player_name)=lower((select player_name from public.paardenrace_obligations group by player_name order by sum(amount_bakken) desc, max(created_at) desc limit 1))),'Nog geen schulden'))
    ),
    'leaderboard_sections', jsonb_build_array(
      jsonb_build_object(
        'title','Jockeyklassement', 'subtitle','Wie de meeste races won vanuit de juiste suit.',
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object('label', player_name, 'value', wins, 'sub', 'winnende suits') order by wins desc, player_name asc)
          from (
            select coalesce(pp->>'player_name','') as player_name, count(*) as wins
            from public.paardenrace_match_history h
            cross join lateral jsonb_array_elements(coalesce(h.summary_payload->'per_player','[]'::jsonb)) pp
            where coalesce((pp->>'is_winner')::boolean, false) is true
            group by coalesce(pp->>'player_name','')
            order by wins desc, player_name asc
            limit 8
          ) q
        ), '[]'::jsonb)
      ),
      jsonb_build_object(
        'title','Bakdruk', 'subtitle','Wie de meeste bakken ophoopte.',
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object('label', player_name, 'value', total_bakken, 'sub', 'bakken totaal') order by total_bakken desc, player_name asc)
          from (
            select player_name, sum(amount_bakken)::bigint as total_bakken
            from public.paardenrace_obligations
            group by player_name
            order by total_bakken desc, player_name asc
            limit 8
          ) q
        ), '[]'::jsonb)
      ),
      jsonb_build_object(
        'title','Suit-meta', 'subtitle','Welke suit het vaakst als winnaar eindigt.',
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object('label', winner_suit, 'value', cnt, 'sub', 'gewonnen races') order by cnt desc, winner_suit asc)
          from (
            select coalesce(winner_suit,'onbekend') as winner_suit, count(*) as cnt
            from public.paardenrace_match_history
            group by coalesce(winner_suit,'onbekend')
            order by cnt desc, winner_suit asc
            limit 8
          ) q
        ), '[]'::jsonb)
      )
    ),
    'table_sections', jsonb_build_array(
      jsonb_build_object(
        'title','Recente races',
        'subtitle','Laatste geclaimde finishes.',
        'columns', jsonb_build_array('Tijd','Room','Winnaar-suit','Spelers','Totaal bakken'),
        'rows', coalesce((
          select jsonb_agg(jsonb_build_array(
            to_char(finished_at at time zone 'Europe/Amsterdam', 'DD-MM HH24:MI'),
            coalesce(room_code,'â€”'),
            coalesce(winner_suit,'â€”'),
            jsonb_array_length(coalesce(summary_payload->'per_player','[]'::jsonb)),
            coalesce((select sum((pp->>'total_bakken_owed')::int) from jsonb_array_elements(coalesce(summary_payload->'per_player','[]'::jsonb)) pp),0)
          ) order by finished_at desc)
          from (
            select * from public.paardenrace_match_history order by finished_at desc limit v_limit
          ) q
        ), '[]'::jsonb)
      )
    ),
    'recent_rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', coalesce(room_code,'Room'),
        'sub', coalesce(winner_suit,'â€”'),
        'value', jsonb_array_length(coalesce(summary_payload->'per_player','[]'::jsonb))::text || ' spelers',
        'meta', to_char(finished_at at time zone 'Europe/Amsterdam', 'DD-MM HH24:MI')
      ) order by finished_at desc)
      from (
        select * from public.paardenrace_match_history order by finished_at desc limit v_limit
      ) q
    ), '[]'::jsonb)
  );
end;
$fn$;

grant execute on function public.get_paardenrace_stats_scoped(text,integer) to anon, authenticated;

create or replace function public.admin_get_paardenrace_dashboard_action(
  admin_session_token text,
  site_scope_input text default 'friends',
  limit_count integer default 40
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_admin jsonb := public._game_admin_require_session(admin_session_token);
begin
  return public.get_paardenrace_stats_scoped(v_scope, limit_count) || jsonb_build_object(
    'ops_cards', jsonb_build_array(
      jsonb_build_object('label','Open rooms', 'value', coalesce((select count(*) from public.paardenrace_rooms where stage='lobby'),0), 'sub','Nog niet gestarte lobbys'),
      jsonb_build_object('label','Actieve races', 'value', coalesce((select count(*) from public.paardenrace_rooms where stage in ('countdown','live','nominations')),0), 'sub','Rooms in countdown/live/nominaties'),
      jsonb_build_object('label','Admin', 'value', coalesce(v_admin->>'admin_username', v_admin->>'username', 'admin'), 'sub','Ingelogde adminsessie')
    )
  );
end;
$fn$;

grant execute on function public.admin_get_paardenrace_dashboard_action(text,text,integer) to anon, authenticated;

create or replace function public.despimarkt_get_stats_scoped(
  session_token text default null,
  site_scope_input text default 'friends',
  limit_count integer default 30
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_limit integer := greatest(5, least(coalesce(limit_count, 30), 120));
  v_name text;
begin
  begin
    v_name := public._gejast_name_for_session(nullif(trim(coalesce(session_token,'')), ''));
  exception when others then
    v_name := null;
  end;

  return jsonb_build_object(
    'overview_cards', jsonb_build_array(
      jsonb_build_object('label','Open markets','value', coalesce((select count(*) from public.despimarkt_markets where site_scope=v_scope and status='open'),0), 'sub','Nog open voor actie'),
      jsonb_build_object('label','Resolved','value', coalesce((select count(*) from public.despimarkt_markets where site_scope=v_scope and status='resolved'),0), 'sub','Afgewikkelde markten'),
      jsonb_build_object('label','Volume','value', coalesce((select sum(stake_cautes)::bigint from public.despimarkt_positions where site_scope=v_scope),0), 'sub','Totale ingezet in cautes'),
      jsonb_build_object('label','Watchers','value', coalesce((select count(*) from public.despimarkt_market_watchers where site_scope=v_scope),0), 'sub','Volgrelaties over alle markten')
    ),
    'story_cards', jsonb_build_array(
      jsonb_build_object('label','Grootste payout','value', coalesce((select player_name from public.despimarkt_market_payouts where site_scope=v_scope order by payout_cautes desc, created_at desc limit 1),'â€”'), 'sub', coalesce((select payout_cautes::text || ' â‚µ' from public.despimarkt_market_payouts where site_scope=v_scope order by payout_cautes desc, created_at desc limit 1),'Nog geen settlements')),
      jsonb_build_object('label','Hotste tag','value', coalesce((select tag from (select unnest(coalesce(market_tags, array[]::text[])) as tag from public.despimarkt_markets where site_scope=v_scope) t group by tag order by count(*) desc, tag asc limit 1),'â€”'), 'sub', coalesce((select count(*)::text || ' markten' from (select unnest(coalesce(market_tags, array[]::text[])) as tag from public.despimarkt_markets where site_scope=v_scope) t where lower(tag)=lower((select tag from (select unnest(coalesce(market_tags, array[]::text[])) as tag from public.despimarkt_markets where site_scope=v_scope) t2 group by tag order by count(*) desc, tag asc limit 1))),'Nog geen tags')),
      jsonb_build_object('label','Rijkste speler','value', coalesce((select player_name from public.despimarkt_caute_balance_view where site_scope=v_scope order by balance_cautes desc, lower(player_name) asc limit 1),'â€”'), 'sub', coalesce((select balance_cautes::text || ' â‚µ' from public.despimarkt_caute_balance_view where site_scope=v_scope order by balance_cautes desc, lower(player_name) asc limit 1),'Nog geen walletdata')),
      jsonb_build_object('label','Jouw watchlist','value', case when nullif(trim(coalesce(v_name,'')), '') is null then 'â€”' else coalesce((select count(*)::text from public.despimarkt_market_watchers where site_scope=v_scope and lower(player_name)=lower(v_name)),'0') end, 'sub', case when nullif(trim(coalesce(v_name,'')), '') is null then 'Log in voor persoonlijke watch-data.' else 'Markten die jij volgt' end)
    ),
    'leaderboard_sections', jsonb_build_array(
      jsonb_build_object(
        'title','Hoogste balances', 'subtitle','Wie het meeste cautes aanhoudt.',
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object('label', player_name, 'value', balance_cautes, 'sub', coalesce(markets_joined,0)::text || ' joined / ' || coalesce(markets_won,0)::text || ' won') order by balance_cautes desc, lower(player_name) asc)
          from (
            select b.player_name, b.balance_cautes,
              (select count(distinct market_id) from public.despimarkt_positions p where p.site_scope=b.site_scope and lower(p.player_name)=lower(b.player_name)) as markets_joined,
              (select count(distinct mp.market_id) from public.despimarkt_market_payouts mp where mp.site_scope=b.site_scope and lower(mp.player_name)=lower(b.player_name) and mp.payout_cautes > 0) as markets_won
            from public.despimarkt_caute_balance_view b
            where b.site_scope = v_scope
            order by b.balance_cautes desc, lower(b.player_name) asc
            limit 8
          ) q
        ), '[]'::jsonb)
      ),
      jsonb_build_object(
        'title','Populaire tags', 'subtitle','Welke themaâ€™s de hub dragen.',
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object('label', tag, 'value', cnt, 'sub', watcher_count::text || ' watchers') order by cnt desc, tag asc)
          from (
            select tag, count(*) as cnt,
              coalesce((select count(*) from public.despimarkt_market_watchers w join public.despimarkt_markets m on m.market_id=w.market_id where m.site_scope=v_scope and tag = any(coalesce(m.market_tags, array[]::text[]))),0) as watcher_count
            from (
              select unnest(coalesce(market_tags, array[]::text[])) as tag
              from public.despimarkt_markets
              where site_scope = v_scope
            ) tags
            group by tag
            order by cnt desc, tag asc
            limit 8
          ) q
        ), '[]'::jsonb)
      ),
      jsonb_build_object(
        'title','Grootste payouts', 'subtitle','Winnaars van de vetste settlement-momenten.',
        'rows', coalesce((
          select jsonb_agg(jsonb_build_object('label', player_name, 'value', payout_cautes, 'sub', coalesce(m.title,'Market')) order by payout_cautes desc, created_at desc)
          from (
            select mp.player_name, mp.payout_cautes, mp.created_at, dm.title
            from public.despimarkt_market_payouts mp
            left join public.despimarkt_markets dm on dm.market_id = mp.market_id
            where mp.site_scope = v_scope
            order by mp.payout_cautes desc, mp.created_at desc
            limit 8
          ) q(player_name, payout_cautes, created_at, title)
        ), '[]'::jsonb)
      )
    ),
    'table_sections', jsonb_build_array(
      jsonb_build_object(
        'title','Recente settlements',
        'subtitle','Laatste afgewikkelde Beurs d''Espinoza-markten.',
        'columns', jsonb_build_array('Tijd','Market','Winnaar','Pot','Watchers'),
        'rows', coalesce((
          select jsonb_agg(jsonb_build_array(
            to_char(coalesce(m.resolved_at,m.updated_at) at time zone 'Europe/Amsterdam','DD-MM HH24:MI'),
            m.title,
            case when m.winning_outcome_key='A' then m.outcome_a_label when m.winning_outcome_key='B' then m.outcome_b_label else 'â€”' end,
            coalesce((select sum(p.stake_cautes)::bigint from public.despimarkt_positions p where p.market_id=m.market_id),0),
            coalesce((select count(*) from public.despimarkt_market_watchers w where w.market_id=m.market_id),0)
          ) order by coalesce(m.resolved_at,m.updated_at) desc)
          from (
            select *
            from public.despimarkt_markets
            where site_scope=v_scope and status in ('resolved','cancelled')
            order by coalesce(resolved_at,updated_at) desc
            limit v_limit
          ) m
        ), '[]'::jsonb)
      )
    ),
    'recent_rows', coalesce((
      select jsonb_agg(jsonb_build_object(
        'title', m.title,
        'sub', case when m.status='resolved' then 'Resolved' else initcap(m.status) end,
        'value', coalesce((select sum(stake_cautes)::bigint from public.despimarkt_positions p where p.market_id=m.market_id),0)::text || ' â‚µ pot',
        'meta', to_char(coalesce(m.resolved_at,m.updated_at,m.created_at) at time zone 'Europe/Amsterdam', 'DD-MM HH24:MI')
      ) order by coalesce(m.resolved_at,m.updated_at,m.created_at) desc)
      from (
        select *
        from public.despimarkt_markets
        where site_scope=v_scope
        order by coalesce(resolved_at,updated_at,created_at) desc
        limit v_limit
      ) m
    ), '[]'::jsonb)
  );
end;
$fn$;

grant execute on function public.despimarkt_get_stats_scoped(text,text,integer) to anon, authenticated;

create or replace function public.admin_get_despimarkt_insights_action(
  admin_session_token text,
  site_scope_input text default 'friends',
  limit_count integer default 40
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_admin jsonb := public._game_admin_require_session(admin_session_token);
begin
  return public.despimarkt_get_stats_scoped(null, v_scope, limit_count) || jsonb_build_object(
    'ops_cards', jsonb_build_array(
      jsonb_build_object('label','Awaiting resolution', 'value', coalesce((select count(*) from public.despimarkt_markets where site_scope=v_scope and status='awaiting_resolution'),0), 'sub','Klaar voor admin-resolutie'),
      jsonb_build_object('label','Open debts', 'value', coalesce((select count(*) from public.despimarkt_drink_debts where site_scope=v_scope and status in ('open','pending_verification')),0), 'sub','Nog lopende drinkschulden'),
      jsonb_build_object('label','Frozen spelers', 'value', coalesce((select count(*) from public.despimarkt_player_restrictions where site_scope=v_scope and is_frozen = true),0), 'sub','Actieve Dry Dock-blokkades'),
      jsonb_build_object('label','Admin', 'value', coalesce(v_admin->>'admin_username', v_admin->>'username', 'admin'), 'sub','Ingelogde adminsessie')
    )
  );
end;
$fn$;

grant execute on function public.admin_get_despimarkt_insights_action(text,text,integer) to anon, authenticated;

commit;

-- ===== END gejast_v548_admin_game_analytics.sql =====

-- ===== BEGIN gejast_v550a_session_runtime_audit.sql =====
-- GEJAST session/runtime audit v550a
-- Read-only inspection script for Supabase SQL editor.
-- Purpose: verify whether the live database has a server-side session-expiry owner path
-- underneath the frontend/session fixes, and whether player_touch_session exists.

begin;

-- 1) Session-related functions that likely own auth/session truth.
select
  n.nspname as schema_name,
  p.proname as function_name,
  pg_get_function_identity_arguments(p.oid) as identity_args,
  pg_get_function_result(p.oid) as result_type,
  p.prosecdef as security_definer
from pg_proc p
join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and (
    p.proname ilike '%session%'
    or p.proname in (
      'get_public_state',
      'player_touch_session',
      '_gejast_player_from_session',
      '_resolve_player_id_from_session_token'
    )
  )
order by p.proname, pg_get_function_identity_arguments(p.oid);

-- 2) Table/view names that look session-related.
select
  table_schema,
  table_name,
  table_type
from information_schema.tables
where table_schema = 'public'
  and (
    table_name ilike '%session%'
    or table_name ilike '%login%'
    or table_name ilike '%token%'
  )
order by table_name;

-- 3) Column-level view of session-like tables.
select
  table_name,
  ordinal_position,
  column_name,
  data_type,
  is_nullable,
  column_default
from information_schema.columns
where table_schema = 'public'
  and (
    table_name ilike '%session%'
    or table_name ilike '%login%'
    or table_name ilike '%token%'
  )
order by table_name, ordinal_position;

-- 4) Check whether the canonical client-side RPC exists.
select
  exists (
    select 1
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname = 'player_touch_session'
  ) as has_player_touch_session;

-- 5) If public.sessions exists, show its row count.
select
  case
    when to_regclass('public.sessions') is null then null
    else (select count(*)::bigint from public.sessions)
  end as sessions_row_count;

-- 6) If public.sessions exists, show its columns again in a compact JSON view.
select jsonb_agg(jsonb_build_object(
  'column_name', c.column_name,
  'data_type', c.data_type,
  'is_nullable', c.is_nullable,
  'column_default', c.column_default
) order by c.ordinal_position) as public_sessions_columns
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'sessions';

-- 7) Timestamp-like columns in public.sessions that could control expiry.
select
  c.column_name,
  c.data_type,
  c.column_default
from information_schema.columns c
where c.table_schema = 'public'
  and c.table_name = 'sessions'
  and (
    c.column_name ilike '%expire%'
    or c.column_name ilike '%touch%'
    or c.column_name ilike '%seen%'
    or c.column_name ilike '%active%'
    or c.column_name ilike '%updated%'
    or c.column_name ilike '%created%'
    or c.column_name ilike '%valid%'
  )
order by c.ordinal_position;

-- 8) Session-like cleanup triggers or trigger functions.
select
  event_object_table as table_name,
  trigger_name,
  action_timing,
  event_manipulation,
  action_statement
from information_schema.triggers
where trigger_schema = 'public'
  and (
    event_object_table ilike '%session%'
    or trigger_name ilike '%session%'
    or action_statement ilike '%session%'
  )
order by event_object_table, trigger_name;

-- 9) Policies that mention sessions or session-like tables.
select
  schemaname,
  tablename,
  policyname,
  permissive,
  roles,
  cmd,
  qual,
  with_check
from pg_policies
where schemaname = 'public'
  and (
    tablename ilike '%session%'
    or coalesce(qual,'') ilike '%session%'
    or coalesce(with_check,'') ilike '%session%'
  )
order by tablename, policyname;

rollback;

-- ===== END gejast_v550a_session_runtime_audit.sql =====
