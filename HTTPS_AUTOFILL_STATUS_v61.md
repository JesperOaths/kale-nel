# HTTPS + autofill status (v61)

## What was patched in the bundle
- added a client-side redirect from `http://` to `https://` for `kalenel.nl`
- added canonical `https://kalenel.nl/...` links on the HTML pages
- added better autofill attributes on:
  - `admin.html` username / password / TOTP fields
  - `login.html` PIN field and username mirror for password-manager friendliness
  - `request.html` email field
- made the version watermark much more visible as `v61 · Made by Bruis`

## Important note
A front-end redirect helps, but true HTTPS depends on hosting.

## Hosting checklist
1. in GitHub Pages / your hosting provider, ensure custom domain HTTPS is enabled
2. keep the `CNAME` pointed correctly
3. force HTTPS in the hosting settings if available
4. once HTTPS is live, test `http://kalenel.nl` and confirm it redirects to `https://kalenel.nl`
