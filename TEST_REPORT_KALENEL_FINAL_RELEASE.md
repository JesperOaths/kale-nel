# Kalenel Final Release Test Report

Updated: 2026-07-26 Europe/Amsterdam.

## Deployment identity

The earlier v758 live/GitHub mismatch report has been investigated. Current live production is proven as:

- Version: `v761`
- GitHub `main` SHA: `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2`
- Deployment source: GitHub Pages generated deployment from `main`
- Evidence branch/docs commit: `agent/v761-deployment-proof` / `307bda4 docs: prove v761 deployment identity`

Do not claim v758 is live. v758 was an intermediate commit (`b1d6626...`); current live origin and current `main` match as v761.

## Deployment proof

Passed:

- Live `/VERSION` equals `v761`.
- Live `/index.html`, `/boerenbridge_vault.html`, `/toepen.html`, `/gejast-config.js?v761`, `/admin-session-sync.js?v761`, and `/admin-gate-v105.js?v761` hash-match Git HEAD from `82476d8`.
- Homepage browser proof shows visible `v761 Made by Bruis`, Toepen, Klaverjas online, Paardenrace, Pikken, Beurs d'Espinoza, Balzaal/Ballroom, speed-ranking route, and public Admin link.
- Service worker active script is `gejast-sw.js?v761`; no old `v750-v757` mixed scripts detected; Cache Storage was empty in the tested profile.

Evidence files:

- `DEPLOYMENT_DRIFT_DIAGNOSIS_v758.md`
- `RECOVERY_DEPLOYMENT_v758.md`
- `LIVE_DEPLOYMENT_PROOF_v758.md`
- `TEST_REPORT_KALENEL_v758.md`
- `HANDOFF_KALENEL_DEPLOYMENT_FINALIZATION_2026-07-26.md`
- `deployment_forensics_v761/`

## Checks passed

- `npm run verify`
- `npm run verify:klaverjas`
- `npm run smoke:live`
- `npm run smoke:push`
- `npm run smoke:games`
- `npm run smoke:beta:read`
- `npm run smoke:beta:extended`
- `npm run smoke:beta:perf`
- `npm run beta:readiness`

## Remaining gates

- Toepen backend SQL apply/proof: `GEJAST_v755_toepen_backend.sql` remains pending.
- Toepen deterministic/live save/idempotency/scope/vault/cleanup proof.
- Admin security architecture: `admin.kalenel.nl` does not resolve; main-host static admin HTML remains publicly reachable and depends on session gates.
- Boerenbridge authenticated admin vault data proof.
- Real backend push delivery to a logged-in subscribed player device.
- Controlled live-write matrix for drinks, games, profiles, badges, Despimarkt, Pikken, Paardenrace, and admin mutations.

## Current recommendation

Proceed with narrow forward finalization only: Toepen backend migration proof first, then admin-host/access hardening, then real-device push and controlled write gates. Do not downgrade or silently edit v758 assets; use the next monotonic frontend version for any new code correction.
