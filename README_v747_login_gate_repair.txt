GEJAST v747 login gate repair

Purpose
- Repair the immediate bounce-back-to-login behavior after a successful login attempt.
- Keep this as a small repair-first patch. No feature work and no SQL changes are included.

Files changed in GitHub
- VERSION
- gejast-home-gate.js
- README_v747_login_gate_repair.txt

Diagnosis
- login.html / gejast-account-runtime.js stores a player session token after a successful login RPC.
- index.html then loads gejast-home-gate.js before the homepage continues.
- The old gate validated the token only through public-state RPCs.
- If those validation RPCs failed, timed out, hit schema-cache lag, or returned no viewer-shaped payload, the old gate cleared the freshly stored token and redirected back to login.
- That made a successful login look like an immediate failed session.

Change made
- gejast-home-gate.js is bumped internally to v747.
- The gate still redirects to login when no session token exists.
- The gate still clears tokens on an explicit hard invalid response such as session_valid=false / is_logged_in=false / valid=false.
- The gate now fails open on transient validation problems and shows the page instead of deleting the token.
- Page-level RPCs still enforce their own session rules.

SQL
- No SQL required for v747.
- Do not run a no-op SQL patch.

Post-deploy browser note
- Because current deployment headers cache JS as public max-age=31536000 immutable, an already-loaded browser may need a hard refresh or cache clear if it keeps using gejast-home-gate.js?v746 from cache.
- The repo-side file is updated directly, but the HTML still references many v746 query strings. A later broader version-normalization pass should update page script query params uniformly.
