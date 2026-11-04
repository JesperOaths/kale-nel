# Tune Rush Solo HTTPS transport

The website can use the same S21 game engine without waiting on the shared
Supabase database queue. `https_bridge.py` is a small transport on the owner's
hub; all song selection, MP3 clipping, guesses, scores and persistence remain
on the S21. It never stores recordings on the hub.

Only these routes are forwarded:

| Method | Route | Access |
| --- | --- | --- |
| GET | `/api/health` | Service availability only |
| POST | `/api/session` | Starts a permanent-library game |
| GET | `/api/state` | Existing 256-bit game capability |
| POST | `/api/action` | Existing 256-bit game capability |

Library, audio-file, filesystem and administrator routes are absent. Browser
origins are restricted to kalenel.nl and www.kalenel.nl. Requests are bounded
to 4 KiB, responses to 2 MiB and upstream concurrency to four. Only the current
clue is returned by the S21. Session creation is rate-limited. CORS is a
browser constraint; the game's bearer capabilities authorize private sessions.

The hub listens on loopback port 8804. Tailscale Funnel provides HTTPS at its
existing device hostname. Funnel must be explicitly enabled by the tailnet
owner before anything becomes publicly reachable. Existing services and
Tailscale routes are preserved. No firewall or site login changes are needed.

The browser probes the HTTPS transport once on load and otherwise retains the
existing queue route. It chooses the transport before submitting any action;
a failed mutation is never automatically replayed using the other route.
Both transports address the same S21 session authority and bearer token.

## Deployment

Install the bridge and user units on the hub. The publishing unit waits for
the owner's Funnel enablement, then creates a persistent background route.
The site integration is in `music/solo/app.js`.

On 4 November 2026, the bridge completed a real five-round game through the
S21, with no repeated songs. All seven 0.5–20 second MP3 clues decoded to the
requested duration and contained non-silent audio. The permanent catalog
remained at 994 playable songs and 1,053 retained recordings after finishing.
Public HTTPS acceptance is pending owner Funnel activation; these results
are local transport and phone acceptance, not proof of public browser play.

## Verification and rollback

Run `python3 test_https_bridge.py` for route, origin and session capability
checks. Run `node test_https_transport.cjs ../solo/app.js` from this directory
for transport selection, queue fallback and mutation replay protection.

After Funnel activation, check the public `/api/health` response, then start
and finish a real game from `https://kalenel.nl/music/?mode=solo`.

To roll back, disable the two new user units and remove only this new Funnel
mapping. The prior frontend commit restores queue-only transport. The phone's
permanent music library is independent of both transports and is retained.
