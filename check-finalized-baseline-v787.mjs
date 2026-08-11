#!/usr/bin/env node
import fs from 'node:fs';
const root=fs.readFileSync('VERSION','utf8').trim();
if(root!=='v787'){console.log('v787 finalized-baseline guard historical skip at '+root);process.exit(0);}
const failures=[];
const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
const doc=fs.readFileSync('FINALIZED_PROJECT_STATE.md','utf8');
if(readiness.site_version!=='live v787 / current frontend release v787') failures.push('readiness site_version must be live v787');
if(readiness.deployment_identity?.live_version!=='v787') failures.push('deployment live_version must be v787');
if(readiness.deployment_identity?.frontend_release_merge!=='bbfc7c4afe232c0e9046d333e2b49b93b9159a2d') failures.push('frontend release merge must be bbfc7c4afe232c0e9046d333e2b49b93b9159a2d');
if('release_candidate_version' in (readiness.deployment_identity||{})) failures.push('release_candidate_version must be removed after live promotion');
if(!Array.isArray(checklist.items)||checklist.items.length!==0) failures.push('live-write checklist must remain empty');
if(checklist.site_version!=='v787') failures.push('live-write checklist site_version must be v787');
const gaps=Array.isArray(readiness.beta_gaps)?readiness.beta_gaps:[];
if(gaps.length!==12||gaps.some(g=>g.status!=='verified_complete')) failures.push('beta readiness must remain 12/12 verified_complete');
for(const token of ['Finalized frontend baseline: **v787**','Current live frontend at freeze: **v787**','bbfc7c4afe232c0e9046d333e2b49b93b9159a2d','Firefox and WebKit','zero wrong','/familie/','subresource requests','v787 is the stable finished baseline']) if(!doc.includes(token)) failures.push('finalized state missing: '+token);
if(failures.length){console.error('v787 finalized baseline regression failed:');for(const f of failures) console.error('- '+f);process.exit(1);}
console.log('v787 finalized baseline PASS: live v787, 12/12 readiness, zero armed writes, release bbfc7c4afe232c0e9046d333e2b49b93b9159a2d, cross-engine Family alias closure recorded.');
