# Handoff v701 - Kale Nel / Wordt Er Gejast Continuation

## Project Context

Workspace root:

`C:\Users\jespe\Documents\wordt-er-gejast`

Current site folder:

`C:\Users\jespe\Documents\wordt-er-gejast\kale-nel-main\kale-nel-main`

The user does not want patched zip files anymore. Deliver normal update folders under:

`C:\Users\jespe\Documents\wordt-er-gejast\patch_bundles\...`

The site is a static frontend backed by Supabase RPCs. The recurring failure pattern is PostgREST overload ambiguity: multiple SQL functions with the same name and same argument types but different parameter names/order. When fixing RPCs, always drop every overload by `pg_proc` name first, then recreate exactly one canonical function.

## Latest Patch State

Latest intended version: `v701`.

Latest update folder:

`patch_bundles\gejast_v701_pikken_rules_paardenrace_ready_handoff_update`

Latest SQL:

`GEJAST_v701_pikken_rules_paardenrace_ready_handoff_fix.sql`

Run this SQL after uploading the frontend files. It is designed to be run after earlier v699/v700 patches, but it also drops the specific overloaded functions it replaces.

## Recent User Issues And Fix Direction

### Paardenrace Ready

User saw:

`Could not choose the best candidate function between: public.set_paardenrace_ready_safe(...)`

Cause:

There were at least two `set_paardenrace_ready_safe` overloads with the same type signature but different parameter names/order.

v701 fix:

- Drops all `set_paardenrace_ready_safe` overloads by name from `pg_proc`.
- Recreates one canonical function:
  `set_paardenrace_ready_safe(session_token text, session_token_input text, room_code_input text, ready_input boolean, site_scope_input text)`
- Unlike v700, v701 does not delegate to `update_paardenrace_room_choice_safe`; it directly updates `paardenrace_room_players.is_ready` or `ready`, then returns the room state when available.

If it still fails:

- Check Supabase SQL editor error first.
- If PostgREST still reports ambiguity, run:
  `select proname, pg_get_function_identity_arguments(oid) from pg_proc where proname='set_paardenrace_ready_safe';`
- There must be exactly one row.

### Pikken Login Recognition

User is logged in, but `pikken_live.html` still alerts:

`Je bent niet ingelogd.`

Frontend changes already made:

- `gejast-config.js` now scans known session keys, nested localStorage/sessionStorage JSON payloads, and cookies.
- `gejast-pikken-contract.js` does the same inside Pikken-specific API.

Important:

If this still appears after upload, confirm deployed `gejast-pikken-contract.js` is actually v701 and not browser-cached v699/v700. The watermark can lag if old HTML is cached. Hard refresh or check Network tab script query strings.

### Pikken Full Game Flow

User expectation from repo rules:

- Normal mode: wrong side loses one die.
- Fair/right_loses mode: right/winning side loses one die.
- `1` is pik/joker for bids 2-6.
- A straight `1-2-3-4-5-6` counts as 6 piks when bidding pik/1.
- Afkeuren starts a vote/reveal process.
- The person who made the bid must not vote on their own bid.
- In a two-player game, after player B presses `Afkeuren` on player A's bid, the challenge should resolve immediately because the only eligible voter is player B.
- After resolution, the loser loses one die, a new round is dealt, and the match continues unless only one player remains.

v701 SQL changes:

- Replaces `pikken_reject_bid_scoped`.
- Replaces `pikken_cast_vote_scoped`.
- Adds `_pikken_finish_vote_v701`.
- Adds `_pikken_deal_round_v701`.
- Adds `_pikken_next_alive_seat_v701`.

Important behavior:

- `pikken_reject_bid_scoped` inserts the challenger vote as `false` immediately.
- Eligible votes exclude the bidder.
- Once all non-bidders have voted, `_pikken_finish_vote_v701` counts all hands using `_pikken_count_bid_hits`, applies the penalty rule, decrements dice, eliminates zero-dice players, deals the next round, clears old votes, and returns new state.

Known limitation:

- v701 uses the existing `pikken_round_hands`, `pikken_round_votes`, `pikken_game_players`, and `pikken_games` tables.
- It does not yet write a rich permanent match history/stat record for every Pikken round. That can be added later through admin/stats RPCs.

## Beurs / Despimarkt State

Recent v699 changes:

- `beurs.html` has an inline quick market creation form.
- `beurs.html` has `myMarketsBox` for own/admin market management.
- `gejast-despimarkt.js` loads dashboard cache-first and refreshes live data.
- Admin controls render when an admin token is present.

If Beurs still lacks markets:

- Check `get_despimarkt_dashboard_v669`.
- The frontend expects fields like `markets`, `positions`/`bets`, `wallet`, `ledger`, `leaderboard`, `totals`.
- If dashboard RPC returns empty because no markets exist, quick-create should work if `create_despimarkt_market_v669` exists and the user session token is valid.

## Spectator Instances

Recent v699 changes:

- `klaverjas_spectator.html` redirects to `klaverjas_live.html?spectator=1`.
- `klaverjas_live.html` hides host update controls in spectator mode and polls every 1.6s.
- `boerenbridge_spectator.html` redirects to `boerenbridge_live.html?spectator=1`.

Still needed later:

- Index card transformation: if a logged-in participant has an active Klaverjassen/Boerenbridge match, the homepage card should show a live pill and primary spectator link.
- See `KLAVERJASSEN_INDEX_SPECTATOR_LIVE_PLAN_v692.md` for the intended shape.

## Active Files Touched In Recent Patches

Frontend:

- `gejast-config.js`
- `gejast-pikken-contract.js`
- `gejast-pikken-live.js`
- `gejast-pikken.js`
- `pikken.html`
- `pikken_live.html`
- `paardenrace.html`
- `paardenrace_live.html`
- `beurs.html`
- `gejast-despimarkt.js`
- `klaverjas_live.html`
- `klaverjas_spectator.html`
- `boerenbridge_spectator.html`

SQL:

- `GEJAST_v699_visibility_beurs_spectator_fix.sql`
- `GEJAST_v700_paardenrace_ready_pikken_pipeline_fix.sql`
- `GEJAST_v701_pikken_rules_paardenrace_ready_handoff_fix.sql`

## Engineering Instructions For Next AI

1. Do not create zip files unless the user explicitly reverses their instruction.
2. Create normal update folders under `patch_bundles`.
3. Do not fake admin/account RPCs with no-op functions.
4. For Supabase overload errors, inspect/drop all overloads by function name before recreating one canonical signature.
5. Prefer direct SQL behavior over frontend masking when a backend state is wrong.
6. Run `node --check` on changed JS and parse inline scripts with `new Function` where practical.
7. Keep version/cachebust values aligned with `VERSION`.
8. Avoid mojibake. Search touched HTML/JS for mojibake marker characters before shipping.

## Current Next Test Checklist

After uploading v701 and running SQL:

1. Paardenrace:
   - Host creates lobby.
   - Other player sees lobby.
   - Both choose suit/wager.
   - Host verifies if needed.
   - Ready button works without PostgREST ambiguity.

2. Pikken:
   - Two logged-in players can join lobby.
   - Host starts.
   - Both land on live page.
   - Dice show 2-6 then pik.
   - Player A bids.
   - Player B presses Afkeuren.
   - Player A does not get vote controls for own bid.
   - With two players, round resolves immediately.
   - Correct player loses one die based on `penalty_mode`.
   - New round starts with updated dice counts.
   - Game ends only when one player remains.

3. Beurs:
   - Page paints from cache quickly.
   - Live dashboard refresh completes.
   - Quick market creation works.
   - Admin/own market box shows controls when permitted.



