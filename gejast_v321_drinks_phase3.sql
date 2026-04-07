begin;

drop function if exists public.get_drink_speed_stats_public(text,text);
drop function if exists public.get_drink_speed_stats_public(text);

create or replace function public.get_drink_speed_stats_public(
  session_token text,
  target_player_name text default null
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_viewer_id bigint;
  v_target text;
begin
  v_viewer_id := public._resolve_player_id_from_session_token(session_token);
  if v_viewer_id is null then
    raise exception 'Niet ingelogd.';
  end if;

  select coalesce(nullif(trim(target_player_name), ''), min(player_name))
    into v_target
  from (
    select distinct coalesce(nullif(trim(dsa.player_name), ''), nullif(trim(to_jsonb(p)->>'display_name'), ''), nullif(trim(to_jsonb(p)->>'username'), ''), 'Onbekend') as player_name
    from public.drink_speed_attempts dsa
    left join public.players p on p.id = dsa.player_id
    where coalesce(to_jsonb(dsa)->>'status', 'pending') = 'verified'
  ) src;

  return (
    with attempts as (
      select
        dsa.id,
        dsa.player_id,
        coalesce(nullif(trim(dsa.player_name), ''), nullif(trim(to_jsonb(p)->>'display_name'), ''), nullif(trim(to_jsonb(p)->>'username'), ''), 'Onbekend') as player_name,
        coalesce(dst.key, 'speed') as speed_type_key,
        coalesce(dst.label, dst.key, 'Snelheid') as speed_type_label,
        round(coalesce(dsa.duration_seconds, 0)::numeric, 1) as duration_seconds,
        coalesce(to_jsonb(dsa)->>'status', 'pending') as status,
        coalesce(nullif(to_jsonb(dsa)->>'verified_at','')::timestamptz, dsa.created_at) as sort_ts,
        to_char(coalesce(nullif(to_jsonb(dsa)->>'verified_at','')::timestamptz, dsa.created_at), 'Dy DD-MM-YYYY HH24:MI') as verified_at_label
      from public.drink_speed_attempts dsa
      left join public.players p on p.id = dsa.player_id
      left join public.drink_speed_types dst on dst.id = dsa.speed_type_id
      where coalesce(dsa.duration_seconds, 0) > 0
    ), verified as (
      select * from attempts where status = 'verified'
    ), players as (
      select distinct player_name from verified order by player_name
    ), recent_attempts as (
      select player_name, speed_type_key, speed_type_label, duration_seconds, verified_at_label
      from verified
      order by sort_ts desc nulls last, id desc
      limit 20
    ), type_ranked as (
      select speed_type_key, speed_type_label, player_name, min(duration_seconds) as best_seconds
      from verified
      group by speed_type_key, speed_type_label, player_name
    ), rankings_by_type as (
      select speed_type_key as key, min(speed_type_label) as label,
        jsonb_agg(jsonb_build_object('player_name', player_name, 'duration_seconds', round(best_seconds::numeric,1)) order by best_seconds asc, player_name asc) filter (where rn <= 5) as rows
      from (
        select *, row_number() over (partition by speed_type_key order by best_seconds asc, player_name asc) as rn
        from type_ranked
      ) ranked
      group by speed_type_key
      order by min(speed_type_label)
    ), target_attempts as (
      select * from verified where player_name = v_target
    ), player_summary as (
      select jsonb_build_object(
        'player_name', v_target,
        'verified_attempt_count', count(*),
        'best_overall_seconds', round(min(duration_seconds)::numeric,1)
      ) as obj
      from target_attempts
    ), player_type_top5 as (
      select speed_type_key as key, min(speed_type_label) as label,
        jsonb_agg(jsonb_build_object('duration_seconds', duration_seconds, 'verified_at_label', verified_at_label) order by duration_seconds asc, sort_ts desc) filter (where rn <= 5) as rows
      from (
        select *, row_number() over (partition by speed_type_key order by duration_seconds asc, sort_ts desc) as rn
        from target_attempts
      ) ranked
      group by speed_type_key
      order by min(speed_type_label)
    ), extra_boxes as (
      select jsonb_build_array(
        jsonb_build_object('label', 'Actieve dranktypes', 'value', (select count(*) from rankings_by_type), 'meta', 'Met verified tijden'),
        jsonb_build_object('label', 'Laatste verified poging', 'value', coalesce((select player_name from recent_attempts limit 1), '—'), 'meta', coalesce((select verified_at_label from recent_attempts limit 1), 'Nog geen data')),
        jsonb_build_object('label', 'Snelste tijd ooit', 'value', coalesce((select round(min(best_seconds)::numeric,1)::text || 's' from type_ranked), '—'), 'meta', 'Over alle dranktypes heen')
      ) as arr
    )
    select jsonb_build_object(
      'players', coalesce((select jsonb_agg(player_name order by player_name) from players), '[]'::jsonb),
      'selected_player_name', v_target,
      'recent_attempts', coalesce((select jsonb_agg(to_jsonb(recent_attempts)) from recent_attempts), '[]'::jsonb),
      'rankings_by_type', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'label', label, 'rows', coalesce(rows, '[]'::jsonb))) from rankings_by_type), '[]'::jsonb),
      'player_summary', coalesce((select obj from player_summary), '{}'::jsonb),
      'player_type_top5', coalesce((select jsonb_agg(jsonb_build_object('key', key, 'label', label, 'rows', coalesce(rows, '[]'::jsonb))) from player_type_top5), '[]'::jsonb),
      'extra_boxes', coalesce((select arr from extra_boxes), '[]'::jsonb)
    )
  );
end;
$$;

grant execute on function public.get_drink_speed_stats_public(text,text) to anon, authenticated;

commit;
