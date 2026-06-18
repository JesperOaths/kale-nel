GEJAST v750 - Klaverjas online polish and pipeline cleanup

Files changed:
- VERSION
- gejast-live-sync.js
- gejast-klaverjas-v750-polish.js
- README_v750_klaverjas_online_polish_repair.txt

Purpose:
- Make the Klaverjas multiplayer/game-mode page visually calmer, cleaner, and easier to use.
- Keep the v749 rule/gameplay fixes, but display them in a sleeker layout.
- Make leaving a bot/match table responsive and reliable.

Implemented:
- Clean two-column desktop layout: table/hand on the left, score/game info on the right.
- Mobile fallback returns to one-column layout.
- Compact score-form side panel with teams, totals, round roem, dangerzone indicator, current phase, bid, trump, last trick, round result and AI coach.
- Less chaotic styling: reduced panels, fewer competing boxes, simpler side information hierarchy.
- Large sticky hand remains visible and readable.
- Trump cards in the hand are visually lifted and highlighted.
- Current turn still blinks around the active player card.
- Played cards get player-colored borders.
- Bidding buttons are grouped into score-form-like sections.
- Leave-table button is immediate: disables itself, shows a leaving overlay, attempts to mark bot games as abandoned, clears local room/progress storage, and navigates to a clean klaverjas_online page without stale game_id/room query state.

Still no SQL:
- The existing klaverjas_online_save_state RPC remains the storage path.
- No Supabase SQL is required for this frontend/client-state polish patch.
