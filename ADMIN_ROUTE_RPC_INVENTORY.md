# Admin route/RPC inventory — Kalenel v761 production completion

Updated: 2026-07-26.

## Current state

- `admin.kalenel.nl` does not resolve.
- Admin HTML is still served as static files on `https://kalenel.nl`.
- Existing frontend/backend admin session gates are the inner lock, not a perimeter.
- Public/admin split is not complete.

## Root admin pages found

`admin.html`, `admin-dev.html`, `admin_account_runtime.html`, `admin_analytics.html`, `admin_beerpong_shared_stats.html`, `admin_boerenbridge_shared_stats.html`, `admin_claims.html`, `admin_cross_game_stats.html`, `admin_deployment_verification.html`, `admin_despimarkt.html`, `admin_despimarkt_auto_markets.html`, `admin_despimarkt_health.html`, `admin_despimarkt_runtime.html`, `admin_drinks_push_health.html`, `admin_expired.html`, `admin_final_runtime_verification.html`, `admin_game_group_a_health.html`, `admin_game_group_a_runtime.html`, `admin_game_group_b_health.html`, `admin_home_profiles_runtime.html`, `admin_identity_health.html`, `admin_implementation_matrix.html`, `admin_klaverjas_runtime.html`, `admin_klaverjassen_alignment.html`, `admin_klaverjassen_shared_stats.html`, `admin_mail_audit.html`, `admin_match_control.html`, `admin_ops_observability.html`, `admin_paardenrace.html`, `admin_phase_completion.html`, `admin_pikken.html`, `admin_pikken_shared_stats.html`, `admin_push.html`, `admin_rad.html`, `admin_release_readiness.html`, `admin_reserved_names.html`, `admin_runtime_verification.html`, `admin_scope_hardening.html`, `admin_security.html`, `admin_shared_stats.html`, `admin_system_health.html`, `admin_v60_orig.html`.

Also review `familie/admin.html`, admin vault pages, and legacy/copy trees before publishing any split bundle.

## Core admin JS/session files

- `admin-session-sync.js`
- `admin-gate-v105.js`
- `gejast-admin-rpc.js`
- `admin-topnav.js`
- `admin.js`
- `admin-desktop-restore-v590.js`
- `gejast-admin-source.js`
- `gejast-admin-claims-source.js`
- `gejast-admin-claims-buckets.js`
- `gejast-admin-buckets.js`
- `gejast-admin-users-patch.js`
- `gejast-push-admin-source.js`

Admin storage keys include `jas_admin_session_v8`, `jas_admin_device_v1`, `jas_admin_user_v1`, and `jas_admin_deadline_v1`. Moving admin to a subdomain changes origin storage; do not assume current apex sessions carry over.

## Public pages that must remain public

- `index.html`, `home.html`, `login.html`, `request.html`, `activate.html`, `invite.html` subject to separate review.
- Public game/stat/profile pages including `leaderboard.html`, `profiles.html`, `player.html`, public vault/score/game/spectator pages.

## Split risks

1. Shared apex origin means public-page XSS could access apex admin storage while admin remains on `kalenel.nl`.
2. Many admin links and redirects are relative (`./admin.html`, `return_to`).
3. Admin pages load relative assets; admin subdomain must serve the required non-secret JS/CSS/assets.
4. Root service-worker scope can cover admin while admin is on apex.
5. Redirect-only security is insufficient unless `admin.kalenel.nl` DNS and Cloudflare Access/default-deny are already live.
6. Legacy admin copies must not accidentally remain exposed.

## Required final perimeter

- Public site: `https://kalenel.nl`.
- Protected admin site: `https://admin.kalenel.nl`.
- Cloudflare Access default deny with approved identities and MFA.
- Supabase admin session/TOTP remains the inner lock.
- Public old admin URLs deny or redirect safely only after the protected host is working.
- Direct protected asset requests are blocked by the perimeter.
