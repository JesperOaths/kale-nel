#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version=fs.readFileSync('VERSION','utf8').trim();
const n=Number(version.match(/^v(\d+)$/)?.[1]||0);
if(n<782){console.log(`v782 live responsive evidence guard not applicable at ${version}.`);process.exit(0);}
const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
const staticEvidence=String((readiness.baseline_checks||[]).find(x=>x.id==='static_integrity')?.evidence||'');
const liveEvidence=String((readiness.baseline_checks||[]).find(x=>x.id==='live_routes')?.evidence||'');
const deploymentNote=String(readiness.deployment_identity?.note||'');
const durableEvidence=[staticEvidence,liveEvidence,deploymentNote].join(' ');
assert.match(staticEvidence,/v782/i,'v782+ static evidence must preserve the v782 responsive baseline');
assert.match(staticEvidence,/Drinks bar renderer/i,'v782+ static evidence must preserve the Drinks renderer repair');
assert.match(staticEvidence,/homepage\/Klaverjas|Klaverjas.*homepage/i,'v782+ static evidence must preserve the responsive homepage/Klaverjas owners');

if(!readiness.deployment_identity?.release_candidate_version){
  assert.match(durableEvidence,/v782[^.]{0,180}no-write responsive Chromium|no-write responsive Chromium[^.]{0,180}v782/i,'v782+ durable evidence must preserve the no-write responsive Chromium proof');
  assert.match(durableEvidence,/Drinks bar renderer/i,'v782+ durable evidence must preserve the Drinks renderer outcome');
  assert.match(durableEvidence,/Klaverjas/i,'v782+ durable evidence must preserve the Klaverjas responsive owner');
  assert.match(durableEvidence,/homepage/i,'v782+ durable evidence must preserve the homepage responsive owner');
}
console.log(`v782 live responsive evidence PASS at ${version}.`);
