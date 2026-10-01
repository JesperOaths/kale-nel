-- Cache the analyzed player's canonical role so selected-role queue cohorting
-- can happen from lightweight metadata before loading large match/timeline JSON.

alter table public.league_match_cache_v1
  add column if not exists player_role text;

with matched as (
  select c.profile_id,c.match_id,
         me.elem->>'teamPosition' as team_position,
         me.elem->>'individualPosition' as individual_position,
         me.elem->>'role' as raw_role,
         me.elem->>'lane' as raw_lane
  from public.league_match_cache_v1 c
  join public.league_profiles_v1 p on p.id=c.profile_id
  cross join lateral (
    select elem
    from jsonb_array_elements(coalesce(c.match_json->'info'->'participants','[]'::jsonb)) elem
    where elem->>'puuid'=p.puuid
    limit 1
  ) me
), normalized as (
  select profile_id,match_id,
    case upper(coalesce(team_position,''))
      when 'UTILITY' then 'SUPPORT' when 'SUPPORT' then 'SUPPORT' when 'DUO_SUPPORT' then 'SUPPORT'
      when 'BOTTOM' then 'ADC' when 'BOT' then 'ADC' when 'ADC' then 'ADC' when 'DUO_CARRY' then 'ADC'
      when 'MIDDLE' then 'MID' when 'MID' then 'MID'
      when 'JUNGLE' then 'JUNGLE' when 'TOP' then 'TOP' else 'GENERIC' end as team_role,
    case upper(coalesce(individual_position,''))
      when 'UTILITY' then 'SUPPORT' when 'SUPPORT' then 'SUPPORT' when 'DUO_SUPPORT' then 'SUPPORT'
      when 'BOTTOM' then 'ADC' when 'BOT' then 'ADC' when 'ADC' then 'ADC' when 'DUO_CARRY' then 'ADC'
      when 'MIDDLE' then 'MID' when 'MID' then 'MID'
      when 'JUNGLE' then 'JUNGLE' when 'TOP' then 'TOP' else 'GENERIC' end as individual_role,
    case upper(coalesce(raw_role,''))
      when 'UTILITY' then 'SUPPORT' when 'SUPPORT' then 'SUPPORT' when 'DUO_SUPPORT' then 'SUPPORT'
      when 'BOTTOM' then 'ADC' when 'BOT' then 'ADC' when 'ADC' then 'ADC' when 'DUO_CARRY' then 'ADC'
      when 'MIDDLE' then 'MID' when 'MID' then 'MID'
      when 'JUNGLE' then 'JUNGLE' when 'TOP' then 'TOP' else 'GENERIC' end as role_role,
    case upper(coalesce(raw_lane,''))
      when 'UTILITY' then 'SUPPORT' when 'SUPPORT' then 'SUPPORT' when 'DUO_SUPPORT' then 'SUPPORT'
      when 'BOTTOM' then 'ADC' when 'BOT' then 'ADC' when 'ADC' then 'ADC' when 'DUO_CARRY' then 'ADC'
      when 'MIDDLE' then 'MID' when 'MID' then 'MID'
      when 'JUNGLE' then 'JUNGLE' when 'TOP' then 'TOP' else 'GENERIC' end as lane_role
  from matched
), resolved as (
  select profile_id,match_id,
    case
      when team_role<>'GENERIC' and individual_role<>'GENERIC' and team_role<>individual_role then 'GENERIC'
      when team_role<>'GENERIC' then team_role
      when individual_role<>'GENERIC' then individual_role
      when role_role<>'GENERIC' then role_role
      when lane_role<>'GENERIC' then lane_role
      else 'GENERIC'
    end as player_role
  from normalized
)
update public.league_match_cache_v1 c
set player_role=r.player_role
from resolved r
where c.profile_id=r.profile_id and c.match_id=r.match_id
  and c.player_role is distinct from r.player_role;

alter table public.league_match_cache_v1
  drop constraint if exists league_match_cache_player_role_check;

alter table public.league_match_cache_v1
  add constraint league_match_cache_player_role_check
  check (player_role is null or player_role in ('ADC','SUPPORT','MID','JUNGLE','TOP','GENERIC'));

create index if not exists league_match_cache_profile_role_queue_time_idx
  on public.league_match_cache_v1(profile_id,player_role,queue_id,game_start_at desc nulls last);
