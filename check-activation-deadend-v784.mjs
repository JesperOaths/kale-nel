#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version=fs.readFileSync('VERSION','utf8').trim();
const n=Number(version.match(/^v(\d+)$/)?.[1]||0);
assert.ok(n>=784,`v784 activation dead-end invariant requires frontend v784+, got ${version}`);

const page=fs.readFileSync('activate.html','utf8');
assert.match(page,/id="activationFallback"[^>]*hidden/i,'activation page must keep a hidden fallback navigation control');
assert.match(page,/href="\.\/login\.html"/,'activation fallback must lead to login');
assert.match(page,/role="status"[^>]*aria-live="polite"/,'activation page must retain a live status region');
for(const id of ['pinInput','pinConfirmInput']) assert.match(page,new RegExp(`id="${id}"[^>]*\\bdisabled\\b`),`${id} must ship disabled before activation context is proven`);
assert.match(page,/<button[^>]*type="submit"[^>]*\bdisabled\b[^>]*>Account activeren<\/button>/i,'activation submit button must ship disabled');

const runtime=fs.readFileSync('gejast-account-runtime.js','utf8');
assert.match(runtime,/async function bootActivatePage\(\)\{[^]*?setBusy\(form,true\)/,'activation form must start disabled until context is proven');
assert.match(runtime,/if\(!token\)\{[^]*?Deze activatielink mist een token\.[^]*?return;/,'missing activation token must stop before context lookup');
assert.match(runtime,/function showActivationFallback\(show\)/,'activation runtime must own explicit fallback visibility');
assert.match(runtime,/approvedName[^]*?Niet beschikbaar/,'invalid activation state must replace misleading loading/unknown identity text');
assert.match(runtime,/const activationName=.*ctx[^]*?const activationEmail=.*ctx/,'valid activation context must derive approved identity fields');
assert.match(runtime,/if\(!activationName\|\|!activationEmail\) throw new Error\('Deze activatielink is ongeldig of verlopen\.'\)/,'incomplete activation context must remain non-actionable');
assert.match(runtime,/setBusy\(form,false\);\s*showActivationFallback\(false\);/,'valid activation context must explicitly re-enable the form and hide fallback');
const enableIndex=runtime.indexOf('setBusy(form,false);');
const fallbackHideIndex=runtime.indexOf('showActivationFallback(false);',enableIndex);
const submitIndex=runtime.indexOf("form.addEventListener('submit'");
assert.ok(enableIndex>=0 && fallbackHideIndex>enableIndex && submitIndex>fallbackHideIndex,'activation submit handler must only be attached after valid context re-enables the form and hides fallback');

console.log(`v784 activation dead-end PASS at ${version}: activation ships disabled, stays non-actionable without valid context, and only wires submit after valid context is proven.`);
