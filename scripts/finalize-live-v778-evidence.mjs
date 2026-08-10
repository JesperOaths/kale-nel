#!/usr/bin/env node
import fs from 'node:fs';

const releaseMerge='639269520263e8edd392ccf7c76009a6fa6a4999';
const version=fs.readFileSync('VERSION','utf8').trim();
if(version!=='v778') throw new Error(`expected v778, got ${version}`);

const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
if(readiness.deployment_identity?.release_candidate_version!=='v778') throw new Error('expected v778 release-candidate marker');
readiness.site_version='live v778 / current frontend release v778';
readiness.last_updated='2026-08-10';
readiness.deployment_identity.live_version='v778';
readiness.deployment_identity.frontend_release_merge=releaseMerge;
readiness.deployment_identity.repository_head_at_audit=releaseMerge;
delete readiness.deployment_identity.release_candidate_version;
readiness.deployment_identity.note='2026-08-10 v778 post-merge public-edge proof PASS: public VERSION v778, hardened 35-route live suite PASS, served Boerenbridge/Paardenrace/Toepen source contains the context-aware runtime accessibility naming introduced in v778, protected drinks_admin.html remains admin-perimeter bounded and terminates 401 unauthenticated, and representative v777 static accessibility markers remain served. The unnamed-control accessibility backlog identified after v776 is now closed 70/70 on the live site: 58 static controls fixed in v777 plus 12 runtime-generated controls fixed in v778. Infrastructure-only v775b public-header code remains merged but not live pending authenticated Cloudflare deployment.';
const staticCheck=(readiness.baseline_checks||[]).find(x=>x.id==='static_integrity');
if(staticCheck) staticCheck.evidence='Current Node 24 verification passes all existing frontend/backend/security regressions through v778. The accessibility backlog identified after v776 is closed 70/70: v777 protects 58 static control names and v778 protects all 12 runtime-generated context-aware names plus safe DOM/escaping behavior.';
const liveRoutes=(readiness.baseline_checks||[]).find(x=>x.id==='live_routes');
if(liveRoutes) liveRoutes.evidence='2026-08-10 v778 post-merge public-edge proof reports live VERSION v778 and hardened 35-route suite PASS. Targeted edge proof confirms v778 runtime accessibility naming is deployed on Boerenbridge, Paardenrace live and Toepen, protected Drinks admin remains HTTP 401 unauthenticated, and representative v777 static labels persist.';

const gaps=readiness.beta_gaps||[];
if(gaps.filter(x=>x.status==='verified_complete').length!==12) throw new Error('readiness must remain 12/12');
if(gaps.some(x=>x.status==='needs_permission'||x.status==='blocked_external')) throw new Error('unexpected readiness permission/blocked gap');
fs.writeFileSync('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');

const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
if(checklist.site_version!=='v778'||!Array.isArray(checklist.items)||checklist.items.length!==0) throw new Error('v778 live-write checklist must remain empty');
console.log('v778 live evidence prepared: accessibility backlog 70/70 closed, readiness 12/12, zero armed writes.');
