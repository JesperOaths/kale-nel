# Tune Rush — Audius-only multiplayer music quiz

**Production:** https://kalenel.nl/music/  
**Status:** one music provider, Audius direct HTTPS streaming. Updated 26 October 2026.

## How it works

1. Open the public page on a tablet or laptop. Choose **Create lobby**.
2. Pick a quick mix or customize the genre and optional decade checkboxes; **All eras** clears the year restriction.
3. Use **Check tracks** to estimate the matching, streamable catalog and how many tracks remain unplayed in the host's last three games.
4. Share the six-character room code or invite link. At least one player must join from a separate device.
5. Start the game. The host taps **Play next clue**, then players buzz and submit **song title** and **artist** from their own phones. The host can replay a clue, skip a song, or move to the next song.
6. Each round uses one random cue and hints of **0.5, 1.5, 3, 5, 8, 12, and 20 seconds**. Correct components earn 0.5 points each; incorrect initial components cost 0.5 points, and incorrect steals cost 1 point per field. Scores never fall below zero. The first player to 20 points wins.

### Supported music

Audius is the **only music source in the current frontend**. The browser discovers tracks at `https://api.audius.co/v1/tracks/trending`, checks each provider's streamability metadata, and streams selected music from `https://api.audius.co/v1/tracks/{id}/stream` with a native `HTMLAudioElement`. No backend downloader, USB music library, YouTube iframe, Deezer resolver, Spotify token or imported host-file music is used.

The catalog emphasizes independent artists, remixes and newer releases. **Audius release metadata is not a guarantee of a track's original release decade.** Some selected genres and eras can yield too few tracks. Playback and licensing remain subject to the provider's artist permissions and applicable event rights.

Streaming is initiated by a host button, never background-autoplayed. A clue does not start counting until the browser's playback clock actually advances after a seek; stalls can be retried. Guests receive no secret title, artist, stream URL or cue position before reveal.

### Multiplayer backend and compatibility

The existing Supabase `musicquiz_v1` RPC remains responsible for capabilities, rooms, buzzer locking, scoring, steal windows, replay, and rounds. Its validated `local` mode transports the **host-only Audius track metadata and transient index** for compatibility. This is a database protocol detail, not an exposed local-file playback path. Do not remove or rename the RPC mode without a separately tested database migration.

The host keeps a limited list of prior Audius IDs in localStorage to reduce repeats across its three latest games; audio bytes are not persisted by Tune Rush. The player does not need to register.

### Current frontend

- `music/index.html`: host/guest lobby, genre/decade filters, responsive player and scoreboard.
- `music/style.css`: midnight-radio presentation; responsive tablet and phone layout.
- `music/app.js`: room RPC, player state, UI, and Audius-only host playback.
- `music/audius-stream.js`: Audius discovery, normalization, playable-stream URLs, genre and era filters.
- `music/game-rotation.js`: Audius selection history and repeat avoidance.

### Verification

- `scripts/test-tune-rush-playback.mjs`: source isolation, host stream clock, stalled seek, replay safety.
- `scripts/test-audius-stream.mjs` and `music/tests/audius-rotation.test.mjs`: provider normalization, filter and rotation fixtures.
- `scripts/test-three-game-rotation.mjs`: three-game, 120-song no-repeat planning.
- `scripts/tune-rush-browser-acceptance.mjs`: real Chromium host + phone, live RPC, fixture-backed HTTPS media, leak and mobile overflow checks.
- `scripts/tune-rush-smoke.mjs` and `scripts/test-tune-rush-replay-db.mjs`: live room interactions and isolated replay SQL checks.
- `.github/workflows/tune-rush-browser-acceptance.yml`, `tune-rush-smoke.yml`, and `tunerush-audius-test.yml` run these checks for changes.

Automated fixture-backed playback is not a substitute for verifying physical tablet speakers and local mobile browser audio policy. A separate live Chromium test on the hub previously verified actual nonzero decoded Audius PCM samples.

### Retired paths

Demo synthesized music, local-host imported audio, YouTube manual links, YouTube auto-catalog refresh, and Deezer previews have been **retired from the current frontend**. Legacy assets and now-obsolete scheduled workflows were removed from active repository paths. Historic server migrations and database compatibility behavior are intentionally preserved for safe rollback and past-session integrity.

### Deployment and rollback

GitHub Pages publishes from `main:/music`. Use a new JS/CSS cache-busting query version for each frontend release. Gate merges on GitHub Actions, including a browser test using the PR's served candidate site, then check the public URL for newly published asset versions. To roll back, revert the last Tune Rush frontend commit; the existing database schema need not change. Avoid modifying unrelated routes, Home Assistant services or S9+ security operations.
