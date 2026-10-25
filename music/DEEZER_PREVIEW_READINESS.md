# Deezer preview provider — development-ready, **not authorized for production**

This change is deliberately not enabled at `kalenel.nl/music/`. The live Tune Rush room backend only supports demo, YouTube link and authorized curated YouTube catalog modes. No Deezer preview is downloaded, played, streamed or proxied on the live website.

## What is implemented
- `music/deezer-preview.mjs` — dependency-free short preview adapter. It validates a direct Deezer preview URL (official host and MP3 path only), strictly matches official artist/title rather than playing karaoke/cover tracks, and supports 0.5, 1.5, 3, 5, 8, 12, 20 second clips from the same randomized cue within the fixed 30-second preview. It cancels stale timer actions when buzzes or round transitions occur.
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
