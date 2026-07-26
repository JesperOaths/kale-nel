# RECOVERY — Kalenel v761 production completion

Created: 2026-07-26 Europe/Amsterdam.

## Known-good baseline

- Production frontend version: `v761`.
- Known-good production commit: `82476d8ae87fa9b41cd7a53e6aab42a3a32baaa2`.
- Local rollback tag: `pre-v761-production-completion-20260726`.
- Evidence branch before this work: `origin/agent/v761-deployment-proof` at `4db893d7217844fb6a8b49cb2a74538380048d25`.

## Frontend rollback

No frontend change should be made without a new monotonic release. If a frontend change is later made and must be reverted, prefer a normal revert PR:

```bash
git fetch origin
git switch -c rollback/v761-production-completion origin/main
git revert <bad_frontend_commit_sha>
npm run verify
npm run verify:klaverjas
git push origin rollback/v761-production-completion
```

Do not force-push `main` unless Bruis explicitly authorises an emergency history rewrite.

## SQL rollback / forward-fix posture

`GEJAST_v755_toepen_backend.sql` is additive: it creates Toepen-only tables/RPCs and does not alter Klaverjas, drinks, Boerenbridge, or account tables.

Preferred recovery if Toepen SQL apply partially fails:

1. Stop further writes.
2. Capture exact error and schema state.
3. Re-run a transaction-safe forward-fix migration that either completes missing Toepen objects or disables broken RPCs.
4. Do not drop production tables containing non-test data unless confirmed empty and explicitly approved.

If the migration was applied and controlled Toepen test rows must be cleaned:

- Delete only rows whose `client_match_id` uses the controlled beta prefix recorded in the test report.
- Rely on `toepen_games` cascade to remove participant/round/result rows for those controlled test game IDs.
- Never delete unrelated Toepen rows.

## Admin perimeter recovery

If admin split/Access preparation breaks navigation:

1. Restore public site from known-good `v761` commit.
2. Keep Supabase admin session/TOTP gates active.
3. Disable only the new admin-host redirect/split commit via normal revert.
4. Preserve Cloudflare Access default-deny if it was successfully configured.

## Push recovery

If real-device push creates stale/failing subscriptions:

- Mark only the controlled test subscription/job as failed/disabled using existing backend functions or documented SQL.
- Do not log or publish subscription endpoint/key material.

## Evidence to retain

- SQL apply transcript or screenshot.
- Schema/function/grant/RLS verification output.
- Controlled test IDs and cleanup output.
- CI command output.
