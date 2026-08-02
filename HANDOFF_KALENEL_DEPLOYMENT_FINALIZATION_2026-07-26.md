# Kalenel handoff — deployment proof and finalization audit

Timestamp: 2026-07-26 Europe/Amsterdam.

## Current truth

The live site is not v758. It is proven as:

- Live URL: `https://kalenel.nl`
- Version: `v761`
- Deployed SHA: `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2`
- Source: GitHub Pages generated deployment from `main`
- Evidence branch: `agent/v761-deployment-proof`
- Evidence/docs commit: `307bda4 docs: prove v761 deployment identity`

The original v758 mismatch report was valid to investigate but stale by the time of this pass. Current live origin and current `main` match byte-for-byte for the representative release-critical files.

## Deployment evidence

Primary docs:

- `DEPLOYMENT_DRIFT_DIAGNOSIS_v758.md`
- `RECOVERY_DEPLOYMENT_v758.md`
- `LIVE_DEPLOYMENT_PROOF_v758.md`
- `TEST_REPORT_KALENEL_v758.md`
- `RELEASES/v758.md`
- `deployment_forensics_v761/`

Important proof:

- `/VERSION` => `v761`
- live `/index.html` hash == Git HEAD `index.html`
- live `/boerenbridge_vault.html` hash == Git HEAD `boerenbridge_vault.html`
- live `/toepen.html` hash == Git HEAD `toepen.html`
- live `gejast-config.js?v761`, `admin-session-sync.js?v761`, `admin-gate-v105.js?v761` hash-match Git HEAD
- Browser loaded `gejast-sw.js?v761`, no mixed v750-v757 scripts, Cache Storage empty

## Checks run

Passed:

- `npm run verify`
- `npm run verify:klaverjas`
- `npm run smoke:live`
- `npm run smoke:push`
- `npm run smoke:games`
- `npm run smoke:beta:read`
- `npm run smoke:beta:extended`
- `npm run smoke:beta:perf`
- `npm run beta:readiness`

## Remaining blockers

1. **Toepen backend** — `GEJAST_v755_toepen_backend.sql` remains pending production apply/proof. Need review, controlled apply, grants/RLS/signature proof, PostgREST reload proof, deterministic/live-save/idempotency/vault tests, and cleanup.
2. **Admin security** — `admin.kalenel.nl` does not resolve. Static admin HTML is still reachable on the main host; it relies on frontend/backend admin session gates. Need admin hostname + Cloudflare Access/default-deny or equivalent, while preserving Supabase session validation.
3. **Boerenbridge admin data proof** — live file identity is proven, but authenticated admin vault data load and unauthorized denial still need a valid admin-session test.
4. **Push backend delivery** — browser/Kalenel-origin notifications work, but real backend user-targeted push needs a logged-in player session, synced subscription, and real-device delivery/click/replay/expiry proof.
5. **Controlled live writes** — drinks, games, profiles, badges, Despimarkt, Pikken, Paardenrace, and admin mutations still require explicit per-scenario approval.

## Safety notes

- Do not downgrade to v758 unless there is a concrete reason; v759-v761 contain push/session-token hardening.
- Keep Ice exactly `2.8` units.
- Do not alter historical drink values.
- Do not run destructive SQL.
- Preserve friends/family isolation.
- Prefer forward fixes with the next monotonic frontend version if code changes are needed.
