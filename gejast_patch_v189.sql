-- Gejast v189
-- Defensive fix for homepage drinks RPC screenshot errors + extra drinks config updates.

begin;

-- Ice in NL: 700mL at 4% = 28mL pure alcohol = 2.8 units (10mL/unit)
update public.drink_event_types
set unit_value = 2.8
where lower(coalesce(key, '')) = 'ice';

-- Ensure speed types exist for all choosable drinks.
insert into public.drink_speed_types (key, label)
select x.key, x.label
from (
  values
    ('bier','Bier'),
    ('shot','Shot'),
    ('wijnfles','Wijnfles'),
    ('ice','Ice'),
    ('liter_bier','Liter bier')
) as x(key,label)
where not exists (
  select 1 from public.drink_speed_types dst where lower(dst.key)=lower(x.key)
);

-- Add a selectable activatable user target.
-- Uses allowed_usernames when present; no PIN is set here so you can activate it yourself.
insert into public.allowed_usernames (username, display_name, status)
select 'testdummy', 'Test Dummy', 'approved'
where to_regclass('public.allowed_usernames') is not null
  and not exists (
    select 1 from public.allowed_usernames where lower(username)='testdummy' or lower(display_name)='test dummy'
  );

create or replace function public.get_drinks_homepage_top5_public()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  has_de_player_name boolean;
  has_de_verified_at boolean;
  has_dsa_player_name boolean;
  has_dsa_speed_type_key boolean;
  has_dst_label boolean;
  q text;
  out_json jsonb;
begin
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='player_name') into has_de_player_name;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_events' and column_name='verified_at') into has_de_verified_at;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='player_name') into has_dsa_player_name;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='speed_type_key') into has_dsa_speed_type_key;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_types' and column_name='label') into has_dst_label;

  q := format($f$
    with verified_events as (
      select
        %1$s as player_name,
        %2$s as display_name,
        coalesce(de.total_units, 0)::numeric as total_units,
        %3$s as event_ts
      from public.drink_events de
      left join public.players p on p.id = de.player_id
      where coalesce(de.status, '') = 'verified'
    ),
    session_window as (
      select public._drink_session_start(now()) as session_start
    ),
    session_top as (
      select player_name, max(display_name) as display_name, round(sum(total_units)::numeric,1) as total_units
      from verified_events ve
      cross join session_window sw
      where ve.event_ts >= sw.session_start
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
        %4$s as speed_type_key,
        %5$s as speed_type_label,
        %6$s as player_name,
        %7$s as display_name,
        round(min(coalesce(dsa.duration_seconds,0))::numeric,1) as duration_seconds
      from public.drink_speed_attempts dsa
      left join public.players p on p.id = dsa.player_id
      %8$s
      where coalesce(dsa.status, '') = 'verified'
      group by 1,2,3,4
    ),
    speed_type_sets as (
      select jsonb_agg(jsonb_build_object(
        'speed_type_key', speed_type_key,
        'label', speed_type_label,
        'rows', rows_json
      ) order by speed_type_label asc) as sets_json
      from (
        select speed_type_key, max(speed_type_label) as speed_type_label,
          jsonb_agg(jsonb_build_object(
            'player_name', player_name,
            'display_name', display_name,
            'duration_seconds', duration_seconds
          ) order by duration_seconds asc, player_name asc) as rows_json
        from (
          select sb.*,
                 row_number() over (partition by speed_type_key order by duration_seconds asc, player_name asc) as rn
          from speed_base sb
        ) ranked
        where rn <= 5
        group by speed_type_key
      ) grouped
    ),
    speed_top as (
      select player_name, max(display_name) as display_name, min(duration_seconds) as duration_seconds
      from speed_base
      group by player_name
      order by min(duration_seconds) asc, player_name asc
      limit 5
    )
    select jsonb_build_object(
      'session_top5', coalesce((select jsonb_agg(to_jsonb(session_top) order by total_units desc, player_name asc) from session_top), '[]'::jsonb),
      'all_time_top5', coalesce((select jsonb_agg(to_jsonb(all_time_top) order by total_units desc, player_name asc) from all_time_top), '[]'::jsonb),
      'speed_top5', coalesce((select jsonb_agg(to_jsonb(speed_top) order by duration_seconds asc, player_name asc) from speed_top), '[]'::jsonb),
      'speed_type_top5', coalesce((select sets_json from speed_type_sets), '[]'::jsonb)
    )
  $f$,
    case when has_de_player_name then "coalesce(nullif(trim(de.player_name), ''), nullif(trim(p.display_name), ''), 'Onbekend')" else "coalesce(nullif(trim(p.display_name), ''), 'Onbekend')" end,
    case when has_de_player_name then "coalesce(nullif(trim(p.display_name), ''), nullif(trim(de.player_name), ''), 'Onbekend')" else "coalesce(nullif(trim(p.display_name), ''), 'Onbekend')" end,
    case when has_de_verified_at then 'coalesce(de.verified_at, de.created_at)' else 'de.created_at' end,
    case when has_dsa_speed_type_key then "coalesce(nullif(trim(dsa.speed_type_key), ''), 'speed')" else "'speed'" end,
    case when has_dst_label and has_dsa_speed_type_key then "coalesce(nullif(trim(dst.label), ''), initcap(replace(dsa.speed_type_key, '_', ' ')))" when has_dsa_speed_type_key then "initcap(replace(dsa.speed_type_key, '_', ' '))" else "'Speed'" end,
    case when has_dsa_player_name then "coalesce(nullif(trim(dsa.player_name), ''), nullif(trim(p.display_name), ''), 'Onbekend')" else "coalesce(nullif(trim(p.display_name), ''), 'Onbekend')" end,
    case when has_dsa_player_name then "coalesce(nullif(trim(p.display_name), ''), nullif(trim(dsa.player_name), ''), 'Onbekend')" else "coalesce(nullif(trim(p.display_name), ''), 'Onbekend')" end,
    case when has_dst_label and has_dsa_speed_type_key then 'left join public.drink_speed_types dst on lower(dst.key)=lower(dsa.speed_type_key)' else '' end
  );

  execute q into out_json;
  return out_json;
end;
$$;

grant execute on function public.get_drinks_homepage_top5_public() to anon, authenticated;

commit;
