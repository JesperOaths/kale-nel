# GEJAST v692 overload/profiles/UI fix

This bundle is intentionally separate from the v691 admin/account owner migration.

Run:

1. Upload/copy the changed site files.
2. Run `GEJAST_v692_overload_profiles_speed_fix.sql` in Supabase SQL Editor after v690.
3. Do not run the v691 admin owner SQL unless you intentionally want that separate admin migration.

Fixes included:

- Drops ambiguous Paardenrace overloads for:
  - `get_paardenrace_open_rooms_public`
  - `get_paardenrace_room_state_fast_v687`
- Recreates one canonical signature for each of those RPCs.
- Restores `scorer.html` from the uploaded full scorer file.
- Fixes the profiles parser bug that unwrapped `{ ok:true, players:[...] }` into just `true`.
- Adds fast active-player SQL functions used by profiles and dropdowns.
- Makes Boerenbridge name loading parallel and capped around 900 ms per source instead of sequential multi-timeout loading.
- Rebuilds `beurs.html` to use the actual Beurs UI/runtime instead of a thin alias that could render empty.
- Cleans mojibake sequences such as `Â·`, `Ã©`, `â€¦`, card suit symbols, and arrows in root HTML/JS files.
- Adds `KLAVERJASSEN_INDEX_SPECTATOR_LIVE_PLAN_v692.md`.

