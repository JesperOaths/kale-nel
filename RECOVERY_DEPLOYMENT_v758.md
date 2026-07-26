# RECOVERY_DEPLOYMENT_v758

Created: 2026-07-26 06:20 Europe/Amsterdam.

This file preserves rollback context for the deployment drift investigation requested for v758. The public site has since advanced to `v761`; rollback should therefore target the exact Git commit, not the filename version label.

## Current proven deployment

- Current live version: `v761`
- Current deployed SHA: `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2`
- Deployment environment: GitHub Pages (`github-pages`)
- Deployment ref: `main`
- Latest Pages deployment run: `pages build and deployment`, SHA `82476d8`, conclusion `success`, updated `2026-07-26T03:50:08Z`
- Domain: `kalenel.nl`
- CNAME file: `kalenel.nl`

## Previous relevant SHAs

- `b1d6626db0bd50d48c570bcd178cf06dcf9f8bc2` — v758 cache-busted admin gate release.
- `f3e70b32968b99c2b1bd983e88fef77035f89b3c` — admin host/login repair before v758.
- `f296fbf3b57f8ec5ee457a34703907b04604103a` — v757 gates/session compatibility.

## Previous/current DNS snapshot

- Nameservers: `anton.ns.cloudflare.com`, `vida.ns.cloudflare.com`
- Apex A: `188.114.96.0`, `188.114.97.0`
- Apex AAAA: `2a06:98c1:3121::`, `2a06:98c1:3120::`
- `www.kalenel.nl`: Cloudflare edge, redirects to apex
- `admin.kalenel.nl`: no A/AAAA/CNAME at investigation time

## Current live hashes

| Path | SHA256 |
|---|---|
| `/VERSION` | `3000d470d1030147114706b173230f35f4f877e30b4ecb3b6078f1daeaf6ab32` |
| `/index.html` | `3f929ee84bd2ec3db26adfe4f1dc7fbe81cb3532123ae4b93ef8d95ab0b5fda4` |
| `/boerenbridge_vault.html` | `a94afe9b773b68d0057c1fd4185436cd5f261f168a3ebe73d0385e3051c6378d` |
| `/toepen.html` | `45d055324a2ec6f1b3068f016b87e9edb7a27d51af9d281ffe6b8e34d9b6a72a` |
| `/gejast-config.js?v761` | `1df9b4d003c911e0748ebe88f91ce9b3fc0a4e0e7ea8ce2f928d2896828fec8d` |
| `/admin-session-sync.js?v761` | `66e94b89c26a02acaa881db5d2d9c6068455a123ccc41309881667dc6c8b08f6` |
| `/admin-gate-v105.js?v761` | `17d9414020aef60aaa5f5be8fa6f139bcee1b4e757267204675002ec5bb1f046` |

## Recovery branch / evidence branch

- Evidence branch: `agent/v761-deployment-proof`
- Created from: `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2`

## Rollback commands

Prefer rollback by revert, not force-push, unless GitHub Pages itself is broken.

### Safe revert of post-v758 commits

From a clean worktree:

```bash
git fetch origin
git switch -c rollback/v758-from-v761 origin/main
git revert --no-edit 82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2 dc0d44a0c698ca090ffd3643c2b85bd93c5a2543 8656bf633576bbbea77fbde6972250a1ba4a9be6
npm run verify
npm run verify:klaverjas
git push origin rollback/v758-from-v761
```

Then open/merge a PR to `main`. After Pages deploys, verify `/VERSION`, `/index.html`, `/boerenbridge_vault.html`, `/toepen.html`, and key JS hashes.

### Emergency hard reset path

Only if normal revert is impossible and Bruis explicitly approves a destructive history rewrite:

```bash
git fetch origin
git switch main
git reset --hard b1d6626db0bd50d48c570bcd178cf06dcf9f8bc2
git push --force-with-lease origin main
```

This is not recommended because it rewrites public history and may discard the v759-v761 fixes.

## Rollback risks

Rolling back from `v761` to `v758` would remove:

- player-session token validation hardening for timestamps, visitor IDs, and short opaque IDs;
- push runtime cache-busting updates;
- final live diagnostic fixes from v759-v761.

Rollback may reintroduce Kalenel push/session false positives where invalid local storage is treated as a player session. Prefer a forward fix unless the v761 code itself is proven harmful.

## Recovery evidence files

Evidence bundle retained under `deployment_forensics_v761/`, including raw live bodies, GitHub API JSON, DNS snapshot, and homepage screenshot.
