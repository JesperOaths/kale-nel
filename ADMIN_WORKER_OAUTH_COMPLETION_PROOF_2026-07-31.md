# Admin Worker OAuth Completion Proof - 2026-07-31

## Change

Successful GitHub OAuth callbacks now return a same-origin HTTP 200 completion page instead of immediately redirecting to `/admin.html`.

The completion response:

- sets `__Host-kalenel_admin_session` with `SameSite=Strict` preserved;
- clears the temporary OAuth and attempt cookies;
- renders a visible `Verder naar admin` Continue link to the sanitized return path;
- includes a short same-origin meta refresh to the same sanitized return path;
- keeps `Cache-Control: no-store` and the existing security headers.

This avoids losing the final Strict session cookie during the cross-site GitHub callback redirect chain without weakening the final session cookie.

## Tests

`npm run admin-worker:test` passed.

Added coverage proves:

- OAuth callback success returns `200 text/html`, not a redirect;
- callback success sets `__Host-kalenel_admin_session` with `SameSite=Strict`;
- the completion page points only to sanitized `/admin.html` through both visible link and meta refresh;
- the exact session cookie set by the callback can be sent on the next same-origin `/admin.html` request and reaches the protected admin asset successfully;
- returned GitHub ID/login normalization still handles whitespace and login casing.

## Live deploy

Wrangler deployed the clean Worker to:

- `admin.kalenel.nl/*`
- `kalenel.nl/*`

Current live Worker version after this fix:

- `c91c8294-addb-427f-b64f-399f1ed225c8`

## Live matrix

Automated live matrix passed `20/20`.

Evidence JSON:

- `ADMIN_WORKER_OAUTH_COMPLETION_LIVE_MATRIX_20260731-061227.json`

Checked at:

- `2026-07-31T04:12:28.874Z`

Failed tests:

- `[]`

## Diagnostics

No temporary diagnostics were added, so none were left behind.
