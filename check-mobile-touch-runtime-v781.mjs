#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version=fs.readFileSync('VERSION','utf8').trim();
const versionNumber=Number(version.match(/^v(\d+)$/)?.[1]||0);
assert.ok(versionNumber>=781,`v781 mobile/runtime invariant requires frontend v781+, got ${version}`);

const drinks=fs.readFileSync('drinks.html','utf8');
assert.match(drinks,/lastStatsLoadedAt=0,\s*statsLoadPromise=null,\s*statsLoadScheduled=false/,'Drinks stats queue state must be declared before queueStatsLoad reads it');
const declIndex=drinks.indexOf('lastStatsLoadedAt=0');
const queueIndex=drinks.indexOf('function queueStatsLoad(force=false)');
assert.ok(declIndex>=0 && queueIndex>declIndex,'Drinks stats queue declarations must appear before queueStatsLoad');
assert.match(drinks,/\.select-field\{[^}]*width:100%;[^}]*min-height:44px;[^}]*padding:11px 12px/i,'Drinks speed type select must retain a mobile-sized control surface');

const float=fs.readFileSync('drinks-verify-float.js','utf8');
assert.match(float,/box\.setAttribute\('aria-hidden','true'\);\s*box\.setAttribute\('inert',''\);/,'verification float must start hidden and inert');
assert.match(float,/function showBox\(\)\{ const box = ensureBox\(\); box\.removeAttribute\('inert'\); box\.setAttribute\('aria-hidden','false'\);/,'showBox must expose and de-inert the verification float before showing it');
assert.match(float,/function hideBox\(\)\{ const box = document\.getElementById\('globalDrinksVerifyFloat'\); if \(box\) \{ box\.classList\.remove\('show'\); box\.setAttribute\('aria-hidden','true'\); box\.setAttribute\('inert',''\); \}/,'hideBox must make the off-canvas verification float inert and aria-hidden');

const beerpong=fs.readFileSync('beerpong.html','utf8');
for(const href of ['./beerpong_vault.html','./index.html']){
  const escaped=href.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
  assert.match(beerpong,new RegExp(`<a href="${escaped}" style="[^"]*display:inline-flex;[^"]*min-height:32px;[^"]*padding:4px 2px`),`${href} must retain a >=24px mobile hit area`);
}
for(const id of ['pussycupA','pussycupB']) assert.match(beerpong,new RegExp(`id="${id}"[^>]*style="[^"]*width:24px;height:24px;flex:0 0 auto`),`${id} must retain a 24x24 checkbox target`);

console.log(`v781 mobile/runtime PASS at ${version}: Drinks stats queue state is declared, speed selector is touch-sized, hidden verification float is inert, and Beerpong navigation/Pussycup targets meet the scoped mobile baseline.`);
