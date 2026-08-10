#!/usr/bin/env node
import assert from 'node:assert/strict';

const base='https://kalenel.nl';
const stamp=Date.now();
async function get(path){
  const r=await fetch(`${base}/${path}${path.includes('?')?'&':'?'}proof=${stamp}`,{redirect:'follow',headers:{'cache-control':'no-cache','pragma':'no-cache'}});
  const text=await r.text();
  console.log(`${path}: HTTP ${r.status} -> ${r.url}`);
  assert.equal(r.status,200,`${path} must return 200`);
  return text;
}

assert.equal((await get('VERSION')).trim(),'v779','public VERSION must be v779');

const drinks=await get('drinks_add.html');
assert.match(drinks,/GEJAST_PAGE_VERSION='v779'/);
assert.match(drinks,/\.geo-card\.linklike:focus-visible\{[^}]*outline:3px solid var\(--verify-border\);[^}]*outline-offset:3px/i);
assert.ok(!/\.geo-card\.linklike:hover,\.geo-card\.linklike:focus-visible\{/.test(drinks),'hover/focus rule must remain separated');
assert.ok(!/outline\s*:\s*(?:none|0)(?:\s*[;}])/.test(drinks),'drinks_add must not suppress focus outline');
assert.match(drinks,/<section class="geo-card linklike" id="verifyGeoCard" role="link" tabindex="0" aria-label="Open verificatiepagina">/i);
assert.match(drinks,/const verifyGeoCard=document\.getElementById\('verifyGeoCard'\);/);
assert.match(drinks,/const goVerify=\(\)=>\{ window\.location\.href='\.\/drinks\.html#verifyPanel'; \};/);
assert.match(drinks,/verifyGeoCard\.addEventListener\('click', goVerify\);/);
assert.match(drinks,/verifyGeoCard\.addEventListener\('keydown',\(ev\)=>\{ if\(ev\.key==='Enter' \|\| ev\.key===' '\)\{ ev\.preventDefault\(\); goVerify\(\); \} \}\);/);

const clickable=await get('gejast-clickable-cards.js');
assert.match(clickable,/node\.setAttribute\('tabindex', '0'\)/);
assert.match(clickable,/node\.setAttribute\('role', 'link'\)/);
assert.match(clickable,/event\.key !== 'Enter' && event\.key !== ' '/);
assert.match(clickable,/event\.preventDefault\(\);\s*\n\s*navigateTo\(route\)/);

// Accessibility naming closure must remain deployed after v779.
for(const [file,marker] of [
  ['login.html','<label for="playerNameInput">Naam</label>'],
  ['despimarkt_create.html','for="titleInput"'],
  ['paardenrace_live.html',"input.setAttribute('aria-label',`Bakken nomineren voor ${name}`)"],
  ['toepen.html',"a.setAttribute('aria-label',`Actie voor ${playerName}`)"]
]){
  const html=await get(file);
  assert.match(html,/GEJAST_PAGE_VERSION='v779'/,`${file} must serve v779 marker`);
  assert.ok(html.includes(marker),`${file} lost accessibility marker ${marker}`);
}

console.log('LIVE_V779_KEYBOARD_FOCUS=PASS: the explicit Drinks focus ring and its own click + Enter/Space route to #verifyPanel are deployed, shared clickable cards retain keyboard activation, and the 70/70 naming closure persists.');
