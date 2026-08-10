#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version=fs.readFileSync('VERSION','utf8').trim();
const n=Number(version.match(/^v(\d+)$/)?.[1]||0);
if(n<782){console.log(`v782 live responsive evidence guard not applicable at ${version}.`);process.exit(0);}
const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
const staticEvidence=String((readiness.baseline_checks||[]).find(x=>x.id==='static_integrity')?.evidence||'');
assert.match(staticEvidence,/v782/i,'v782+ static evidence must preserve the v782 responsive baseline');
assert.match(staticEvidence,/Drinks bar renderer/i,'v782+ static evidence must preserve the Drinks renderer repair');
assert.match(staticEvidence,/homepage\/Klaverjas|Klaverjas.*homepage/i,'v782+ static evidence must preserve the responsive homepage/Klaverjas owners');

if(!readiness.deployment_identity?.release_candidate_version){
  const note=String(readiness.deployment_identity?.note||'');
  const liveEvidence=String((readiness.baseline_checks||[]).find(x=>x.id==='live_routes')?.evidence||'');
  assert.match(note,/v782 post-merge public-edge proof PASS/i,'promoted v782+ readiness must preserve explicit v782 live PASS evidence');
  assert.match(note,/no missing-renderBars page error/i,'promoted v782+ note must preserve the live Drinks renderer outcome');
  assert.match(note,/Klaverjas desktop document overflow/i,'promoted v782+ note must preserve the live Klaverjas overflow outcome');
  assert.match(note,/homepage tablet-portrait overflow/i,'promoted v782+ note must preserve the live homepage overflow outcome');
  assert.match(note,/non-GET browser traffic was intercepted locally/i,'promoted v782+ note must preserve responsive proof write isolation');
  assert.match(liveEvidence,/no-write responsive Chromium/i,'v782+ live_routes evidence must preserve responsive Chromium coverage');
}
console.log(`v782 live responsive evidence PASS at ${version}.`);
