GEJAST security patch v421

Files:
- gejast-config.js
- gejast-home-gate.js

What this patch does:
- reinstates aggressive private-page gating on pages that already load gejast-home-gate.js
- hides the document before auth/scope validation completes
- redirects missing/expired/invalid sessions back to home.html
- scrubs page body before redirect to reduce pre-redirect exposure in the rendered DOM
- bumps shared visible version to v421

Important honesty note:
- on a static-hosted site, client-side JavaScript cannot make raw HTML source completely undiscoverable to a determined requester
- this patch hardens the rendered experience and redirects faster, but true no-source access requires server/edge auth
