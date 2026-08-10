#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version=fs.readFileSync('VERSION','utf8').trim();
const versionNumber=Number(version.match(/^v(\d+)$/)?.[1]||0);
assert.ok(versionNumber>=782,`v782 responsive/runtime invariant requires frontend v782+, got ${version}`);

const drinks=fs.readFileSync('drinks.html','utf8');
const renderBarsIndex=drinks.indexOf('function renderBars(');
const renderStatsIndex=drinks.indexOf('function renderStats(');
assert.ok(renderBarsIndex>=0,'Drinks must define renderBars');
assert.ok(renderStatsIndex>renderBarsIndex,'Drinks renderBars must be defined before renderStats uses it');
assert.match(drinks,/renderBars\(document\.getElementById\('typeBars'\)/,'Drinks stats must retain the typeBars renderer call');
for(const marker of ['bar-row','bar-track','bar-fill','bar-value']) assert.ok(drinks.includes(marker),`Drinks renderBars styling marker missing: ${marker}`);

const klaverjas=fs.readFileSync('klaverjas_online.html','utf8');
assert.match(klaverjas,/\.lobby-home\{[^}]*grid-column:1\s*\/\s*-1;[^}]*min-width:0;/,'Klaverjas lobby must span the runtime shell grid and be shrinkable');
assert.match(klaverjas,/\.home-panel\{[^}]*min-width:0;/,'Klaverjas lobby panels must be allowed to shrink inside the grid');

const home=fs.readFileSync('index.html','utf8');
assert.match(home,/body\s*\{[^}]*display:\s*flex;[^}]*flex-direction:\s*column;/s,'Homepage flex body must stack the page and static watermark vertically');

const bridge=fs.readFileSync('boerenbridge.html','utf8');
assert.match(bridge,/\.table-wrap\{[^}]*overflow-x:\s*auto/i,'Boerenbridge intentional score-table horizontal scroll must remain available');

console.log(`v782 responsive/runtime PASS at ${version}: Drinks bar rendering exists, Klaverjas lobby spans the shell grid, homepage flow cannot place the watermark beside the page, and Boerenbridge intentional table scrolling is preserved.`);
