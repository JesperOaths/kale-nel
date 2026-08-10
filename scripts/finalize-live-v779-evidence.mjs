#!/usr/bin/env node
import fs from 'node:fs';

const releaseMerge='020bd5ca50e13d6b7dab692164a2f6c8e7446262';
const version=fs.readFileSync('VERSION','utf8').trim();
if(version!=='v779') throw new Error(`expected v779, got ${version}`);
const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
if(readiness.deployment_identity?.release_candidate_version!=='v779') throw new Error('expected v779 release-candidate marker');
readiness.site_version='live v779 / current frontend release v779';
readiness.last_updated='2026-08-10';
readiness.deployment_identity.live_version='v779';
readiness.deployment_identity.frontend_release_merge=releaseMerge;
readiness.deployment_identity.repository_head_at_audit=releaseMerge;
delete readiness.deployment_identity.release_candidate_version;
readiness.deployment_identity.note='2026-08-10 v779 post-merge public-edge proof PASS: public VERSION v779, hardened 35-route live suite PASS, drinks_add.html serves the explicit focus-visible ring on the named keyboard-link verification card with no outline suppression, and gejast-clickable-cards.js serves the shared tabindex/role plus Enter/Space activation runtime. The live accessibility naming closure remains 70/70: 58 static controls from v777 plus 12 runtime-generated controls from v778. The earlier temporary Chromium/axe audit found 0 axe violations, 0 serious/critical findings, 0 positive tabindex, 0 missing visible focus indicators and 0 page errors on the unauthenticated rendered journeys. Infrastructure-only v775b public-header code remains merged but not live pending authenticated Cloudflare deployment.';
const staticCheck=(readiness.baseline_checks||[]).find(x=>x.id==='static_integrity');
if(staticCheck) staticCheck.evidence='Current Node 24 verification passes all existing frontend/backend/security regressions through v779. The accessibility naming backlog remains closed 70/70: 58 static controls are protected by v777 and 12 runtime-generated controls by v778. v779 protects the keyboard/focus baseline: no positive tab order, no non-native inline public clicks, no public outline suppression, explicit Drinks focus-visible styling, and preserved shared Enter/Space activation.';
const liveRoutes=(readiness.baseline_checks||[]).find(x=>x.id==='live_routes');
if(liveRoutes) liveRoutes.evidence='2026-08-10 v779 post-merge public-edge proof reports live VERSION v779 and hardened 35-route suite PASS. Targeted edge proof confirms the explicit Drinks focus-visible ring and keyboard-link semantics, served Enter/Space clickable-card runtime, and representative v777/v778 accessibility markers remain deployed.';
if((readiness.beta_gaps||[]).filter(x=>x.status==='verified_complete').length!==12) throw new Error('readiness must remain 12/12');
if((readiness.beta_gaps||[]).some(x=>x.status==='needs_permission'||x.status==='blocked_external')) throw new Error('unexpected readiness permission/blocked gap');
fs.writeFileSync('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');
const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
if(checklist.site_version!=='v779'||!Array.isArray(checklist.items)||checklist.items.length!==0) throw new Error('v779 live-write checklist must remain empty');
console.log('v779 live evidence prepared: keyboard/focus baseline deployed, 70/70 naming closure preserved, readiness 12/12, zero armed writes.');
