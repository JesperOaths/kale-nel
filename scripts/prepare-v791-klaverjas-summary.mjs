#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const targetVersion='v791';
const liveCommit='a6ad0b61b99e47ecb63e347d79180bf9ef816d9e';
const scorerPath='scorer.html';
const scorer=fs.readFileSync(scorerPath,'utf8');
const anchor='  <div id="setupOverlay" class="overlay">';
const summaryMarkup=`  <div id="matchSummaryOverlay" class="overlay">
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="matchSummaryDialogTitle">
      <h2 id="matchSummaryDialogTitle">Wedstrijd klaar</h2>
      <div id="matchSummaryCard" style="display:grid;gap:12px"></div>
      <div class="modal-footer">
        <button class="btn-light" type="button" onclick="downloadMatchSummaryImage()">Afbeelding</button>
        <button class="btn-light" type="button" onclick="copyMatchRecapText()">Samenvatting kopiëren</button>
        <button class="btn-dark" type="button" onclick="closeMatchSummary()">Sluiten</button>
      </div>
    </div>
  </div>

`;
let next=scorer;
if(!next.includes('id="matchSummaryOverlay"')){
  if(!next.includes(anchor)) throw new Error('Klaverjas setup overlay anchor changed; refusing blind patch');
  next=next.replace(anchor,summaryMarkup+anchor);
  fs.writeFileSync(scorerPath,next,'utf8');
}

const guard=`#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version=fs.readFileSync('VERSION','utf8').trim();
const versionNumber=Number(version.match(/^v(\\d+)$/)?.[1]||0);
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
assert.match(source,/onclick="downloadMatchSummaryImage\\(\\)"/,'summary image action must remain wired');
assert.match(source,/onclick="copyMatchRecapText\\(\\)"/,'summary recap copy action must remain wired');
assert.match(source,/onclick="closeMatchSummary\\(\\)"/,'summary close action must remain wired');
assert.match(source,/document\\.getElementById\\('matchSummaryCard'\\)\\.innerHTML=/,'openMatchSummary must render into its owned card');
assert.match(source,/document\\.getElementById\\('matchSummaryOverlay'\\)\\.classList\\.add\\('show'\\)/,'openMatchSummary must reveal its owned overlay');
assert.match(source,/const oldFinish=window\\.finishGame; window\\.finishGame=function\\(\\)\\{ if\\(oldFinish\\) oldFinish\\(\\); openMatchSummary\\(\\); \\};/,'16-round finish must still open the finished-match summary');
assert.match(source,/id="saveMatchBtn"[\\s\\S]*onclick="handoffFinishedGame\\(\\)"/,'finished-match handoff button must remain intact');
const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
assert.equal(checklist.site_version,version,'live-write checklist must follow current release');
assert.deepEqual(checklist.items,[],'Klaverjas dialog repair must not arm production writes');
console.log('Klaverjas v791 finished-summary ownership regression PASS: 16-round summary DOM, actions and handoff remain owned; writes remain unarmed.');
`;
fs.writeFileSync('check-klaverjas-summary-overlay-v791.mjs',guard,'utf8');

const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const cmd='node check-klaverjas-summary-overlay-v791.mjs';
if(!pkg.scripts['verify:static'].includes(cmd)) pkg.scripts['verify:static'] += ' && '+cmd;
fs.writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n','utf8');

fs.writeFileSync('VERSION',targetVersion+'\n','utf8');
const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
checklist.site_version=targetVersion;
checklist.items=[];
fs.writeFileSync('beta-live-write-checklist.json',JSON.stringify(checklist,null,2)+'\n','utf8');

const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
readiness.site_version='live v790 / release candidate '+targetVersion;
readiness.last_updated='2026-08-13';
readiness.deployment_identity.live_version='v790';
readiness.deployment_identity.frontend_release_merge=liveCommit;
readiness.deployment_identity.repository_head_at_audit=liveCommit;
readiness.deployment_identity.release_candidate_version=targetVersion;
const evidence='v791 candidate: Klaverjas 16-round scorer now owns the finished-match summary dialog that its existing finish wrapper renders, while score calculation, live-summary sync, handoff payload, backend contracts and production-write freeze remain unchanged.';
if(!readiness.deployment_identity.evidence.includes(evidence)) readiness.deployment_identity.evidence.push(evidence);
const staticIntegrity=(readiness.baseline_checks||[]).find(x=>x.id==='static_integrity');
if(staticIntegrity&&!String(staticIntegrity.evidence).includes('v791 protects')) staticIntegrity.evidence += ' v791 protects Klaverjas finished-match summary ownership: the 16-round finish wrapper has an accessible dialog/card target and its image/copy/close actions plus score handoff remain wired.';
fs.writeFileSync('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n','utf8');

const sync=spawnSync(process.execPath,['fix-version-drift.mjs'],{stdio:'inherit'});
if(sync.status!==0) process.exit(sync.status||1);
console.log('PREP_V791=PASS');
