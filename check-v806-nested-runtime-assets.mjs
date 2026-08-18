#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version = fs.readFileSync('VERSION', 'utf8').trim();
const current = Number((version.match(/\d+/) || ['0'])[0]);
assert.ok(current >= 806, 'nested runtime asset guard requires VERSION v806 or newer');

const config = fs.readFileSync('gejast-config.js', 'utf8');

for (const asset of [
  'gejast-scope-hardening.js',
  'gejast-v725-repair.js',
  'gejast-site-announcements.js',
]) {
  assert(
    config.includes(`script.src = \`/${asset}?\${effectiveVersion}\``),
    `${asset} must be injected from the site root so nested /familie/ routes cannot resolve it as HTML`,
  );
  assert(
    !config.includes(`script.src = \`./${asset}?\${effectiveVersion}\``),
    `${asset} must never use document-relative injection`,
  );
}

assert(
  config.includes("fetch('/VERSION?ts=' + Date.now()"),
  'runtime version refresh must fetch the canonical root VERSION file',
);
assert(
  !config.includes("fetch('./VERSION?ts=' + Date.now()"),
  'nested routes must not request /familie/VERSION',
);

const protectedFamilyAliases = [
  'familie/boerenbridge.html',
  'familie/boerenbridge_vault.html',
  'familie/ladder.html',
  'familie/profiles.html',
  'familie/request.html',
  'familie/vault.html',
];
for (const file of protectedFamilyAliases) {
  const html = fs.readFileSync(file, 'utf8');
  assert(html.includes('/gejast-auth-gate.js?'), `${file} must preserve the forced-login gate`);
  assert(/location\.replace\(/.test(html), `${file} must remain an immediate canonical redirect alias`);
}

console.log('RESULT=V806_NESTED_RUNTIME_ASSETS_PASS');
