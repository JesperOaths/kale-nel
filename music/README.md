# Tune Rush — Kalenel music quiz

## Recovering an interrupted clue
The host can use **Replay current clue** after a clue starts, including the final 20-second clue. A failed start changes the main button to **Retry this clue**. Replay retains the same hint length, song position, scores and answer-attempt restrictions. It cannot interrupt a claimed buzzer or undo an answer. Every replay identifies its exact round and clue, so a delayed request cannot replay a newer song. After a reconnect, a host can recover a server-side playing clue whose local player stopped.

Deploy `supabase/migrations/20261025032513_musicquiz_replay_current_clue.sql` before publishing the v6 browser assets. It guards against unexpected changes to the existing function; its only game-logic addition is the host-only `replay` action. No table or permission changes. Rollback: revert the website assets and restore only the `musicquiz_v1` function definition from `sql/musicquiz-official-youtube-enrichment-v4.sql` (do not rerun that entire migration). `scripts/test-tune-rush-replay-db.mjs` tests the SQL using isolated, in-memory PostgreSQL. After deployment run `node scripts/tune-rush-replay-smoke.mjs` against the live guest endpoint.

Host controls disable while a request is pending and requests time out after 12 seconds. Mutating requests are never automatically repeated, because an interrupted response may still have changed the server state.

## YouTube playback recovery (25 October 2026)
Both automatic-library and manual YouTube games wait for the host to tap **Play next clue**. The player is checked for readiness, visibility and known embedding failures before the server advances a hint. A persistent message beneath the official video explains blocked videos, connection failures and browser-required taps. The host can skip blocked videos; the game never tries to bypass YouTube restrictions. The iframe stays visible and resizes to the host screen.

Server buzz updates continue while the player is waiting to start. A buzz or round change cancels pending playback so late player events cannot install a clue timer over an answer window. `node scripts/test-tune-rush-playback.mjs` checks these races and failure paths. The browser acceptance separately reports `BROWSER_YOUTUBE_PLAYBACK_PASS` only when the video clock advances and the clue pauses; `BROWSER_YOUTUBE_PLAYBACK_NOT_VERIFIED` is not a playback pass. Set `TUNE_RUSH_REQUIRE_YOUTUBE_PLAYBACK=1` to make actual provider playback a mandatory test gate. Physical iPad/iPhone speakers remain a separate acceptance check.

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

## YouTube Music host video mode (25 October 2026)
This uses YouTube's **official, visible IFrame video player** and accepts a `https://music.youtube.com/watch?v=VIDEO_ID` URL (or normal `youtube.com/watch?v=...`, `youtu.be/...`). It **does not integrate YouTube Music Premium, request Google login, download streams, strip video, hide/cover the player, or suppress ads**. Your existing YouTube Music sign-in is not a programmable third-party playback session.

1. On the **host tablet or host phone** open `https://kalenel.nl/music/`, create a room and select **YouTube Music link**.
2. Open the track in YouTube Music, choose Share > Copy link and paste into **YouTube Music / YouTube video link**. Host privately enters the correct **song title**, **artist** and optional starting second (default 0). Keep video and metadata on host screen only, out of the players' view.
3. Players join using six-character room code. After host starts, a standard YouTube embedded player appears, including its title, controls, YouTube branding and advertisements.
4. On the host, keep **at least half of the player visible** and tap **Play next clue** near the video. The official player seeks to the selected start second and plays. The game pauses playback as hints end or a phone buzzes. If the host switches apps/tabs, video stops to prevent background playback.
5. The host supplies another YouTube Music URL/song/artist when the previous track is solved. Previous scores, normal +0.5/−0.5 and steal +0.5/−1 scoring remain unchanged.
6. The five local public-domain demo melodies are still available by choosing Demo melodies.

**Limitations:** Because YouTube video streams can buffer, insert ads, disallow embedding, or require user interaction, sub-second clues and automatic sound initiation **are best-effort, not guaranteed**. No claim of YouTube Music playback API support or guaranteed availability for a song. The official iframe should not be modified or obscured; if songs show their titles in video, keep the host screen private. Embedded viewing terms do not remove the need for any applicable public-performance rights for the venue. YouTube's policies: https://developers.google.com/youtube/terms/developer-policies and https://developers.google.com/youtube/terms/required-minimum-functionality

