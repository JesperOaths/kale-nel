GEJAST v700 - Paardenrace ready overload + Pikken live pipeline

Run:

GEJAST_v700_paardenrace_ready_pikken_pipeline_fix.sql

Fixes:

1. Paardenrace ready
- Drops every overloaded set_paardenrace_ready_safe signature.
- Recreates one canonical set_paardenrace_ready_safe(session_token, session_token_input, room_code_input, ready_input, site_scope_input).
- This removes the PostgREST "could not choose best candidate function" error.

2. Pikken logged-in detection
- gejast-config.js and gejast-pikken-contract.js now recursively search session/account/login payloads in localStorage/sessionStorage and cookies.
- This covers the case where the site knows you are logged in but Pikken only checked the old two token keys.

3. Pikken action pipeline
- Adds canonical RPCs for:
  - pikken_set_ready_scoped
  - pikken_place_bid_scoped
  - pikken_reject_bid_scoped
  - pikken_cast_vote_scoped
  - pikken_leave_game_scoped
- These use the same pikken_games, pikken_game_players, pikken_round_hands, and pikken_round_votes tables as the existing fast lobby/state functions.
- Bid, reject, vote, reveal, loser dice decrement, and state_version updates now live in the v700 SQL path.

No zip is created for this update.
