# DEPLOYMENT_DRIFT_DIAGNOSIS_v758

Forensics timestamp: 2026-07-26 06:15-06:19 Europe/Amsterdam.

## Executive finding

The original `v758` live/GitHub mismatch is no longer present at the origin. The public site is now serving GitHub Pages deployment `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2` from `main`, release `v761`.

The most likely root cause of the observed mismatch was a stale observation window/cache state after `v758`, followed by later deployments (`v759`, `v760`, `v761`). Current live origin content, query-busted content, no-cache content, and browser-loaded scripts all agree with current GitHub `main`.

## Current repository state

- Repository: `JesperOaths/kale-nel`
- Default branch: `main`
- Current main SHA: `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2`
- Current repo `VERSION`: `v761`
- Local branch used for evidence work: `agent/v761-deployment-proof`, created from `82476d8`
- `CNAME`: `kalenel.nl`

Recent main commits:

1. `82476d8ae87f` — `fix: harden player session token validation`
2. `dc0d44a0c698` — `fix: reject visitor ids in player session detection`
3. `8656bf633576` — `fix: finalize v759 push session detection`
4. `b1d6626db0bd` — `fix: release v758 cache-busted admin gate`
5. `f3e70b32968b` — `fix: keep admin login on reachable host`

PR evidence:

- PR #2 merged at `2026-07-26T00:52:56Z`: `v755 stabilize homepage, games, admin host, and CI`.

## GitHub Pages / deployment source evidence

Public Pages config API returned 404, so the branch/folder setting itself was not directly readable through the unauthenticated API. Other public evidence is sufficient:

- Repo API reports `has_pages: true`.
- Deployments API latest deployment:
  - environment: `github-pages`
  - ref: `main`
  - SHA: `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2`
  - created: `2026-07-26T03:49:53Z`
- Latest generated Pages workflow:
  - name: `pages build and deployment`
  - path: `dynamic/pages/pages-build-deployment`
  - branch: `main`
  - SHA: `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2`
  - conclusion: `success`
  - updated: `2026-07-26T03:50:08Z`
- Latest CI workflow:
  - name: `GEJAST verification`
  - SHA: `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2`
  - conclusion: `success`

No checked-in workflow publishes a separate Pages artifact. Workflows present:

- `.github/workflows/verify.yml`
- `.github/workflows/web-push-dispatcher.yml`
- `.github/workflows/apply-repair-sql.yml`
- `.github/workflows/setup-beta-users.yml`

Conclusion: current site is deployed by GitHub's generated Pages build/deploy path from `main`, not by a stale custom artifact workflow.

## DNS / hosting evidence

Authoritative nameservers:

- `anton.ns.cloudflare.com`
- `vida.ns.cloudflare.com`

DNS records observed:

- `kalenel.nl` A: `188.114.96.0`, `188.114.97.0`
- `kalenel.nl` AAAA: `2a06:98c1:3121::`, `2a06:98c1:3120::`
- `www.kalenel.nl` A/AAAA resolves to the same Cloudflare edge range and redirects to apex.
- `admin.kalenel.nl` does not resolve.

TLS:

- `kalenel.nl` / `www.kalenel.nl` certificate subject `CN=kalenel.nl`
- issuer: Let's Encrypt `YE2`
- valid from `2026-07-21T03:12:59Z` to `2026-10-19T03:12:58Z`

Provider/header evidence:

- Edge: Cloudflare (`Server: cloudflare`, `CF-RAY: ...-AMS`)
- Origin path: GitHub Pages/Fastly (`x-github-request-id`, `via: 1.1 varnish`, `x-served-by: cache-rtm...`, `x-fastly-request-id`)
- HTML/VERSION cache: `Cache-Control: max-age=600`
- JS cache: `Cache-Control: max-age=14400`
- `Last-Modified`: `Sun, 26 Jul 2026 03:50:03 GMT`, matching the `82476d8` Pages deployment window.

Redirect notes:

- `http://kalenel.nl/` returns 200; no forced HTTP->HTTPS redirect observed.
- `https://kalenel.nl/` returns 200.
- `www` redirects to apex.
- `admin.kalenel.nl` unresolved.

## Live content comparison

