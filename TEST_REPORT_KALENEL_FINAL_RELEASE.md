# Kalenel Final Release Test Report

Target: v757
Branch: agent/v757-finalization

## Local static gate
- 2026-07-24: 
pm run verify PASS
  - 
ode check-version-drift.mjs: PASS, root VERSION v757
  - 
ode check-rpc-coverage.mjs: PASS, Frontend RPCs=111, SQL functions=587
  - 
ode check-local-refs.mjs: PASS
  - 
ode check-homepage-root-fixes.mjs: PASS
  - 
ode check-toepen.mjs: PASS
  - 
ode check-active-js-syntax.mjs: PASS, Files checked=163

## Live checks so far
- https://kalenel.nl: HTTP 200, public content still v750-era/production.
- https://kalenel.nl/admin.html: HTTP 200, public admin still reachable [BLOCKER].
- https://admin.kalenel.nl: DNS resolution failed [BLOCKER].

## Pending gates
- Toepen deterministic rule-engine coverage.
- Toepen SQL migration apply/proof, grants, RLS, signatures.
- Controlled Toepen friends/family live save/vault/idempotency tests.
- Public/admin deployment split and Cloudflare Access proof.
- Boerenbridge vault live contracts.
- Push real-device delivery/action/replay/expiry.
- Full controlled live-write matrix.
- Mobile/browser regression.
- Service-worker/cache upgrade from v750 to v757.
