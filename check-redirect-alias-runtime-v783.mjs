#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version=fs.readFileSync('VERSION','utf8').trim();
const versionNumber=Number(version.match(/^v(\d+)$/)?.[1]||0);
assert.ok(versionNumber>=783,`v783 redirect-alias invariant requires frontend v783+, got ${version}`);

function assertRuntimeLight(text,label,maxBytes){
  assert.ok(Buffer.byteLength(text,'utf8')<=maxBytes,`${label} alias must stay small enough to remain redirect-only`);
  assert.ok(!/<script\s+src=/i.test(text),`${label} alias must not preload runtime scripts before navigation`);
  assert.ok(!/<link[^>]+rel=["'](?:stylesheet|preload|modulepreload)["']/i.test(text),`${label} alias must not preload styles/runtime assets before navigation`);
}

const score=fs.readFileSync('score.html','utf8');
assert.match(score,/new URL\('\.\/klaverjas_scorer_v596_repo_ready\.html',location\.href\)/,'score alias must retain the canonical scorer target');
assert.match(score,/new URLSearchParams\(location\.search\|\|''\)\.forEach/,'score alias must preserve all query parameters');
assert.match(score,/location\.replace\(url\.toString\(\)\)/,'score alias must retain replace-navigation semantics');
assertRuntimeLight(score,'score',1800);
assert.ok(!/gejast-mobile-foundation|gejast-home-gate|gejast-config\.js/i.test(score),'score alias must stay runtime-light');

const spectator=fs.readFileSync('pikken_spectator.html','utf8');
assert.match(spectator,/new URL\('\.\/pikken_live\.html',location\.href\)/,'Pikken spectator alias must retain the live-page target');
assert.match(spectator,/\['game_id','client_match_id','match_ref','lobby_code'\]/,'Pikken spectator alias must preserve canonical game and compatible room identifiers');
assert.match(spectator,/if\(q\.get\(key\)\)u\.searchParams\.set\(key,q\.get\(key\)\)/,'Pikken spectator alias must forward every declared gameplay identifier');
assert.match(spectator,/q\.get\('scope'\)==='family'/,'Pikken spectator alias must preserve family scope forwarding');
assert.match(spectator,/u\.searchParams\.set\('spectator','1'\)/,'Pikken spectator alias must force spectator mode');
assert.match(spectator,/location\.replace\(u\.pathname\+u\.search\+u\.hash\)/,'Pikken spectator alias must retain replace-navigation semantics');
assertRuntimeLight(spectator,'Pikken spectator',2200);
assert.ok(!/gejast-mobile-foundation|gejast-home-gate|gejast-config\.js|gejast-game-group-b-bridge/i.test(spectator),'Pikken spectator alias must stay runtime-light');

console.log(`v783 redirect alias runtime PASS at ${version}: score and Pikken spectator aliases redirect directly without starting unused runtime/style downloads, and spectator navigation preserves game context.`);
