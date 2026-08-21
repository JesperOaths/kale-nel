#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import worker from './cloudflare/workers/admin-gate/src/worker.js';

const source=fs.readFileSync('cloudflare/workers/admin-gate/src/worker.js','utf8');
assert.match(source,/async function handlePublicApex\(request, env, url\)/);
assert.match(source,/if \(isSecurityPath\(url\.pathname\)\) return await handlePublicSecurity\(request, env, url\)/);
assert.match(source,/return withPublicSecurityHeaders\(response\)/);
const helperStart=source.indexOf('function applyPublicSecurityHeaders(headers)');
const helperEnd=source.indexOf('function secureHeaders(',helperStart);
assert.ok(helperStart>=0 && helperEnd>helperStart,'public security helper bounds missing');
const publicHelper=source.slice(helperStart,helperEnd);
assert.match(publicHelper,/X-Content-Type-Options', 'nosniff'/);
assert.match(publicHelper,/Referrer-Policy', 'strict-origin-when-cross-origin'/);
assert.match(publicHelper,/X-Frame-Options', 'SAMEORIGIN'/);
assert.match(publicHelper,/Permissions-Policy', 'camera=\(\), microphone=\(\), payment=\(\)'/);
assert.doesNotMatch(publicHelper,/geolocation=\(\)/);
assert.doesNotMatch(publicHelper,/Content-Security-Policy/);
assert.doesNotMatch(publicHelper,/Strict-Transport-Security/);

const originalFetch=globalThis.fetch;
globalThis.fetch=async ()=>new Response('<!doctype html><title>Public test</title>',{status:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'max-age=600','X-Origin-Proof':'kept'}});
try {
  const response=await worker.fetch(new Request('https://kalenel.nl/home.html'),{},{});
  assert.equal(response.status,200);
  assert.equal(response.headers.get('Content-Type'),'text/html; charset=utf-8');
  assert.equal(response.headers.get('Cache-Control'),'max-age=600');
  assert.equal(response.headers.get('X-Origin-Proof'),'kept');
  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');
  assert.equal(response.headers.get('Referrer-Policy'),'strict-origin-when-cross-origin');
  assert.equal(response.headers.get('X-Frame-Options'),'SAMEORIGIN');
  assert.equal(response.headers.get('Permissions-Policy'),'camera=(), microphone=(), payment=()');
  assert.equal(response.headers.get('Content-Security-Policy'),null);
  assert.equal(response.headers.get('Strict-Transport-Security'),null);
  assert.match(await response.text(),/Public test/);
} finally { globalThis.fetch=originalFetch; }

const protectedRedirect=await worker.fetch(new Request('https://kalenel.nl/admin.html',{redirect:'manual'}),{},{});
assert.equal(protectedRedirect.status,302);
assert.equal(protectedRedirect.headers.get('Location'),'https://admin.kalenel.nl/admin.html');
assert.equal(protectedRedirect.headers.get('Cache-Control'),'no-store');
assert.equal(protectedRedirect.headers.get('X-Content-Type-Options'),'nosniff');
assert.equal(protectedRedirect.headers.get('Referrer-Policy'),'no-referrer');
assert.equal(protectedRedirect.headers.get('X-Frame-Options'),'DENY');
assert.equal(protectedRedirect.headers.get('Permissions-Policy'),'camera=(), microphone=(), geolocation=(), payment=()');
assert.match(protectedRedirect.headers.get('Content-Security-Policy')||'',/frame-ancestors 'none'/);

const adminTest=fs.readFileSync('scripts/test-admin-worker-gate.mjs','utf8');
assert.match(adminTest,/const FRONTEND_VERSION = fs.readFileSync/);
assert.doesNotMatch(adminTest,/GEJAST_PAGE_VERSION=\\'v762/);
console.log('v775b public edge header regression PASS: ordinary public responses get the compatible baseline, the security viewer is routed through its dedicated perimeter, protected paths retain the strict admin policy, and the admin fixture follows root VERSION.');
