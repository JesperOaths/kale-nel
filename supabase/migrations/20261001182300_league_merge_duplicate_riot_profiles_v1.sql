-- Merge an empty named duplicate into its populated legacy recent-request
-- profile, preserving cached matches/history on the legacy row. Then prevent
-- duplicate saved profiles for the same Riot identity inside one workspace.

do $$
declare
  r record;
  dominant_role text;
begin
  for r in
    select
      legacy.id as legacy_id,
      named.id as named_id,
      named.profile_key as named_profile_key,
      coalesce(nullif(named.display_name,''),legacy.display_name) as merged_display_name
    from public.league_profiles_v1 legacy
    join public.league_profiles_v1 named
      on named.owner_player_id=legacy.owner_player_id
     and named.site_scope=legacy.site_scope
     and named.id<>legacy.id
     and named.profile_key<>'recent-request'
     and lower(coalesce(named.game_name,''))=lower(coalesce(legacy.game_name,''))
     and lower(coalesce(named.tag_line,''))=lower(coalesce(legacy.tag_line,''))
     and lower(coalesce(named.platform_region,''))=lower(coalesce(legacy.platform_region,''))
    where legacy.profile_key='recent-request'
      and legacy.game_name is not null
      and legacy.tag_line is not null
      and not exists(select 1 from public.league_match_cache_v1 c where c.profile_id=named.id)
      and not exists(select 1 from public.league_analysis_runs_v1 a where a.profile_id=named.id)
      and not exists(select 1 from public.league_fetch_runs_v1 f where f.profile_id=named.id)
  loop
    select c.player_role
      into dominant_role
    from public.league_match_cache_v1 c
    where c.profile_id=r.legacy_id
      and c.player_role in ('ADC','SUPPORT','MID','JUNGLE','TOP')
    group by c.player_role
    order by count(*) desc,c.player_role
    limit 1;

    delete from public.league_profiles_v1
    where id=r.named_id;

    update public.league_profiles_v1
    set profile_key=r.named_profile_key,
        display_name=r.merged_display_name,
        notes='kalenel_league_profile_v2|role='||coalesce(dominant_role,'ADC'),
        updated_at=now()
    where id=r.legacy_id;
  end loop;
end
$$;

create unique index if not exists league_profiles_owner_riot_identity_uidx
  on public.league_profiles_v1(
    owner_player_id,
    site_scope,
    lower(game_name),
    lower(tag_line),
    lower(platform_region)
  )
  where game_name is not null and tag_line is not null;
