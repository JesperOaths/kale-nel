#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version=fs.readFileSync('VERSION','utf8').trim();
const versionNumber=Number(version.match(/^v(\d+)$/)?.[1]||0);
assert.ok(versionNumber>=780,`v780 rendered accessibility invariant requires frontend v780+, got ${version}`);

function relativeLuminance(hex){
  const value=hex.replace('#','');
  const rgb=[0,2,4].map(i=>parseInt(value.slice(i,i+2),16)/255).map(c=>c<=0.04045?c/12.92:Math.pow((c+0.055)/1.055,2.4));
  return 0.2126*rgb[0]+0.7152*rgb[1]+0.0722*rgb[2];
}
function contrastRatio(foreground,background){
  const a=relativeLuminance(foreground), b=relativeLuminance(background);
  const lighter=Math.max(a,b), darker=Math.min(a,b);
  return (lighter+0.05)/(darker+0.05);
}
for(const [foreground,background,label] of [
  ['#7a705a','#ffffff','muted gold on white'],
  ['#7a705a','#fbf7ef','muted gold on paper'],
  ['#7a705a','#f9f7f2','muted gold on card'],
  ['#7a6f5d','#ffffff','Beerpong muted label on white'],
  ['#7a6f5d','#fbf7ef','Beerpong muted label on paper'],
  ['#7a6f5d','#f9f7f2','Beerpong muted label on card']
]) assert.ok(contrastRatio(foreground,background)>=4.5,`${label} must remain WCAG AA >=4.5:1; got ${contrastRatio(foreground,background).toFixed(3)}:1`);

const goldFiles=['drinks_speed.html','paardenrace.html','paardenrace_live.html','toepen.html','klaverjas_live.html','despimarkt-theme.css'];
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

console.log(`v780 rendered accessibility PASS at ${version}: replacement text tones retain numeric WCAG AA contrast, shared Despimarkt ownership is protected, Paardenrace hidden drawer stays inert, and Rad legend remains keyboard-focusable.`);
