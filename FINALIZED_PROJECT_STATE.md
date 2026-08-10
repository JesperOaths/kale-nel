# Kalenel — finalized project state

Finalized on **2026-08-10** after the v786 production-acceptance closure.

## Authoritative stable baseline

- Finalized frontend baseline: **v786**
- Current live frontend at freeze: **v786**
- Frontend release merge: `81c6ba88e579188effa7342cc6a9d3790d5d0637`
- Public frontend: GitHub Pages/static deployment from `main`
- Protected admin perimeter: Cloudflare Worker build **v762** on `admin.kalenel.nl` (separate version stream from the frontend)
- Backend/data: Supabase authenticated RPC contracts
- Push dispatcher: Node 24 production runtime
- Beta readiness: **12/12 verified complete**, 0 permission-gated, 0 blocked
- Live-write checklist: **0 armed mutation targets**

## Final production acceptance

Live v786 passed the hardened **35-route** public health suite, base and extended read-only beta checks, configured performance budgets, and a real Chromium sweep of all 35 authoritative public routes at phone and desktop size (**70 combinations**). The sweep intercepted all non-GET browser traffic locally and finished with zero page exceptions, zero console-error pages, zero same-origin GET/HEAD failures, zero stuck auth/loading states, zero whole-page overflow, zero positive-tabindex/hidden-focus violations, and zero serious/critical axe accessibility violations.

The Rad runtime received an additional live multi-width proof at **320, 360, 390, 430 and 760px**. The shared mobile runtime now sizes the wheel from its container with `min(100%,460px)`, no longer injects the faulty `96vw` override, and keeps the page and wheel inside the mobile panel. This closes the sole 69/70 failure from the v785 freeze attempt.

## User-facing product surface

Friends and Family scopes remain isolated. The public product includes the homepage/game launcher, profiles and account claim/login/activation flows, Klaverjas scorer/live/online/leaderboard surfaces, Toepen, Beerpong, Boerenbridge, Pikken, Paardenrace, Drinks and verification/statistics, Caute Rad, and Beurs d'Espinoza/Caute Coins surfaces. Compatibility/deep-link aliases are retained only where current runtime navigation still depends on them.

## Security and operations

The public admin entry redirects to the protected admin host. The Cloudflare outer GitHub OAuth allowlist remains separate from the inner Supabase admin username/password/TOTP boundary. Active admin mutation paths remain session/scope guarded. Public operational consoles removed during the v775 cleanup remain absent. No Cloudflare paid service is required by this baseline.

Production mutation proof is closed rather than continuously re-run: Drinks, Toepen, Klaverjas, Beerpong, Boerenbridge and profile persistence have controlled evidence and permanent guards. Completed write targets stay disarmed. New consequential writes require a newly scoped approval gate instead of reusing historical proof machinery.

## Stable invariants

- Ice remains exactly **2.8 units**.
- Daily counters/polls use the Amsterdam **06:00 -> 06:00** boundary.
- Friends/Family scope isolation remains mandatory.
- Completed live-write targets remain disarmed.
- Admin Worker build **v762** is not the frontend VERSION and must not be mechanically bumped with frontend releases.
- Historical module/RPC suffixes identify contracts and are not current frontend-version markers.
- The Rad shared mobile runtime must remain container-bounded; the removed `96vw` wheel override must not return.

## Change policy after freeze

v786 is the stable finished baseline. Future work should normally be a deliberate feature or a specifically reported defect, not open-ended cleanup for its own sake. Change only the affected owner, preserve working behavior outside that scope, add or update a focused regression, bump the frontend VERSION for a real frontend change, and repeat the relevant live proof plus the standard verification suite. Consequential production mutations remain permissioned and should not be manufactured merely for testing.
