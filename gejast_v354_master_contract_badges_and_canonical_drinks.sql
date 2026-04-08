-- GEJAST v354 combined badge + backend contract unification

-- GEJAST v354 badge system SQL
-- Carries forward the v331 live/comeback badge facts layer as the canonical badge-facts backend for the v354 badge UI rollout.

-- GEJAST v331 - live participation + comeback badge facts
-- Requires the scope helpers from v313+ to be present.
begin;

create or replace function public._gejast_summary_rows_scoped(
  include_live boolean default true,
  site_scope_input text default 'friends'
)
returns table(
  game_key text,
  match_ref text,
  created_at timestamptz,
  finished_at timestamptz,
  participants text[],
  winner_names text[],
  recap_text text,
  summary_payload jsonb,
  is_live boolean
)
language sql
stable
as $$
  select
    r.game_key,
    r.match_ref,
    r.created_at,
    r.finished_at,
    r.participants,
    r.winner_names,
    r.recap_text,
    r.summary_payload,
    r.is_live
  from public._gejast_summary_rows(include_live) r
  join public.game_match_summaries g
    on lower(g.game_type) = r.game_key
   and g.client_match_id = r.match_ref
  where coalesce(lower(g.site_scope), 'friends') = public._scope_norm(site_scope_input);
$$;

drop function if exists public._gejast_live_participation_rows_scoped(text);
create or replace function public._gejast_live_participation_rows_scoped(
  site_scope_input text default 'friends'
)
returns table(
  game_key text,
  match_ref text,
  player_name text,
  site_scope text,
  first_live_at timestamptz,
  finished_at timestamptz,
  live_rounds integer,
  live_duration_seconds integer
)
language sql
stable
as $$
  with scoped as (
    select
      r.game_key,
      r.match_ref,
      r.created_at as first_live_at,
      coalesce(
        r.finished_at,
        nullif(r.summary_payload->>'finished_at', '')::timestamptz
      ) as finished_at,
      r.participants,
      r.summary_payload,
      coalesce(g.site_scope, 'friends') as site_scope
    from public._gejast_summary_rows_scoped(false, site_scope_input) r
    join public.game_match_summaries g
      on lower(g.game_type) = r.game_key
     and g.client_match_id = r.match_ref
    where coalesce(jsonb_typeof(r.summary_payload->'live_state'), 'null') = 'object'
  ),
  factored as (
    select
      s.game_key,
      s.match_ref,
      s.participants,
      s.site_scope,
      s.first_live_at,
      s.finished_at,
      greatest(
        coalesce(nullif(s.summary_payload->'live_state'->>'rounds_played', '')::integer, 0),
        public._gejast_round_count(s.summary_payload)
      ) as live_rounds,
      greatest(
        floor(extract(epoch from (s.finished_at - s.first_live_at))),
        0
      )::integer as live_duration_seconds
    from scoped s
    where s.finished_at is not null
      and s.finished_at > s.first_live_at
  )
  select
    f.game_key,
    f.match_ref,
    p.player_name,
    public._scope_norm(f.site_scope) as site_scope,
    f.first_live_at,
    f.finished_at,
    f.live_rounds,
    f.live_duration_seconds
  from factored f
  cross join lateral unnest(f.participants) as p(player_name)
  where f.live_rounds >= 2
    and f.live_duration_seconds >= 45;
$$;

drop function if exists public._gejast_klaverjas_comeback_rows_scoped(text);
create or replace function public._gejast_klaverjas_comeback_rows_scoped(
  site_scope_input text default 'friends'
)
returns table(
  game_key text,
  match_ref text,
  player_name text,
  site_scope text,
  finished_at timestamptz,
  largest_deficit_points integer,
  largest_deficit_pct numeric,
  first_real_behind_round integer,
  real_behind_checkpoints integer
)
language sql
stable
as $$
  with base as (
    select
      r.game_key,
      r.match_ref,
      coalesce(
        r.finished_at,
        nullif(r.summary_payload->>'finished_at', '')::timestamptz
      ) as finished_at,
      r.summary_payload,
      r.winner_names,
      coalesce(g.site_scope, 'friends') as site_scope,
      case
        when lower(coalesce(r.summary_payload->>'winner_side', '')) in ('wij', 'w') then 'wij'
        when lower(coalesce(r.summary_payload->>'winner_side', '')) in ('zij', 'z') then 'zij'
        when coalesce(nullif(r.summary_payload->'totals'->>'wij', '')::integer, 0)
             > coalesce(nullif(r.summary_payload->'totals'->>'zij', '')::integer, 0) then 'wij'
        when coalesce(nullif(r.summary_payload->'totals'->>'wij', '')::integer, 0)
             < coalesce(nullif(r.summary_payload->'totals'->>'zij', '')::integer, 0) then 'zij'
        else null
      end as winner_side
    from public._gejast_summary_rows_scoped(false, site_scope_input) r
    join public.game_match_summaries g
      on lower(g.game_type) = r.game_key
     and g.client_match_id = r.match_ref
    where r.game_key = 'klaverjas'
      and coalesce(
        r.finished_at,
        nullif(r.summary_payload->>'finished_at', '')::timestamptz
      ) is not null
  ),
  winners as (
    select
      b.match_ref,
      b.finished_at,
      b.site_scope,
      p.player_name
    from base b
    cross join lateral unnest(
      coalesce(
        case
          when b.winner_side = 'wij' then (
            select array_agg(value::text)
            from jsonb_array_elements_text(coalesce(b.summary_payload->'teams'->'wij', '[]'::jsonb))
          )
          when b.winner_side = 'zij' then (
            select array_agg(value::text)
            from jsonb_array_elements_text(coalesce(b.summary_payload->'teams'->'zij', '[]'::jsonb))
          )
          else null
        end,
        b.winner_names,
        '{}'::text[]
      )
    ) as p(player_name)
  ),
  round_rows as (
    select
      b.match_ref,
      b.finished_at,
      b.site_scope,
      b.winner_side,
      rr.ordinality::integer as round_no,
      coalesce(
        nullif(rr.round_item->>'fw', '')::integer,
        nullif(rr.round_item->>'scoreW', '')::integer,
        0
      ) as fw,
      coalesce(
        nullif(rr.round_item->>'fz', '')::integer,
        nullif(rr.round_item->>'scoreZ', '')::integer,
        0
      ) as fz
    from base b
    cross join lateral jsonb_array_elements(coalesce(b.summary_payload->'rounds', '[]'::jsonb))
      with ordinality as rr(round_item, ordinality)
    where b.winner_side in ('wij', 'zij')
  ),
  checkpoints as (
    select
      r.match_ref,
      r.finished_at,
      r.site_scope,
      r.winner_side,
      r.round_no,
      sum(r.fw) over (
        partition by r.match_ref
        order by r.round_no
        rows between unbounded preceding and current row
      ) as wij_running,
      sum(r.fz) over (
        partition by r.match_ref
        order by r.round_no
        rows between unbounded preceding and current row
      ) as zij_running
    from round_rows r
  ),
  behind as (
    select
      c.match_ref,
      c.finished_at,
      c.site_scope,
      c.round_no,
      case
        when c.winner_side = 'wij' then (c.zij_running - c.wij_running)
        else (c.wij_running - c.zij_running)
      end as deficit_points,
      (c.wij_running + c.zij_running) as combined_running,
      greatest(
        24,
        ceil(((c.wij_running + c.zij_running)::numeric) * 0.16)
      )::integer as behind_threshold_points
    from checkpoints c
    where c.round_no >= 4
      and (c.wij_running + c.zij_running) >= 120
      and (
        (c.winner_side = 'wij' and c.wij_running < c.zij_running)
        or
        (c.winner_side = 'zij' and c.zij_running < c.wij_running)
      )
  ),
  qualified as (
    select
      b.match_ref,
      b.finished_at,
      b.site_scope,
      b.round_no,
      b.deficit_points,
      round(
        b.deficit_points::numeric / nullif(b.combined_running::numeric, 0),
        4
      ) as deficit_pct
    from behind b
    where b.deficit_points >= b.behind_threshold_points
  ),
  rolled as (
    select
      q.match_ref,
      max(q.finished_at) as finished_at,
      max(q.site_scope) as site_scope,
      max(q.deficit_points) as largest_deficit_points,
      max(q.deficit_pct) as largest_deficit_pct,
      min(q.round_no) as first_real_behind_round,
      count(*)::integer as real_behind_checkpoints
    from qualified q
    group by q.match_ref
  )
  select
    'klaverjas'::text as game_key,
    r.match_ref,
    w.player_name,
    public._scope_norm(r.site_scope) as site_scope,
    r.finished_at,
    r.largest_deficit_points,
    r.largest_deficit_pct,
    r.first_real_behind_round,
    r.real_behind_checkpoints
  from rolled r
  join winners w
    on w.match_ref = r.match_ref;
$$;

