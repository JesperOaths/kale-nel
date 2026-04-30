# GEJAST / Kale Nel Continuation Handoff v717

## Current Goal
Repair-first stabilization of Pikken, Paardenrace, profiles badges, homepage ladders, and Supabase RPC compatibility. Do not start new feature phases until these flows are verified in the live site.

## Workspace
- Main repo folder: `C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\kale-nel-main`
- Latest update folder: `C:\Users\jespe\Documents\wordt-er-gejast\patch_bundles\gejast_v717_lobby_start_ladders_fix`
- Latest SQL to run: `GEJAST_v717_lobby_start_ladders_fix.sql`

## Important User Requirements From Recent Chat
- Pikken and Paardenrace users must not manually name created lobbies anymore.
- Both systems must auto-name lobbies as `Despinoza 1`, `Despinoza 2`, etc.
- Pikken dice count selector belongs inside the created lobby, not before lobby creation.
- Pikken sticky action panel must stay visible without hiding the player dice hand.
- Pikken final winner popup must have festive dice / Despinoza logos / streamers / balloons exploding from behind the winner name.
- Pikken completed/abandoned matches must archive into match history, player stats, and ELO.
- Paardenrace cannot start unless at least 2 players and at least 2 different suits/horses are selected.
- Paardenrace live must not send players back to the lobby once a race actually started.
- Paardenrace suit options must show real suit symbols again.
- Profiles badge accordion boxes should show badges in clean responsive rows, not one distorted column.
- Homepage Top 5 boxes should not be overly strict. Caute Coins should show active users, defaulting to 100 coins when no ledger exists yet.

## v715/v716/v717 Work Done
- v715:
  - Moved Pikken start-dice selector into the lobby.
  - Added `pikken_update_lobby_config_v715`.
  - Added Paardenrace `Despinoza N` creation helper.
  - Tried to use the Paardenrace minimap as full live board.
- v716:
  - Re-shipped Pikken create override so `pikken_create_lobby_fast_v687` generates `DESPINOZA N`.
  - Added `pikken_abandon_and_record_v716` for page-leave/archive.
  - Added frontend pagehide/beforeunload keepalive call from `pikken_live.html`.
  - Loosened homepage top 5 filtering after it had become too strict.
- v717:
  - Bumped `VERSION` and `gejast-config.js` to `v717`.
  - Removed/locked Paardenrace manual room naming in the UI.
  - Added stronger visual contrast to Pikken and Paardenrace lobby panels/cards.
  - Removed stale-looking Pikken lobby player text `Levend - X dobbelstenen`.
  - Made Pikken live dock more translucent/narrower to reduce dice-hand occlusion.
  - Added festive winner burst HTML/CSS to Pikken victory overlay.
  - Restored suit symbols in Paardenrace select and runtime labels.
  - Changed Paardenrace live page so lobby state shows a waiting message instead of immediately bouncing back.
  - Updated Profiles badge gallery CSS to responsive rows.
  - Added `GEJAST_v717_lobby_start_ladders_fix.sql`:
    - Includes its own Paardenrace `Despinoza N` helper, so it does not depend on v715 for that helper.
    - Paardenrace creation ignores manual room name and always generates `Despinoza N`.
    - Paardenrace start requires 2+ players, all ready, and 2+ distinct selected suits.
    - Caute Coins top 5 defaults active players to 100 coins.

## Files Changed In v717
- `VERSION`
- `gejast-config.js`
- `index.html`
- `pikken.html`
- `gejast-pikken.js`
- `pikken_live.html`
- `gejast-pikken-live.js`
- `gejast-pikken-contract.js`
- `paardenrace.html`
- `paardenrace_live.html`
- `gejast-paardenrace.js`
- `profiles.html`
- `GEJAST_v717_lobby_start_ladders_fix.sql`

## Verification Already Run
- `node --check` passed earlier for:
  - `gejast-pikken.js`
  - `gejast-pikken-live.js`
  - `gejast-pikken-contract.js`
  - `gejast-config.js`
- Need to rerun after v717 edits before final delivery.

## Known Risks / Next Things To Verify
- Supabase SQL must be run in order. If v716 was skipped, run v716 first, then v717.
- Paardenrace SQL uses `paardenrace_room_players.room_id`; if a future schema variant uses a different FK name, make the start wrapper dynamic like earlier v419 dynamic SQL.
- Pikken archive-on-page-leave uses `fetch(... keepalive:true)` and can fail silently if the browser kills the request too fast. The server-side idle cleanup should also archive stale live games if this becomes unreliable.
- Homepage ladders still depend on the RPC data shape. If family/friends scoping is wrong, inspect `get_homepage_ladders_public_scoped(text)` and `get_caute_coin_top5_public(text)`.
- Test with two real accounts:
  1. Create Pikken lobby -> should be `Despinoza 1`.
  2. Pick start dice in lobby -> start -> player rows should not show stale dice counts in lobby.
  3. Finish Pikken -> victory burst appears -> closing popup returns to lobby -> stats/history show match.
  4. Create Paardenrace lobby -> should be `Despinoza 1`.
  5. Both players select same suit -> start should fail.
  6. Players select different suits -> start should enter live race and not bounce back.

## SQL Run Order
If the live database is missing recent patches, run:
1. `GEJAST_v716_pikken_archive_home_paardenrace_fix.sql`
2. `GEJAST_v717_lobby_start_ladders_fix.sql`

v717 is self-contained for Paardenrace lobby naming, but v716 is still needed for Pikken archive-on-leave and Pikken `Despinoza N` create override.

Do not create random no-op compatibility functions. If Supabase reports an exact duplicate/parameter error, drop the exact signature first and rerun.
