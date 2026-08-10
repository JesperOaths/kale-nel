#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version=fs.readFileSync('VERSION','utf8').trim();
const n=Number(version.match(/^v(\d+)$/)?.[1]||0);
if(n<784){console.log(`v784 live activation evidence guard not applicable at ${version}.`);process.exit(0);}
const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
const staticEvidence=String((readiness.baseline_checks||[]).find(x=>x.id==='static_integrity')?.evidence||'');
assert.match(staticEvidence,/v784/i,'v784+ static evidence must preserve the activation dead-end baseline');
assert.match(staticEvidence,/disabled-by-default activation controls/i,'v784+ static evidence must preserve disabled activation controls');
assert.match(staticEvidence,/valid-context-only submit wiring/i,'v784+ static evidence must preserve valid-context-only submit wiring');

if(!readiness.deployment_identity?.release_candidate_version){
  const note=String(readiness.deployment_identity?.note||'');
  const liveEvidence=String((readiness.baseline_checks||[]).find(x=>x.id==='live_routes')?.evidence||'');
  assert.match(note,/v784 post-merge public-edge proof PASS/i,'promoted v784+ readiness must preserve explicit v784 live PASS evidence');
  assert.match(note,/missing token makes zero activation-context calls and zero activation-write RPCs/i,'v784+ readiness must preserve missing-token no-write proof');
  assert.match(note,/expired token[^.]*zero activation-write RPCs/i,'v784+ readiness must preserve expired-token no-write proof');
  assert.match(note,/keep the form disabled and show the login fallback/i,'v784+ readiness must preserve unusable-link UI outcome');
  assert.match(note,/get_scope_hardening_bundle_v672/i,'v784+ readiness must identify the unrelated read-only scope lookup');
  assert.match(liveEvidence,/missing-token activation makes zero activation-context calls and zero activation-write RPCs/i,'v784+ live_routes evidence must preserve the missing-token browser outcome');
  assert.match(liveEvidence,/expired context keeps activation disabled and makes zero activation-write RPCs/i,'v784+ live_routes evidence must preserve expired-token browser outcome');
}
console.log(`v784 live activation evidence PASS at ${version}.`);
