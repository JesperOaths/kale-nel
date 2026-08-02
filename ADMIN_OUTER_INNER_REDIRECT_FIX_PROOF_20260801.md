# Admin outer-session / inner-session redirect fix proof - 2026-08-01

## Bug reproduced

The earlier tests only hit the unauthenticated Worker `401` login gate. A new full browser integration test used a synthetic valid outer Worker cookie so the real production `admin.html` and all scripts executed.

Before the fix, Chromium reproduced the bad authenticated-outer / missing-inner behavior:

1. `GET https://admin.kalenel.nl/admin.html` -> `200`
2. Production scripts executed.
3. `gejast-home-gate.js` treated `admin.html` as a normal player-protected page.
4. With no player session token, it called `redirectToLogin()` / `location.replace(loginUrl())`.
5. Browser navigated to `https://admin.kalenel.nl/login.html?return_to=admin.html`.

Captured failing chain from the first browser integration run:

```json
[
  { "event": "request", "url": "https://admin.kalenel.nl/admin.html" },
  { "event": "response", "url": "https://admin.kalenel.nl/admin.html", "status": 200, "location": "" },
  { "event": "framenavigated", "url": "https://admin.kalenel.nl/admin.html" },
  { "event": "request", "url": "https://admin.kalenel.nl/login.html?return_to=admin.html" },
  { "event": "response", "url": "https://admin.kalenel.nl/login.html?return_to=admin.html", "status": 200, "location": "" },
  { "event": "framenavigated", "url": "https://admin.kalenel.nl/login.html?return_to=admin.html" }
]
```

Precise initiating script before removal:

- `gejast-home-gate.js`
- `redirectToLogin()`
- `location.replace(loginUrl())`
- `loginUrl()` produced `./login.html?return_to=admin.html`

## Narrow fix

Changed only admin/client gate behavior:

- `gejast-home-gate.js`
  - added `isAdminSurface()`.
  - skips the normal player-session redirect on `admin`, `admin.html`, and `admin_*.html`.
  - admin pages remain governed by the separate admin inner Supabase/TOTP gate.

- `admin-session-sync.js`
  - added `isMainAdminHub()`.
  - `redirectToAdminLogin()` refuses to navigate when already on `admin.html`; it clears invalid inner storage and leaves the document loaded.
  - recursive/nested `return_to` values are stripped for protected subpage redirects.

- `admin_claims.html`
  - now invokes `GEJAST_ADMIN_SESSION.requirePage()` on load.
  - missing/invalid inner session redirects once to `admin.html?reason=session_invalid&return_to=admin_claims.html`.

No Worker OAuth, GitHub allowlist, outer cookie, SameSite, Supabase/TOTP, or secret behavior was changed.

## New full-browser proof

Script: `scripts/test-admin-outer-inner-browser.mjs`

Mechanism:

- imports the real Worker module;
- signs a synthetic valid outer `__Host-kalenel_admin_session` with a fake test secret;
- routes `https://admin.kalenel.nl/**` through the Worker with the real built static assets;
- executes production HTML and scripts in Playwright Chromium and Firefox;
- intercepts Supabase RPCs for mocked inner-session states;
- caps main-document navigation at 10 and records the full chain.

Evidence: `ADMIN_OUTER_INNER_BROWSER_PROOF_20260801.json`.

Post-fix assertions passed in both Chromium and Firefox:

### `/admin.html`, valid outer Worker session, empty local/session storage

- exactly one main-document request;
- no HTTP redirect;
- no `location.assign`/`location.replace`/meta-refresh instrumentation fired;
- final URL remained `https://admin.kalenel.nl/admin.html`;
- `loginView` visible;
- `hubView` hidden.

### `/admin.html`, valid outer Worker session, mocked valid inner Supabase session

- final URL remained `https://admin.kalenel.nl/admin.html`;
- `loginView` hidden;
- `hubView` visible;
- status `Beheerhub geladen.`.

### `/admin_claims.html`, valid outer Worker session, missing inner session

- first document load: `/admin_claims.html` -> `200`;
- exactly one client navigation to `/admin.html?reason=session_invalid&return_to=admin_claims.html`;
- final hub shows login/TOTP form and hides admin hub;
- no recursive/nested `return_to`.

## Verification gates

Passed after fix:

- `npm run admin-worker:build`
- `node scripts/test-admin-inner-render.mjs`
- `node scripts/test-admin-outer-inner-browser.mjs`
- `node scripts/test-admin-worker-gate.mjs`
- `npm run verify:js`
- `npm run admin-worker:dry-run`

## Deployment

Deployed with Wrangler.

- Worker version: `74505d9a-8b99-4b4e-be23-a04bd8ff78c4`
- Routes preserved:
  - `admin.kalenel.nl/*`
  - `kalenel.nl/*`

## Live unauthenticated sanity check after deploy

Results:

- `https://admin.kalenel.nl/admin.html` -> terminal `401 Unauthorized`, no `Location`.
- `https://admin.kalenel.nl/admin` -> one `302 Location: /admin.html`.
