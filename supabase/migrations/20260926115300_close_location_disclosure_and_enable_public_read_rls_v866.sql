begin;

alter table public.drink_events enable row level security;
alter table public.drink_speed_attempts enable row level security;
alter table public.drink_verified_records enable row level security;

revoke select, references, trigger on table
  public.drink_events,
  public.drink_speed_attempts,
  public.drink_verified_records
from anon, authenticated;

alter function public.get_drink_player_bundle_public(text,integer) security definer;
alter function public.get_drink_player_bundle_public(text,integer) set search_path to public;
alter function public.get_drinks_global_stats_public(integer) security definer;
alter function public.get_drinks_global_stats_public(integer) set search_path to public;
alter function public.get_drink_speed_stats_bundle_public(text,text) security definer;
alter function public.get_drink_speed_stats_bundle_public(text,text) set search_path to public;
alter function public._badge_verified_drink_rows(text) security definer;
alter function public._badge_verified_drink_rows(text) set search_path to public;
alter function public._badge_verified_speed_rows(text) security definer;
alter function public._badge_verified_speed_rows(text) set search_path to public;

revoke execute on function public._web_push_request_payload(text,bigint)
from public, anon, authenticated;
grant execute on function public._web_push_request_payload(text,bigint) to service_role;

do $$
declare t text;
begin
  foreach t in array array[
    'drink_speed_types','klaverjas_player_rating_history','klaverjas_player_ratings','paardenrace_matches',
    'paardenrace_match_nominations','boerenbridge_player_stats','boerenbridge_player_ratings',
    'pikken_player_stats','pikken_player_relationship_stats','despimarkt_positions','despimarkt_markets',
    'rad_spin_events','rad_target_events','beerpong_matches','beerpong_player_ratings',
    'beerpong_player_rating_history','jas_game_entries','beerpong_player_stats','beerpong_rating_history',
    'player_profiles','games','drink_event_types','game_elo_ratings_scoped','jas_games',
    'game_elo_history_scoped','klaverjas_player_stats','boerenbridge_player_rating_history','boerenbridge_matches',
    'site_scope_name_overrides','ballroom_members','ballroom_safe_members','paardenrace_drink_obligations',
    'drink_type_aliases','badge_speed_thresholds','badge_definitions','ballroom_safe_king_history',
    'pikken_bid_events','pikken_match_player_outcomes','despimarkt_announcements'
  ]
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke references, trigger on table public.%I from anon, authenticated', t);
    execute format('create policy public_read_v866 on public.%I for select to anon, authenticated using (true)', t);
  end loop;
end $$;

commit;
