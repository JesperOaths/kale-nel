# GEJAST v690 Full-Site Sweep

This bundle is a broad compatibility and hygiene sweep across the root deployed site.

## Automated Sweep Result

- Root HTML pages scanned: 113
- Root JS files scanned: 135
- Root SQL files scanned: 105
- Broken local `src` / `href` references after fixes: 0
- Active-page version drift after fixes: 0
- Frontend RPC names without committed SQL definitions after fixes: 21

The remaining 21 RPC gaps are privileged admin/mail/account actions. They were not stubbed because fake admin success would be unsafe. Those need the real admin/account SQL owner, not a compatibility no-op.

## Major Fixes Included

- Normalized every root HTML page to `GEJAST_PAGE_VERSION='v690'`.
- Normalized root HTML asset cache-busters to `?v690`.
- Removed public `MAKE_WEBHOOK_URL` from `gejast-config.js`.
- Preserved real backend RPC suffixes such as `_v687`; `v690` is only the deploy/cache version.
- Kept the v688/v689 login/profile/name-loading fixes.
- Added `GEJAST_v690_full_site_compat.sql`, a standalone Supabase SQL editor bundle.

## SQL Bundle Adds

- v688 selector/login helpers.
- v689 profile/name compatibility functions.
- Paardenrace v415 safe backend owner plus fast v687 wrappers.
- Paardenrace wrappers for room state/create/join/leave/disband/ready/verify/reject.
- Public read shims for:
  - drinks dashboards
  - drink verification queue
  - Caute coins public reads
  - profile settings
  - public session state
  - homepage/live summaries
  - Beerpong shared stats reads
  - web push action consume diagnostic
  - Despimarkt maintenance no-op
- Explicit drink action signatures that raise clear `*_backend_missing` errors instead of PostgREST schema-cache/missing-function errors when the real drink write owner is not deployed.

## Deploy Order

1. Upload the zip contents to the GitHub repo root.
2. Run `GEJAST_v690_full_site_compat.sql` in the Supabase SQL editor.
3. Refresh the Supabase/PostgREST schema cache.
4. Hard refresh the site.
5. Re-test:
   - login dropdown
   - profiles page and badge accordions
   - Klaverjassen scorer dropdowns
   - Paardenrace lobby/open rooms
   - Pikken lobby create fallback
   - Boerenbridge name loading
   - drinks pages, especially write actions

## Still Needs Real Backend SQL

The audit still reports missing committed SQL for admin/mail/account actions such as:

- `admin_login`
- `admin_check_session`
- `admin_get_claim_requests`
- `admin_resend_pending_activation_action`
- `admin_validate_outbound_email_job`
- `create_player_activation_link_action`

Those are intentionally not faked in this bundle.
