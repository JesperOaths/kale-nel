#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version=fs.readFileSync('VERSION','utf8').trim();
const n=Number(version.match(/^v(\d+)$/)?.[1]||0);
if(n<784){console.log(`v784 live activation evidence guard not applicable at ${version}.`);process.exit(0);}
const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
const staticEvidence=String((readiness.baseline_checks||[]).find(x=>x.id==='static_integrity')?.evidence||'');
const liveEvidence=String((readiness.baseline_checks||[]).find(x=>x.id==='live_routes')?.evidence||'');
const deploymentNote=String(readiness.deployment_identity?.note||'');
const durableEvidence=[staticEvidence,liveEvidence,deploymentNote].join(' ');
assert.match(staticEvidence,/v784/i,'v784+ static evidence must preserve the activation dead-end baseline');
assert.match(staticEvidence,/disabled-by-default activation controls/i,'v784+ static evidence must preserve disabled activation controls');
assert.match(staticEvidence,/valid-context-only submit wiring/i,'v784+ static evidence must preserve valid-context-only submit wiring');

if(!readiness.deployment_identity?.release_candidate_version){
  assert.match(durableEvidence,/missing[- ]token[^.]{0,180}zero activation-context calls[^.]{0,180}zero activation-write RPCs/i,'v784+ durable evidence must preserve missing-token no-write proof');
  assert.match(durableEvidence,/expired token|expired context/i,'v784+ durable evidence must preserve expired-token coverage');
  assert.match(durableEvidence,/expired[^.]{0,220}zero activation-write RPCs/i,'v784+ durable evidence must preserve expired-token no-write proof');
  assert.match(durableEvidence,/form disabled|activation disabled|keep the form disabled/i,'v784+ durable evidence must preserve unusable-link disabled state');
  assert.match(durableEvidence,/login fallback|Terug naar inloggen/i,'v784+ durable evidence must preserve the unusable-link escape path');
  assert.match(durableEvidence,/get_scope_hardening_bundle_v672/i,'v784+ durable evidence must identify the unrelated read-only scope lookup');
}
console.log(`v784 live activation evidence PASS at ${version}.`);
