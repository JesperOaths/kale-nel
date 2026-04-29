GEJAST v705 - Pikken reveal animation, Paardenrace ready, central version

Upload/copy this folder to the site root. It includes all top-level HTML pages because their visible version/cache references were aligned to v705.

Run this SQL in Supabase:
- GEJAST_v705_pikken_reveal_animation_paardenrace_ready_version.sql

Important changes:
- Pikken dice are only rolled/dealt by the backend when a new round starts.
- The frontend no longer plays the throw/resolve animation for every action or refresh. It only plays on a real round change with last_reveal.
- The resolve overlay lasts longer and shows:
  - whether the bid was made,
  - the bid and counted total,
  - who loses a die,
  - every player's revealed hand for the resolved round,
  - highlighted dice that counted for that bid.
- Paardenrace ready matching now uses player_id as text plus name fallbacks and row_count, making the ready RPC much less brittle.
- gejast-config.js now fetches ./VERSION with no-store and applies that as the visible site version, so VERSION becomes the source for displayed version labels.
- Visible mojibake scan stayed clean after this update.

Notes:
- This is a normal folder, not a zip.
- Future visible version bumps should update VERSION first. The hardcoded script query values were aligned to v705 for this upload, but the watermark/visible version now refreshes from VERSION.
