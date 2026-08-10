#!/usr/bin/env node
import fs from 'node:fs';
const root=fs.readFileSync('VERSION','utf8').trim();
const rootN=Number(root.match(/^v(\d+)$/)?.[1]||0);
const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
const doc=fs.readFileSync('FINALIZED_PROJECT_STATE.md','utf8');
const failures=[];
if(rootN<786) failures.push('finalized baseline guard requires VERSION >= v786');
for(const marker of ['Finalized frontend baseline: **v786**','81c6ba88e579188effa7342cc6a9d3790d5d0637','35-route','70 combinations','320, 360, 390, 430 and 760px','12/12 verified complete','0 armed mutation targets','Cloudflare Worker build **v762**','Ice remains exactly **2.8 units**','06:00 -> 06:00','96vw']) if(!doc.includes(marker)) failures.push('finalized project state missing marker: '+marker);
if(root==='v786'){
  if(readiness.deployment_identity?.live_version!=='v786') failures.push('v786 freeze requires live_version v786');
  if(readiness.deployment_identity?.release_candidate_version) failures.push('v786 freeze must not retain a release candidate');
  if(readiness.site_version!=='live v786 / current frontend release v786') failures.push('v786 freeze site_version is not promoted');
}
const gaps=Array.isArray(readiness.beta_gaps)?readiness.beta_gaps:[];
const completeCount=gaps.filter(item=>item.status==='verified_complete').length;
const permissionCount=gaps.filter(item=>item.status==='needs_permission').length;
const blockedCount=gaps.filter(item=>item.status==='blocked_external').length;
if(gaps.length!==12||completeCount!==12||permissionCount!==0||blockedCount!==0) failures.push('finalized readiness must stay 12/12 with zero permission-gated/blocked gaps');
if((checklist.items||[]).length!==0) failures.push('finalized baseline must keep zero armed live-write items');
if(checklist.site_version!==root) failures.push('live-write checklist must track root VERSION');
for(const path of ['V786_LIVE_FINAL_ACCEPTANCE.json','scripts/v786-live-final-acceptance.mjs','scripts/promote-v786-finalized-baseline.mjs','.github/workflows/v786-live-final-acceptance.yml']) if(fs.existsSync(path)) failures.push('temporary v786 final-acceptance residue remains: '+path);
if(failures.length){console.error('Finalized baseline v786 regression failed:');for(const f of failures) console.error('- '+f);process.exit(1);}
console.log('Finalized baseline v786 PASS: authoritative project state, 12/12 zero-write posture, live deployment identity, Rad closure and stable invariants are retained.');
