# League deployment-plane verification

Use this checklist before claiming `/league/` live/source parity. It separates the static page from the League Edge Function so a green check in one plane is not treated as proof for the other.

## 1. Classify the diff before deployment

- Static plane changed when `league/index.html`, `league/app.js`, `league/styles.css`, or the static config they load changed.
- Backend/API plane changed when `supabase/functions/league-api-v1/**` changed. The current public frontend calls the Supabase function slot `/functions/v1/printify-gildan-diff-diag-v1`; `league-api-v1` is the source name and the reused diagnostic slot is an implementation detail documented in the function source.
- Tests/docs-only changes do not require production deployment, but live/source drift must still be recorded in `CURRENT_STATE.md`.

## 2. Static `/league/` plane

Before deploy:

1. Run the local public-page and contract checks that cover the changed surface:
   - `node scripts/check-league-public-page-smoke.mjs`
   - `node check-league-web-v1.mjs`
   - `node scripts/check-league-analysis-contract.mjs` when analysis rendering or semantics changed.
2. Inspect `league/index.html` for the intended asset query markers and keep `app.js`/`styles.css` references cache-busted when their content changed.
3. Confirm the diff does not reintroduce private Kalenel login gates, persisted Riot keys, or non-role-pure copy.

After deploy:

1. Fetch `https://kalenel.nl/league/` and verify HTTP 200, public workspace copy, and session-only Riot-key copy.
2. Verify the live HTML references the expected `/league/app.js?...` and `/league/styles.css?...` asset markers from the deployed source.
3. Fetch each referenced live asset and verify HTTP 200.
4. Run `KALENEL_LEAGUE_SMOKE_URL=1 node scripts/check-league-public-page-smoke.mjs` for the live static contract.
5. Open the live page in a browser when frontend behavior changed and verify it renders the public workspace without console errors.

## 3. `league-api-v1` / Supabase function plane

Before deploy:

1. Run the backend source check:
   - `deno check --node-modules-dir=auto supabase/functions/league-api-v1/index.ts`
2. Run the League web contract because the frontend and backend response shape are coupled:
   - `node check-league-web-v1.mjs`
3. Confirm the API diff keeps CORS limited to the documented origins, keeps `Cache-Control: no-store`, and does not log, persist, or expose Riot API keys.
4. Confirm anonymous public workspace limits remain bounded for profiles, match cache, fetch runs, analyses, and deep timeline batches.

After deploy:

1. Verify the live function's read-only `GET` health response through the deployed Supabase slot returns JSON with `ok: true`, `mode: "league-api-v1"`, `internal_slot: "retired-diagnostic-reuse"`, `requires_session: false`, and `public_workspace: true`.
2. If request/analysis behavior changed, run a read-only or throwaway-workspace smoke only when a valid Riot key can be supplied through the supported session/header flow without logging it. Do not paste or commit the key.
3. Re-open `/league/` and confirm the backend status pill reaches the expected ready/configuration state without browser errors.
4. Record the verified function deploy target and health evidence in `CURRENT_STATE.md`; do not claim backend parity from a static deploy alone.

## 4. Blocker wording

If deployment or verification is unavailable, leave the tested commit in source and state the exact plane that is unverified, for example: `static frontend changed but no authorized push/static deployment job was invoked or verified`, or `league-api-v1 source changed but the reused Supabase function slot health response was not verified after deploy`.
