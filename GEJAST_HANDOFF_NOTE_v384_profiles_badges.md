# GEJAST handoff note v384

## Included in this patch
- `profiles.html`
- `player.html`
- `gejast-badge-progress.js`
- `gejast-config.js`
- `gejast_v384_profiles_player_badges.sql`

## What changed
- Profiles page now targets a canonical active-player bundle instead of the weaker direct player list path.
- Profiles cards now show every active player returned by the new scoped bundle, with:
  - nickname/public display name
  - original name when nickname differs
  - profile picture
  - most rare acquired badge title/nickname
  - short stats block
- Badge gallery below profiles is now grouped by rarity class and sorted alphabetically inside each rarity box, with the description shown under every badge.
- Player page badge rendering was rebuilt onto a single render path instead of the older double-render/enhancement overlap.
- Player page now shows:
  - attained badges
  - in-progress badges with transparent styling
  - progress lines per badge based on the current stats snapshot
- Global visible version bumped to `v384` via `gejast-config.js` while keeping the Made by Bruis watermark.

## SQL notes
- Fixes `get_player_profiles_public_scoped` so it reads from the real `profiles` payload key.
- Fixes `get_site_player_badge_cards_scoped` so it returns both `cards` and `players` keys for compatibility.
- Replaces `get_profiles_page_bundle_scoped` with an active-player-first scoped bundle that enriches each player with badge bundle data.

## Fast steps
1. Upload the changed frontend files.
2. Run `gejast_v384_profiles_player_badges.sql` in Supabase.
3. Hard refresh `profiles.html` and `player.html`.
4. Verify:
   - profiles page shows all active users in the current scope
   - badge gallery is grouped by rarity and alphabetized
   - clicking a player opens the player page
   - attained badges show normally
   - in-progress badges show transparent with progress text
