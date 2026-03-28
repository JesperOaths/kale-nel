# GEJAST Root Cause Note v148

## Homepage ladders root cause
The homepage ladder problem was not just styling or RPC grants.
A real JS bug existed: `loadHomepageLadders()` was defined but not invoked in the homepage boot flow.
That leaves the badge stuck on standby forever and the cards empty even when ladder SQL works.

## Admin repeated-login root cause
The site currently has two admin auth patterns:
1. token-only admin pages like `admin_claims.html`
2. gate-based pages like `leaderboard.html`, `boerenbridge_vault.html`, `beerpong_vault.html` that also look for username/deadline/device data

If the login page only stores the bare session token, the gate-based pages bounce back to admin login again.
The fix direction is to keep these keys in sync:
- jas_admin_session_v8
- jas_admin_user_v1
- jas_admin_deadline_v1
- optional jas_admin_device_v1

## Delivery rule
Always reissue full patched bundles/scripts, not surface-level excerpts.
