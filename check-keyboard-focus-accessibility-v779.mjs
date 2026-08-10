#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version=fs.readFileSync('VERSION','utf8').trim();
const versionNumber=Number(version.match(/^v(\d+)$/)?.[1]||0);
assert.ok(versionNumber>=779,`v779 keyboard/focus invariant requires frontend v779+, got ${version}`);

const drinksAdd=fs.readFileSync('drinks_add.html','utf8');
assert.match(drinksAdd,/\.geo-card\.linklike:focus-visible\{[^}]*outline:3px solid var\(--verify-border\);[^}]*outline-offset:3px/i,'Drinks verification card must retain an explicit visible keyboard focus ring');
assert.doesNotMatch(drinksAdd,/\.geo-card\.linklike:hover,\.geo-card\.linklike:focus-visible\{/,'hover and focus-visible styling must remain separated so keyboard focus can have its own ring');
assert.match(drinksAdd,/<section class="geo-card linklike"[^>]*data-route="\.\/drinks_pending\.html"[^>]*role="link"[^>]*tabindex="0"[^>]*aria-label="Open verificatiepagina"/i,'the focus-ring target must remain a named keyboard-link surface with a real route');

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
assert.match(clickable,/if \(!node\.hasAttribute\('tabindex'\)\) node\.setAttribute\('tabindex', '0'\)/,'clickable cards must remain keyboard focusable');
assert.match(clickable,/if \(!node\.hasAttribute\('role'\)\) node\.setAttribute\('role', 'link'\)/,'clickable cards must retain link semantics');
assert.match(clickable,/event\.key !== 'Enter' && event\.key !== ' '/,'clickable cards must retain Enter/Space activation');
assert.match(clickable,/event\.preventDefault\(\);\s*\r?\n\s*navigateTo\(route\)/,'keyboard activation must prevent default and navigate through the shared route owner');

console.log(`v779 keyboard/focus accessibility PASS at ${version}: public pages avoid forced tab order/non-native inline clicks/outline suppression, the Drinks verification card retains explicit keyboard-link semantics plus a focus-visible ring, and shared clickable cards retain Enter/Space activation.`);
