# Admin Worker Allowlist Fix Proof - 2026-07-31

## Live change

- Overwrote only the two approved-account Worker secrets via Wrangler:
  - `APPROVED_GITHUB_ID` set to the approved numeric GitHub ID.
  - `APPROVED_GITHUB_LOGIN` set to the approved GitHub login.
- No OAuth tokens, cookies, GitHub client secrets, authorization codes, or full GitHub user payloads were logged or recorded.
- Redeployed `kalenel-admin-gate` after hardening allowlist normalization.
- Live Worker version after the clean deploy: `53ce3352-b874-4859-9e4e-ce6b1f1c86ad`.
- Live routes confirmed by Wrangler:
  - `admin.kalenel.nl/*`
  - `kalenel.nl/*`

## Code hardening

`cloudflare/workers/admin-gate/src/worker.js` now normalizes both returned GitHub values and configured allowlist values before comparison:

- GitHub ID: `String(value || '').trim()`
- GitHub login: `String(value || '').trim().toLowerCase()`

The comparison remains fail-closed and constant-time after length equality.

## Verification

- `npm run admin-worker:test` passed.
- Unit coverage now verifies:
  - returned GitHub ID with surrounding whitespace still matches configured ID;
  - returned GitHub login with surrounding whitespace and different casing still matches configured login.
- Live automated Worker matrix passed `20/20`.
  - Evidence JSON: `ADMIN_WORKER_ALLOWLIST_FIX_LIVE_MATRIX_20260731-055344.json`
  - Checked at: `2026-07-31T03:53:46.746Z`
  - Failed tests: `[]`

## Browser retest status

A managed-browser retest with the existing GitHub session did not reach the previous Worker allowlist rejection. It stopped on GitHub's own `Reauthorization required` screen for the approved account/app. I did not click the GitHub authorization button or ask the user to repeat login.

## Diagnostic status

The temporary fail-closed mismatch diagnostic was not added because the live retest no longer produced the Worker allowlist rejection after the secret overwrite and normalization deploy. The clean Worker is live.
