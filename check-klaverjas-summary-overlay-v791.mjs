#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version=fs.readFileSync('VERSION','utf8').trim();
const versionNumber=Number(version.match(/^v(\d+)$/)?.[1]||0);
assert.ok(versionNumber>=791,'Klaverjas finished-summary ownership requires frontend v791+');
const source=fs.readFileSync('scorer.html','utf8');
const once=(needle,label)=>assert.equal(source.split(needle).length-1,1,label+' must exist exactly once');
once('id="matchSummaryOverlay"','match summary overlay');
once('id="matchSummaryCard"','match summary card');
once('id="matchSummaryDialogTitle"','match summary title');
const markupIndex=source.indexOf('id="matchSummaryOverlay"');
const ownerIndex=source.indexOf('window.openMatchSummary=function()');
assert.ok(markupIndex>=0&&ownerIndex>markupIndex,'summary DOM owners must exist before openMatchSummary executes');
assert.match(source,/id="matchSummaryOverlay" class="overlay"/,'summary must use the established scorer modal overlay');
assert.match(source,/role="dialog" aria-modal="true" aria-labelledby="matchSummaryDialogTitle"/,'summary dialog must retain accessible modal ownership');
assert.match(source,/onclick="downloadMatchSummaryImage\(\)"/,'summary image action must remain wired');
assert.match(source,/onclick="copyMatchRecapText\(\)"/,'summary recap copy action must remain wired');
assert.match(source,/onclick="closeMatchSummary\(\)"/,'summary close action must remain wired');
assert.match(source,/document\.getElementById\('matchSummaryCard'\)\.innerHTML=/,'openMatchSummary must render into its owned card');
assert.match(source,/document\.getElementById\('matchSummaryOverlay'\)\.classList\.add\('show'\)/,'openMatchSummary must reveal its owned overlay');
assert.match(source,/const oldFinish=window\.finishGame; window\.finishGame=function\(\)\{ if\(oldFinish\) oldFinish\(\); openMatchSummary\(\); \};/,'16-round finish must still open the finished-match summary');
assert.match(source,/id="saveMatchBtn"[\s\S]*onclick="handoffFinishedGame\(\)"/,'finished-match handoff button must remain intact');
const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
assert.equal(checklist.site_version,version,'live-write checklist must follow current release');
assert.deepEqual(checklist.items,[],'Klaverjas dialog repair must not arm production writes');
console.log('Klaverjas v791 finished-summary ownership regression PASS: 16-round summary DOM, actions and handoff remain owned; writes remain unarmed.');
