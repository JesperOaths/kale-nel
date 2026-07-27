# Admin perimeter v761 proof — 2026-07-27

Production project: `jas-site`  
Frontend version: `v761`  
Branch: `agent/v761-production-completion`

## Checks run

### Admin subdomain DNS

Command: `Resolve-DnsName admin.kalenel.nl`

Result:

- `admin.kalenel.nl` does not resolve.
- HTTPS request to `https://admin.kalenel.nl` failed with remote-name resolution failure.

### Apex admin exposure

Command: `Invoke-WebRequest -UseBasicParsing -Uri https://kalenel.nl/admin.html`

Result:

- `HEAD_STATUS=200`
- `GET_STATUS=200`
- Body served live admin HTML: title `Beheerhub - Wordt er gejast?`

### Local Cloudflare credentials/session hints

Environment variable name check only, no values read or printed:

- No environment variable names matching `CLOUDFLARE`, `CF_`, or `KALENEL` were present.

## Current perimeter state

- Supabase/browser admin session gates exist and were used successfully for Toepen and Boerenbridge proof.
- `admin.kalenel.nl` is not configured in DNS.
- Cloudflare Access/default-deny perimeter is not proven or configured.
- Apex `https://kalenel.nl/admin.html` is still publicly reachable at static-file level (`200`).

## Blocker

True admin perimeter completion requires Cloudflare/DNS account access to:

1. Create `admin.kalenel.nl` DNS record.
2. Put `admin.kalenel.nl` behind Cloudflare Access/default-deny policy.
3. Split or route admin-only static pages so admin HTML is not publicly served from the apex without the Access layer.
4. Re-prove:
   - unauthenticated `admin.kalenel.nl` blocks before static HTML load;
   - authenticated Access session can reach admin pages;
   - apex public routes still work;
   - Supabase admin session/TOTP gates remain as the second layer.

## Result

Admin perimeter is **not complete**. This is an external DNS/Cloudflare configuration blocker, not a repository-only fix. Do not claim admin-host security complete until Cloudflare/DNS evidence exists.
