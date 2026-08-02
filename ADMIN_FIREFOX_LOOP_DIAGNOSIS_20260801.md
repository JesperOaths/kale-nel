# Admin Firefox Redirect Loop Diagnosis - 2026-08-01

## Scope

Investigated reported Firefox `The page isn’t redirecting properly` at `https://admin.kalenel.nl/admin.html` without starting GitHub OAuth and without clicking `Login met GitHub`.

## Live curl results from this Windows machine

Saved in `ADMIN_FIREFOX_LOOP_CURL_20260801.json`.

- `curl.exe -sS -D - -o NUL --max-redirs 0 --http1.1 "https://admin.kalenel.nl/admin.html"`
  - `401 Unauthorized`
  - no `Location`
  - no `Set-Cookie`
- `curl.exe -sS -D - -o NUL --max-redirs 0 -A "Mozilla/5.0 Firefox" "https://admin.kalenel.nl/admin.html"`
  - `401 Unauthorized`
  - no `Location`
  - no `Set-Cookie`
- `curl.exe -sS -L -D - -o NUL --max-redirs 15 "https://admin.kalenel.nl/admin.html"`
  - `401 Unauthorized`
  - no redirects followed

The live outer-login body was saved in `ADMIN_ADMINHTML_BODY_20260801.html`; headers in `ADMIN_ADMINHTML_HEADERS_20260801.txt`.

## Fresh Playwright browser results

Scripts:

- `scripts/trace-admin-browser-navigation.mjs`
- `scripts/trace-admin-browser-variants.mjs`
- `scripts/screenshot-admin-fresh-browsers.mjs`

Evidence:

- `ADMIN_BROWSER_NAV_TRACE_20260801.json`
- `ADMIN_BROWSER_NAV_VARIANTS_20260801.json`
- `ADMIN_CHROMIUM_FRESH_ADMINHTML_20260801.png`
- `ADMIN_FIREFOX_FRESH_ADMINHTML_20260801.png`

Fresh Chromium and fresh Firefox contexts used empty cookies/storage and navigated only to `https://admin.kalenel.nl/admin.html`.

Both browsers produced the same main-document chain:

1. request `GET https://admin.kalenel.nl/admin.html`
   - request cookies: empty
   - initiator: document/navigation
2. response `401`
   - `Location`: empty
   - `Set-Cookie`: empty
   - from service worker: false
3. main frame settled at `https://admin.kalenel.nl/admin.html`
   - title: `Kalenel admin login`
   - outer GitHub login gate visible
   - no OAuth click/start

No cycle was reproduced in fresh Playwright Chromium or Firefox.

## Served asset navigation search

Saved in:

- `ADMIN_SERVED_LOCATION_SEARCH_20260801.json`
- `ADMIN_SERVED_NAV_SEARCH_20260801.json`

For the live served `admin.html`/`admin-session-sync.js` path, the only direct navigation-capable entries relevant to admin are:

- `admin.html` force-https script: only runs when protocol is `http:`; it does not rewrite `https://admin.kalenel.nl/admin.html`.
- `admin.html` `maybeReturnAfterLogin()`: only runs after an inner Supabase/TOTP login and only if a `return_to` query parameter exists.
- `admin-session-sync.js` redirectToAdminLogin(): protected subpages redirect to `./admin.html?...`; `admin.html` is not treated as a protected subpage.
- `gejast-config.js` generic login helpers skip `/admin` paths for public gate behavior.

No served `admin.html` path rewrites `/admin.html` to `/admin` or `/admin/`.

## Cloudflare inspection

Saved in `ADMIN_CLOUDFLARE_CONFIG_INSPECTION_20260801.json`.

Confirmed via Wrangler/API:

- Active Worker routes:
  - `admin.kalenel.nl/*` → `kalenel-admin-gate`
  - `kalenel.nl/*` → `kalenel-admin-gate`
- Active Worker deployment/version at time of inspection:
  - `57501792-e76b-41ee-8236-9057ef6f606c`

Blocked by Cloudflare API permission/auth limitations despite Wrangler login:

- Page Rules returned `403 Unauthorized to access requested resource`.
- DNS records returned `403 Authentication error`.
- Ruleset entrypoints for redirect/transform/cache/firewall phases returned `403 Authentication error`.

No Worker-route-level redirect cycle was found.

## System Firefox note

A system Firefox temp-profile launch was attempted with `scripts/trace-system-firefox-admin.mjs`, but system Firefox does not expose request/response hooks through that launch mode. The temp-profile process tree was killed by parent PID; user Firefox processes were not killed.

## Current conclusion

The exact reported Firefox redirect/navigation cycle was not reproduced from this machine in fresh instrumented Firefox or Chromium. The canonical URL currently behaves as a terminal Worker outer-login page with no HTTP redirect, no JavaScript/meta navigation, no cookies, and no service-worker involvement in clean browser contexts.

Because no repeated navigation was identified, no code/security change was deployed in this diagnostic pass. Changing OAuth, cookies, allowlist, Supabase/TOTP, or Worker security would be speculative and was intentionally avoided.
