begin;

create or replace function public.get_drink_speed_page_public_v638(session_token text default null, player_name_input text default null)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  stats jsonb;
begin
  stats := public.get_drinks_verified_speed_stats_v638(player_name_input);
  return jsonb_build_object(
    'allowed_types', public.get_drinks_speed_allowed_types_v638(),
    'leaderboards', coalesce(stats->'rankings_by_type','[]'::jsonb),
    'rankings_by_type', coalesce(stats->'rankings_by_type','[]'::jsonb),
    'recent_attempts', coalesce(stats->'recent_attempts','[]'::jsonb),
    'players', coalesce(stats->'players','[]'::jsonb),
    'player_summary', coalesce(stats->'player_summary','{}'::jsonb),
    'player_type_top5', coalesce(stats->'player_type_top5','[]'::jsonb),
    'extra_boxes', coalesce(stats->'extra_boxes','[]'::jsonb),
    'source', 'v638_verified_speed_stats'
  );
end;
$$;

grant execute on function public.get_drink_speed_page_public_v638(text,text) to anon, authenticated;

commit;
