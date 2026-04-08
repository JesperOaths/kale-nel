-- GEJAST v353 badge system SQL
-- Carries forward the v331 live/comeback badge facts layer as the canonical badge-facts backend for the v353 badge UI rollout.

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
