# GEJAST Real Fix Note v151

## Version root cause
The version label kept sticking because the browser could keep serving an older cached `gejast-config.js`.
The fix in this phase is not another styling tweak; it cache-busts the config/admin scripts by versioning their script URLs sitewide.

## Admin login loop root cause
`admin_claims.html` treated any admin session result without a literal `ok` field as invalid:
`if (!session.ok) ...`
That can force false logouts even when the token is valid.
This phase changes that to only reject when the response is actually missing or explicitly `ok === false`.
