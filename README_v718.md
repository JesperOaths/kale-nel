# GEJAST v718 lobby loop / start guard repair

This is a repair-first update on top of v717.

## Frontend files in this zip

- `VERSION` -> v718
- `gejast-v718-repair.js`
- `apply_v718_patch.mjs`
- `README_v718.md`

## SQL file is separate

Run the separately supplied file:

`GEJAST_v718_lobby_loop_cleanup_start_guards.sql`

Do **not** put this SQL in the GitHub upload zip if following the project packaging rule that SQL is delivered separately.

## Apply steps

1. Copy `gejast-v718-repair.js` into the repo root.
2. Copy/replace `VERSION` in the repo root.
3. Run:
   `node apply_v718_patch.mjs /path/to/kale-nel-main`
4. Upload/commit changed frontend files.
5. Run `GEJAST_v718_lobby_loop_cleanup_start_guards.sql` in Supabase after v709, v716, v717, and v717a if used.
6. Hard refresh the site.

## What v718 fixes

- Paardenrace live URL double-encoding loop (`DESPINOZA%25201` / `DESPINOZA%201`) by normalizing room/live params and generating single-encoded URLs.
- Removes manual join-code inputs/buttons from Pikken and Paardenrace UI; joins happen through visible lobby cards only.
- Reinforces Despinoza N lobby naming in SQL for both Pikken and Paardenrace.
- Pikken start is guarded by host-only, 2+ players, all ready.
- Paardenrace start is guarded by host-only, 2+ players, all ready, 2+ distinct suits.
- Lobby/live lists refresh faster from the browser overlay.
- Dead/stale Pikken game IDs are cleared from localStorage so old closed/destroyed matches stop redirecting the lobby page to a non-active live match.
- Pikken dice selector change is wired to backend config save again.

## Honesty boundary

This package was source-inspected and JS syntax-checked. It still needs live Supabase/browser verification with two real accounts.
