# Klaverjassen Index Spectator Live Button Plan v692

Goal: when the current logged-in player is participating in an active Klaverjassen match, the Klaverjassen box on `index.html` should transform from a normal "open scorer" card into a live/spectator entry card.

Implementation shape:

1. Add a tiny read RPC, for example `get_my_active_klaverjas_match_v692(session_token_input text, site_scope_input text)`.
   - Return `{ ok, active, client_match_id, match_id, spectator_url, scorer_url, role, players, round_label, updated_at }`.
   - It must be read-only and fast, using an index on active Klaverjassen match participants by `player_id` or normalized player name.
   - If no active match exists, return `{ ok:true, active:false }`.

2. Add a homepage helper JS file or inline boot function near the existing game-card boot.
   - Read player session token via `window.GEJAST_CONFIG.getPlayerSessionToken()`.
   - Race the RPC against a 900 ms timeout so homepage paint is never blocked.
   - Cache the result in `sessionStorage` for 20-30 seconds.

3. Add stable hooks to the Klaverjassen card in `index.html`.
   - `data-game-card="klaverjassen"`
   - `data-klaverjas-primary-link`
   - `data-klaverjas-live-status`
   - This avoids brittle text searching.

4. Transform only when `active === true`.
   - Primary button href becomes `spectator_url || ./klaverjas/live.html?match=...`.
   - Button label becomes `Live meekijken` for non-scorers or `Verder scoren` for the active scorer.
   - Add a compact live pill: `LIVE · ronde/bod/slag`.
   - Keep the normal scorer link available as a secondary small link.

5. Failure behavior:
   - If RPC times out or fails, leave the card exactly as normal.
   - Do not show errors on the homepage for this; log to console only in debug mode.

6. Required data model:
   - Active match table/view must include match id, current status, participants, scorer/host, `site_scope`, and `updated_at`.
   - Add partial index for active rows:
     `create index ... on klaverjas_matches(site_scope, status, updated_at desc) where status in ('active','live','in_progress');`
   - Add participant index:
     `create index ... on klaverjas_match_players(player_id, match_id);`

7. Verification:
   - Logged-out homepage: Klaverjassen card stays normal.
   - Logged-in but no active match: card stays normal within 1 second.
   - Logged-in active participant: card changes to live button and opens spectator/scorer URL.
   - Mobile card layout does not shift or overflow.