The opt-in database change is `sql/musicquiz-youtube-host-video-v2.sql`, an additive migration to private `musicquiz.rooms` fields and the existing token-authorized `public.musicquiz_v1` routine. The browser only gets YouTube song ID when authenticated as the room host. Players receive the mode but **no title, artist, or YouTube ID** until the normal quiz reveals these. Live integration regression tests: `scripts/tune-rush-smoke.mjs` and `scripts/tune-rush-youtube-smoke.mjs`.

## Automatic genre × decade video pool (25 October 2026)
The new **Automatic music library** mode provides 71 host-only catalogued YouTube music video IDs and independently recorded song metadata from the 1960s–2020s. The video identities were checked using YouTube's official oEmbed metadata; that does **not** prove an embed will play (some may return error 101/150). The official visible YouTube iframe remains mandatory. No YouTube ads are filtered, blocked or bypassed and no YouTube account password is taken. This is **not a YouTube Music API integration**.

- **Genre:** choose one or more of Pop, Rock, Hip-hop/Rap, Electronic, Dance, Disco, Indie, R&B, Metal and Dutch. Each catalog song can belong to several genres.
- **Release decade:** independently choose any combination of 1960s, 1970s, 1980s, 1990s, 2000s, 2010s and 2020s. Leave all decade boxes unchecked for all decades. Pop + 1970s matches only pop songs released in 1970–1979.
- **Selection:** the private Supabase room backend selects a random eligible song, suppressing repeats until matching songs have all played. It then reshuffles and continues without any artificial round limit. The game still ends at 20 points, and rooms expire after eight hours. Filters with zero songs show an error rather than lying about what was selected.
- **Mid-song cues:** before the first hint, the host's *official iframe* provides the actual video duration to the game server. The server randomly picks a start position at least 10 seconds into the video (normally 15%, capped at 60 seconds) and at least 21 seconds before the video ends. All seven hints use the *same* server-persisted cue. If duration cannot be verified or a video cannot be embedded, **Skip / Reveal song** lets the host select another one without losing previous points.
- **Privacy:** song title/artist/YouTube ID remain private in Supabase. Only the host room token obtains the video ID. Players see scores and the revealed answer parts, never the unrevealed catalog metadata.
- **Separation:** Demo and manual YouTube modes continue to work. In automatic mode a host only chooses filters and taps Play next clue / Next song, without manually pasting each song.

Implementation: `sql/musicquiz-filtered-video-pool-v3.sql` (private RLS table, isolated RPC extension), `sql/musicquiz-video-pool-seed-v3.sql` (71 curated entries). Live network acceptance is `scripts/tune-rush-catalog-smoke.mjs`; the six-browser acceptance also covers the catalog's filter controls and rapid skip/next. Do **not** infer actual video/advertisement behavior from successful database tests.

**Automated YouTube-wide search is not active yet:** there is no configured YouTube Data API credential. A curated starter pool is available now; automatically discovering arbitrary new video links via YouTube's official Data API requires an API key and provider quota. A server-side Premium account, hidden audio player, YouTube scraper or ad blocker cannot replace that key or guarantee ad-free streams. If fully ad-free playback is required, use independently licensed, self-hosted recordings rather than YouTube.

## Optional ongoing catalog expansion through official YouTube Data API
The native YouTube Data API is the **supported** way to discover additional videos. Tune Rush provides a server-side batch discovery workflow (`.github/workflows/tune-rush-catalog-refresh.yml`) which can periodically expand the private video pool beyond the initial 71. There is no fixed maximum number of songs in the video pool or game rounds.

