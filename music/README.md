# Kalenel Tune Rush — public multiplayer music quiz (v1)

## Current delivery boundary
This feature branch adds the public website at `/music/`, the browser/controller, the isolated PostgreSQL data plane, and a Supabase Edge gateway. It is **not live** until all three are deployed and real-tablet/phone acceptance has passed. It deliberately does not integrate Spotify.

### Why no Spotify button?
Spotify's Developer Policy, section III, explicitly prohibits building a game (including trivia quizzes), and its compliance guidance specifically calls out "name that tune" games. Seeking, pausing, or using the Web Playback SDK does not change this. Spotify may only be considered if Spotify gives written approval. Do not use audio scraping, cached previews, or Spotify embeds to work around that prohibition.

## Host workflow (iPad or tablet)
Open `https://kalenel.nl/music/`, tap **Create lobby**, select one or more genres, share the room code or invite URL. Wait for phones to join. The host is never a player. Tap **Start game** and authorize tablet sound. A randomly selected track plays for 0.5s, pauses for 1s, then replays from the same configured cue for 1.5s, 3s, 5s, 8s, 12s, 20s, with 1s between snippets if nobody buzzes. When a player submits a guess that leaves a part unanswered, the tablet remains paused indefinitely so another player can buzz. The host can manually tap **Continue hints** to resume progressive playback. When both song and artist have been identified, only the host may tap **Next round**. After the last hint, the host may **Reveal & skip**.

For non-demo audio: use recordings you own or have the rights to use, install them under `/music/audio/`, then insert catalog rows. Choose `cue_ms` manually to avoid clips in which a vocalist names the title. The source filename should not disclose the answer. External hosted music URLs are intentionally rejected by the browser. Never serve protected recordings without documented permission.

## Phone workflow
Open the same public URL (or invite URL), enter a nickname and six-character code. No Kalenel login is needed. Buzz whenever the current snippet or pause is open. The first request that obtains the database row lock wins; this is fair by **server arrival order**, not an impossible guarantee of equal network latency. Type title and/or artist: each attempted correct part scores +0.5; each attempted wrong part −0.5; blank/unattempted fields score 0. You can pass with no penalty. A player may only attempt one answer per snippet, allowing others a chance. If the song is partly identified, the known part is revealed and locked. The first player to reach at least 20 points wins.

## Backend deployment
1. Review and apply `sql/musicquiz-v1.sql` as a single additive migration on the existing Supabase project `uiqntazgnrxwliaidkmy`. The schema is `musicquiz`, with RLS and private table grants; the only public-schema RPC is executable by `service_role` only.
2. Deploy `supabase/functions/music-game-v1/index.ts` as function `music-game-v1` with `verify_jwt=false`, because guests have no login. **The Edge Function itself authenticates room actions using SHA-256-hashed 256-bit room/player secrets**, with the service-role API key only in the Supabase server environment. Never expose that key in frontend code. CORS is restricted to kalenel.nl and local development origins, but CORS is not considered authentication.
3. Publish `music/index.html`, `music/style.css` and `music/app.js` through the existing GitHub Pages main branch. The site has a v817 footer and intentionally omits shared GEJAST login scripts, matching the public shop's authentication model.
4. Verify live with at least one physical tablet and two phones on different networks, using only the demo pack, before loading any third-party songs.
5. Add recordings with independently documented reproduction, streaming/public-performance and other applicable permissions. Retain the license note and cue point in the track metadata. Spotify is not a valid catalog source without written permission.

## Verification already performed
- SQL schema and functions compiled against the production PostgreSQL v17 server in `BEGIN … ROLLBACK` (no persistent database changes).
- Transactional demo cases: room create; two guest joins; host start; no guest audio/title leakage; first buzz accepted and second rejected; wrong two-part answer −1; separate guests earn +0.5 each for title and artist; successful next round; winner at 20.
- `SET LOCAL ROLE service_role` confirmed that the intended invoker privileges can create a room, join and get a privacy-filtered state. Again all rolled back.
- Browser JavaScript was parsed in V8 without a syntax error.

## Remaining acceptance / release gates
- Browser DOM, Safari/iPad, Android, real multi-device and network race tests have **not** been executed yet.
- The Edge Function has **not** been deployed or exercised through a real external HTTP request.
- Production schema has **not** been migrated; frontend has **not** been merged or published.
- Anonymous spam controls are limited to an automatic eight-hour room expiry, 150-room capacity, and 24 players per room. Before broad public promotion, add edge-level request throttling, bot protection, and monitoring.
- Poll-based UI updates may be slower than a WebSocket/Realtime broadcast. The first-buzz decision itself is database-serialized. For large gatherings, upgrade to a room-scoped realtime channel and measure tablet pause latency.
- iOS Safari may require explicit **Enable tablet audio** interaction, especially after tab/background suspension. If real audio fails to autoplay, retain the host activation button rather than bypassing browser audio policies.
- Resume/rollback test should also confirm that host reload during an active clip does not incorrectly skip or duplicate a snippet. This is an initial MVP, not a production-verified game.

## Rollback
Front-end: revert the isolated music-route PR without modifying shop or existing games. Edge: delete/disable `music-game-v1`. Database: retain unused additive schema until rooms expire; only remove `musicquiz` in a separately reviewed cleanup after verifying no other consumer depends on it. Never drop shared public/Supabase objects as part of this feature rollback.
