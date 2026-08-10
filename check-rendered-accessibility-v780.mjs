#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version=fs.readFileSync('VERSION','utf8').trim();
const versionNumber=Number(version.match(/^v(\d+)$/)?.[1]||0);
assert.ok(versionNumber>=780,`v780 rendered accessibility invariant requires frontend v780+, got ${version}`);

const goldFiles=['drinks_speed.html','paardenrace.html','paardenrace_live.html','toepen.html','despimarkt_create.html','despimarkt_debts.html','klaverjas_live.html'];
for(const file of goldFiles){
  const text=fs.readFileSync(file,'utf8');
  assert.doesNotMatch(text,/#8a7a55/i,`${file} must not restore the sub-AA muted gold #8a7a55`);
  assert.match(text,/#7a705a/i,`${file} must retain the AA-safe muted gold #7a705a`);
}
const beerpong=fs.readFileSync('beerpong.html','utf8');
assert.doesNotMatch(beerpong,/#8a7f6b/i,'Beerpong must not restore the sub-AA muted label color #8a7f6b');
assert.match(beerpong,/#7a6f5d/i,'Beerpong must retain the AA-safe muted label color #7a6f5d');

const race=fs.readFileSync('paardenrace_live.html','utf8');
assert.match(race,/<section class="drawer" id="mobileDrawer" aria-hidden="true" inert>/,'closed Paardenrace drawer must start inert while aria-hidden');
assert.match(race,/\$\('mobileDrawer'\)\.setAttribute\('aria-hidden', 'false'\);\s*\$\('mobileDrawer'\)\.removeAttribute\('inert'\);/,'opening drawer must remove inert after exposing it');
assert.match(race,/\$\('mobileDrawer'\)\.setAttribute\('aria-hidden', 'true'\);\s*\$\('mobileDrawer'\)\.setAttribute\('inert', ''\);/,'closing drawer must restore inert with aria-hidden');

const rad=fs.readFileSync('rad.html','utf8');
assert.match(rad,/<div class="legend" id="legendBox" tabindex="0" aria-label="Segmenten van het rad"><\/div>/,'scrollable Rad legend must be keyboard focusable and named');

console.log(`v780 rendered accessibility PASS at ${version}: AA-safe muted text colors, inert hidden Paardenrace drawer lifecycle, and keyboard-focusable Rad legend are protected.`);
