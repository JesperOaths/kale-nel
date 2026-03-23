# Plan to completely lock down admin pages, vault, and backend tools (v61)

## Important reality first
Right now the site is mostly static HTML.
That means hiding links in the UI is **not enough**.
If someone knows the URL, they can still try to open the page.

Front-end session checks help the experience, but they are **not a real hard lock** by themselves.

## Real secure target
To truly protect admin pages, you need **both**:
1. real server-side access control
2. database-side permission checks

## Best end-state

### Public pages stay public
Examples:
- index.html
- login.html
- request.html
- scorer.html

### Sensitive pages move behind real auth
Examples:
- admin.html
- admin-tools.html
- vault.html
- leaderboard admin version
- queue monitor

## Secure rollout plan in easy steps

### Step 1 — split public and private hosting paths
Best pattern:
- public site on the main root
- admin tools under a protected subpath or separate subdomain

Examples:
- `https://kalenel.nl/` for public
- `https://admin.kalenel.nl/` for admin

Why this helps:
- easier to apply different auth rules
- easier to block crawlers and direct access
- easier to add extra security headers

### Step 2 — put admin pages behind hosting-level auth
Use one of these:
- Cloudflare Access
- Netlify password / identity protection
- Vercel middleware / auth gate
- a small backend reverse proxy with auth

This is the first true lock.

### Step 3 — keep Supabase RPCs admin-checked
Every admin RPC must verify the admin session server-side.
Examples:
- `admin_check_session`
- `admin_decide_claim_request`
- `admin_queue_activation_email`
- `admin_revoke_player_access`

Never trust the page alone.

### Step 4 — stop exposing sensitive data to public pages
Public pages should never fetch:
- full claim history
- queue job payloads
- vault analytics data
- admin-only page lists

Only admin pages should call those RPCs.

### Step 5 — protect vault at both layers
For `vault.html`:
- move it behind the protected admin host/path
- require admin session check in the page
- make the vault RPCs admin-only in Supabase

### Step 6 — remove admin-only files from public navigation
Keep them out of `index.html`.
Also add:
- `noindex, nofollow`
- but remember: that does not secure them, it only reduces discovery

### Step 7 — add session expiry + forced logout
Admin sessions should:
- expire quickly
- refresh only while active
- be revocable

### Step 8 — add audit logging
Every admin action should be written to an audit table.

## Recommended technical approach for your stack

### Easiest strong option
1. move admin pages to a protected subdomain
2. put Cloudflare Access or equivalent in front of it
3. keep Supabase RPC admin checks as the second lock

That gives you:
- real URL blocking before page load
- real DB blocking if someone tries API calls directly

## What to do with the current static pages
Until you move them:
- keep the front-end admin session checks
- keep `noindex,nofollow`
- remove public links
- treat this as temporary only

## Simple priority order
1. protect admin host/path at hosting level
2. keep admin RPC checks strict
3. move vault and admin tools there
4. add audit logs
5. remove old direct public access
