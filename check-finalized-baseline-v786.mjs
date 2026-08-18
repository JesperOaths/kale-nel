#!/usr/bin/env node
import fs from 'node:fs';
const root=fs.readFileSync('VERSION','utf8').trim();
const rootN=Number(root.match(/^v(\d+)$/)?.[1]||0);
const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const doc=fs.readFileSync('FINALIZED_PROJECT_STATE.md','utf8');
const failures=[];
const releaseMerge='81c6ba88e579188effa7342cc6a9d3790d5d0637';
if(rootN<786) failures.push('finalized baseline guard requires VERSION >= v786');

if(root==='v786'){
  for(const marker of ['Finalized frontend baseline: **v786**',releaseMerge,'35-route','70 combinations','320, 360, 390, 430 and 760px','12/12 verified complete','0 armed mutation targets','Cloudflare Worker build **v762**','Ice remains exactly **2.8 units**','06:00 -> 06:00','removed `96vw` wheel override']) if(!doc.includes(marker)) failures.push('finalized project state missing marker: '+marker);
  if(readiness.deployment_identity?.live_version!=='v786') failures.push('v786 freeze requires live_version v786');
  if(readiness.deployment_identity?.release_candidate_version) failures.push('v786 freeze must not retain a release candidate');
  if(readiness.site_version!=='live v786 / current frontend release v786') failures.push('v786 freeze site_version is not promoted');
  if(readiness.deployment_identity?.frontend_release_merge!==releaseMerge) failures.push('v786 freeze must retain the exact frontend release merge');
  if(readiness.deployment_identity?.repository_head_at_audit!==releaseMerge) failures.push('v786 freeze must retain the exact release audit identity');
  const note=String(readiness.deployment_identity?.note||'');
  for(const marker of ['v786 FINALIZED BASELINE PASS','70 combinations','320, 360, 390, 430 and 760px','no 96vw runtime override','non-GET browser requests were intercepted locally']) if(!note.includes(marker)) failures.push('v786 promoted deployment note missing final proof marker: '+marker);
}else if(rootN>786){
  for(const marker of ['v786 full Chromium freeze remains preserved','35-route','70 combinations','320, 360, 390, 430 and 760px','12/12 verified complete','0 armed mutation targets','Cloudflare Worker build **v762**','Ice remains exactly **2.8 units**','06:00 -> 06:00','96vw']) if(!doc.includes(marker)) failures.push('newer finalized state must preserve historical v786 marker: '+marker);
}

const gaps=Array.isArray(readiness.beta_gaps)?readiness.beta_gaps:[];
const completeCount=gaps.filter(item=>item.status==='verified_complete').length;
const permission=gaps.filter(item=>item.status==='needs_permission');
const permissionIds=permission.map(item=>item.id).sort();
const blockedCount=gaps.filter(item=>item.status==='blocked_external').length;
if(rootN===786){
  if(gaps.length!==12||completeCount!==12||permission.length!==0||blockedCount!==0) failures.push('exact v786 freeze must preserve its historical 12/12 zero-blocker readiness');
}else if(rootN>786 && rootN<801){
  // Historical intermediate releases may legitimately carry their then-current readiness state.
  if(gaps.length!==12||blockedCount!==0) failures.push('post-v786 historical readiness must preserve the 12-gap zero-external-blocker structure');
}else if(rootN>=801 && rootN<806){
  // Before the explicitly authorized production v801a deployment, Toepen was the sole permission-gated item.
  if(gaps.length!==12||completeCount!==11||JSON.stringify(permissionIds)!==JSON.stringify(['toepen_backend_live'])||blockedCount!==0) failures.push('pre-deployment v801-v805 readiness must expose exactly the Toepen v801a permission blocker');
  const toepen=gaps.find(item=>item.id==='toepen_backend_live');
  if(!/v801a/i.test(String(toepen?.next_action||''))) failures.push('pre-deployment Toepen blocker must identify v801a');
}else if(rootN>=806){
  // v801a was explicitly authorized and deployed on 2026-08-18. Newer baselines must retain the historical
  // v786 acceptance facts while also preserving the now-closed production owner/scope proof truth.
  if(gaps.length!==12||completeCount!==12||permission.length!==0||blockedCount!==0) failures.push('v806+ readiness must preserve 12/12 complete state after the proven v801a deployment');
  const toepen=gaps.find(item=>item.id==='toepen_backend_live');
  const proof=[toepen?.proof_needed,toepen?.next_action,toepen?.latest_probe].map(v=>String(v||'')).join('\n');
  if(toepen?.status!=='verified_complete') failures.push('v806+ Toepen readiness must remain verified_complete');
  if(!/v801a/i.test(proof)||!/20260818001412/.test(proof)||!/32084142660/.test(proof)) failures.push('v806+ Toepen readiness must preserve the deployed v801a migration and public REST proof identity');
  if(/needs_permission|not deployed|authorization before production deployment/i.test(proof)) failures.push('v806+ finalized-baseline guard must reject stale pre-deployment Toepen wording');
}
if((checklist.items||[]).length!==0) failures.push('finalized baseline must keep zero armed live-write items');
if(checklist.site_version!==root) failures.push('live-write checklist must track root VERSION');
const verifyStatic=String(pkg.scripts?.['verify:static']||'');
if(!verifyStatic.includes('node check-rad-live-overflow-v786.mjs')) failures.push('verify:static must keep the v786 Rad live-overflow regression wired');
if(!verifyStatic.includes('node check-finalized-baseline-v786.mjs')) failures.push('verify:static must keep the finalized v786 baseline regression wired');
for(const path of ['V786_LIVE_FINAL_ACCEPTANCE.json','scripts/v786-live-final-acceptance.mjs','scripts/promote-v786-finalized-baseline.mjs','.github/workflows/v786-live-final-acceptance.yml']) if(fs.existsSync(path)) failures.push('temporary v786 final-acceptance residue remains: '+path);
if(failures.length){console.error('Finalized baseline v786 regression failed:');for(const f of failures) console.error('- '+f);process.exit(1);}
console.log(`Finalized baseline v786 PASS at ${root}: exact v786 identity is enforced; newer baselines preserve its acceptance facts and the historically correct Toepen lifecycle state.`);
