#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version=fs.readFileSync('VERSION','utf8').trim();
const n=Number(version.match(/^v(\d+)$/)?.[1]||0);
if(n<783){console.log(`v783 live runtime evidence guard not applicable at ${version}.`);process.exit(0);}
const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
const staticEvidence=String((readiness.baseline_checks||[]).find(x=>x.id==='static_integrity')?.evidence||'');
const liveEvidence=String((readiness.baseline_checks||[]).find(x=>x.id==='live_routes')?.evidence||'');
const deploymentNote=String(readiness.deployment_identity?.note||'');
const durableEvidence=[staticEvidence,liveEvidence,deploymentNote].join(' ');
assert.match(staticEvidence,/v783/i,'v783+ static evidence must preserve the v783 runtime baseline');
assert.match(staticEvidence,/runtime-light direct score\/Pikken spectator redirect aliases/i,'v783+ static evidence must preserve redirect-alias cleanup');

if(!readiness.deployment_identity?.release_candidate_version){
  assert.match(durableEvidence,/70 combinations|70-combination/i,'v783+ durable evidence must preserve the 70-combination runtime audit scope');
  for(const marker of ['zero JavaScript page crashes','zero console-error pages','zero same-origin HTTP 4xx/5xx resources','zero stuck/hidden pages','zero empty pages']) assert.ok(durableEvidence.includes(marker),`v783+ durable evidence must preserve runtime audit result: ${marker}`);
  assert.match(durableEvidence,/446 non-GET requests were intercepted locally/i,'v783+ durable evidence must preserve runtime-audit write isolation');
  assert.match(durableEvidence,/zero aborted same-origin resources/i,'v783+ durable evidence must preserve live redirect cleanliness proof');
  assert.match(durableEvidence,/runtime-light direct score\/Pikken spectator redirect aliases|redirect aliases/i,'v783+ durable evidence must preserve redirect-alias scope');
}
console.log(`v783 live runtime evidence PASS at ${version}.`);
