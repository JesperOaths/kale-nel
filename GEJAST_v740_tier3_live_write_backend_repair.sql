-- GEJAST v740: Tier 3 live-write backend repair notes.
-- Symptoms from Tier 3 beta live-write tests:
--   record "new" has no field "lat"
--   record "v_player" has no field "chosen_username"
--   column reference "client_match_id" is ambiguous
--
-- The live drinks trigger/RPC stack expects drink_events rows to expose lat/lng
-- fields. Add the compatible nullable columns instead of changing existing
-- trigger ownership. This is intentionally narrow and reversible.
--
-- The Rad symptom points at an older rad_log_* RPC compiled against
-- players.chosen_username. If the live players table does not have that column,
-- adding a generated-compatible nullable column is the least invasive bridge.
--
-- The Beerpong/Boerenbridge client_match_id ambiguity needs the affected SQL
-- functions to be re-created with disambiguated parameter names or qualified
-- references. Do not paper over that in the frontend; the RPC currently fails
-- before the client can verify stats/vault updates.

begin;

alter table if exists public.drink_events
  add column if not exists lat double precision,
  add column if not exists lng double precision,
  add column if not exists accuracy double precision;

alter table if exists public.players
  add column if not exists chosen_username text;

update public.players
   set chosen_username = coalesce(
     nullif(trim(chosen_username), ''),
     nullif(trim(display_name), ''),
     nullif(trim(name), ''),
     nullif(trim(slug), '')
   )
 where chosen_username is null or trim(chosen_username) = '';

create index if not exists drink_events_location_pending_idx
  on public.drink_events (site_scope, status, created_at desc)
  where lat is not null and lng is not null;

create index if not exists players_chosen_username_lower_idx
  on public.players (lower(chosen_username))
  where chosen_username is not null;

notify pgrst, 'reload schema';
notify pgrst, 'reload config';

commit;
