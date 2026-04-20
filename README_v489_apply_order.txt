v489 patch bundle

Included frontend files:
- gejast-config.js
- gejast-scope.js
- admin-session-sync.js
- admin-gate-v105.js
- admin.html
- admin_analytics.html
- admin_claims.html
- admin_expired.html
- admin_mail_audit.html
- admin_match_control.html
- admin_push.html
- admin_reserved_names.html
- login.html
- request.html
- pikken.html
- gejast-pikken.js
- pikken_live.html

Intent:
- make admin session persist much longer on remembered devices
- keep admin session valid across new frontend uploads via local/device bundle
- harden family/friends scoped username lists on login/request
- improve Pikken lobby/mobile/desktop UI and start readiness UX

Apply the separate SQL file after uploading these frontend files.
