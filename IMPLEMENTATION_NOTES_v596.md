# Klaverjas v596 implementation package

This package turns the uploaded v596 handoff/prototypes into a repo-ready implementation direction.

## Included backend
- `gejast_v596_klaverjas_persistence_live_stats.sql`
  - persisted `klaverjas_matches`
  - persisted `klaverjas_rounds`
  - `klaverjas_match_snapshots` after round 8 and then every later round
  - derived progress / elo scale / winner / kruipen flags
  - active-match presence table for spectator CTA routing
  - public quick-stats and live-match RPCs
  - derived player stats view and fun ladders RPC

## Included frontend
- `klaverjas_scorer_v596_repo_ready.html`
  - the uploaded fixed scorer prototype, preserved as the UI basis
  - loads the repo bridge for persistence and live/quick-stats routing
- `gejast-klaverjas-api.js`
  - shared Supabase RPC helper with timeout handling
- `gejast-klaverjas-scorer-bridge.js`
  - syncs the scorer prototype into the backend with a whole-match upsert
  - writes active match presence
  - redirects winner close into real quick stats page
- `klaverjas_live_v596.html`
- `gejast-klaverjas-live.js`
  - read-only spectator page polling the saved match state
- `klaverjas_quick_stats_v596_repo.html`
- `gejast-klaverjas-quick-stats.js`
  - real quick stats page using `match_id`

## Important honesty note
This package is repo-ready but not repo-applied. I did not have the current live repo source for the Klaverjas subsystem itself in this prompt, only the uploaded handoff/prototype package, so I built the implementation around that source of truth.

## Integration expectations
- place the frontend files in the repo root next to `gejast-config.js`
- run the SQL migration
- route the index-card CTA to `klaverjas_live_v596.html?match_id=...` when `klaverjas_active_match_presence` says the current user is active in a match
- optionally rename files from `_v596` to the repo naming style you use in production

## Why the whole-state sync model was used
The uploaded scorer prototype already owns the full score state client-side, including rounds, taks, quick-stats payload and snapshot logic. Rather than guessing a partial per-round repo owner path without the current subsystem code, this package uses a whole-match sync model:
- every scorer save/edit syncs the entire canonical round list
- SQL re-materializes round rows and snapshots from that state
- quick stats and live page read the persisted rows, not session storage

That is the fastest path to making the uploaded prototype real without inventing hidden client state.
