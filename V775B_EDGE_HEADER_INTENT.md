# v775b public edge header hardening intent

Infrastructure-only hardening; frontend VERSION remains v775.

Target baseline for ordinary public apex responses through the existing free Cloudflare Worker:
- X-Content-Type-Options: nosniff
- Referrer-Policy: strict-origin-when-cross-origin
- X-Frame-Options: SAMEORIGIN
- Permissions-Policy: camera=(), microphone=(), payment=()

Deliberately deferred from this compatibility-first pass:
- geolocation restriction (public site uses geolocation)
- broad Content-Security-Policy (requires separate resource compatibility proof)
- HSTS (requires separate HTTPS/subdomain rollout proof)

The one-time builder will remove this intent file before final merge if the patch passes all Worker/repository checks.
