# LIVE_DEPLOYMENT_PROOF_v758

Proof timestamp: 2026-07-26 06:15-06:21 Europe/Amsterdam.

Despite the requested filename, the proven live release is **v761**, not v758. I am intentionally not writing "v758 is live" because the evidence proves `v761` is live.

## Deployed identity

- Live `/VERSION`: `v761`
- GitHub `main`: `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2`
- GitHub Pages deployment: `github-pages`, ref `main`, SHA `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2`, success
- CI: `GEJAST verification`, SHA `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2`, success

## File hash proof

Hashes below compare live `https://kalenel.nl/...` responses to `git show HEAD:<file>` from `82476d8`.

| Route | Live bytes | SHA256 | Git HEAD match |
|---|---:|---|---|
| `/VERSION` | 5 | `3000d470d1030147114706b173230f35f4f877e30b4ecb3b6078f1daeaf6ab32` | yes |
| `/index.html` | 111647 | `3f929ee84bd2ec3db26adfe4f1dc7fbe81cb3532123ae4b93ef8d95ab0b5fda4` | yes |
| `/boerenbridge_vault.html` | 8741 | `a94afe9b773b68d0057c1fd4185436cd5f261f168a3ebe73d0385e3051c6378d` | yes |
| `/toepen.html` | 18654 | `45d055324a2ec6f1b3068f016b87e9edb7a27d51af9d281ffe6b8e34d9b6a72a` | yes |
| `/gejast-config.js?v761` | 36720 | `1df9b4d003c911e0748ebe88f91ce9b3fc0a4e0e7ea8ce2f928d2896828fec8d` | yes |
| `/admin-session-sync.js?v761` | 7335 | `66e94b89c26a02acaa881db5d2d9c6068455a123ccc41309881667dc6c8b08f6` | yes |
| `/admin-gate-v105.js?v761` | 5975 | `17d9414020aef60aaa5f5be8fa6f139bcee1b4e757267204675002ec5bb1f046` | yes |

Normal, no-cache, and unique query-string requests returned stable bodies for the core HTML routes.

## Response/header proof

Representative live headers showed:

- `Server: cloudflare`
- `CF-RAY: ...-AMS`
- `x-github-request-id: ...`
- `Via: 1.1 varnish`
- `x-served-by: cache-rtm...`
- `Last-Modified: Sun, 26 Jul 2026 03:50:03 GMT`
- HTML/VERSION `Cache-Control: max-age=600`
- JS `Cache-Control: max-age=14400`

This proves Cloudflare is in front of GitHub Pages/Fastly, not a separate unknown host.

## Homepage visible/browser proof

Browser loaded `https://kalenel.nl/?openclaw_forensics_v761=1`.

Observed:

- visible watermark: `v761 Made by Bruis`
- `window.GEJAST_CONFIG.VERSION`: `v761`
- no mixed old script query tags matching `v750`-`v757`
- active service worker: `https://kalenel.nl/gejast-sw.js?v761`
- Cache Storage keys: `[]`
- public admin link still points to `./admin.html`

Visible feature checks:

| Requirement | Result |
|---|---|
| Stand-by, not Live-ready | source contains `Stand-by` 3x and `Live-ready` 0x; browser text did not show either in current visible loaded state |
| native Toepen card | visible as `Toepen scorer` |
| Klaverjas Online | visible as `Klaverjas online` |
| Paardenrace | visible |
| Pikken | visible |
| Beurs d'Espinoza | visible |
| Ballroom | visible as localized `Balzaal` |
| speed-ranking route | `./drinks_speed.html` visible as `SNELHEIDS POGING +` |
| public Admin link | visible as `ADMIN` -> `./admin.html` |
| mixed old JS | none detected |

Screenshot evidence:

- `deployment_forensics_v761/homepage_v761.png`
- tool-saved media copy: `C:\Users\jespe\.openclaw\media\outbound\0bc4bd4e-e5be-45d3-b985-bd0cc7faab84---3bab6396-4747-47a0-915d-e96cfe96aa24.jpg`

## Boerenbridge proof

- `/boerenbridge_vault.html` live hash matches Git HEAD.
- Live file contains `GEJAST_CONFIG`, `database`, `admin`, and `boerenbridge` markers.
- Live file does not contain old-wrapper markers checked as `wrapper` / `oude`.

Authenticated admin data loading was not proven in this pass because that requires a valid admin session. Public unauthorized exposure remains an audit item below.

## Toepen proof

- `/toepen.html` live hash matches Git HEAD.
- Homepage visible route/card exists as `Toepen scorer`.
- Static Toepen checks passed earlier in CI/local gates for `82476d8` (`check-toepen.mjs`, `check-toepen-engine.mjs` via `npm run verify`).

## Cache/service-worker proof

- Existing browser profile loaded `v761` scripts.
- Active service worker script URL is `gejast-sw.js?v761`.
- `caches.keys()` returned `[]`.
- The service worker contains push-notification handlers and `skipWaiting()` / `clients.claim()`; it does not cache navigation HTML or populate Cache Storage.
- Fresh origin requests, query-busted requests, and no-cache requests match.

Offline revisit is not supported by the current service worker because no offline cache is implemented. This is safer than a stale cache, but it means there is no offline homepage guarantee to verify.

## CI / smoke status already run for v761

Passed before this proof document:

- GitHub Actions `GEJAST verification`: success for `82476d8`
- local `npm run verify`: pass
- local `npm run verify:klaverjas`: pass
- live `npm run smoke:live` with expected `v761`: pass
- live `npm run smoke:push`: pass
- live `npm run smoke:games`: pass
- live `npm run smoke:beta:read`: pass
- live `npm run smoke:beta:extended`: pass
- live `npm run smoke:beta:perf`: pass

## Remaining caveats

- `admin.kalenel.nl` DNS does not resolve; admin pages are still publicly reachable at the main host and must rely on frontend/backend session gates.
- Full backend push delivery still requires a valid logged-in player/device subscription and/or real device action proof.
- Authenticated Boerenbridge admin vault data loading was not proven in this pass.
- Some labels are localized (`Balzaal` instead of `Ballroom`, `Klaverjas online` with lowercase `online`), but routes/cards exist.

## Evidence paths

- `DEPLOYMENT_DRIFT_DIAGNOSIS_v758.md`
- `RECOVERY_DEPLOYMENT_v758.md`
- `deployment_forensics_v761/`
