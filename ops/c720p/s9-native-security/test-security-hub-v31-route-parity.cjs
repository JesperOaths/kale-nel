#!/usr/bin/env node
'use strict';
// Source parity gate: the V31 candidate may only alter health presentation.
// No network, UI deployment or camera interaction.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=__dirname;
const prod=fs.readFileSync(path.join(root,'security-hub-v30.js'),'utf8');
const candidate=fs.readFileSync(path.join(root,'security-hub-v31.js'),'utf8');
const prefix=' const nonnegative=x=>';
const suffix=' const observer=new MutationObserver(refresh)';
assert.equal(prod.split(prefix).length,2,'V30 stable safety boundary');
assert.equal(candidate.split(prefix).length,2,'V31 safety boundary');
assert.equal(prod.slice(0,prod.indexOf(prefix)),candidate.slice(0,candidate.indexOf(prefix)),
             'Navigation, player close, camera controls, and relay access must match production');
assert.equal(prod.split(suffix).length,2,'V30 observer');
assert.equal(candidate.split(suffix).length,2,'V31 observer');
assert.equal(prod.slice(prod.indexOf(suffix)),candidate.slice(candidate.indexOf(suffix)),
             'Hidden-page polling, return-to-page and relay recovery behavior must remain untouched');
assert.match(candidate,/security-people-v50\.html/);
assert.match(candidate,/function stopMedia\(/);
assert.match(candidate,/const api=\(\)=>window\.C720PSecureRelay/);
assert.doesNotMatch(candidate,/\.src\s*=\s*['"]http:\/\/192\.168\./);
console.log('V31_PRODUCTION_NAV_RELAY_POLLING_PARITY_PASS 9');