- `music/catalog-candidates.json` contains independent editorial artist/title/release-year/genre entries (60 additional candidates). This prevents misgrading because the correct answer does **not** come from a potentially misleading uploaded YouTube title.
- `scripts/tune-rush-official-catalog-import.mjs` uses **official** `youtube/v3/search` and `youtube/v3/videos` endpoints. It accepts public, eligible, longer-than-50-second videos where title/artist match. It checks `status.embeddable`, rejects "made for kids", and does not download/modify content or suppress YouTube ads. It processes 12 candidates per daily run to limit quota consumption; **12 is an API batch limit, not a game song-count limit**.
- The importer calls `public.musicquiz_catalog_import_v1`, a **SECURITY INVOKER** PostgreSQL RPC restricted to service_role, never to anonymous game players. Its migration is `sql/musicquiz-official-youtube-enrichment-v4.sql`.
- YouTube Data API metadata rows are removed when older than 29 days unless refreshed. Only those API-derived rows are affected; the curated original catalog remains intact. The cleanup task is `musicquiz_official_api_data_retention` in pg_cron.
- The GitHub Actions workflow can be manually dispatched or runs each day when **both GitHub Actions secrets** `YOUTUBE_DATA_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` have been configured in the repository's Actions secrets. Do not add either secret to the public website, GitHub source, or this chat. When either secret is absent, the workflow reports `YOUTUBE_OFFICIAL_IMPORT_SKIPPED` and does not claim to discover or import more videos.
- YouTube API quotas, policies, potential embed errors 101/150, advertisements and geographical availability still apply. A YouTube Premium session is not used for server-side playback.

**Current status:** the importer and daily schedule can be installed, but real automatic discovery remains inactive without the two secrets. The 71 curated songs are immediately selectable by genre and decade independently of this optional importer. Video playback continues through the host's visible YouTube iframe; it cannot be moved to an invisible server process or made ad-free with an ad blocker under YouTube's developer terms.

## Local full-song music on the host tablet (v10)

The host can now use ordinary audio files already available on their iPad, laptop, or other host device. This is an independent playback path; no Spotify, YouTube, Deezer, provider SDK, provider advertising, or preview clip limitations. It does **not** provide a free catalog of copyrighted hits; the host supplies playable files they have the right to use.

1. Tap **Create lobby → Play your music collection → Choose audio files** (or **Choose a music folder** on browsers supporting folder input).
2. Select MP3 or another natively supported browser audio format (e.g. AAC/M4A/WAV). MP3 ID3v2.2/v2.3/v2.4 or ID3v1 tags may fill title, artist, genre and release year automatically; filename **Artist - Title.ext** is a fallback. Other formats can be edited in the built-in collection review list. Review missing fields before proceeding.
3. Select **GENRES** and independently **RELEASE DECADES**. E.g. **Pop + 1970s** uses only matching imported tracks. Leave decades unchecked for all decades.
4. Invite players to the room and tap **Start the game**. Only the host's song title, artist, transient numerical file index, and randomized seek position reach Supabase. Actual music audio bytes remain on the host browser and are never uploaded or sent to the guest devices. Players continue using their phones.
5. Tap **Play next clue** on the tablet, with the usual 0.5, 1.5, 3, 5, 8, 12 and 20 second hints. Every hint uses the same server-persisted random cue (leaving at least 21 seconds until the end); host skip/replay/next works normally. Files avoid repeats until the matching pool is exhausted and then reshuffle, without an artificial round limit.

The music files are available **only for that browser tab's lifetime**: refreshing or closing the host's tab loses access to local File objects and cannot restore local audio for an active game. Reimport the files into a new game. Browser support for AAC, FLAC and other codecs differs by device, and only recordings at least 30 seconds long are accepted.

**Copyright:** Local playback removes service-level playback restrictions, not the rights in the recordings. In the Netherlands, BumaStemra notes that private parties attended by friends/family without paid admission may qualify for an exemption; public/commercial events may require permission from BumaStemra and Sena. Use files you are authorized to play, and do not attempt to extract DRM-protected streaming downloads.

Implementation: `music/local-tracks.js`, `sql/musicquiz-local-host-files-v6.sql`, `scripts/test-tune-rush-local-tracks.mjs`, and six-browser live multiplayer acceptance.
