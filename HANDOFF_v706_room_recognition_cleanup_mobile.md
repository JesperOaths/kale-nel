# GEJAST v706 Handoff

## Scope

This patch focuses on the current Paardenrace/Pikken failure loop:

- Paardenrace lobby showed `Room niet gevonden` while the same room was still visible in the public open-room list.
- Pikken and Paardenrace rooms needed stricter stale cleanup after 15 minutes without activity.
- Pikken reveal needed to stay visible longer and show the round result clearly.
- Paardenrace and Pikken needed a more mobile-friendly layout.
- Version labels had drifted across pages.

## Files Changed

- `VERSION`
- `gejast-config.js`
- `gejast-pikken-contract.js`
- `gejast-pikken.js`
- `gejast-pikken-live.js`
- `pikken.html`
- `pikken_live.html`
- `paardenrace.html`
- `paardenrace_live.html`
- `GEJAST_v706_room_recognition_cleanup_mobile.sql`

## SQL To Run

Run `GEJAST_v706_room_recognition_cleanup_mobile.sql` in Supabase SQL editor.

The SQL includes:

- `cleanup_stale_pikken_rooms_v706(site_scope_input text default 'friends')`
- `cleanup_stale_paardenrace_rooms_v706(site_scope_input text default 'friends')`
- Earlier Pikken reveal/round fixes and Paardenrace ready fixes carried forward.

The cleanup RPCs close rooms/matches whose `updated_at`/`created_at` is older than 15 minutes and whose state is not already closed/deleted/finished. The pages call the cleanup RPCs opportunistically around lobby feed refreshes, but a Supabase scheduled job can also call them every minute if desired.

## Paardenrace Notes

`paardenrace.html` now handles the specific broken state where:

1. `get_paardenrace_room_state_fast_v687` says room not found.
2. `get_paardenrace_open_rooms_fast_v687` still returns that room.

In that case the page no longer clears the UI and no longer leaves the red not-found state. It builds a fallback state from the public room row so the lobby remains visible while the private state RPC catches up or is repaired.

If ready still fails after running the SQL, check the exact return/error from `set_paardenrace_ready_safe`, because v706 updates by `player_id::text` and by player-name fallbacks and returns the refreshed room state.

## Pikken Notes

The Pikken live reveal now:

- Only animates after a round actually resolves.
- Does not reroll or replay just because the hand refreshes.
- Shows all revealed hands for the resolved bid.
- Highlights dice counted for that bid.
- Shows which player lost a die.
- Stays on screen long enough to read.

The bidder still cannot reject/vote against their own bid. Round resolution is handled server-side in the SQL.

## Versioning

`VERSION` is now `v706`. Pages/scripts use `?v706`, and `gejast-config.js` still fetches `./VERSION` to keep the visible watermark centralized.

## Follow-Up Checks

After upload and SQL execution:

1. Create a Paardenrace room, refresh the page, and verify the red not-found status does not appear for a visible room.
2. Ready/unready both players from separate sessions.
3. Leave a Paardenrace room idle for 15+ minutes, refresh lobbies, and confirm it closes.
4. Create a Pikken lobby, start a match, place a bid, reject from another player, and verify the reveal overlay shows counted dice and the die loser.
5. Leave a Pikken room idle for 15+ minutes and confirm it disappears from lobby/live feeds.
