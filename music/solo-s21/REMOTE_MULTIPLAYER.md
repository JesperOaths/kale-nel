# Tune Rush multiplayer over 5G / external networks — 2026-11-13

## What now works

A separate C720P loopback gateway on port **8806** forwards only
`GET /, /index.html, /app.js, /style.css, /api/health` and
`POST /api/multiplayer` to the Samsung S21 **8798** game engine.

A dedicated **outbound-only** `cloudflared` Quick Tunnel publishes the
gateway over valid HTTPS. The HTTPS browser uses the same-origin S21
multiplayer protocol; a guest can join with the host's six-character room
code over mobile data or another Wi-Fi network. A genuine S21-cached MP3
clue was returned to the host through the external HTTPS path, with no
track title or audio leaked to the guest. A real Chrome host and an
independent browser context successfully created and joined a room.

Everything remains processed and scored on the S21. No MP3 archive
transfer, open home router port or Supabase RPC is required.

## Security boundary

* S21 phone: internal LAN `192.168.178.196:8798`; do not expose it
  directly on the public internet
* C720P gateway: `127.0.0.1:8806`, not a publicly listening TCP port
* Public HTTPS: Cloudflare outbound tunnel, TLS handled at the edge
* No general reverse proxy, file browser, Android shell, Home Assistant
  or security camera endpoints
* Strict static route allowlist, version-only asset cache query strings,
  <=4096-byte JSON bodies, action allowlist, 64-hex capability checks
* Enforced same-origin POST, concurrency cap, rate limits, and host-only
  private MP3 response (guest MP3 leak triggers a 502 fail-closed)
* `Cache-Control: no-store`, no-referrer, restrictive CSP, no indexing
* User interface's `LOCAL_DIRECT` logic now also accepts the known
  HTTPS Quick Tunnel / Tailscale Funnel domains
* Solo port 8797 and the permanent 20GB song library are unchanged

## Current runtime files on C720P

* `/home/jespern/tunerush-internet-bridge/hub_multiplayer_gateway.py`
* `~/.config/systemd/user/tunerush-multiplayer-internet-bridge.service`
  (enabled, localhost-only port 8806, restart-on-failure, resource guard)
* `~/.config/systemd/user/tunerush-multiplayer-https-tunnel.service`
  (enabled, independent Cloudflare tunnel; a restart may rotate its URL)
* The active tunnel's **current** HTTPS address is extracted with:

```sh
journalctl --user -u tunerush-multiplayer-https-tunnel.service --no-pager |
  grep -oE 'https://[a-z0-9-]+\\.trycloudflare\\.com' | tail -n 1
```

The versioned-asset gateway repair has a one-file backup:
`/home/jespern/tunerush-internet-bridge/hub_multiplayer_gateway.py.before-versioned-assets-20261113`.

S21's two changed web files have an automatic rollback backup:
`$HOME/tune-rush-solo/backups/multiplayer-5g-20261113/`.
The S21 game server did **not** restart during the web update.

## Known limitation: Quick Tunnel is temporary

Cloudflare explicitly identifies its `trycloudflare.com` Quick Tunnels
as development tools. Their random public hostnames **change on a tunnel
restart**. Therefore do not treat the temporary URL as permanent or
hardcode it as the only route from the production homepage.

For a stable any-network game, use a **named Cloudflare Tunnel** with a
fixed hostname such as `play.kalenel.nl`, or enable **Tailscale Funnel**
once in the owner tailnet. Tailscale Funnel was blocked by the tailnet's
missing `funnel` node attribute and requires an authorized owner to
approve the enablement link shown by `tailscale funnel`. After approval,
the same bounded C720P gateway can be published under the stable
`https://jesper-hub.tail87c632.ts.net` endpoint without disclosing
any LAN or Android-management interface.

The existing unrelated security camera tunnel and C720P Solo HTTPS
bridge must not be modified or reused for this work.

## Verify and rollback

Run `python3 music/solo-s21/test_hub_multiplayer_gateway.py`.
The dedicated two-device browser CI runs both LAN and HTTPS gateway
origins. Live tests must additionally check:
1. Public HTTPS GET page/script/styles and S21 health = 200.
2. Disallowed private files/routes = 404.
3. Anonymous invalid join = error, valid room host+guest = success.
4. S21 cache clue over HTTPS = genuine MP3 host-only; guests never
   receive hidden title or audio.
5. Real HTTPS tablet host / independent phone guest browser actions.

To disable external access only, stop and disable
`tunerush-multiplayer-https-tunnel.service`, then
`tunerush-multiplayer-internet-bridge.service`.
Do **not** stop Solo, S21 phone services, or the camera. The local
multiplayer URL remains available on the home Wi-Fi.
