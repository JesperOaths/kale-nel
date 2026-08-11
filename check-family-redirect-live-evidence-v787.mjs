#!/usr/bin/env node
import fs from 'node:fs';
const root=fs.readFileSync('VERSION','utf8').trim();
const rootN=Number(root.match(/^v(\d+)$/)?.[1]||0);
if(rootN<787){console.log('v787 live Family evidence guard pre-v787 skip');process.exit(0);}
const failures=[];
const readinessText=fs.readFileSync('beta-readiness.json','utf8');
const readiness=JSON.parse(readinessText);
const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
const doc=fs.readFileSync('FINALIZED_PROJECT_STATE.md','utf8');
const combined=readinessText+'\n'+doc;
const releaseMerge='bbfc7c4afe232c0e9046d333e2b49b93b9159a2d';
for(const token of ['2026-08-11','live v787','Firefox','WebKit','16','zero wrong /familie/ subresource requests','35-route','performance',releaseMerge,'v787 is the stable finished baseline']) if(!combined.includes(token)) failures.push('durable v787 live evidence missing: '+token);
if(root==='v787'){
  if(readiness.site_version!=='live v787 / current frontend release v787') failures.push('v787 live evidence requires promoted site_version');
  if(readiness.deployment_identity?.live_version!=='v787') failures.push('v787 live evidence requires deployment live_version v787');
  if(readiness.deployment_identity?.frontend_release_merge!==releaseMerge) failures.push('v787 live evidence requires exact release merge');
  if(readiness.deployment_identity?.release_candidate_version) failures.push('v787 live evidence must not retain release_candidate_version');
  const gaps=Array.isArray(readiness.beta_gaps)?readiness.beta_gaps:[];
  if(gaps.length!==12||gaps.some(item=>item.status!=='verified_complete')) failures.push('v787 live evidence requires 12/12 verified_complete readiness');
  if(!Array.isArray(checklist.items)||checklist.items.length!==0) failures.push('v787 live evidence requires zero armed live-write items');
}
if(failures.length){console.error('v787 live Family evidence regression failed:');for(const f of failures) console.error('- '+f);process.exit(1);}
console.log('v787 live Family evidence PASS: exact release, 12/12 zero-write freeze, public closure, Firefox/WebKit 16-case alias proof and zero wrong /familie/ requests remain durably recorded.');
