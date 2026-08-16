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

console.log('PASS v801 full visual audit current-session/context contract');
