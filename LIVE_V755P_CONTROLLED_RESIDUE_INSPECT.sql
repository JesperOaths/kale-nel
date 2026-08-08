-- Read-only inspection of unexpected OC_V764 Beerpong residue after v755p apply.
-- Safe to run in Supabase SQL Editor.
-- Does not create/update/delete production rows.

select
  id,
  client_match_id,
  created_by_player_id,
  match_status,
  match_format,
  winner_team,
  team_a_cups_left,
  team_b_cups_left,
  finished_at,
  updated_at,
  team_a_player_names,
  team_b_player_names
from public.beerpong_matches
where client_match_id like 'OC_V764_BEERPONG_%'
order by id;

select
  count(*) as total_matches,
  count(*) filter (where client_match_id like 'OC_V764_BEERPONG_%') as controlled_matches,
  (select count(*) from public.beerpong_player_ratings) as rating_rows,
  (select count(*) from public.beerpong_player_rating_history) as rating_history_rows,
  (select unit_value from public.drink_event_types where key='ice' limit 1) as ice_unit_value
from public.beerpong_matches;
