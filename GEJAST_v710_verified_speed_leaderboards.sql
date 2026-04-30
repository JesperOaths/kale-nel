-- GEJAST v710 verified speed leaderboards
-- Purpose: feed drinks.html with all verified speed attempts grouped by drink type,
-- while excluding shots/shotjes/shooters as required by the drinks handoffs.
-- Safe to run repeatedly.

begin;

create or replace function public.get_verified_speed_leaderboards_v710(site_scope_input text default 'friends')
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := case
    when lower(trim(coalesce(site_scope_input,''))) = 'family' then 'family'
    else 'friends'
  end;
  v_has_scope boolean := false;
  v_has_status boolean := false;
  v_has_verified_at boolean := false;
  v_has_duration boolean := false;
  v_has_speed_key boolean := false;
  v_has_speed_label boolean := false;
  v_has_player_name boolean := false;
  v_has_player_id boolean := false;
  v_sql text;
  v_rows jsonb := '[]'::jsonb;
begin
  if to_regclass('public.drink_speed_attempts') is null then
    return jsonb_build_object('ok', true, 'site_scope', v_scope, 'leaderboards', '[]'::jsonb, 'warning', 'drink_speed_attempts not found');
  end if;

  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='site_scope') into v_has_scope;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='status') into v_has_status;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='verified_at') into v_has_verified_at;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='duration_seconds') into v_has_duration;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='speed_type_key') into v_has_speed_key;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='speed_type_label') into v_has_speed_label;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='player_name') into v_has_player_name;
  select exists(select 1 from information_schema.columns where table_schema='public' and table_name='drink_speed_attempts' and column_name='player_id') into v_has_player_id;

  if not v_has_duration then
    return jsonb_build_object('ok', true, 'site_scope', v_scope, 'leaderboards', '[]'::jsonb, 'warning', 'duration_seconds column not found');
  end if;

  v_sql := format($sql$
    with base as (
      select
        %s as speed_type_key,
        %s as speed_type_label,
        %s as player_name,
        duration_seconds::numeric as duration_seconds,
        %s as verified_at,
        %s as player_id
      from public.drink_speed_attempts dsa
      where duration_seconds is not null
        and duration_seconds > 0
        %s
        %s
    ), filtered as (
      select * from base
      where coalesce(speed_type_key,'') <> ''
        and not (lower(coalesce(speed_type_key,'') || ' ' || coalesce(speed_type_label,'')) ~ '(^|[^a-z0-9])(shot|shots|shotje|shotjes|shooter|shooters|borrel|borrels)([^a-z0-9]|$)')
    ), ranked as (
      select *, row_number() over (partition by lower(speed_type_key), lower(player_name) order by duration_seconds asc, verified_at asc nulls last) as player_rank
      from filtered
    ), best_per_player as (
      select * from ranked where player_rank = 1
    ), grouped as (
      select
        speed_type_key,
        min(speed_type_label) as speed_type_label,
        jsonb_agg(jsonb_build_object(
          'player_id', player_id,
          'player_name', player_name,
          'speed_type_key', speed_type_key,
          'speed_type_label', speed_type_label,
          'duration_seconds', duration_seconds,
          'verified_at', verified_at
        ) order by duration_seconds asc, lower(player_name)) as rows
      from best_per_player
      group by speed_type_key
    )
    select coalesce(jsonb_agg(jsonb_build_object(
      'key', speed_type_key,
      'label', coalesce(nullif(speed_type_label,''), speed_type_key),
      'rows', rows
    ) order by lower(coalesce(nullif(speed_type_label,''), speed_type_key))), '[]'::jsonb)
    from grouped
  $sql$,
    case when v_has_speed_key then 'coalesce(nullif(trim(dsa.speed_type_key),''''), ''unknown'')' else '''unknown''' end,
    case when v_has_speed_label then 'coalesce(nullif(trim(dsa.speed_type_label),''''), nullif(trim(dsa.speed_type_key),''''), ''Drank'')' when v_has_speed_key then 'coalesce(nullif(trim(dsa.speed_type_key),''''), ''Drank'')' else '''Drank''' end,
    case when v_has_player_name then 'coalesce(nullif(trim(dsa.player_name),''''), ''Onbekend'')' else '''Onbekend''' end,
    case when v_has_verified_at then 'dsa.verified_at' else 'null::timestamptz' end,
    case when v_has_player_id then 'dsa.player_id' else 'null::bigint' end,
    case when v_has_status then 'and lower(coalesce(dsa.status,'''')) in (''verified'',''approved'',''confirmed'')' else '' end,
    case when v_has_scope then format('and lower(coalesce(dsa.site_scope,''friends'')) = %L', v_scope) else '' end
  );

  execute v_sql into v_rows;

  return jsonb_build_object(
    'ok', true,
    'site_scope', v_scope,
    'leaderboards', coalesce(v_rows, '[]'::jsonb)
  );
end;
$fn$;

grant execute on function public.get_verified_speed_leaderboards_v710(text) to anon, authenticated;
notify pgrst, 'reload schema';

commit;
