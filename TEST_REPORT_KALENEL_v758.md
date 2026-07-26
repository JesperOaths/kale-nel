# Kalenel Deployment / Finalization Test Report (v758 request, v761 proven live)

Report timestamp: 2026-07-26 06:30 Europe/Amsterdam.

## Important correction

The requested audit was framed around proving `v758` live. Read-only forensics proved that the prompt's `v758` starting facts were stale: current GitHub `main` and the live origin are `v761` at commit `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2`.

I did **not** force a downgrade to v758. The safe/correct deployment source is current `main`, and live byte hashes match that commit for the release-critical files.

## Deployment proof gate

Passed / proven:

- GitHub default branch: `main`.
- Latest Pages deployment: environment `github-pages`, ref `main`, SHA `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2`, state success.
- Live `/VERSION`: `v761`.
- Live `/index.html`, `/boerenbridge_vault.html`, `/toepen.html`, `/gejast-config.js?v761`, `/admin-session-sync.js?v761`, and `/admin-gate-v105.js?v761` hash-match `git show HEAD:<file>` from `82476d8`.
- Browser proof: visible `v761 Made by Bruis`, `GEJAST_CONFIG.VERSION === v761`, active service worker `gejast-sw.js?v761`, no old `v750-v757` script tags, Cache Storage empty in the tested profile.
- Homepage feature proof: Toepen, Klaverjas online, Paardenrace, Pikken, Beurs d'Espinoza, Balzaal/Ballroom, and speed-ranking route are present; source contains `Stand-by` and not `Live-ready`.

Evidence documents:

- `DEPLOYMENT_DRIFT_DIAGNOSIS_v758.md`
- `RECOVERY_DEPLOYMENT_v758.md`
- `LIVE_DEPLOYMENT_PROOF_v758.md`
- `deployment_forensics_v761/`

## Local / CI / live checks

Passed in this continuation or immediately before it:

- `npm run verify`
- `npm run verify:klaverjas`
- `npm run smoke:live`
- `npm run smoke:push`
- `npm run smoke:games`
- `npm run smoke:beta:read`
- `npm run smoke:beta:extended`
- `npm run smoke:beta:perf`
- `npm run beta:readiness` completed and reports 6/12 beta gaps verified complete.

## Current blockers / unfinished gates

- Toepen backend SQL: `GEJAST_v755_toepen_backend.sql` exists but is still recorded as not applied to production. No destructive SQL was run in this audit.
- Toepen live write/idempotency/vault proof: not performed; requires safe production SQL apply/proof and controlled live writes.
- Admin architecture: `admin.kalenel.nl` does not resolve. Admin HTML remains reachable on the main public host and relies on Supabase/admin session gates. Cloudflare Access/default-deny is not yet proven.
- Boerenbridge admin vault: source and live file identity are proven; authenticated admin data loading was not proven without a valid admin session.
- Push: local/site-origin notification popups were proven earlier; full backend user-targeted push still requires a valid logged-in player session/device subscription and real delivery proof.
- Controlled write flows still need explicit per-test permission: drinks create/verify/reject, admin mutations, badges, secondary game saves, profile edits, Despimarkt, Pikken and Paardenrace mutation flows.
- HTTP apex did not clearly force HTTPS in forensics; HTTPS works.

## Admin exposure result

Public admin routes return HTTP 200 as static pages on `https://kalenel.nl`. Protected admin pages include frontend/backend gate code (`admin-session-sync.js`, `admin-gate-v105.js`), but static HTML reachability remains an architecture gap until `admin.kalenel.nl` + Cloudflare Access/default-deny (or equivalent) is implemented and proven.

## Boerenbridge result

`/boerenbridge_vault.html` is no longer the old minimal wrapper at the origin. Live bytes match Git HEAD and include the database-backed vault UI. Authenticated data load still needs an admin-session test.

## Toepen result

`/toepen.html` exists live and hash-matches Git HEAD. The homepage native Toepen card is visible. Backend persistence is not production-proven because the dedicated Toepen SQL migration is still pending.

## Recommendation

Continue with narrow, sequenced finalization:

1. Apply/prove `GEJAST_v755_toepen_backend.sql` in production only after reviewing signatures/grants/RLS and preparing rollback notes.
2. Run controlled Toepen live save/idempotency/vault cleanup tests.
3. Fix admin-host exposure with `admin.kalenel.nl` DNS + Cloudflare Access/default deny, preserving Supabase session gates as the second layer.
4. Prove real-device push using a logged-in player subscription.
5. Run remaining controlled live-write gates with explicit per-scenario approval.
