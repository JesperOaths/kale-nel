# GEJAST v688 Login Dropdown Hotfix

This bundle fixes the first login blocker where `login.html` showed:

`Geen actieve loginspelers gevonden...`

## What Changed

- `login.html`
  - Bumped to `v688`.
  - Loads `gejast-login-names-fallback.js` before `gejast-account-runtime.js`.
  - Uses fresh cache-busters so old immutable browser/CDN assets do not keep the broken login runtime alive.

- `gejast-account-runtime.js`
  - Runtime version bumped to `v688`.
  - Removes the five duplicate calls to `get_login_active_names_v687`.
  - Calls one fast `get_login_active_names_v687` request first.
  - Falls back to `get_player_selector_source_v1`.
  - Parses `activated_names` from the selector RPC.
  - Falls back to shared config/fallback loaders before showing an empty dropdown.
  - Replaces the hostile empty message with a clearer deployment/setup message.

- `gejast-config.js`
  - Root browser runtime version bumped to `v688`.

- `VERSION`
  - Root version bumped to `v688`.

- `GEJAST_v688_login_dropdown_complete.sql`
  - Standalone SQL bundle.
  - Includes the canonical player selector source from `player_selector_source.sql`.
  - Adds the `get_login_active_names_v687(site_scope_input text)` compatibility RPC expected by the browser.

## Upload / Deploy Order

1. Upload the changed site files to GitHub:
   - `VERSION`
   - `login.html`
   - `gejast-config.js`
   - `gejast-account-runtime.js`
   - `gejast-login-names-fallback.js`

2. Run this SQL in Supabase SQL editor:
   - `GEJAST_v688_login_dropdown_complete.sql`

3. Hard refresh `login.html`.

4. Confirm:
   - the login page loads `?v688` assets;
   - the dropdown fills with activated login names;
   - the old `Geen actieve loginspelers gevonden... requestable/familie/scope-only...` message no longer appears during normal successful loading.

## Important

This hotfix keeps requestable names out of the login dropdown. Users without an active login/PIN should still go through `request.html` / admin activation.
