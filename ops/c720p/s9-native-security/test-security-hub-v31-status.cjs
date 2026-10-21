#!/usr/bin/env node
'use strict';
// Validation-only tests for the inactive V31 System Status candidate.
// No network calls, token handling, camera or production writes.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const path=require('node:path');

const candidate=fs.readFileSync(path.join(__dirname,'security-hub-v31.js'),'utf8');
const old='CRITICAL: Root filesystem full (0 MiB available)';
const funcs=candidate.match(/ function storageAlert\(i\)\{[\s\S]*?\n \}/g)||[];
assert.equal(funcs.length,1,'Only one storage alert handler');
const storageAlert=vm.runInNewContext('('+funcs[0].trim()+')');
const base={root_available_bytes:900*1048576,root_total_bytes:21*1073741824,status:'current'};
assert.match(storageAlert({...base,root_available_bytes:0}),/^CRITICAL: Root filesystem full \(0 MiB available\); media work must be deferred$/);
assert.match(storageAlert({...base,root_available_bytes:0,status:'stale'}),/Last report.*current status unverified/);
assert.match(storageAlert({...base,root_available_bytes:null}),/unavailable/);
assert.match(storageAlert({...base,root_total_bytes:null}),/unavailable/);
assert.match(storageAlert(base),/low/);
assert.equal(storageAlert({...base,root_available_bytes:4*1073741824}),null);
assert.match(storageAlert({...base,root_available_bytes:4*1073741824,status:'stale'}),/current status unverified/);
assert.match(candidate,/if\(i\.ntp_synchronized===null\)warnings\.push\('Clock synchronization unknown'\)/);
assert.match(candidate,/i\.original_digest_mismatches===null\)warnings\.push\('Original integrity evidence unavailable'\)/);
assert.match(candidate,/Last reported/);
assert.ok(candidate.includes("(data.aggregate_stale?'Last reported: ':'')+m.without_reported_binding"));
assert.match(candidate,/const api=\(\)=>window\.C720PSecureRelay/);
assert.match(candidate,/Per-record blocked reasons\/revocations unavailable/);
assert.doesNotMatch(candidate,/document\.cookie\s*=/);
console.log('V31_STORAGE_STALE_UNKNOWN_REGRESSIONS_PASS 12');
