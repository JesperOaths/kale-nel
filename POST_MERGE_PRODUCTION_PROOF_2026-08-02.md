# Post-merge production proof - 2026-08-02

Scope: narrow verification after PR #3 merge into `main`.

## Repository and deployment

- Local repo fetched and switched to `main`.
- `HEAD` = `origin/main` = `5b1fe57610b14c3412bc3dc68b38d53524d0d2f1`.
- Initial working tree was clean before this proof file was written.
- GitHub Actions main deployment inspected via public API:
  - `pages build and deployment` for `5b1fe57610b14c3412bc3dc68b38d53524d0d2f1`: completed / success.
  - `GEJAST verification` for the same SHA: completed / success.
- Cloudflare Worker was not redeployed or modified.
- `wrangler deployments list` shows the current/latest admin Worker deployment remains `79e680cd-4baf-433f-8310-da2d1f1c2b9c`.

## Passing production checks

- Live `/VERSION`: `v761`.
- Browser proof: public pages show `v761 - Made by Bruis`; approved GitHub OAuth reaches the existing Supabase/TOTP inner lock on `admin.kalenel.nl/admin.html`, where the page shows `v762 - Made by Bruis` and the username/password/TOTP fields.
- Public route smoke passed:
  - `/`, `/index.html`, `/home.html`, `/login.html`, `/request.html`, `/activate.html`
  - `/klaverjas_online.html`, `/klaverjas_room.html`, `/klaverjas_live.html`
  - `/toepen.html`, `/boerenbridge.html`, `/boerenbridge_live.html`, `/drinks.html`
- Homepage/game-selection static check passed: `/index.html` exposes game links for drinks, toepen, klaverjas, boerenbridge, beerpong, rad, paardenrace, and pikken.
- Admin/public perimeter smoke passed, 20/20:
  - `kalenel.nl/admin.html` redirects to `https://admin.kalenel.nl/admin.html`.
  - `admin.kalenel.nl/admin.html` requires GitHub OAuth when unauthenticated.
  - GitHub OAuth start, mismatch denial, and tampered-session denial all passed.
  - public admin/vault/proof/sql assets redirect to the protected admin host instead of serving directly.
- Standard verification suite passed: `npm run verify`.

## Blocking check

- **Ice units did not pass the requested invariant.** Non-destructive live Supabase REST read of public drink type data returned `drink_event_types` row `key=ice`, `label=Ice`, `unit_value=3.0`.
- Expected by the post-merge checklist / repo handoff: Ice remains exactly `2.8` units.
- The PR merge diff from previous branch head `de58795c4f9420fca1c76bba22a0a492c793bb92` to merge commit `5b1fe57610b14c3412bc3dc68b38d53524d0d2f1` did not change Ice/unit-value files, so this looks like live data drift rather than a code regression from the merge.

## Verdict

Production-completion cannot be marked closed yet because the Ice `2.8` invariant failed. No Worker changes were made.
