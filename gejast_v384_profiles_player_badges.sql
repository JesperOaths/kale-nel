begin;

create or replace function public.get_player_profiles_public_scoped(site_scope_input text default 'friends')
returns jsonb
language sql
security definer
set search_path to 'public'
as $fn$
with filtered as (
  select jsonb_array_elements(coalesce((public.get_player_profiles_public()->'profiles'),'[]'::jsonb)) as item
), scoped as (
  select item
  from filtered
  where lower(coalesce(
    (select p.site_scope
       from public.players p
      where lower(p.display_name) = lower(coalesce(item->>'player_name', item->>'display_name', item->>'chosen_username', item->>'public_display_name'))
      limit 1),
    'friends'
  )) = lower(coalesce(nullif(trim(site_scope_input),''),'friends'))
)
select jsonb_build_object(
  'players', coalesce(jsonb_agg(item), '[]'::jsonb),
  'profiles', coalesce(jsonb_agg(item), '[]'::jsonb)
)
from scoped;
$fn$;

grant execute on function public.get_player_profiles_public_scoped(text) to anon, authenticated;

create or replace function public.get_site_player_badge_cards_scoped(
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_scope text := case when lower(trim(coalesce(site_scope_input, ''))) = 'family' then 'family' else 'friends' end;
  v_raw jsonb;
  v_players jsonb := '[]'::jsonb;
  v_card jsonb;
  v_bundle jsonb;
  v_cards jsonb := '[]'::jsonb;
begin
  v_raw := public.get_all_site_players_public_scoped(site_scope_input => v_scope);
  if jsonb_typeof(v_raw) = 'object' and v_raw ? 'players' then
    v_players := coalesce(v_raw->'players', '[]'::jsonb);
  elsif jsonb_typeof(v_raw) = 'array' then
    v_players := v_raw;
  end if;

  for v_card in select value from jsonb_array_elements(v_players)
  loop
    v_bundle := public.get_player_badge_bundle_scoped(
      coalesce(
        nullif(trim(coalesce(v_card->>'player_name', '')), ''),
        nullif(trim(coalesce(v_card->>'display_name', '')), ''),
        nullif(trim(coalesce(v_card->>'chosen_username', '')), '')
      ),
      v_scope
    );

    v_cards := v_cards || jsonb_build_array(
      jsonb_build_object(
        'player_name', coalesce(v_card->>'player_name', v_bundle->>'player_name'),
        'display_name', coalesce(v_bundle->>'display_name', v_card->>'display_name', v_card->>'player_name'),
        'original_name', coalesce(v_bundle->>'original_name', v_card->>'player_name'),
        'favorite_game', v_card->>'favorite_game',
        'total_matches', coalesce(nullif(v_card->>'total_matches', '')::int, 0),
        'total_wins', coalesce(nullif(v_card->>'total_wins', '')::int, 0),
        'best_rating', coalesce(nullif(v_card->>'best_rating', '')::numeric, 1000),
        'primary_nickname', coalesce(v_bundle->>'primary_nickname', ''),
        'primary_badge', v_bundle->'primary_badge',
        'attained_badges', coalesce(v_bundle->'attained_badges', '[]'::jsonb),
        'mini_badges', coalesce(v_bundle->'mini_badges_48', '[]'::jsonb),
        'badge_count', coalesce((v_bundle->>'badge_count')::int, 0)
      )
    );
  end loop;

  return jsonb_build_object('cards', v_cards, 'players', v_cards);
end;
$$;

grant execute on function public.get_site_player_badge_cards_scoped(text) to anon, authenticated;

create or replace function public.get_profiles_page_bundle_scoped(
  site_scope_input text default 'friends'
)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $fn$
declare
  v_scope text := public._scope_norm(site_scope_input);
  v_base_players jsonb := '[]'::jsonb;
  v_row jsonb;
  v_bundle jsonb;
  v_cards jsonb := '[]'::jsonb;
begin
  with summary_counts as (
    select
      spr.player_name,
      count(*)::int as total_summary_matches,
      count(*) filter (where spr.is_win)::int as total_summary_wins,
      count(*) filter (where spr.game_key = 'klaverjas')::int as klaverjas_matches,
      count(*) filter (where spr.game_key = 'boerenbridge')::int as boerenbridge_matches
    from public._gejast_summary_player_rows(false) spr
    group by spr.player_name
  ), beerpong_counts as (
    select
      bpr.player_name,
      count(*)::int as beerpong_matches,
      count(*) filter (where bpr.is_win)::int as beerpong_wins
    from public._gejast_beerpong_player_rows() bpr
    group by bpr.player_name
  ), active_players as (
    select
      p.id,
      p.display_name as player_name,
      p.display_name as display_name,
      coalesce(pp.nickname, '') as nickname,
      pp.profile_picture_url,
      pp.favorite_game,
      pp.bio,
      coalesce(sc.total_summary_matches,0) + coalesce(bp.beerpong_matches,0) as total_matches,
      coalesce(sc.total_summary_wins,0) + coalesce(bp.beerpong_wins,0) as total_wins,
      coalesce(sc.klaverjas_matches,0) as klaverjas_matches,
      coalesce(sc.boerenbridge_matches,0) as boerenbridge_matches,
      coalesce(bp.beerpong_matches,0) as beerpong_matches,
      coalesce(round((select rating from public.beerpong_player_ratings r where r.player_id = p.id),0),1000) as best_rating,
      public._gejast_public_badge(
        coalesce(sc.total_summary_matches,0) + coalesce(bp.beerpong_matches,0),
        case when (coalesce(sc.total_summary_matches,0) + coalesce(bp.beerpong_matches,0)) > 0 then
          (100.0 * (coalesce(sc.total_summary_wins,0) + coalesce(bp.beerpong_wins,0))) / (coalesce(sc.total_summary_matches,0) + coalesce(bp.beerpong_matches,0))
        else 0 end
      ) as best_badge
    from public.players p
    left join public.player_profiles pp on pp.player_id = p.id
    left join summary_counts sc on public._gejast_norm_name(sc.player_name) = public._gejast_norm_name(p.display_name)
    left join beerpong_counts bp on public._gejast_norm_name(bp.player_name) = public._gejast_norm_name(p.display_name)
    where coalesce(p.active, false) is true
      and nullif(trim(coalesce(p.display_name, '')), '') is not null
      and lower(coalesce(nullif(trim(coalesce(p.site_scope, '')), ''), 'friends')) = v_scope
    order by (coalesce(sc.total_summary_matches,0) + coalesce(bp.beerpong_matches,0)) desc, lower(coalesce(pp.nickname, p.display_name)) asc
  )
  select coalesce(jsonb_agg(jsonb_build_object(
    'player_id', ap.id,
    'player_name', ap.player_name,
    'display_name', ap.display_name,
    'public_display_name', coalesce(nullif(trim(ap.nickname), ''), ap.display_name),
    'chosen_username', coalesce(nullif(trim(ap.nickname), ''), ap.display_name),
    'nickname', ap.nickname,
    'profile_picture_url', ap.profile_picture_url,
    'favorite_game', ap.favorite_game,
    'bio', ap.bio,
    'total_matches', ap.total_matches,
    'total_wins', ap.total_wins,
    'klaverjas_matches', ap.klaverjas_matches,
    'boerenbridge_matches', ap.boerenbridge_matches,
    'beerpong_matches', ap.beerpong_matches,
    'best_rating', ap.best_rating,
    'best_badge', ap.best_badge
  )), '[]'::jsonb)
  into v_base_players
  from active_players ap;

  for v_row in select value from jsonb_array_elements(v_base_players)
  loop
    begin
      v_bundle := public.get_player_badge_bundle_scoped(v_row->>'player_name', v_scope);
    exception when others then
      v_bundle := '{}'::jsonb;
    end;

    v_cards := v_cards || jsonb_build_array(
      v_row || jsonb_build_object(
        'primary_nickname', coalesce(v_bundle->>'primary_nickname', ''),
        'primary_badge', v_bundle->'primary_badge',
        'attained_badges', coalesce(v_bundle->'attained_badges', '[]'::jsonb),
        'all_badges', coalesce(v_bundle->'all_badges', '[]'::jsonb),
        'mini_badges', coalesce(v_bundle->'mini_badges_48', '[]'::jsonb),
        'badge_count', coalesce((v_bundle->>'badge_count')::int, 0)
      )
    );
  end loop;

  return jsonb_build_object(
    'site_scope', v_scope,
    'players', coalesce(v_cards, '[]'::jsonb),
    'badge_cards', coalesce(v_cards, '[]'::jsonb),
    'active_players_count', jsonb_array_length(coalesce(v_cards, '[]'::jsonb)),
    'perf_hints', jsonb_build_object(
      'chunk_cards', true,
      'lazy_avatars', true,
      'mobile_initial_batch', 18
    )
  );
end;
$fn$;

grant execute on function public.get_profiles_page_bundle_scoped(text) to anon, authenticated;

commit;
