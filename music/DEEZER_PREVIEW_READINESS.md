# Deezer preview provider — development-ready, **not authorized for production**

This change is deliberately not enabled at `kalenel.nl/music/`. The live Tune Rush room backend only supports demo, YouTube link and authorized curated YouTube catalog modes. No Deezer preview is downloaded, played, streamed or proxied on the live website.

## What is implemented
- `music/deezer-preview.js` — dependency-free short preview adapter. It validates a direct Deezer preview URL (official host and MP3 path only), strictly matches official artist/title rather than playing karaoke/cover tracks, and supports 0.5, 1.5, 3, 5, 8, 12, 20 second clips from the same randomized cue within the fixed 30-second preview. It cancels stale timer actions when buzzes or round transitions occur.
- `scripts/deezer-metadata-preflight.mjs --fixtures` — verifies exact matching without network access. `--live` performs **metadata-only** lookup for selected editorial catalog entries, reports preview availability, and does not fetch any preview audio.
- `scripts/test-deezer-preview.mjs` and CI — simulate HTMLAudio playback, seeking, timing, stale timer cancellation, artist/version mismatches, and URL validation; no Deezer audio is fetched.

## Remaining work after Deezer approves quiz usage
1. Obtain written authorization for **public interactive music trivia using 30-second preview clips**, including permitted playback, seeking/pausing, audience size/territory and attribution obligations. Spotify approval is separate. Deezer's API terms and staff guidance require more than a generic API response. See:
   - https://developers.deezer.com/termsofuse
   - https://www.deezer-techservices.com/contact/
   - https://deezer-business.com/
2. Implement a host-authorized HTTPS resolver at the Supabase edge, gated by server-stored proof of provider approval. Validate the real room host identity before returning a fresh preview URL, and NEVER return a title, artist, track ID or preview URL to unauthenticated/guest clients.
3. Add an additive private track-ID mapping for the existing catalog with strict exact matches and independently curated release-year/genre data. Protect it via RLS and role-restricted RPC, with server-side feature gate disabled by default.
4. Activate the source only after independent Deezer rights verification. Add it as a fourth choice in the lobby when the server advertises it as approved. Never use a client-side variable as the licensing gate.
5. Use the adapted HTMLAudioElement player on the tablet with a user-initiated audio unlock control, full buzzer/pause integration, and end-to-end physical Safari/Android tests. Maintain 1-second pauses and seven cue lengths. An excerpt only has 30 seconds; randomize **within the preview**, not arbitrarily in the full recording. Avoid storing preview URLs, preview audio, or cookies.
6. Full permission and rights review is required for venues or commercial operation; this staging implementation conveys no rights to Deezer recordings.

## Test and activation status
- `node scripts/test-deezer-preview.mjs`
- `node scripts/deezer-metadata-preflight.mjs --fixtures`
- `node scripts/deezer-metadata-preflight.mjs --live` (metadata requests only, optional)
- **Production playback: disabled, waiting for documented Deezer authorization.**

## Updated implementation: complete approval-gated integration (staged)

This branch also includes the following **unreleased** integration files:
- `sql/musicquiz-deezer-preview-gated-v5.sql`: adds a private Deezer track-ID catalog and an approval record defaulting to `false`; extends the room's selection/scoring to support Deezer songs with independent genre + release-decade filters; no repeat until matching pool exhausts; 0–9 s cue; full 20 s final hint. The `deezer_not_authorized` exception is raised even for the legitimate host when approval has not been established. The public feature-status RPC reports `false` unless a genuine service-role-approved record exists.
- `public.musicquiz_deezer_host_preview_v1` (in that SQL): privileged resolver RPC restricted to `service_role`, validates the 64-character SHA-256 host capability, active room, selected track and continuing authorization; never grants preview URLs or unrevealed artist/title to guest clients.
- `music/deezer-edge-candidate.ts`: **not deployed** Edge Function candidate. It validates a host capability with the database resolver and asks the official Deezer metadata API for the current selected track's 30-second preview. It returns a validated `https://cdnt-preview.dzcdn.net/stream/*.mp3` URL to the host only. No proxying/downloading/transcoding.
- `music/index.html`, `music/app.js`, `music/style.css`: fourth music-source option, automatically hidden until the trusted backend's approval RPC returns `true`. Reuses the existing host tablet, genre and decade filters, scoring, buzz interruption, current-hint replay, and skip controls. No video iframe is required when Deezer is lawfully enabled, because audio is taken from the provider's authorized 30-second preview.
- `scripts/test-deezer-license-db.mjs`: complete in-memory PostgreSQL test. Verifies denial by default; host-identity enforcement, guest secret privacy, test-only approval, 1980s Pop selection, 0–9s cue, skip, no repeats, and immediate permission revocation. The test authorization exists only in an isolated database.

**Do not mistake a prepared implementation for provider permission.** There is no production permission grant, no live Deezer content and no user login. Before activation, Deezer must authorize *this exact* public quiz use and the necessary rights arrangements must be confirmed. Only then deploy the Edge Function with a server secret, populate the private catalog from authorized metadata, set the approved record with Deezer's genuine written authorization reference, verify performance and phone playback, and release the source. Without these steps all existing Tune Rush modes continue normally.

The contact-ready written request is `music/DEEZER_APPROVAL_REQUEST.md`. Submission is an external provider action and was **not** performed automatically.
