# Kale Nel Phase 2 patch report — v630

## Scope
This patch implements the remaining frontend Phase 2 items on top of the Phase 1 base.

## Verified starting point
While inspecting the repo snapshot used for this patch, some Phase 2 items were already present in code:
- `profiles.html` already contained profile pictures, badge accordions, cache-first rendering, and a chunked render path.
- `beerpong.html` already contained the live win-probability bar above the result/info block and already used the shared activated-player helper before falling back to older RPCs.
- `scorer.html` already used the shared activated-player helper before falling back to older RPCs.

So this patch focuses on the Phase 2 gaps that were still open, and on hardening the profiles merge path so the existing profiles implementation is more reliable.

## Files changed
- `gejast-config.js`
- `VERSION`
- `bump-version.sh`
- `scripts/bump-version.sh`
- `profiles.html`
- `gejast-profile-source.js`
- `beerpong.html`
- `boerenbridge.html`
- `pikken.html`
- `gejast-pikken.js`
- `scorer.html`

## What changed

### 1. Version bump to v630
Frontend patch version bumped from v629 to v630.
- `gejast-config.js` version updated
- page script query versions updated in changed HTML files
- `VERSION` file updated to `630`
- bump helpers updated

### 2. Profiles page hardening
`profiles.html` already had the UI work for:
- active-player card grid
- uploaded profile pictures
- badge accordions
- cache-first rendering and chunked rendering

What was still missing was a stronger source helper layer that matched what the page was already trying to call.

Added to `gejast-profile-source.js`:
- `fetchActivatedPlayers(scope)`
- `fetchLoginNamesPlayers(scope)`
- `mergeProfilePlayers(bundlePlayers, allPlayers, activatedPlayers, loginNamePlayers)`

Why:
- `profiles.html` already attempted to call these helpers if they existed.
- Before this patch they did not exist in the source module, so the page silently fell back to a simpler merge path.
- This patch makes the page’s intended merge path real instead of implicit.

Result:
- stronger merge coverage for active users
- profile page continues to use uploaded profile pictures and badge accordions already present in the page code

### 3. Shared player-dropdown behavior
The shared helper introduced in Phase 1 remains the canonical source:
- `getActivatedPlayerNamesForScope(scope)`
- `fetchScopedActivePlayerNames(scope)`

In the inspected repo snapshot:
- `beerpong.html` already used it
- `boerenbridge.html` already used it
- `scorer.html` already used it

This patch keeps that path and bumps the changed pages to the new version.

### 4. Boerenbridge win-probability box
Implemented a new wide odds box in `boerenbridge.html` in the same summary row as:
- Ronde
- Deler
- Spelers
- Status

What was added:
- new `odds-box` / `odds-grid` / `odds-row` UI
- a `boerenbridgeOddsGrid` container
- frontend ladder-rating fetch through the public ladder RPC
- probability rendering based on current player selection and current known Boerenbridge ELO

Behavior:
- before enough players are chosen: explanatory placeholder
- once players are chosen: one row per player with probability + ELO
- recalculates on table/setup renders
- refreshes once ladder ratings finish loading

Implementation note:
- this is a frontend-only probability estimate based on current Boerenbridge ELO distribution
- no SQL was added in this phase

### 5. Pikken lobby win-probability display
Implemented a new probability box in `pikken.html` / `gejast-pikken.js`.

What was added:
- `pkWinProbBar` UI block under match summary in the active-table panel
- frontend rating fetch using available Pikken ladder/stats RPCs
- `renderWinProbability(game, players)`

Behavior:
- no active lobby / too few players: explanatory placeholder
- active lobby or match with enough participants: one line per player with estimated win chance + ELO
- re-renders whenever state re-renders

Implementation note:
- this is also frontend-only and uses currently available ladder/stat reads
- no backend changes were made

## Why these choices
- I did not remove or replace existing features.
- Where code already existed and matched the requested Phase 2 behavior, I kept it and hardened the missing pieces around it.
- I kept this phase frontend-only, consistent with the earlier Phase 2 plan.

## SQL
No SQL file is needed for this Phase 2 patch.

## Upload order
1. Upload the Phase 1 patch first if you have not already done so.
2. Upload this Phase 2 patch after that.

## Expected visible outcomes
- profiles page keeps its faster cache-first render path and now has a stronger multi-source merge path for active users
- beerpong entry page remains on the live win-probability path
- boerenbridge now shows a wide odds box in the summary row
- pikken now shows lobby/player win probabilities in the active-table panel
- changed pages show v630
