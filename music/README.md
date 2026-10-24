# Tune Rush — Kalenel music quiz

## Production status (24 October 2026)
- **Database live:** `musicquiz` schema, five original synthetic demo tunes, private tables (RLS), and server-authoritative buzzer/score function.
- **Guest data plane live:** public `/rest/v1/rpc/musicquiz_v1` using a **publishable** API key and browser-minted 256-bit capability tokens represented as SHA-256 digests. The database RPC is a narrowly scoped `SECURITY DEFINER` function. The tables stay inaccessible to anonymous browsers.
- **Reason for direct RPC:** Supabase refused an additional Edge Function deployment (project maximum reached). `supabase/functions/music-game-v1` is staged reference code only, **not deployed**. Do not present it as operational.
- **Site:** `music/` staged in PR #1185 until merge and GitHub Pages activation.
- **Network smoke:** GitHub Actions `scripts/tune-rush-smoke.mjs` creates a disposable room with one host/two independent guests and tests simultaneous buzz attempts, answer privacy, real REST/CORS, wrong answer score floor, stealing, typo acceptance and advancing the round. Room records expire after eight hours.
- **Physical acceptance still required:** iPad Safari audio activation/playback, iPhone/Android focus/keyboard behavior and latency on actual devices. Browser network simulations are not physical device tests.

## Audio restrictions
Spotify's Developer Policy explicitly prohibits using Spotify APIs/content/player/embeds in any game, including `name that tune`. Spotify login and interactive playback may only be added after **written Spotify approval**. This project does not access Spotify and does not scrape Spotify. The included five demo melodies are synthesized directly in Web Audio from public-domain compositions. For modern music, source recordings you have rights to store, transmit and play in this specific quiz. Add files in `/music/audio/` and private catalog rows with `license_note` (>=20 chars) and `cue_ms` at a suitable passage. The source path is limited to same-site recordings.

## Game rules
- The host opens `https://kalenel.nl/music/` on a tablet or host phone. It displays all scores but cannot participate.
- Players enter a 6-character room code and nickname, no Kalenel account.
- The host chooses genres, starts and enables browser audio. Audio begins with 0.5 seconds and then 1.5, 3, 5, 8, 12, 20 seconds, each from the same cue, with 1-second pauses when nobody buzzes.
- First phone to reach the database row lock on **BUZZ** receives a 25-second exclusive answer window. Song and artist use distinct text fields. Small spelling mistakes are accepted (edit distance: 1 for 5–9 characters, 2 for 10+ characters; short names must match exactly after diacritic and punctuation removal).
- Ordinary answer: +0.5 for correct title, +0.5 for correct artist; -0.5 for each incorrect attempted field; blanks have no effect. Score is floored at zero.
- If the first answer does not complete both parts, playback stays paused in a **STEAL WINDOW**. Other eligible players can press **STEAL**. The earliest accepted steal gets a 25-second exclusive answer window. Stealers must enter every still-unknown field: +0.5 for each correct, **-1 for each wrong**. Any score reductions stop at zero. A player gets at most one answer attempt per snippet.
- If a player passes or lets the answer window expire, their claim is released and they cannot try again on that same snippet. The host can resume hints after any unsuccessful answer, or reveal/skip after the last hint.
- When both components are solved, the host taps **Next round**. First player to 20 points wins; ongoing round changes are disabled after a winner.

## Deployment/rollback
The site is published with GitHub Pages from `main:/` using `music/index.html`, `style.css` and `app.js`. The public auth-gate test in `check-v798-forced-login-gate.mjs` explicitly exempts the new route, while requiring the isolated guest capability backend.

The SQL was deployed as two additive migrations: `sql/musicquiz-v1.sql` and then `sql/musicquiz-direct-public-v1.sql`. **Migration order matters**; reapplying the first file alone resets the function to invoker mode. Existing tables are not modified by the site PR. To disable the feature immediately, revert only the `music/` site files; the now-unused database schema can remain private until separately reviewed cleanup. Do not touch other games, shop or shared auth.

## Security and limitations
- Guest tokens are cryptographically random and stored in browser localStorage; only SHA-256 digests are sent to the RPC. Room codes alone do not grant host or player authority.
- PostgreSQL row locking arbitrates first-arrival requests in deterministic server order, not equalized network latency.
- The public RPC has capacity limits of 150 active rooms and 24 players per room, with eight-hour expiry. These are not full abuse prevention or IP rate limiting; add gateway throttling before broad promotion.
- All direct table access is revoked from anon/authenticated, and all private tables have RLS.
- No Spotify credentials, secrets or music player tokens are stored or transmitted.
