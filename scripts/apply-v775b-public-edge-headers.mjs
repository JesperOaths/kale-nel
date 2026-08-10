#!/usr/bin/env node
import fs from 'node:fs';

const workerFile='cloudflare/workers/admin-gate/src/worker.js';
let worker=fs.readFileSync(workerFile,'utf8');
function replaceOnce(from,to,label){const count=worker.split(from).length-1;if(count!==1)throw new Error(`${label}: expected exactly 1 match, found ${count}`);worker=worker.replace(from,to);}
replaceOnce(
  'function handlePublicApex(request, url) {\n  if (!isSafePath(url.pathname)) return notFound();\n  if (!isProtectedPublicPath(url.pathname)) return fetch(request);',
  "async function handlePublicApex(request, url) {\n  if (!isSafePath(url.pathname)) return notFound();\n  if (!isProtectedPublicPath(url.pathname)) {\n    const response = await fetch(request);\n    return withPublicSecurityHeaders(response);\n  }",
  'public pass-through wrapper'
);
replaceOnce(
  'function secureHeaders(init = {}) { const headers = new Headers(init); applySecurityHeaders(headers); return headers; }',
  `function withPublicSecurityHeaders(response) {\n  const headers = new Headers(response.headers);\n  applyPublicSecurityHeaders(headers);\n  return new Response(response.body, { status: response.status, statusText: response.statusText, headers });\n}\nfunction applyPublicSecurityHeaders(headers) {\n  headers.set('X-Content-Type-Options', 'nosniff');\n  headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');\n  headers.set('X-Frame-Options', 'SAMEORIGIN');\n  headers.set('Permissions-Policy', 'camera=(), microphone=(), payment=()');\n}\n\nfunction secureHeaders(init = {}) { const headers = new Headers(init); applySecurityHeaders(headers); return headers; }`,
  'public security helper'
);
fs.writeFileSync(workerFile,worker,'utf8');

const testFile='scripts/test-admin-worker-gate.mjs';
let test=fs.readFileSync(testFile,'utf8');
function replaceTest(from,to,count,label){const found=test.split(from).length-1;if(found!==count)throw new Error(`${label}: expected ${count}, found ${found}`);test=test.split(from).join(to);}
replaceTest("import assert from 'node:assert/strict';\n", "import assert from 'node:assert/strict';\nimport fs from 'node:fs';\n", 1, 'test fs import');
replaceTest("import worker, { __test } from '../cloudflare/workers/admin-gate/src/worker.js';\n", "import worker, { __test } from '../cloudflare/workers/admin-gate/src/worker.js';\n\nconst FRONTEND_VERSION = fs.readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();\n", 1, 'frontend version source');
replaceTest("return new Response('<!doctype html><title>Beheerhub - Wordt er gejast?</title><script>window.GEJAST_PAGE_VERSION=\\'v762\\';</script><script src=\"./gejast-home-gate.js?v775\"></script><script src=\"./admin-session-sync.js?v775\"></script>', { status: 200, headers: { 'Content-Type': 'text/html' } });", "return new Response(`<!doctype html><title>Beheerhub - Wordt er gejast?</title><script>window.GEJAST_PAGE_VERSION='${FRONTEND_VERSION}';</script><script src=\"./gejast-home-gate.js?${FRONTEND_VERSION}\"></script><script src=\"./admin-session-sync.js?${FRONTEND_VERSION}\"></script>`, { status: 200, headers: { 'Content-Type': 'text/html' } });", 1, 'admin HTML fixture');
replaceTest("assert.match(approvedHtml, /GEJAST_PAGE_VERSION='v775'/);", "assert.ok(approvedHtml.includes(`GEJAST_PAGE_VERSION='${FRONTEND_VERSION}'`));", 1, 'approved page version assertion');
replaceTest("assert.match(approvedHtml, /gejast-home-gate\\.js\\?v775/);", "assert.ok(approvedHtml.includes(`gejast-home-gate.js?${FRONTEND_VERSION}`));", 1, 'home gate version assertion');
replaceTest("assert.match(approvedHtml, /admin-session-sync\\.js\\?v775/);", "assert.ok(approvedHtml.includes(`admin-session-sync.js?${FRONTEND_VERSION}`));", 1, 'session sync version assertion');
replaceTest("assert.match(adminAfterCallbackHtml, /GEJAST_PAGE_VERSION='v775'/);", "assert.ok(adminAfterCallbackHtml.includes(`GEJAST_PAGE_VERSION='${FRONTEND_VERSION}'`));", 1, 'callback page version assertion');
fs.writeFileSync(testFile,test,'utf8');

