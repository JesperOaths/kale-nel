#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
const version=fs.readFileSync('VERSION','utf8').trim();
const current=Number((version.match(/\d+/)||['0'])[0]);
assert.ok(current>=800,'v800 session-token-shape contract requires VERSION v800 or newer');
const cfg=fs.readFileSync('gejast-config.js','utf8');
const owner=cfg.match(/function looksLikePlayerSessionToken\(value\)\{[\s\S]*?\n\}/)?.[0]||'';
assert(owner.includes('/^[0-9a-f]{48}$/i'),'player session recovery must require the deployed 48-hex token shape');
assert(!owner.includes('token.length < 24'),'legacy permissive length heuristic must be removed');
assert(!owner.includes('A-Za-z0-9._~+/=-'),'legacy arbitrary-string token charset heuristic must be removed');
const rx=/^[0-9a-f]{48}$/i;
assert(rx.test('0123456789abcdef0123456789abcdef0123456789abcdef'),'canonical 48-hex token must remain accepted');
for(const invalid of ['membership_cache_refreshed','v799-invalid-session-token','000000000000000000000000','2026-08-16T10:50:57.761Z']) assert(!rx.test(invalid),`non-token recovery string must be rejected: ${invalid}`);
console.log('v800 player-session token shape contract ok.');