drop function if exists public._gejast_boerenbridge_comeback_rows_scoped(text);
create or replace function public._gejast_boerenbridge_comeback_rows_scoped(
  site_scope_input text default 'friends'
)
returns table(
  game_key text,
  match_ref text,
  player_name text,
  site_scope text,
  finished_at timestamptz,
  largest_gap_points integer,
  largest_gap_pct numeric,
  first_real_behind_round integer,
  real_behind_checkpoints integer
)
language sql
stable
as $$
  with base as (
    select
      r.game_key,
      r.match_ref,
      coalesce(
        r.finished_at,
        nullif(r.summary_payload->>'finished_at', '')::timestamptz
      ) as finished_at,
      r.summary_payload,
      r.winner_names,
      coalesce(g.site_scope, 'friends') as site_scope,
      case
        when coalesce(array_length(r.winner_names, 1), 0) = 1 then r.winner_names[1]
        else null
      end as sole_winner_name
    from public._gejast_summary_rows_scoped(false, site_scope_input) r
    join public.game_match_summaries g
      on lower(g.game_type) = r.game_key
     and g.client_match_id = r.match_ref
    where r.game_key = 'boerenbridge'
      and coalesce(
        r.finished_at,
        nullif(r.summary_payload->>'finished_at', '')::timestamptz
      ) is not null
      and coalesce(array_length(r.winner_names, 1), 0) = 1
  ),
  raw_player_rounds as (
    select
      b.match_ref,
      b.finished_at,
      b.site_scope,
      public._gejast_norm_name(b.sole_winner_name) as winner_norm_name,
      rr.ordinality::integer as round_no,
      coalesce(
        nullif(pr.player_item->>'name', ''),
        nullif(pr.player_item->>'display_name', '')
      ) as player_name,
      coalesce(nullif(pr.player_item->>'points', '')::integer, 0) as points,
      nullif(pr.player_item->>'running_total', '')::integer as running_total_raw
    from base b
    cross join lateral jsonb_array_elements(coalesce(b.summary_payload->'rounds', '[]'::jsonb))
      with ordinality as rr(round_item, ordinality)
    cross join lateral jsonb_array_elements(coalesce(rr.round_item->'players', '[]'::jsonb))
      as pr(player_item)
  ),
  player_rounds as (
    select
      rpr.match_ref,
      rpr.finished_at,
      rpr.site_scope,
      rpr.winner_norm_name,
      rpr.round_no,
      rpr.player_name,
      public._gejast_norm_name(rpr.player_name) as player_norm_name,
      coalesce(
        rpr.running_total_raw,
        sum(rpr.points) over (
          partition by rpr.match_ref, public._gejast_norm_name(rpr.player_name)
          order by rpr.round_no
          rows between unbounded preceding and current row
        )
      ) as running_total
    from raw_player_rounds rpr
    where nullif(trim(coalesce(rpr.player_name, '')), '') is not null
  ),
  leaders as (
    select
      pr.match_ref,
      pr.round_no,
      max(pr.running_total) as leader_score
    from player_rounds pr
    group by pr.match_ref, pr.round_no
  ),
  winner_checkpoints as (
    select
      pr.match_ref,
      pr.finished_at,
      pr.site_scope,
      pr.player_name,
      pr.round_no,
      pr.running_total as winner_score,
      l.leader_score,
      (l.leader_score - pr.running_total) as gap_points,
      greatest(
        8,
        ceil((l.leader_score::numeric) * 0.28)
      )::integer as behind_threshold_points
    from player_rounds pr
    join leaders l
      on l.match_ref = pr.match_ref
     and l.round_no = pr.round_no
    where pr.player_norm_name = pr.winner_norm_name
  ),
  qualified as (
    select
      w.match_ref,
      w.finished_at,
      w.site_scope,
      w.player_name,
      w.round_no,
      w.gap_points,
      round(
        w.gap_points::numeric / nullif(w.leader_score::numeric, 0),
        4
      ) as gap_pct
    from winner_checkpoints w
    where w.round_no >= 4
      and w.leader_score >= 30
      and w.winner_score < w.leader_score
      and w.gap_points >= w.behind_threshold_points
  ),
  rolled as (
    select
      q.match_ref,
      max(q.finished_at) as finished_at,
      max(q.site_scope) as site_scope,
      max(q.player_name) as player_name,
      max(q.gap_points) as largest_gap_points,
      max(q.gap_pct) as largest_gap_pct,
      min(q.round_no) as first_real_behind_round,
      count(*)::integer as real_behind_checkpoints
    from qualified q
    group by q.match_ref
  )
  select
    'boerenbridge'::text as game_key,
    r.match_ref,
    r.player_name,
    public._scope_norm(r.site_scope) as site_scope,
    r.finished_at,
    r.largest_gap_points,
    r.largest_gap_pct,
    r.first_real_behind_round,
    r.real_behind_checkpoints
  from rolled r;
$$;

drop function if exists public.get_player_badge_facts_scoped(text, text);
create or replace function public.get_player_badge_facts_scoped(
  player_name text,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $fn$
declare
  v_name text := nullif(trim(coalesce(player_name, '')), '');
  v_scope text := public._scope_norm(site_scope_input);
  v_live_total integer := 0;
  v_live_klaverjas integer := 0;
  v_live_boerenbridge integer := 0;
  v_live_match_refs text[] := '{}'::text[];
  v_kc integer := 0;
  v_k_match_refs text[] := '{}'::text[];
  v_k_points integer := 0;
  v_k_pct numeric := 0;
  v_bc integer := 0;
  v_b_match_refs text[] := '{}'::text[];
  v_b_points integer := 0;
  v_b_pct numeric := 0;
begin
  if v_name is null or not public._name_in_site_scope(v_name, v_scope) then
    return jsonb_build_object(
      'player_name', coalesce(v_name, player_name),
      'site_scope', v_scope,
      'live_participations_total', 0,
      'live_participations_klaverjas', 0,
      'live_participations_boerenbridge', 0,
      'live_match_refs', '[]'::jsonb,
      'klaverjas_comeback_wins', 0,
      'klaverjas_comeback_match_refs', '[]'::jsonb,
      'largest_klaverjas_comeback_points', 0,
      'largest_klaverjas_comeback_pct', 0,
      'boerenbridge_comeback_wins', 0,
      'boerenbridge_comeback_match_refs', '[]'::jsonb,
      'largest_boerenbridge_comeback_points', 0,
      'largest_boerenbridge_comeback_pct', 0,
      'total_comeback_wins', 0
    );
  end if;

  select
    count(*)::integer,
    (count(*) filter (where game_key = 'klaverjas'))::integer,
    (count(*) filter (where game_key = 'boerenbridge'))::integer,
    coalesce(array_agg(match_ref order by finished_at desc), '{}'::text[])
  into
    v_live_total,
    v_live_klaverjas,
    v_live_boerenbridge,
    v_live_match_refs
  from public._gejast_live_participation_rows_scoped(v_scope)
  where public._gejast_norm_name(player_name) = public._gejast_norm_name(v_name);

  select
    count(*)::integer,
    coalesce(array_agg(match_ref order by finished_at desc), '{}'::text[]),
    coalesce(max(largest_deficit_points), 0),
    coalesce(max(largest_deficit_pct), 0)
  into
    v_kc,
    v_k_match_refs,
    v_k_points,
    v_k_pct
  from public._gejast_klaverjas_comeback_rows_scoped(v_scope)
  where public._gejast_norm_name(player_name) = public._gejast_norm_name(v_name);

  select
    count(*)::integer,
    coalesce(array_agg(match_ref order by finished_at desc), '{}'::text[]),
    coalesce(max(largest_gap_points), 0),
    coalesce(max(largest_gap_pct), 0)
  into
    v_bc,
    v_b_match_refs,
    v_b_points,
    v_b_pct
  from public._gejast_boerenbridge_comeback_rows_scoped(v_scope)
  where public._gejast_norm_name(player_name) = public._gejast_norm_name(v_name);

  return jsonb_build_object(
    'player_name', v_name,
    'site_scope', v_scope,
    'live_participations_total', coalesce(v_live_total, 0),
    'live_participations_klaverjas', coalesce(v_live_klaverjas, 0),
    'live_participations_boerenbridge', coalesce(v_live_boerenbridge, 0),
    'live_match_refs', to_jsonb(coalesce(v_live_match_refs, '{}'::text[])),
    'klaverjas_comeback_wins', coalesce(v_kc, 0),
    'klaverjas_comeback_match_refs', to_jsonb(coalesce(v_k_match_refs, '{}'::text[])),
    'largest_klaverjas_comeback_points', coalesce(v_k_points, 0),
    'largest_klaverjas_comeback_pct', coalesce(v_k_pct, 0),
    'boerenbridge_comeback_wins', coalesce(v_bc, 0),
    'boerenbridge_comeback_match_refs', to_jsonb(coalesce(v_b_match_refs, '{}'::text[])),
    'largest_boerenbridge_comeback_points', coalesce(v_b_points, 0),
    'largest_boerenbridge_comeback_pct', coalesce(v_b_pct, 0),
    'total_comeback_wins', coalesce(v_kc, 0) + coalesce(v_bc, 0)
  );
end;
$fn$;

drop function if exists public.get_player_badge_facts(text);
create or replace function public.get_player_badge_facts(player_name text)
returns jsonb
language sql
stable
security definer
set search_path to 'public'
as $$
  select public.get_player_badge_facts_scoped(
    player_name,
    public._site_scope_for_name(player_name)
  );
$$;

grant execute on function public.get_player_badge_facts_scoped(text, text) to anon, authenticated;
grant execute on function public.get_player_badge_facts(text) to anon, authenticated;

commit;


-- ===== backend contract unification =====

begin;

create or replace function public._contract_ok(
  domain_input text,
  contract_input text,
  data_input jsonb default '{}'::jsonb,
  warnings_input jsonb default '[]'::jsonb
)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'ok', true,
    'version', 'v1',
    'domain', coalesce(domain_input, 'unknown'),
    'contract', coalesce(contract_input, 'unknown'),
    'data', coalesce(data_input, '{}'::jsonb),
    'error', null,
    'warnings', coalesce(warnings_input, '[]'::jsonb)
  );
$$;

