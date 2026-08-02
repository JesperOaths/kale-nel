# Admin perimeter v761 proof — updated 2026-07-29

Production project: `jas-site`  
Frontend version: `v761`  
Branch: `agent/v761-production-completion`

## Repository-side preparation

Added/updated repo-side perimeter materials:

- `cloudflare/admin-perimeter-v761.md` — Cloudflare/DNS hosting model, path classes, edge rules, and proof matrix.
- `scripts/probe-admin-perimeter-v761.ps1` — repeatable public/admin perimeter probe without secrets.
- `DEPLOYMENT_PUBLIC_ADMIN.md` — updated current state and deployment model.

No service-role key or private secret was added to frontend code or docs.

## Checks run

### Admin subdomain DNS

Command: `Resolve-DnsName admin.kalenel.nl`

Result:

- `admin.kalenel.nl` does not resolve.
- HTTPS request to `https://admin.kalenel.nl` fails with remote-name resolution failure.

### Apex admin exposure

Command: `Invoke-WebRequest -UseBasicParsing -Uri https://kalenel.nl/admin.html`

Result:

- `GET_STATUS=200`
- Body serves live admin HTML: title `Beheerhub - Wordt er gejast?`

### Public protected asset exposure spot check

Command: `Invoke-WebRequest -UseBasicParsing -Uri https://kalenel.nl/admin-session-sync.js?v761`

Result:

- `GET_STATUS=200`
- Public static admin support JS is still fetchable from the apex.

## Current perimeter state

- Supabase/browser admin session gates exist and were used successfully for Toepen and Boerenbridge proof.
- `admin.kalenel.nl` is not configured in DNS.
- Cloudflare Access/default-deny perimeter is not proven or configured.
- Apex `https://kalenel.nl/admin.html` is still publicly reachable at static-file level (`200`).
- The current browser automation session is not authenticated to Cloudflare; the managed OpenClaw browser lands on the Cloudflare sign-in page, and the existing user browser profile could not be attached for tab control.

## Required Cloudflare/DNS implementation

Use `cloudflare/admin-perimeter-v761.md` as the implementation checklist:

1. Create/confirm a proxied `admin.kalenel.nl` DNS record pointed at the admin static deployment/origin.
2. Create a Cloudflare Access self-hosted application for `admin.kalenel.nl/*`.
3. Keep Access default-deny; add allow policy only for approved identities/groups.
4. Require MFA through the Access identity provider/posture configuration.
5. Add public apex edge rules so admin-only paths redirect to the protected admin host or return safe denial.
6. Add public denial for repo artifacts that should not be served (`*.md`, `*.txt`, `*.sql`, `*.patch`, `/mnt/*`, `/sql/*`, deployment forensics).
7. Keep public account activation and account-request pages available on `kalenel.nl`.
8. Re-prove with `scripts/probe-admin-perimeter-v761.ps1` plus authenticated Access/Supabase session tests.

## Blocker

True admin perimeter completion requires Cloudflare/DNS account access. Current evidence still fails the required criteria:

- `admin.kalenel.nl` does not resolve.
- public `kalenel.nl/admin.html` returns `200` admin HTML.
- public admin support JS still returns `200`.

## Result

Admin perimeter is **not complete**. This is an external DNS/Cloudflare configuration blocker, not a repository-only fix.

Do not declare Kalenel production-complete until Cloudflare/DNS evidence proves the Access perimeter and public apex admin paths no longer serve admin source openly.
