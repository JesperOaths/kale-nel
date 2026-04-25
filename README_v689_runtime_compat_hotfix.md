# GEJAST v689 Runtime Compatibility Hotfix

This bundle addresses the concrete failures reported after v688:

- `pikken_create_lobby_backend_missing`
- Paardenrace ambiguous `get_paardenrace_open_rooms_fast_v687(...)` overloads
- slow Boerenbridge name loading
- Klaverjassen scorer dropdowns not loading active names
- Profiles timing out and hiding players/badge accordions

## Deploy Order

1. Upload all files in this bundle to GitHub/root.
2. Run `GEJAST_v689_runtime_compat_hotfix.sql` in the Supabase SQL editor.
3. In Supabase, refresh the PostgREST/schema cache if the dashboard still serves old signatures.
4. Hard-refresh the browser.

## What Changed

- `profiles.html`
  - v689 cache busters.
  - Longer primary profile timeout.
  - Active-login fallback via `get_login_active_names_v687`.
  - Badge gallery renders independently, even if profiles are slow.

- `gejast-klaverjas-runtime.js` and `scorer.html`
  - v689 runtime/page.
  - Klaverjassen dropdown names now prefer active-login names only.
  - Adds fast selector/login fallbacks before showing empty dropdowns.

- `gejast-pikken-contract.js`
  - Allows fallback from broken fast wrappers that return `*_backend_missing`.
  - This lets the existing scoped Pikken RPC owner handle lobby create/join/destroy when present.

- `gejast-paardenrace.js`
  - Sends `limit_input` for open-room reads to avoid ambiguous PostgREST overload selection.

- `boerenbridge.html`
  - Adds name-load timeouts and active-login/selector fallback.
  - Removes dummy-player fallback so only active scoped users are offered.

- `GEJAST_v689_runtime_compat_hotfix.sql`
  - Standalone SQL bundle.
  - Embeds v688 selector/login helpers.
  - Drops broken Pikken fast write wrappers so frontend fallback can work.
  - Drops stale one-argument Paardenrace open-rooms overload.
  - Adds `get_profiles_fast_v687`, `get_game_player_names_fast_v687`, and `get_scoped_player_names_v687` compatibility functions backed by active selector names.

## Notes

This is a compatibility repair, not a full game-engine rewrite. If a legacy scoped Pikken RPC is also missing in Supabase, Pikken create/join will still need the full Pikken SQL owner deployed.
