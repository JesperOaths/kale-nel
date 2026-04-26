# GEJAST v693 lobby/profiles/beurs fix

Run `GEJAST_v693_lobby_profiles_beurs_fix.sql` after v692.

Fixes:

- Profiles crash: removes the invalid `p.session_token` dependency from active-player/profile SQL.
- Paardenrace create lobby: drops all overloads of `create_paardenrace_room_fast_v687` and recreates one canonical 5-argument function.
- Pikken public lobby list: adds `get_pikken_open_lobbies_fast_v687` and `get_pikken_live_matches_fast_v687` as scope-only public readers so other players can see joinable lobbies.
- Beurs page: `get_caute_coin_top5_public` now reads `despimarkt_caute_balance_view` when present, and falls back to active players instead of showing a dead empty board.
- Scorer page: if there are no saved rounds, stale saved player names no longer trigger resume. The player/team setup popup opens immediately.

This bundle does not include the v691 admin-owner migration.