const guard=`#!/usr/bin/env node\nimport assert from 'node:assert/strict';\nimport fs from 'node:fs';\nimport worker from './cloudflare/workers/admin-gate/src/worker.js';\n\nconst source=fs.readFileSync('cloudflare/workers/admin-gate/src/worker.js','utf8');\nassert.match(source,/async function handlePublicApex\\(request, url\\)/);\nassert.match(source,/return withPublicSecurityHeaders\\(response\\)/);\nconst helperStart=source.indexOf('function applyPublicSecurityHeaders(headers)');\nconst helperEnd=source.indexOf('function secureHeaders(',helperStart);\nassert.ok(helperStart>=0 && helperEnd>helperStart,'public security helper bounds missing');\nconst publicHelper=source.slice(helperStart,helperEnd);\nassert.match(publicHelper,/X-Content-Type-Options', 'nosniff'/);\nassert.match(publicHelper,/Referrer-Policy', 'strict-origin-when-cross-origin'/);\nassert.match(publicHelper,/X-Frame-Options', 'SAMEORIGIN'/);\nassert.match(publicHelper,/Permissions-Policy', 'camera=\\(\\), microphone=\\(\\), payment=\\(\\)'/);\nassert.doesNotMatch(publicHelper,/geolocation=\\(\\)/);\nassert.doesNotMatch(publicHelper,/Content-Security-Policy/);\nassert.doesNotMatch(publicHelper,/Strict-Transport-Security/);\n\nconst originalFetch=globalThis.fetch;\nglobalThis.fetch=async ()=>new Response('<!doctype html><title>Public test</title>',{status:200,headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'max-age=600','X-Origin-Proof':'kept'}});\ntry {\n  const response=await worker.fetch(new Request('https://kalenel.nl/home.html'),{},{});\n  assert.equal(response.status,200);\n  assert.equal(response.headers.get('Content-Type'),'text/html; charset=utf-8');\n  assert.equal(response.headers.get('Cache-Control'),'max-age=600');\n  assert.equal(response.headers.get('X-Origin-Proof'),'kept');\n  assert.equal(response.headers.get('X-Content-Type-Options'),'nosniff');\n  assert.equal(response.headers.get('Referrer-Policy'),'strict-origin-when-cross-origin');\n  assert.equal(response.headers.get('X-Frame-Options'),'SAMEORIGIN');\n  assert.equal(response.headers.get('Permissions-Policy'),'camera=(), microphone=(), payment=()');\n  assert.equal(response.headers.get('Content-Security-Policy'),null);\n  assert.equal(response.headers.get('Strict-Transport-Security'),null);\n  assert.match(await response.text(),/Public test/);\n} finally { globalThis.fetch=originalFetch; }\n\nconst adminTest=fs.readFileSync('scripts/test-admin-worker-gate.mjs','utf8');\nassert.match(adminTest,/const FRONTEND_VERSION = fs\.readFileSync/);\nassert.doesNotMatch(adminTest,/GEJAST_PAGE_VERSION=\\\\'v762/);\nconsole.log('v775b public edge header regression PASS: low-risk baseline headers are applied, admin fixture follows root VERSION, and geolocation/CSP/HSTS remain intentionally unrestricted/deferred.');\n`;
fs.writeFileSync('check-public-edge-headers-v775b.mjs',guard,'utf8');

let pkg=fs.readFileSync('package.json','utf8');
const needle='node check-diagnostic-self-consistency-v773.mjs';
if(!pkg.includes(needle)) throw new Error('package verify:static anchor missing');
pkg=pkg.replace(needle,`${needle} && node check-public-edge-headers-v775b.mjs`);
fs.writeFileSync('package.json',pkg,'utf8');

console.log('v775b edge-header patch prepared. Root frontend VERSION intentionally unchanged.');
