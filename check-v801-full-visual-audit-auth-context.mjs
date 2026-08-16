#!/usr/bin/env node
import fs from 'node:fs';
import assert from 'node:assert/strict';

const workflow = fs.readFileSync('.github/workflows/full-live-visual-audit-v792.yml', 'utf8');
const runner = fs.readFileSync('scripts/full-live-visual-audit-v792.mjs', 'utf8');

assert.match(workflow, /account_login_v687\(:'name1',\s*:'pin1',\s*'friends'/, 'visual audit must provision Friends token 1 through current login contract');
assert.match(workflow, /account_login_v687\(:'name2',\s*:'pin2',\s*'friends'/, 'visual audit must provision Friends token 2 through current login contract');
assert.match(workflow, /account_login_v687\(:'family_name',\s*:'family_pin',\s*'family'/, 'visual audit must provision a current Family session');
assert.match(workflow, /\^\[0-9a-f\]\{48\}\$/, 'visual audit must reject non-canonical session-token shapes');
assert.doesNotMatch(workflow, /v793-visual-|insert into public\.gejast_account_sessions_v671|insert into public\.gejast_account_players_v671/i, 'legacy visual-audit session fabrication must not return');
assert.match(workflow, /delete from public\.gejast_player_sessions_v746/, 'visual audit must clean current player sessions');
assert.match(workflow, /Visual-audit cleanup PASS with zero residue/, 'visual audit must retain explicit cleanup success marker');
assert.match(workflow, /DB_RETRY_ATTEMPTS=4/, 'visual audit DB access must use a bounded retry budget');
assert.match(workflow, /\.pooler\.supabase\.com:5432\//, 'visual audit must recognize the shared Supavisor session-pooler URL');
assert.match(workflow, /VISUAL_AUDIT_DB_URL=.*:6543\//, 'ephemeral GitHub audit DB access must prefer Supavisor transaction mode');
assert.match(workflow, /retry_psql_file 'visual-audit fixture provision'/, 'fixture provisioning must retry transient database checkout failures');
assert.match(workflow, /retry_psql_capture 'visual-audit session login'/, 'session provisioning must retry transient database checkout failures');
assert.match(workflow, /retry_psql_file 'visual-audit cleanup'/, 'cleanup must retry transient database checkout failures');
assert.match(workflow, /retry_psql_capture 'visual-audit residue check'/, 'cleanup residue verification must retry transient database checkout failures');
assert.match(workflow, /delete from public\.players[\s\S]*is_dummy=true and hidden_from_public=true;[\s\S]*insert into public\.players/, 'fixture provisioning retries must be idempotent for the exact disposable identities');

assert.match(runner, /GEJAST_FAMILY_TOKEN/, 'runner must require Family auth context');
assert.match(runner, /for \(const store of \[localStorage, sessionStorage\]\)/, 'runner must seed current session into both browser stores');
assert.match(runner, /contextual authenticated capture ended at login/, 'context captures must fail if redirected to login');
assert.match(runner, /authState !== 'authenticated'/, 'context captures must require authenticated auth state');
assert.match(runner, /context__index__authenticated/, 'authenticated main page must be visually captured');
assert.match(runner, /context__family__index/, 'authenticated Family main page must be visually captured');
assert.match(runner, /const familyRoute = htmlPath === 'familie\.html' \|\| htmlPath\.startsWith\('familie\/'\)/, 'tracked Family pages must use Family sessions');
assert.match(runner, /const context = await newContext\(browser, familyRoute \? familyToken : token1/, 'tracked captures must isolate scope-correct sessions');
assert.match(runner, /finally \{ await context\.close\(\); \}/, 'per-route contexts must be closed to prevent storage poisoning');
assert.doesNotMatch(runner, /const context = await newContext\(browser\);\s*try \{\s*let index = 0;/s, 'single shared authenticated context must not return');

assert.match(runner, /GEJAST_VISUAL_PROFILE_TARGET \|\| 'Antoni'/, 'context profile capture must use a visible profile target rather than the hidden audit identity');
assert.doesNotMatch(runner, /context__pikken__lobby/, 'invalid Pikken game_id lobby variant must not return');
assert.match(runner, /process\.exitCode = 1/, 'visual audit must fail the workflow when broken pages are recorded');
assert.match(runner, /FULL_LIVE_VISUAL_AUDIT_FAIL broken=/, 'visual audit must expose an explicit broken-page failure marker');
assert.match(runner, /trackedRouteUsesAuthGate/, 'tracked routes that load the auth gate must be identified from checked-in HTML');
assert.match(runner, /waitForAuthGateToSettle/, 'visual audit must explicitly wait for gated pages to leave transient checking state');
assert.match(runner, /auth gate did not settle within/, 'a genuinely stuck auth gate must remain a fail-closed broken result');
assert.match(runner, /if \(!protectedOnArrival\) \{\s*authGate = await waitForAuthGateToSettle/s, 'Cloudflare-protected admin responses must bypass player-auth settlement waiting');
assert.match(runner, /seriousConsole\.length && judgement !== 'broken' && judgement !== 'protected'/, 'expected Cloudflare protection must not be downgraded to warning by perimeter console noise');

console.log('PASS v801 full visual audit current-session/context contract');