create or replace function public._contract_err(
  domain_input text,
  contract_input text,
  code_input text,
  message_input text,
  details_input jsonb default '{}'::jsonb
)
returns jsonb
language sql
stable
as $$
  select jsonb_build_object(
    'ok', false,
    'version', 'v1',
    'domain', coalesce(domain_input, 'unknown'),
    'contract', coalesce(contract_input, 'unknown'),
    'data', null,
    'error', jsonb_build_object(
      'code', coalesce(code_input, 'UNKNOWN'),
      'message', coalesce(message_input, 'Onbekende fout.'),
      'details', coalesce(details_input, '{}'::jsonb)
    ),
    'warnings', '[]'::jsonb
  );
$$;

create or replace function public.contract_scope_context_v1(
  session_token text default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_name text := null;
begin
  begin
    v_name := public._gejast_name_for_session(session_token);
  exception when others then
    v_name := null;
  end;

  return public._contract_ok(
    'scope',
    'context',
    jsonb_build_object(
      'site_scope', v_scope,
      'viewer_name', v_name,
      'is_logged_in', v_name is not null,
      'is_family', v_scope = 'family'
    )
  );
end;
$$;

create or replace function public.contract_drinks_read_v1(
  session_token text default null,
  viewer_lat numeric default null,
  viewer_lng numeric default null,
  site_scope_input text default 'friends',
  history_limit integer default 40
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_ctx jsonb;
  v_page jsonb := '{}'::jsonb;
  v_pending jsonb := '[]'::jsonb;
  v_mine jsonb := '[]'::jsonb;
  v_history jsonb := '[]'::jsonb;
  v_speed jsonb := '{}'::jsonb;
  v_speed_types jsonb := '[]'::jsonb;
begin
  v_ctx := public.contract_scope_context_v1(session_token, v_scope)->'data';

  begin
    v_page := public.get_drinks_page_public(
      session_token => session_token,
      viewer_lat => viewer_lat,
      viewer_lng => viewer_lng
    );
  exception when others then
    return public._contract_err('drinks', 'read', 'PAGE_READ_FAILED', SQLERRM);
  end;

  begin
    v_pending := coalesce(public.get_all_pending_drink_event_verifications_public(session_token => session_token), '[]'::jsonb);
  exception when others then
    v_pending := coalesce(v_page->'verify_queue', '[]'::jsonb);
  end;

  begin
    v_mine := coalesce(public.get_my_pending_drink_requests_public(session_token => session_token), '[]'::jsonb);
  exception when others then
    v_mine := coalesce(v_page->'my_pending_events', '[]'::jsonb);
  end;

  begin
    v_history := coalesce(public.get_verified_drinks_history_public(limit_count => greatest(1, least(coalesce(history_limit, 40), 100))), '[]'::jsonb);
  exception when others then
    v_history := '[]'::jsonb;
  end;

  begin
    v_speed := public.get_drink_speed_page_public(
      session_token => session_token,
      viewer_lat => viewer_lat,
      viewer_lng => viewer_lng
    );
  exception when others then
    v_speed := '{}'::jsonb;
  end;

  v_speed_types := (
    with fixed as (
      select jsonb_build_array(
        jsonb_build_object('key','bier','label','Bier'),
        jsonb_build_object('key','2_bakken','label','2 bakken'),
        jsonb_build_object('key','liter_bier','label','Liter bier'),
        jsonb_build_object('key','ice','label','Ice'),
        jsonb_build_object('key','fles_wijn','label','Fles wijn')
      ) as arr
    ),
    dynamic_rows as (
      select coalesce(jsonb_agg(distinct jsonb_build_object(
        'key', lower(coalesce(item->>'speed_type_key', item->>'event_type_key', item->>'key', '')),
        'label', coalesce(item->>'speed_type_label', item->>'event_type_label', item->>'label', item->>'key', 'Snelheid')
      )), '[]'::jsonb) as arr
      from (
        select * from jsonb_array_elements(coalesce(v_speed->'top_attempts', '[]'::jsonb))
        union all
        select * from jsonb_array_elements(coalesce(v_speed->'my_attempts', '[]'::jsonb))
        union all
        select * from jsonb_array_elements(coalesce(v_speed->'verify_queue', '[]'::jsonb))
        union all
        select * from jsonb_array_elements(coalesce(v_page->'event_types', '[]'::jsonb))
      ) q(item)
      where lower(coalesce(item->>'speed_type_key', item->>'event_type_key', item->>'key', '')) not in ('shot','shots')
    )
    select coalesce((
      select jsonb_agg(distinct x.obj order by x.obj->>'label')
      from (
        select jsonb_array_elements((select arr from fixed)) as obj
        union all
        select jsonb_array_elements((select arr from dynamic_rows)) as obj
      ) x
      where coalesce(nullif(trim(x.obj->>'key'), ''), '') <> ''
    ), '[]'::jsonb)
  );

  return public._contract_ok(
    'drinks',
    'read',
    jsonb_build_object(
      'context', v_ctx,
      'dashboard', jsonb_build_object(
        'session', coalesce(v_page->'session', '{}'::jsonb),
        'totals', coalesce(v_page->'totals', '{}'::jsonb),
        'event_types', coalesce(v_page->'event_types', '[]'::jsonb),
        'verify_queue', coalesce(v_pending, '[]'::jsonb),
        'my_pending_events', coalesce(v_mine, '[]'::jsonb),
        'verified_recent', coalesce(v_history, '[]'::jsonb)
      ),
      'speed', jsonb_build_object(
        'speed_types', v_speed_types,
        'top_attempts', coalesce(v_speed->'top_attempts', '[]'::jsonb),
        'my_attempts', coalesce(v_speed->'my_attempts', '[]'::jsonb),
        'verify_queue', coalesce(v_speed->'verify_queue', '[]'::jsonb)
      )
    )
  );
end;
$$;

create or replace function public.contract_drinks_write_v1(
  session_token text,
  action text,
  payload jsonb default '{}'::jsonb,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_action text := lower(trim(coalesce(action, '')));
  v_result jsonb;
begin
  if nullif(trim(coalesce(session_token, '')), '') is null then
    return public._contract_err('drinks', 'write', 'MISSING_SESSION', 'Niet ingelogd.');
  end if;

  if v_action = 'create_event' then
    v_result := public.create_drink_event(
      session_token => session_token,
      event_type_key => payload->>'event_type_key',
      quantity => coalesce(nullif(payload->>'quantity', '')::numeric, 1),
      lat => nullif(payload->>'lat', '')::numeric,
      lng => nullif(payload->>'lng', '')::numeric,
      accuracy => nullif(payload->>'accuracy', '')::numeric
    );
  elsif v_action = 'cancel_event' then
    v_result := public.cancel_my_pending_drink_event(
      session_token => session_token,
      drink_event_id => nullif(payload->>'drink_event_id', '')::bigint
    );
  elsif v_action = 'verify_event' then
    v_result := public.verify_drink_event(
      session_token => session_token,
      drink_event_id => nullif(payload->>'drink_event_id', '')::bigint,
      lat => nullif(payload->>'lat', '')::numeric,
      lng => nullif(payload->>'lng', '')::numeric,
      accuracy => nullif(payload->>'accuracy', '')::numeric,
      approve => coalesce((payload->>'approve')::boolean, true)
    );
  elsif v_action = 'create_speed_attempt' then
    v_result := public.create_combined_drink_speed_attempt(
      session_token => session_token,
      event_type_key => payload->>'event_type_key',
      location_label_input => nullif(payload->>'location_label_input', ''),
      quantity => coalesce(nullif(payload->>'quantity', '')::numeric, 1),
      duration_seconds => nullif(payload->>'duration_seconds', '')::numeric,
      lat => nullif(payload->>'lat', '')::numeric,
      lng => nullif(payload->>'lng', '')::numeric,
      accuracy => nullif(payload->>'accuracy', '')::numeric
    );
  elsif v_action = 'cancel_speed_attempt' then
    v_result := public.cancel_my_speed_attempt(
      session_token => session_token,
      attempt_id => nullif(payload->>'attempt_id', '')::bigint
    );
  elsif v_action = 'verify_speed_attempt' then
    v_result := public.verify_drink_speed_attempt(
      session_token => session_token,
      attempt_id => nullif(payload->>'attempt_id', '')::bigint,
      lat => nullif(payload->>'lat', '')::numeric,
      lng => nullif(payload->>'lng', '')::numeric,
      accuracy => nullif(payload->>'accuracy', '')::numeric,
      approve => coalesce((payload->>'approve')::boolean, true),
      reason => nullif(payload->>'reason', '')
    );
  elsif v_action = 'set_event_location_label' then
    v_result := public.set_drink_event_location_label(
      session_token => session_token,
      drink_event_id => nullif(payload->>'drink_event_id', '')::bigint,
      location_label_input => payload->>'location_label_input'
    );
  else
    return public._contract_err('drinks', 'write', 'INVALID_ACTION', 'Onbekende drinks-actie.', jsonb_build_object('action', v_action));
  end if;

  return public._contract_ok('drinks', 'write', jsonb_build_object('action', v_action, 'result', coalesce(v_result, '{}'::jsonb)));
exception when others then
  return public._contract_err('drinks', 'write', 'WRITE_FAILED', SQLERRM, jsonb_build_object('action', v_action));
end;
$$;

create or replace function public.contract_live_read_v1(
  session_token text default null,
  game_type_input text default null,
  client_match_id_input text default null,
  site_scope_input text default 'friends',
  include_finished boolean default false
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_ctx jsonb := public.contract_scope_context_v1(session_token, site_scope_input)->'data';
  v_matches jsonb := '[]'::jsonb;
begin
  begin
    v_matches := coalesce(
      public.get_live_match_summaries_scoped(
        session_token => session_token,
        game_type_input => game_type_input,
        site_scope_input => site_scope_input,
        client_match_id_input => client_match_id_input
      )->'matches',
      '[]'::jsonb
    );
  exception when others then
    return public._contract_err('live', 'read', 'LIVE_READ_FAILED', SQLERRM);
  end;

  return public._contract_ok(
    'live',
    'read',
    jsonb_build_object(
      'viewer', jsonb_build_object(
        'viewer_name', v_ctx->>'viewer_name',
        'site_scope', v_ctx->>'site_scope'
      ),
      'matches', coalesce(v_matches, '[]'::jsonb)
    )
  );
end;
$$;

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
as $$
declare
  v_result jsonb;
  v_scope text := public._scope_norm(site_scope_input);
begin
  if nullif(trim(coalesce(session_token, '')), '') is null then
    return public._contract_err('live', 'write', 'MISSING_SESSION', 'Niet ingelogd.');
  end if;

  v_result := public.save_game_match_summary(
    session_token => session_token,
    game_type => lower(trim(coalesce(game_type, ''))),
    client_match_id => trim(coalesce(client_match_id, '')),
    summary_payload => coalesce(summary_payload, '{}'::jsonb)
  );

  begin
    update public.game_match_summaries
    set site_scope = v_scope
    where lower(coalesce(public.game_match_summaries.game_type, '')) = lower(trim(coalesce(contract_live_write_v1.game_type, '')))
      and client_match_id = trim(coalesce(contract_live_write_v1.client_match_id, ''));
  exception when others then
    null;
  end;

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
$$;

create or replace function public.contract_profile_read_v1(
  player_name text,
  game_key text default 'klaverjas',
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_unified jsonb := '{}'::jsonb;
  v_shared jsonb := '{}'::jsonb;
  v_insights jsonb := '{}'::jsonb;
  v_drinks jsonb := '{}'::jsonb;
  v_badges jsonb := '{}'::jsonb;
begin
  if not public._name_in_site_scope(player_name, v_scope) then
    return public._contract_err('profile', 'read', 'PLAYER_NOT_IN_SCOPE', 'Speler valt buiten deze scope.', jsonb_build_object('player_name', player_name, 'site_scope', v_scope));
  end if;

  v_unified := public.get_public_player_unified_scoped(player_name => player_name, site_scope_input => v_scope);
  v_shared := public.get_public_shared_player_stats_scoped(game_key => game_key, player_name => player_name, site_scope_input => v_scope);
  v_insights := public.get_public_player_game_insights_scoped(game_key => game_key, player_name => player_name, site_scope_input => v_scope);
  v_drinks := public.get_drink_player_public(player_name => player_name);
  v_badges := public.get_player_badge_facts_scoped(player_name => player_name, site_scope_input => v_scope);

  return public._contract_ok(
    'profile',
    'read',
    jsonb_build_object(
      'player_name', player_name,
      'site_scope', v_scope,
      'unified', coalesce(v_unified, '{}'::jsonb),
      'shared_stats', coalesce(v_shared, '{}'::jsonb),
      'game_insights', coalesce(v_insights, '{}'::jsonb),
      'drinks', coalesce(v_drinks, '{}'::jsonb),
      'badge_facts', coalesce(v_badges, '{}'::jsonb)
    )
  );
exception when others then
  return public._contract_err('profile', 'read', 'PROFILE_READ_FAILED', SQLERRM, jsonb_build_object('player_name', player_name, 'game_key', game_key));
end;
$$;

create or replace function public.contract_push_presence_write_v1(
  session_token text,
  endpoint_input text,
  p256dh_input text,
  auth_input text,
  page_path_input text default null,
  permission_input text default null,
  standalone_input boolean default null,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_register jsonb := '{}'::jsonb;
  v_touch jsonb := '{}'::jsonb;
begin
  if nullif(trim(coalesce(session_token, '')), '') is null then
    return public._contract_err('push', 'presence_write', 'MISSING_SESSION', 'Niet ingelogd.');
  end if;
  if nullif(trim(coalesce(endpoint_input, '')), '') is null then
    return public._contract_err('push', 'presence_write', 'MISSING_ENDPOINT', 'Push endpoint ontbreekt.');
  end if;

  begin
    v_register := public.register_web_push_subscription(
      session_token => session_token,
      endpoint_input => endpoint_input,
      p256dh_input => p256dh_input,
      auth_input => auth_input,
      user_agent_input => null,
      permission_input => permission_input
    );
  exception when others then
    v_register := jsonb_build_object('ok', false, 'reason', SQLERRM);
  end;

  v_touch := public.touch_active_web_push_presence(
    session_token => session_token,
    endpoint_input => endpoint_input,
    p256dh_input => p256dh_input,
    auth_input => auth_input,
    page_path_input => page_path_input,
    permission_input => permission_input,
    standalone_input => standalone_input
  );

  return public._contract_ok(
    'push',
    'presence_write',
    jsonb_build_object(
      'register_result', coalesce(v_register, '{}'::jsonb),
      'touch_result', coalesce(v_touch, '{}'::jsonb),
      'page_path', page_path_input,
      'site_scope', public._scope_norm(site_scope_input)
    )
  );
exception when others then
  return public._contract_err('push', 'presence_write', 'PUSH_PRESENCE_FAILED', SQLERRM);
end;
$$;

create or replace function public.contract_push_admin_read_v1(
  admin_session_token text,
  active_minutes integer default 5,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_rows jsonb := '{}'::jsonb;
begin
  v_rows := public.admin_get_active_web_push_presence(
    admin_session_token => admin_session_token,
    active_minutes => active_minutes
  );

  return public._contract_ok(
    'push',
    'admin_read',
    jsonb_build_object(
      'site_scope', public._scope_norm(site_scope_input),
      'active', coalesce(v_rows, '{}'::jsonb)
    )
  );
exception when others then
  return public._contract_err('push', 'admin_read', 'INVALID_ADMIN_SESSION', SQLERRM);
end;
$$;

create or replace function public.contract_push_admin_write_v1(
  admin_session_token text,
  title_input text,
  body_input text,
  target_url_input text default null,
  active_minutes integer default 5,
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_result jsonb := '{}'::jsonb;
begin
  v_result := public.admin_queue_active_web_push(
    admin_session_token => admin_session_token,
    title_input => title_input,
    body_input => body_input,
    target_url_input => target_url_input,
    active_minutes => active_minutes
  );

  return public._contract_ok(
    'push',
    'admin_write',
    jsonb_build_object(
      'site_scope', public._scope_norm(site_scope_input),
      'result', coalesce(v_result, '{}'::jsonb)
    )
  );
exception when others then
  return public._contract_err('push', 'admin_write', 'ADMIN_PUSH_QUEUE_FAILED', SQLERRM);
end;
$$;

grant execute on function public.contract_scope_context_v1(text, text) to anon, authenticated;
grant execute on function public.contract_drinks_read_v1(text, numeric, numeric, text, integer) to anon, authenticated;
grant execute on function public.contract_drinks_write_v1(text, text, jsonb, text) to anon, authenticated;
grant execute on function public.contract_live_read_v1(text, text, text, text, boolean) to anon, authenticated;
grant execute on function public.contract_live_write_v1(text, text, text, jsonb, text) to anon, authenticated;
grant execute on function public.contract_profile_read_v1(text, text, text) to anon, authenticated;
grant execute on function public.contract_push_presence_write_v1(text, text, text, text, text, text, boolean, text) to anon, authenticated;
grant execute on function public.contract_push_admin_read_v1(text, integer, text) to anon, authenticated;
grant execute on function public.contract_push_admin_write_v1(text, text, text, text, integer, text) to anon, authenticated;

commit;


-- ===== canonical drinks verified lifecycle =====

begin;

create table if not exists public.drink_type_aliases (
  alias_key text primary key,
  canonical_key text not null,
  display_label text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drink_type_aliases_alias_key_nonempty check (length(trim(alias_key)) > 0),
  constraint drink_type_aliases_canonical_key_nonempty check (length(trim(canonical_key)) > 0),
  constraint drink_type_aliases_display_label_nonempty check (length(trim(display_label)) > 0)
);

create index if not exists idx_drink_type_aliases_canonical_key
  on public.drink_type_aliases(canonical_key);

insert into public.drink_type_aliases(alias_key, canonical_key, display_label) values
  ('bier', 'bier', 'Bier'),
  ('biertje', 'bier', 'Bier'),
  ('beer', 'bier', 'Bier'),
  ('2bakken', '2bakken', '2 Bakken'),
  ('2 bakken', '2bakken', '2 Bakken'),
  ('twee bakken', '2bakken', '2 Bakken'),
  ('literbier', 'liter_bier', 'Liter Bier'),
  ('liter bier', 'liter_bier', 'Liter Bier'),
  ('1 liter bier', 'liter_bier', 'Liter Bier'),
  ('ice', 'ice', 'Ice'),
  ('smirnoff ice', 'ice', 'Ice'),
  ('wijnfles', 'wijnfles', 'Fles Wijn'),
  ('fles wijn', 'wijnfles', 'Fles Wijn'),
  ('wijn', 'wijnfles', 'Fles Wijn'),
  ('shot', 'shot', 'Shot'),
  ('shots', 'shot', 'Shot')
on conflict (alias_key) do update
set canonical_key = excluded.canonical_key,
    display_label = excluded.display_label,
    updated_at = now();

alter table if exists public.drink_events
  add column if not exists canonical_event_type_key text,
  add column if not exists submitted_at timestamptz,
  add column if not exists review_started_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists rejection_reason text;

alter table if exists public.drink_speed_attempts
  add column if not exists canonical_event_type_key text,
  add column if not exists submitted_at timestamptz,
  add column if not exists review_started_at timestamptz,
  add column if not exists resolved_at timestamptz,
  add column if not exists cancelled_at timestamptz,
  add column if not exists rejection_reason text;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'drink_events_canonical_status_chk'
  ) then
    alter table public.drink_events
      add constraint drink_events_canonical_status_chk
      check (coalesce(status, 'pending') in ('pending','verified','rejected','cancelled'));
  end if;

  if not exists (
    select 1
    from pg_constraint
    where conname = 'drink_speed_attempts_canonical_status_chk'
  ) then
    alter table public.drink_speed_attempts
      add constraint drink_speed_attempts_canonical_status_chk
      check (coalesce(status, 'pending') in ('pending','verified','rejected','cancelled'));
  end if;
end $$;

create index if not exists idx_drink_events_status_created
  on public.drink_events(status, created_at desc);

create index if not exists idx_drink_events_player_status
  on public.drink_events(player_id, status);

create index if not exists idx_drink_events_canonical_type_verified
  on public.drink_events(canonical_event_type_key, verified_at desc);

create index if not exists idx_drink_speed_attempts_status_created
  on public.drink_speed_attempts(status, created_at desc);

create index if not exists idx_drink_speed_attempts_player_status
  on public.drink_speed_attempts(player_id, status);

create index if not exists idx_drink_speed_attempts_canonical_type_verified
  on public.drink_speed_attempts(canonical_event_type_key, verified_at desc);

create table if not exists public.drink_verified_records (
  id bigserial primary key,
  source_kind text not null,
  source_request_id bigint not null,
  player_id bigint not null,
  player_name text not null,
  canonical_event_type_key text not null,
  display_event_type_label text not null,
  quantity numeric(12,2) not null default 1,
  total_units numeric(12,2) not null default 0,
  duration_seconds numeric(12,2),
  source_status text not null default 'verified',
  source_created_at timestamptz not null,
  submitted_at timestamptz,
  review_started_at timestamptz,
  verified_at timestamptz not null,
  verified_by_player_id bigint,
  verified_by_player_name text,
  location_label text,
  lat double precision,
  lng double precision,
  accuracy double precision,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint drink_verified_records_kind_chk check (source_kind in ('drink','speed')),
  constraint drink_verified_records_status_chk check (source_status = 'verified'),
  constraint drink_verified_records_unique_source unique (source_kind, source_request_id),
  constraint drink_verified_records_player_name_nonempty check (length(trim(player_name)) > 0),
  constraint drink_verified_records_type_nonempty check (length(trim(canonical_event_type_key)) > 0)
);

create index if not exists idx_drink_verified_records_player_verified
  on public.drink_verified_records(player_name, verified_at desc);

create index if not exists idx_drink_verified_records_type_verified
  on public.drink_verified_records(canonical_event_type_key, verified_at desc);

create index if not exists idx_drink_verified_records_kind_verified
  on public.drink_verified_records(source_kind, verified_at desc);

revoke insert, update, delete on public.drink_verified_records from anon, authenticated;
grant select on public.drink_verified_records to anon, authenticated;

create or replace function public._fold_drink_type_key(input_value text)
returns text
language sql
immutable
as $$
  select lower(
    regexp_replace(
      coalesce(trim(input_value), ''),
      '[^a-z0-9]+',
      ' ',
      'g'
    )
  );
$$;

create or replace function public._normalize_drink_type_key(input_value text)
returns text
language plpgsql
stable
as $$
declare
  v_folded text := public._fold_drink_type_key(input_value);
  v_key text;
begin
  select canonical_key
  into v_key
  from public.drink_type_aliases
  where alias_key = v_folded
  limit 1;

  if v_key is not null then
    return v_key;
  end if;

  if replace(v_folded, ' ', '') = '2bakken' then
    return '2bakken';
  elsif replace(v_folded, ' ', '') = 'literbier' then
    return 'liter_bier';
  elsif replace(v_folded, ' ', '') in ('wijnfles', 'fleswijn') then
    return 'wijnfles';
  elsif replace(v_folded, ' ', '') in ('bier', 'biertje', 'beer') then
    return 'bier';
  elsif replace(v_folded, ' ', '') in ('ice', 'smirnoffice') then
    return 'ice';
  elsif replace(v_folded, ' ', '') in ('shot', 'shots') then
    return 'shot';
  end if;

  return 'bier';
end;
$$;

create or replace function public._drink_type_display_label(input_value text)
returns text
language plpgsql
stable
as $$
declare
  v_key text := public._normalize_drink_type_key(input_value);
  v_label text;
begin
  select display_label
  into v_label
  from public.drink_type_aliases
  where canonical_key = v_key
  order by alias_key = canonical_key desc, alias_key asc
  limit 1;

  if v_label is null then
    case v_key
      when 'bier' then v_label := 'Bier';
      when '2bakken' then v_label := '2 Bakken';
      when 'liter_bier' then v_label := 'Liter Bier';
      when 'ice' then v_label := 'Ice';
      when 'wijnfles' then v_label := 'Fles Wijn';
      when 'shot' then v_label := 'Shot';
      else v_label := initcap(replace(v_key, '_', ' '));
    end case;
  end if;

  return v_label;
end;
$$;

create or replace function public._set_verified_sync_context()
returns void
language plpgsql
as $$
begin
  perform set_config('gejast.verified_sync', '1', true);
end;
$$;

create or replace function public._assert_verified_record_sync_context()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('gejast.verified_sync', true), '') <> '1' then
    raise exception 'Direct writes to drink_verified_records are not allowed';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

drop trigger if exists trg_assert_verified_record_sync_context on public.drink_verified_records;
create trigger trg_assert_verified_record_sync_context
before insert or update or delete on public.drink_verified_records
for each row execute function public._assert_verified_record_sync_context();

create or replace function public._sync_drink_request_lifecycle_fields()
returns trigger
language plpgsql
as $$
declare
  v_raw_type text;
begin
  v_raw_type := coalesce(
    new.event_type_key,
    new.speed_type_key,
    new.canonical_event_type_key,
    'bier'
  );

  new.canonical_event_type_key := public._normalize_drink_type_key(v_raw_type);

  if new.submitted_at is null then
    new.submitted_at := coalesce(new.created_at, now());
  end if;

  if coalesce(new.status, 'pending') = 'pending' then
    new.cancelled_at := null;
    if new.verified_at is null then
      new.resolved_at := null;
    end if;
  elsif new.status = 'cancelled' then
    new.cancelled_at := coalesce(new.cancelled_at, now());
    new.resolved_at := coalesce(new.resolved_at, new.cancelled_at, now());
  elsif new.status = 'rejected' then
    new.resolved_at := coalesce(new.resolved_at, now());
  elsif new.status = 'verified' then
    new.verified_at := coalesce(new.verified_at, now());
    new.resolved_at := coalesce(new.resolved_at, new.verified_at, now());
  end if;

  if tg_op = 'UPDATE' then
    if coalesce(old.status, 'pending') in ('verified','rejected','cancelled')
       and coalesce(new.status, old.status) <> old.status then
      raise exception 'Terminal drinks statuses are immutable';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_sync_drink_request_lifecycle_fields on public.drink_events;
create trigger trg_sync_drink_request_lifecycle_fields
before insert or update on public.drink_events
for each row execute function public._sync_drink_request_lifecycle_fields();

drop trigger if exists trg_sync_speed_request_lifecycle_fields on public.drink_speed_attempts;
create trigger trg_sync_speed_request_lifecycle_fields
before insert or update on public.drink_speed_attempts
for each row execute function public._sync_drink_request_lifecycle_fields();

create or replace function public._mark_drink_event_review_started()
returns trigger
language plpgsql
as $$
begin
  update public.drink_events
  set review_started_at = coalesce(review_started_at, now())
  where id = new.drink_event_id
    and coalesce(status, 'pending') = 'pending';
  return new;
end;
$$;

drop trigger if exists trg_mark_drink_event_review_started on public.drink_event_verifications;
create trigger trg_mark_drink_event_review_started
after insert on public.drink_event_verifications
for each row execute function public._mark_drink_event_review_started();

create or replace function public._mark_speed_attempt_review_started()
returns trigger
language plpgsql
as $$
begin
  update public.drink_speed_attempts
  set review_started_at = coalesce(review_started_at, now())
  where id = new.attempt_id
    and coalesce(status, 'pending') = 'pending';
  return new;
end;
$$;

drop trigger if exists trg_mark_speed_attempt_review_started on public.drink_speed_verifications;
create trigger trg_mark_speed_attempt_review_started
after insert on public.drink_speed_verifications
for each row execute function public._mark_speed_attempt_review_started();

create or replace function public._sync_verified_record_from_drink_event()
returns trigger
language plpgsql
as $$
declare
  r public.drink_events%rowtype;
  v_total_units numeric(12,2);
  v_player_name text;
  v_verifier_name text;
begin
  if tg_op = 'DELETE' then
    perform public._set_verified_sync_context();
    delete from public.drink_verified_records
    where source_kind = 'drink' and source_request_id = old.id;
    return old;
  end if;

  r := new;
  v_total_units := coalesce(
    nullif(to_jsonb(r)->>'total_units','')::numeric,
    coalesce(r.quantity, 1) * coalesce(
      (select nullif(to_jsonb(det)->>'unit_value','')::numeric
       from public.drink_event_types det
       where lower(coalesce(det.key,'')) = lower(coalesce(r.event_type_key, r.canonical_event_type_key, 'bier'))
       limit 1),
      1
    ),
    coalesce(r.quantity, 1)
  );

  v_player_name := coalesce(
    nullif(to_jsonb(r)->>'player_name',''),
    (select coalesce(nullif(p.display_name,''), nullif(p.nickname,''), p.name)
     from public.players p
     where p.id = r.player_id
     limit 1),
    'Onbekend'
  );

  v_verifier_name := coalesce(
    nullif(to_jsonb(r)->>'verified_by_player_name',''),
    (select coalesce(nullif(p.display_name,''), nullif(p.nickname,''), p.name)
     from public.players p
     where p.id = r.verified_by_player_id
     limit 1)
  );

  perform public._set_verified_sync_context();
  if coalesce(r.status, 'pending') = 'verified' then
    insert into public.drink_verified_records(
      source_kind,
      source_request_id,
      player_id,
      player_name,
      canonical_event_type_key,
      display_event_type_label,
      quantity,
      total_units,
      duration_seconds,
      source_status,
      source_created_at,
      submitted_at,
      review_started_at,
      verified_at,
      verified_by_player_id,
      verified_by_player_name,
      location_label,
      lat,
      lng,
      accuracy,
      updated_at
    ) values (
      'drink',
      r.id,
      r.player_id,
      v_player_name,
      public._normalize_drink_type_key(coalesce(r.canonical_event_type_key, r.event_type_key)),
      public._drink_type_display_label(coalesce(r.canonical_event_type_key, r.event_type_key)),
      coalesce(r.quantity, 1),
      v_total_units,
      null,
      'verified',
      coalesce(r.created_at, now()),
      coalesce(r.submitted_at, r.created_at, now()),
      r.review_started_at,
      coalesce(r.verified_at, now()),
      r.verified_by_player_id,
      v_verifier_name,
      nullif(to_jsonb(r)->>'location_label',''),
      r.lat,
      r.lng,
      r.accuracy,
      now()
    )
    on conflict (source_kind, source_request_id) do update
    set player_id = excluded.player_id,
        player_name = excluded.player_name,
        canonical_event_type_key = excluded.canonical_event_type_key,
        display_event_type_label = excluded.display_event_type_label,
        quantity = excluded.quantity,
        total_units = excluded.total_units,
        source_status = 'verified',
        source_created_at = excluded.source_created_at,
        submitted_at = excluded.submitted_at,
        review_started_at = excluded.review_started_at,
        verified_at = excluded.verified_at,
        verified_by_player_id = excluded.verified_by_player_id,
        verified_by_player_name = excluded.verified_by_player_name,
        location_label = excluded.location_label,
        lat = excluded.lat,
        lng = excluded.lng,
        accuracy = excluded.accuracy,
        updated_at = now();
  else
    delete from public.drink_verified_records
    where source_kind = 'drink' and source_request_id = r.id;
  end if;

  return r;
end;
$$;

drop trigger if exists trg_sync_verified_record_from_drink_event on public.drink_events;
create trigger trg_sync_verified_record_from_drink_event
after insert or update or delete on public.drink_events
for each row execute function public._sync_verified_record_from_drink_event();

create or replace function public._sync_verified_record_from_speed_attempt()
returns trigger
language plpgsql
as $$
declare
  r public.drink_speed_attempts%rowtype;
  v_total_units numeric(12,2);
  v_player_name text;
  v_verifier_name text;
begin
  if tg_op = 'DELETE' then
    perform public._set_verified_sync_context();
    delete from public.drink_verified_records
    where source_kind = 'speed' and source_request_id = old.id;
    return old;
  end if;

  r := new;
  v_total_units := coalesce(
    nullif(to_jsonb(r)->>'total_units','')::numeric,
    coalesce(r.quantity, 1) * coalesce(
      (select nullif(to_jsonb(det)->>'unit_value','')::numeric
       from public.drink_event_types det
       where lower(coalesce(det.key,'')) = lower(coalesce(r.event_type_key, r.speed_type_key, r.canonical_event_type_key, 'bier'))
       limit 1),
      1
    ),
    coalesce(r.quantity, 1)
  );

  v_player_name := coalesce(
    nullif(to_jsonb(r)->>'player_name',''),
    (select coalesce(nullif(p.display_name,''), nullif(p.nickname,''), p.name)
     from public.players p
     where p.id = r.player_id
     limit 1),
    'Onbekend'
  );

  v_verifier_name := coalesce(
    nullif(to_jsonb(r)->>'verified_by_player_name',''),
    (select coalesce(nullif(p.display_name,''), nullif(p.nickname,''), p.name)
     from public.players p
     where p.id = r.verified_by_player_id
     limit 1)
  );

  perform public._set_verified_sync_context();
  if coalesce(r.status, 'pending') = 'verified' then
    insert into public.drink_verified_records(
      source_kind,
      source_request_id,
      player_id,
      player_name,
      canonical_event_type_key,
      display_event_type_label,
      quantity,
      total_units,
      duration_seconds,
      source_status,
      source_created_at,
      submitted_at,
      review_started_at,
      verified_at,
      verified_by_player_id,
      verified_by_player_name,
      location_label,
      lat,
      lng,
      accuracy,
      updated_at
    ) values (
      'speed',
      r.id,
      r.player_id,
      v_player_name,
      public._normalize_drink_type_key(coalesce(r.canonical_event_type_key, r.event_type_key, r.speed_type_key)),
      public._drink_type_display_label(coalesce(r.canonical_event_type_key, r.event_type_key, r.speed_type_key)),
      coalesce(r.quantity, 1),
      v_total_units,
      nullif(to_jsonb(r)->>'duration_seconds','')::numeric,
      'verified',
      coalesce(r.created_at, now()),
      coalesce(r.submitted_at, r.created_at, now()),
      r.review_started_at,
      coalesce(r.verified_at, now()),
      r.verified_by_player_id,
      v_verifier_name,
      nullif(to_jsonb(r)->>'location_label',''),
      r.lat,
      r.lng,
      r.accuracy,
      now()
    )
    on conflict (source_kind, source_request_id) do update
    set player_id = excluded.player_id,
        player_name = excluded.player_name,
        canonical_event_type_key = excluded.canonical_event_type_key,
        display_event_type_label = excluded.display_event_type_label,
        quantity = excluded.quantity,
        total_units = excluded.total_units,
        duration_seconds = excluded.duration_seconds,
        source_status = 'verified',
        source_created_at = excluded.source_created_at,
        submitted_at = excluded.submitted_at,
        review_started_at = excluded.review_started_at,
        verified_at = excluded.verified_at,
        verified_by_player_id = excluded.verified_by_player_id,
        verified_by_player_name = excluded.verified_by_player_name,
        location_label = excluded.location_label,
        lat = excluded.lat,
        lng = excluded.lng,
        accuracy = excluded.accuracy,
        updated_at = now();
  else
    delete from public.drink_verified_records
    where source_kind = 'speed' and source_request_id = r.id;
  end if;

  return r;
end;
$$;

drop trigger if exists trg_sync_verified_record_from_speed_attempt on public.drink_speed_attempts;
create trigger trg_sync_verified_record_from_speed_attempt
after insert or update or delete on public.drink_speed_attempts
for each row execute function public._sync_verified_record_from_speed_attempt();

create or replace view public.canonical_pending_drink_requests_v as
select
  'drink'::text as request_kind,
  de.id as request_id,
  de.player_id,
  coalesce(nullif(to_jsonb(de)->>'player_name',''),
           (select coalesce(nullif(p.display_name,''), nullif(p.nickname,''), p.name) from public.players p where p.id = de.player_id limit 1),
           'Onbekend') as player_name,
  public._normalize_drink_type_key(coalesce(de.canonical_event_type_key, de.event_type_key)) as canonical_event_type_key,
  public._drink_type_display_label(coalesce(de.canonical_event_type_key, de.event_type_key)) as event_type_label,
  coalesce(de.quantity, 1)::numeric as quantity,
  coalesce(
    nullif(to_jsonb(de)->>'total_units','')::numeric,
    coalesce(de.quantity, 1)
  )::numeric as total_units,
  null::numeric as duration_seconds,
  de.location_label,
  de.lat,
  de.lng,
  de.accuracy,
  coalesce(de.submitted_at, de.created_at) as submitted_at,
  de.review_started_at,
  de.created_at,
  de.status
from public.drink_events de
where coalesce(de.status, 'pending') = 'pending'

union all

select
  'speed'::text as request_kind,
  ds.id as request_id,
  ds.player_id,
  coalesce(nullif(to_jsonb(ds)->>'player_name',''),
           (select coalesce(nullif(p.display_name,''), nullif(p.nickname,''), p.name) from public.players p where p.id = ds.player_id limit 1),
           'Onbekend') as player_name,
  public._normalize_drink_type_key(coalesce(ds.canonical_event_type_key, ds.event_type_key, ds.speed_type_key)) as canonical_event_type_key,
  public._drink_type_display_label(coalesce(ds.canonical_event_type_key, ds.event_type_key, ds.speed_type_key)) as event_type_label,
  coalesce(ds.quantity, 1)::numeric as quantity,
  coalesce(
    nullif(to_jsonb(ds)->>'total_units','')::numeric,
    coalesce(ds.quantity, 1)
  )::numeric as total_units,
  nullif(to_jsonb(ds)->>'duration_seconds','')::numeric as duration_seconds,
  nullif(to_jsonb(ds)->>'location_label','') as location_label,
  ds.lat,
  ds.lng,
  ds.accuracy,
  coalesce(ds.submitted_at, ds.created_at) as submitted_at,
  ds.review_started_at,
  ds.created_at,
  ds.status
from public.drink_speed_attempts ds
where coalesce(ds.status, 'pending') = 'pending';

create or replace view public.canonical_verified_drinks_v as
select
  id,
  source_kind as request_kind,
  source_request_id as request_id,
  player_id,
  player_name,
  canonical_event_type_key,
  display_event_type_label as event_type_label,
  quantity,
  total_units,
  duration_seconds,
  source_created_at as created_at,
  submitted_at,
  review_started_at,
  verified_at,
  verified_by_player_id,
  verified_by_player_name,
  location_label,
  lat,
  lng,
  accuracy
from public.drink_verified_records;

create or replace function public.canonical_drinks_action_v1(
  session_token text,
  action text,
  request_kind text default 'drink',
  payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_player_id bigint;
  v_action text := lower(trim(coalesce(action, '')));
  v_kind text := lower(trim(coalesce(request_kind, 'drink')));
  v_request_id bigint := nullif(payload->>'request_id','')::bigint;
  v_now timestamptz := now();
  v_result jsonb := '{}'::jsonb;
  v_lat double precision := nullif(payload->>'lat','')::double precision;
  v_lng double precision := nullif(payload->>'lng','')::double precision;
  v_accuracy double precision := nullif(payload->>'accuracy','')::double precision;
  v_duration numeric := nullif(payload->>'duration_seconds','')::numeric;
  v_quantity numeric := coalesce(nullif(payload->>'quantity','')::numeric, 1);
  v_type_key text := public._normalize_drink_type_key(payload->>'event_type_key');
  v_client_id text := coalesce(nullif(payload->>'client_request_id',''), 'web-' || extract(epoch from clock_timestamp())::bigint::text || '-' || floor(random()*1000000)::int::text);
  v_current_status text;
  v_owner_id bigint;
begin
  if nullif(trim(coalesce(session_token,'')), '') is null then
    raise exception 'MISSING_SESSION';
  end if;

  v_player_id := public._resolve_player_id_from_session_token(session_token);
  if v_player_id is null then
    raise exception 'MISSING_SESSION';
  end if;

  if v_kind not in ('drink','speed') then
    raise exception 'INVALID_KIND';
  end if;

  if v_action = 'create' then
    if v_kind = 'drink' then
      v_result := public.create_drink_event(
        session_token => session_token,
        event_type_key => v_type_key,
        quantity => v_quantity,
        lat => v_lat,
        lng => v_lng,
        accuracy => v_accuracy
      );
    else
      v_result := public.create_combined_drink_speed_attempt(
        session_token => session_token,
        client_attempt_id => v_client_id,
        event_type_key => v_type_key,
        quantity => v_quantity,
        duration_seconds => v_duration,
        lat => v_lat,
        lng => v_lng,
        accuracy => v_accuracy
      );
    end if;

    return jsonb_build_object('ok', true, 'action', v_action, 'request_kind', v_kind, 'result', coalesce(v_result, '{}'::jsonb));
  end if;

  if v_request_id is null then
    raise exception 'MISSING_REQUEST_ID';
  end if;

  if v_kind = 'drink' then
    select player_id, coalesce(status,'pending')
    into v_owner_id, v_current_status
    from public.drink_events
    where id = v_request_id
    limit 1;
  else
    select player_id, coalesce(status,'pending')
    into v_owner_id, v_current_status
    from public.drink_speed_attempts
    where id = v_request_id
    limit 1;
  end if;

  if v_owner_id is null then
    raise exception 'NOT_FOUND';
  end if;

  if v_action = 'submit' then
    if v_owner_id <> v_player_id then
      raise exception 'NOT_ALLOWED';
    end if;
    if v_kind = 'drink' then
      update public.drink_events
      set submitted_at = coalesce(submitted_at, v_now)
      where id = v_request_id;
    else
      update public.drink_speed_attempts
      set submitted_at = coalesce(submitted_at, v_now)
      where id = v_request_id;
    end if;
    return jsonb_build_object('ok', true, 'action', v_action, 'request_kind', v_kind, 'request_id', v_request_id);
  end if;

  if v_action = 'cancel' then
    if v_owner_id <> v_player_id then
      raise exception 'NOT_ALLOWED';
    end if;
    if v_current_status <> 'pending' then
      raise exception 'ALREADY_RESOLVED';
    end if;

    if v_kind = 'drink' then
      update public.drink_events
      set status = 'cancelled',
          cancelled_at = coalesce(cancelled_at, v_now),
          resolved_at = coalesce(resolved_at, v_now)
      where id = v_request_id
        and player_id = v_player_id
        and coalesce(status,'pending') = 'pending';
    else
      update public.drink_speed_attempts
      set status = 'cancelled',
          cancelled_at = coalesce(cancelled_at, v_now),
          resolved_at = coalesce(resolved_at, v_now)
      where id = v_request_id
        and player_id = v_player_id
        and coalesce(status,'pending') = 'pending';
    end if;

    return jsonb_build_object('ok', true, 'action', v_action, 'request_kind', v_kind, 'request_id', v_request_id);
  end if;

  if v_action = 'approve' then
    if v_kind = 'drink' then
      v_result := public.verify_drink_event(
        session_token => session_token,
        drink_event_id => v_request_id,
        lat => v_lat,
        lng => v_lng,
        accuracy => v_accuracy,
        approve => true
      );
    else
      v_result := public.verify_drink_speed_attempt(
        session_token => session_token,
        attempt_id => v_request_id,
        lat => v_lat,
        lng => v_lng,
        accuracy => v_accuracy,
        approve => true,
        reason => null
      );
    end if;
    return jsonb_build_object('ok', true, 'action', v_action, 'request_kind', v_kind, 'request_id', v_request_id, 'result', coalesce(v_result, '{}'::jsonb));
  end if;

  if v_action = 'reject' then
    if v_kind = 'drink' then
      v_result := public.verify_drink_event(
        session_token => session_token,
        drink_event_id => v_request_id,
        lat => v_lat,
        lng => v_lng,
        accuracy => v_accuracy,
        approve => false
      );
    else
      v_result := public.verify_drink_speed_attempt(
        session_token => session_token,
        attempt_id => v_request_id,
        lat => v_lat,
        lng => v_lng,
        accuracy => v_accuracy,
        approve => false,
        reason => nullif(payload->>'reason','')
      );
    end if;
    return jsonb_build_object('ok', true, 'action', v_action, 'request_kind', v_kind, 'request_id', v_request_id, 'result', coalesce(v_result, '{}'::jsonb));
  end if;

  raise exception 'INVALID_ACTION';
exception
  when others then
    return jsonb_build_object(
      'ok', false,
      'action', v_action,
      'request_kind', v_kind,
      'error_code', sqlerrm,
      'message',
        case sqlerrm
          when 'MISSING_SESSION' then 'Niet ingelogd.'
          when 'INVALID_KIND' then 'Onbekend requesttype.'
          when 'MISSING_REQUEST_ID' then 'Aanvraag-id ontbreekt.'
          when 'NOT_FOUND' then 'Aanvraag niet gevonden.'
          when 'NOT_ALLOWED' then 'Deze actie is niet toegestaan.'
          when 'ALREADY_RESOLVED' then 'Deze aanvraag is al afgehandeld.'
          when 'INVALID_ACTION' then 'Onbekende drinks-actie.'
          else 'Drinks-actie mislukt.'
        end
    );
end;
$$;

create or replace function public.get_canonical_pending_drinks_public(
  session_token text default null,
  viewer_lat numeric default null,
  viewer_lng numeric default null,
  request_kind text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_viewer_id bigint := null;
  v_kind text := lower(trim(coalesce(request_kind, '')));
  v_my_pending jsonb;
  v_verification_queue jsonb;
  v_recent_rejected jsonb;
begin
  begin
    if nullif(trim(coalesce(session_token,'')), '') is not null then
      v_viewer_id := public._resolve_player_id_from_session_token(session_token);
    end if;
  exception when others then
    v_viewer_id := null;
  end;

  v_my_pending := coalesce((
    select jsonb_agg(to_jsonb(x) order by x.submitted_at desc, x.request_id desc)
    from (
      select *
      from public.canonical_pending_drink_requests_v
      where (v_kind = '' or request_kind = v_kind)
        and (v_viewer_id is not null and player_id = v_viewer_id)
    ) x
  ), '[]'::jsonb);

  v_verification_queue := coalesce((
    with existing_votes as (
      select 'drink'::text as request_kind, dev.drink_event_id as request_id, dev.verifier_player_id as verifier_id
      from public.drink_event_verifications dev
      union all
      select 'speed'::text as request_kind, dsv.attempt_id as request_id, dsv.verifier_player_id as verifier_id
      from public.drink_speed_verifications dsv
    )
    select jsonb_agg(to_jsonb(q) order by q.review_started_at nulls last, q.submitted_at desc, q.request_id desc)
    from (
      select
        p.*,
        case
          when v_viewer_id is null then false
          when p.player_id = v_viewer_id then false
          when exists (
            select 1 from existing_votes ev
            where ev.request_kind = p.request_kind
              and ev.request_id = p.request_id
              and ev.verifier_id = v_viewer_id
          ) then false
          else true
        end as can_vote
      from public.canonical_pending_drink_requests_v p
      where (v_kind = '' or p.request_kind = v_kind)
        and (v_viewer_id is null or p.player_id <> v_viewer_id)
    ) q
  ), '[]'::jsonb);

  v_recent_rejected := coalesce((
    select jsonb_agg(to_jsonb(r) order by r.resolved_at desc, r.request_id desc)
    from (
      select
        'drink'::text as request_kind,
        de.id as request_id,
        de.player_id,
        coalesce(nullif(to_jsonb(de)->>'player_name',''),
                 (select coalesce(nullif(p.display_name,''), nullif(p.nickname,''), p.name) from public.players p where p.id = de.player_id limit 1),
                 'Onbekend') as player_name,
        public._normalize_drink_type_key(coalesce(de.canonical_event_type_key, de.event_type_key)) as canonical_event_type_key,
        public._drink_type_display_label(coalesce(de.canonical_event_type_key, de.event_type_key)) as event_type_label,
        coalesce(de.quantity,1)::numeric as quantity,
        coalesce(nullif(to_jsonb(de)->>'total_units','')::numeric, coalesce(de.quantity,1)::numeric) as total_units,
        null::numeric as duration_seconds,
        de.location_label,
        de.resolved_at
      from public.drink_events de
      where coalesce(de.status,'pending') = 'rejected'
        and (v_kind = '' or v_kind = 'drink')

      union all

      select
        'speed'::text as request_kind,
        ds.id as request_id,
        ds.player_id,
        coalesce(nullif(to_jsonb(ds)->>'player_name',''),
                 (select coalesce(nullif(p.display_name,''), nullif(p.nickname,''), p.name) from public.players p where p.id = ds.player_id limit 1),
                 'Onbekend') as player_name,
        public._normalize_drink_type_key(coalesce(ds.canonical_event_type_key, ds.event_type_key, ds.speed_type_key)) as canonical_event_type_key,
        public._drink_type_display_label(coalesce(ds.canonical_event_type_key, ds.event_type_key, ds.speed_type_key)) as event_type_label,
        coalesce(ds.quantity,1)::numeric as quantity,
        coalesce(nullif(to_jsonb(ds)->>'total_units','')::numeric, coalesce(ds.quantity,1)::numeric) as total_units,
        nullif(to_jsonb(ds)->>'duration_seconds','')::numeric as duration_seconds,
        nullif(to_jsonb(ds)->>'location_label','') as location_label,
        ds.resolved_at
      from public.drink_speed_attempts ds
      where coalesce(ds.status,'pending') = 'rejected'
        and (v_kind = '' or v_kind = 'speed')
    ) r
  ), '[]'::jsonb);

  return jsonb_build_object(
    'my_pending', v_my_pending,
    'verification_queue', v_verification_queue,
    'recent_rejected', v_recent_rejected
  );
end;
$$;

create or replace function public.get_canonical_verified_drinks_public(
  request_kind text default null,
  target_player_name text default null,
  canonical_event_type_key text default null,
  limit_count integer default 40
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_kind text := lower(trim(coalesce(request_kind, '')));
  v_player text := nullif(trim(coalesce(target_player_name, '')), '');
  v_type text := case when nullif(trim(coalesce(canonical_event_type_key,'')), '') is null then null else public._normalize_drink_type_key(canonical_event_type_key) end;
  v_limit integer := case when limit_count is null then null else greatest(1, least(limit_count, 500)) end;
begin
  return coalesce((
    select jsonb_agg(to_jsonb(q) order by q.verified_at desc, q.request_id desc)
    from (
      select *
      from public.canonical_verified_drinks_v
      where (v_kind = '' or request_kind = v_kind)
        and (v_player is null or lower(player_name) = lower(v_player))
        and (v_type is null or canonical_event_type_key = v_type)
      order by verified_at desc, request_id desc
      limit coalesce(v_limit, 1000000)
    ) q
  ), '[]'::jsonb);
end;
$$;

create or replace function public.get_canonical_drinks_homepage_public()
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_today_total integer;
  v_all_time_total integer;
  v_top_types jsonb;
  v_heaviest_nights jsonb;
  v_top_players jsonb;
begin
  select count(*)::int
  into v_today_total
  from public.drink_verified_records
  where verified_at::date = current_date;

  select count(*)::int
  into v_all_time_total
  from public.drink_verified_records;

  v_top_types := coalesce((
    select jsonb_agg(to_jsonb(t) order by t.total_units desc, t.canonical_event_type_key)
    from (
      select canonical_event_type_key,
             max(display_event_type_label) as label,
             round(sum(total_units)::numeric, 2) as total_units,
             count(*)::int as records
      from public.drink_verified_records
      where source_kind = 'drink'
      group by canonical_event_type_key
      order by sum(total_units) desc
      limit 5
    ) t
  ), '[]'::jsonb);

  v_heaviest_nights := coalesce((
    select jsonb_agg(to_jsonb(h) order by h.total_units desc, h.drink_date desc)
    from (
      select verified_at::date as drink_date,
             round(sum(total_units)::numeric, 2) as total_units,
             count(*)::int as records
      from public.drink_verified_records
      where source_kind = 'drink'
      group by verified_at::date
      order by sum(total_units) desc
      limit 5
    ) h
  ), '[]'::jsonb);

  v_top_players := coalesce((
    select jsonb_agg(to_jsonb(p) order by p.total_units desc, p.player_name)
    from (
      select player_name,
             round(sum(total_units)::numeric, 2) as total_units,
             count(*)::int as records
      from public.drink_verified_records
      where source_kind = 'drink'
      group by player_name
      order by sum(total_units) desc
      limit 5
    ) p
  ), '[]'::jsonb);

  return jsonb_build_object(
    'today_total', coalesce(v_today_total, 0),
    'all_time_total', coalesce(v_all_time_total, 0),
    'top_types', v_top_types,
    'heaviest_nights', v_heaviest_nights,
    'top_players', v_top_players
  );
end;
$$;

create or replace function public.get_canonical_drinks_player_public(player_name text)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_player text := trim(coalesce(player_name, ''));
begin
  return jsonb_build_object(
    'player_name', v_player,
    'summary', (
      select jsonb_build_object(
        'verified_records', count(*)::int,
        'total_units', round(coalesce(sum(total_units), 0)::numeric, 2),
        'speed_records', count(*) filter (where request_kind = 'speed'),
        'drink_records', count(*) filter (where request_kind = 'drink')
      )
      from public.canonical_verified_drinks_v
      where lower(player_name) = lower(v_player)
    ),
    'by_type', coalesce((
      select jsonb_agg(to_jsonb(x) order by x.total_units desc, x.canonical_event_type_key)
      from (
        select canonical_event_type_key,
               max(event_type_label) as label,
               round(sum(total_units)::numeric, 2) as total_units,
               count(*)::int as records
        from public.canonical_verified_drinks_v
        where lower(player_name) = lower(v_player)
        group by canonical_event_type_key
      ) x
    ), '[]'::jsonb),
    'recent', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.verified_at desc, r.request_id desc)
      from (
        select *
        from public.canonical_verified_drinks_v
        where lower(player_name) = lower(v_player)
        order by verified_at desc
        limit 25
      ) r
    ), '[]'::jsonb),
    'speed_records', coalesce((
      select jsonb_agg(to_jsonb(s) order by s.duration_seconds asc nulls last, s.verified_at desc)
      from (
        select *
        from public.canonical_verified_drinks_v
        where lower(player_name) = lower(v_player)
          and request_kind = 'speed'
        order by duration_seconds asc nulls last, verified_at desc
        limit 25
      ) s
    ), '[]'::jsonb)
  );
end;
$$;

create or replace function public.get_canonical_drinks_speed_stats_public(
  session_token text default null,
  target_player_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_target text := nullif(trim(coalesce(target_player_name, '')), '');
begin
  return jsonb_build_object(
    'player_name', v_target,
    'top_by_type', coalesce((
      select jsonb_agg(to_jsonb(t) order by t.canonical_event_type_key)
      from (
        select canonical_event_type_key,
               max(event_type_label) as label,
               min(duration_seconds) as best_seconds,
               count(*)::int as verified_attempts
        from public.canonical_verified_drinks_v
        where request_kind = 'speed'
          and (v_target is null or lower(player_name) = lower(v_target))
        group by canonical_event_type_key
      ) t
    ), '[]'::jsonb),
    'recent_attempts', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.verified_at desc)
      from (
        select *
        from public.canonical_verified_drinks_v
        where request_kind = 'speed'
          and (v_target is null or lower(player_name) = lower(v_target))
        order by verified_at desc
        limit 30
      ) r
    ), '[]'::jsonb),
    'rankings_by_type', coalesce((
      select jsonb_agg(to_jsonb(q) order by q.canonical_event_type_key)
      from (
        select canonical_event_type_key,
               max(event_type_label) as label,
               jsonb_agg(
                 jsonb_build_object(
                   'player_name', player_name,
                   'best_seconds', best_seconds,
                   'attempts', attempts
                 )
                 order by best_seconds asc nulls last, player_name asc
               ) as rankings
        from (
          select canonical_event_type_key,
                 event_type_label,
                 player_name,
                 min(duration_seconds) as best_seconds,
                 count(*)::int as attempts
          from public.canonical_verified_drinks_v
          where request_kind = 'speed'
          group by canonical_event_type_key, event_type_label, player_name
        ) s
        group by canonical_event_type_key
      ) q
    ), '[]'::jsonb)
  );
end;
$$;

grant execute on function public.canonical_drinks_action_v1(text, text, text, jsonb) to anon, authenticated;
grant execute on function public.get_canonical_pending_drinks_public(text, numeric, numeric, text) to anon, authenticated;
grant execute on function public.get_canonical_verified_drinks_public(text, text, text, integer) to anon, authenticated;
grant execute on function public.get_canonical_drinks_homepage_public() to anon, authenticated;
grant execute on function public.get_canonical_drinks_player_public(text) to anon, authenticated;
grant execute on function public.get_canonical_drinks_speed_stats_public(text, text) to anon, authenticated;

commit;
