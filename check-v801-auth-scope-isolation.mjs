#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
const version=fs.readFileSync('VERSION','utf8').trim();
assert.ok(Number((version.match(/\d+/)||['0'])[0])>=801,'v801 scope isolation requires VERSION v801+');
const gate=fs.readFileSync('gejast-auth-gate.js','utf8');
assert(gate.includes("responseScope===requestedScope()"),'auth gate must compare validated session scope to requested page scope');
assert(gate.includes("data&&data.ok===true&&responseScope===requestedScope()"),'ok=true alone must not reveal protected pages');
assert(gate.includes("site_scope_input:requestedScope()"),'auth RPC must still receive requested scope');
console.log('v801 auth scope isolation contract ok.');
