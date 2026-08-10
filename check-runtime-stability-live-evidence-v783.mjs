#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';

const version=fs.readFileSync('VERSION','utf8').trim();
const n=Number(version.match(/^v(\d+)$/)?.[1]||0);
if(n<783){console.log(`v783 live runtime evidence guard not applicable at ${version}.`);process.exit(0);}
const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
const staticEvidence=String((readiness.baseline_checks||[]).find(x=>x.id==='static_integrity')?.evidence||'');
assert.match(staticEvidence,/v783/i,'v783+ static evidence must preserve the v783 runtime baseline');
assert.match(staticEvidence,/runtime-light direct score\/Pikken spectator redirect aliases/i,'v783+ static evidence must preserve redirect-alias cleanup');

if(!readiness.deployment_identity?.release_candidate_version){
  const note=String(readiness.deployment_identity?.note||'');
  const liveEvidence=String((readiness.baseline_checks||[]).find(x=>x.id==='live_routes')?.evidence||'');
  assert.match(note,/v783 post-merge public-edge proof PASS/i,'promoted v783+ readiness must preserve explicit v783 live PASS evidence');
  assert.match(note,/70 combinations/i,'v783+ readiness must preserve the 70-combination runtime audit scope');
  for(const marker of ['zero JavaScript page crashes','zero console-error pages','zero same-origin HTTP 4xx/5xx resources','zero stuck/hidden pages','zero empty pages']) assert.ok(note.includes(marker),`v783+ readiness must preserve runtime audit result: ${marker}`);
  assert.match(note,/446 non-GET requests were intercepted locally/i,'v783+ readiness must preserve runtime-audit write isolation');
  assert.match(note,/zero aborted same-origin resources, page errors or write attempts before navigation/i,'v783+ readiness must preserve live redirect cleanliness proof');
  assert.match(liveEvidence,/70-combination no-write runtime-stability audit/i,'v783+ live_routes evidence must preserve runtime-stability browser coverage');
  assert.match(liveEvidence,/no longer abort same-origin runtime resources before navigation/i,'v783+ live_routes evidence must preserve live redirect result');
}
console.log(`v783 live runtime evidence PASS at ${version}.`);