The live files below match `git show HEAD:<file>` byte-for-byte at `82476d8`:

| File / URL | Git HEAD SHA256 | Live SHA256 | Result |
|---|---|---|---|
| `VERSION` / `/VERSION` | `3000d470d1030147114706b173230f35f4f877e30b4ecb3b6078f1daeaf6ab32` | `3000d470d1030147114706b173230f35f4f877e30b4ecb3b6078f1daeaf6ab32` | match |
| `index.html` / `/index.html` | `3f929ee84bd2ec3db26adfe4f1dc7fbe81cb3532123ae4b93ef8d95ab0b5fda4` | `3f929ee84bd2ec3db26adfe4f1dc7fbe81cb3532123ae4b93ef8d95ab0b5fda4` | match |
| `boerenbridge_vault.html` | `a94afe9b773b68d0057c1fd4185436cd5f261f168a3ebe73d0385e3051c6378d` | `a94afe9b773b68d0057c1fd4185436cd5f261f168a3ebe73d0385e3051c6378d` | match |
| `toepen.html` | `45d055324a2ec6f1b3068f016b87e9edb7a27d51af9d281ffe6b8e34d9b6a72a` | `45d055324a2ec6f1b3068f016b87e9edb7a27d51af9d281ffe6b8e34d9b6a72a` | match |
| `gejast-config.js` / `?v761` | `1df9b4d003c911e0748ebe88f91ce9b3fc0a4e0e7ea8ce2f928d2896828fec8d` | `1df9b4d003c911e0748ebe88f91ce9b3fc0a4e0e7ea8ce2f928d2896828fec8d` | match |
| `admin-session-sync.js` / `?v761` | `66e94b89c26a02acaa881db5d2d9c6068455a123ccc41309881667dc6c8b08f6` | `66e94b89c26a02acaa881db5d2d9c6068455a123ccc41309881667dc6c8b08f6` | match |
| `admin-gate-v105.js` / `?v761` | `17d9414020aef60aaa5f5be8fa6f139bcee1b4e757267204675002ec5bb1f046` | `17d9414020aef60aaa5f5be8fa6f139bcee1b4e757267204675002ec5bb1f046` | match |

Normal, query-string, and no-cache requests returned stable content for the checked routes.

## Service worker / cache diagnosis

Live browser state at `https://kalenel.nl/?openclaw_forensics_v761=1`:

- `window.GEJAST_CONFIG.VERSION`: `v761`
- service worker active script: `https://kalenel.nl/gejast-sw.js?v761`
- `caches.keys()`: `[]`
- homepage scripts use `?v761`
- mixed old scripts matching `v750`-`v757`: none detected

The current `gejast-sw.js` is a push-notification worker. It does not implement navigation caching, cache-first HTML handling, or named Cache Storage entries. Therefore it is not currently capable of permanently pinning old homepage HTML through Cache Storage. Old browser state can still show stale JS/HTML until refresh because Cloudflare/Fastly expose short origin TTLs and JS has long cache headers, but the release query tag bump to `v761` prevents mixed-version active assets.

## Root cause conclusion

Current evidence does **not** support a continuing wrong-branch, wrong-folder, stale-artifact, DNS-to-wrong-host, or service-worker-cache deployment drift.

The supported root cause for the earlier v758 mismatch is deployment/cache timing plus subsequent releases: the site was observed during or before GitHub Pages/Fastly/Cloudflare convergence, then `v759`/`v760`/`v761` were deployed. At the time of this diagnosis, live origin and current `main` agree byte-for-byte for the representative release-critical files.

## Evidence files

Evidence bundle: `deployment_forensics_v761/`

Key files:

- `deployment_forensics_v761/github-pages-api.json`
- `deployment_forensics_v761/dns.txt`
- `deployment_forensics_v761/live-fetches.json`
- `deployment_forensics_v761/curl_VERSION.body`
- `deployment_forensics_v761/curl_index.body`
- `deployment_forensics_v761/curl_boerenbridge_vault.body`
- `deployment_forensics_v761/curl_toepen.body`
- `deployment_forensics_v761/curl_gejast_config_v761.body`
- `deployment_forensics_v761/homepage_v761.png`
