#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version = fs.readFileSync('VERSION','utf8').trim();
const versionNumber = Number(version.match(/^v(\d+)$/)?.[1] || 0);
assert.ok(versionNumber >= 789, 'gameplay runtime repair invariant requires frontend v789+');

const scorer = fs.readFileSync('scorer.html','utf8');
const overlayRule = scorer.match(/\.overlay\s*\{[^{}]*?z-index:(\d+)/s);
assert.ok(overlayRule, 'Klaverjas scorer overlay stacking rule missing');
assert.ok(Number(overlayRule[1]) > 9998, 'Klaverjas overlays must sit above fixed home/game-management controls');
assert.match(scorer, /class=\"manage-match-chip\"/, 'Klaverjas management chip baseline disappeared');
assert.match(scorer, /class=\"page-floating-logo\"/, 'Klaverjas floating home control baseline disappeared');

const ladderHtml = fs.readFileSync('pikken_ladder.html','utf8');
assert.match(ladderHtml, /gejast-pikken-ladder\.js\?v\d+/, 'Pikken ladder must load its game-owned renderer');
assert.match(ladderHtml, /GEJAST_PIKKEN_LADDER&&window\.GEJAST_PIKKEN_LADDER\.load\(\)/, 'Pikken ladder must boot the game-owned renderer');
assert.doesNotMatch(ladderHtml, /GEJAST_DESPIMARKT[^\n]*loadLadderPage\('pikken'\)/, 'Pikken ladder must not call the incompatible Beurs ladder renderer');
for (const id of ['ladderStatus','ladderOverviewGrid','ladderStoryGrid','ladderRows','ladderHistory','ladderSectionsWrap','ladderTablesWrap','ladderFormulaNote']) {
  assert.ok(ladderHtml.includes('id="' + id + '"') || ladderHtml.includes("id='" + id + "'"), 'Pikken ladder DOM owner missing #' + id);
}

const renderer = fs.readFileSync('gejast-pikken-ladder.js','utf8');
assert.match(renderer, /callRpc\('get_pikken_stats_scoped'/, 'Pikken ladder must use the scoped Pikken stats contract');
for (const id of ['ladderOverviewGrid','ladderStoryGrid','ladderRows','ladderHistory','ladderSectionsWrap','ladderTablesWrap','ladderFormulaNote']) assert.ok(renderer.includes(id), 'Pikken renderer does not own #' + id);
assert.match(renderer, /replace\(\/\[&<>\"'\]\/g/, 'Pikken renderer must HTML-escape backend labels/values');

const checklist = JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
assert.equal(checklist.site_version, version, 'live-write checklist version must follow release');
assert.deepEqual(checklist.items, [], 'gameplay runtime repair must not arm production writes');

console.log('gameplay runtime repair regression PASS at ' + version + ': Klaverjas modal pointer ownership and Pikken scoped ladder rendering are protected; live writes remain unarmed.');
