#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version=fs.readFileSync('VERSION','utf8').trim();
const versionNumber=Number(version.match(/^v(\d+)$/)?.[1]||0);
assert.ok(versionNumber>=779,`v779 keyboard/focus invariant requires frontend v779+, got ${version}`);

const drinksAdd=fs.readFileSync('drinks_add.html','utf8');
assert.match(drinksAdd,/\.geo-card\.linklike:focus-visible\{[^}]*outline:3px solid var\(--verify-border\);[^}]*outline-offset:3px/i,'Drinks verification card must retain an explicit visible keyboard focus ring');
assert.doesNotMatch(drinksAdd,/\.geo-card\.linklike:hover,\.geo-card\.linklike:focus-visible\{/,'hover and focus-visible styling must remain separated so keyboard focus can have its own ring');
assert.match(drinksAdd,/<section class="geo-card linklike" id="verifyGeoCard" role="link" tabindex="0" aria-label="Open verificatiepagina">/i,'the focus-ring target must remain a named keyboard-link surface');
assert.match(drinksAdd,/const verifyGeoCard=document\.getElementById\('verifyGeoCard'\);/,'Drinks verification keyboard-link owner must remain explicitly bound');
assert.match(drinksAdd,/const goVerify=\(\)=>\{ window\.location\.href='\.\/drinks\.html#verifyPanel'; \};/,'Drinks verification card must keep its intended verification-panel destination');
assert.match(drinksAdd,/verifyGeoCard\.addEventListener\('click', goVerify\);/,'Drinks verification card must remain pointer-activatable');
assert.match(drinksAdd,/verifyGeoCard\.addEventListener\('keydown',\(ev\)=>\{ if\(ev\.key==='Enter' \|\| ev\.key===' '\)\{ ev\.preventDefault\(\); goVerify\(\); \} \}\);/,'Drinks verification card must remain Enter/Space keyboard-activatable');

const exclude=/^(?:admin|familie_admin)|_vault\.html$|^vault\.html$|(?:test|debug|diagnostic|health|runtime|audit|preview|export)|_orig\.html$|_v\d+.*\.html$|_repo.*\.html$/i;
const publicHtml=fs.readdirSync('.').filter(f=>/\.html$/i.test(f)&&!exclude.test(f));
const violations=[];
for(const file of publicHtml){
  const text=fs.readFileSync(file,'utf8');
  if(/tabindex\s*=\s*["'][1-9]\d*["']/i.test(text)) violations.push(`${file}: positive tabindex`);
  if(/<(?:div|span|tr|td|li|section)\b[^>]*\bonclick\s*=/i.test(text)) violations.push(`${file}: inline click handler on non-native element`);
  if(/outline\s*:\s*(?:none|0)(?:\s*[;}])/i.test(text)) violations.push(`${file}: focus outline suppression`);
}
assert.deepEqual(violations,[],`public keyboard baseline violations:\n${violations.join('\n')}`);

const clickable=fs.readFileSync('gejast-clickable-cards.js','utf8');
assert.match(clickable,/if \(!node\.hasAttribute\('tabindex'\)\) node\.setAttribute\('tabindex', '0'\)/,'shared clickable cards must remain keyboard focusable');
assert.match(clickable,/if \(!node\.hasAttribute\('role'\)\) node\.setAttribute\('role', 'link'\)/,'shared clickable cards must retain link semantics');
assert.match(clickable,/event\.key !== 'Enter' && event\.key !== ' '/,'shared clickable cards must retain Enter/Space activation');
assert.match(clickable,/event\.preventDefault\(\);\s*\r?\n\s*navigateTo\(route\)/,'shared keyboard activation must prevent default and navigate through its route owner');

console.log(`v779 keyboard/focus accessibility PASS at ${version}: public pages avoid forced tab order/non-native inline clicks/outline suppression, the Drinks verification card retains its own click + Enter/Space route to the verification panel plus a focus-visible ring, and shared clickable cards retain keyboard activation.`);
