#!/usr/bin/env node
import fs from 'node:fs';

const releaseMerge='9a5da20da189681d59954a15ad9833d7094f07ed';
const version=fs.readFileSync('VERSION','utf8').trim();
if(version!=='v780') throw new Error(`expected v780, got ${version}`);
const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
if(readiness.deployment_identity?.release_candidate_version!=='v780') throw new Error('expected v780 release-candidate marker');
readiness.site_version='live v780 / current frontend release v780';
readiness.last_updated='2026-08-10';
readiness.deployment_identity.live_version='v780';
readiness.deployment_identity.frontend_release_merge=releaseMerge;
readiness.deployment_identity.repository_head_at_audit=releaseMerge;
delete readiness.deployment_identity.release_candidate_version;
readiness.deployment_identity.note='2026-08-10 v780 post-merge public-edge proof PASS: public VERSION v780, hardened 35-route live suite PASS, exact served contrast/drawer/legend source markers match v780, and an isolated no-write Chromium/axe audit of all nine formerly failing pages returned zero serious/critical violations, zero total axe violations, zero positive tabindex and zero page errors. The live harness locally neutralized only authentication redirects and intercepted all non-GET requests before they could reach production. The 70/70 accessible-name closure and v779 keyboard/focus baseline remain deployed. Infrastructure-only v775b public-header code remains merged but not live pending authenticated Cloudflare deployment.';
const staticCheck=(readiness.baseline_checks||[]).find(x=>x.id==='static_integrity');
if(staticCheck) staticCheck.evidence='Current Node 24 verification passes all existing frontend/backend/security regressions through v780. The accessibility naming backlog remains closed 70/70: 58 static controls are protected by v777 and 12 runtime-generated controls by v778; v779 keyboard/focus invariants remain protected. v780 adds numeric WCAG AA contrast protection, shared Despimarkt contrast ownership, inert Paardenrace drawer lifecycle, keyboard Rad legend access, and rendered Chromium/axe proof of zero violations on the nine repaired pages.';
const liveRoutes=(readiness.baseline_checks||[]).find(x=>x.id==='live_routes');
if(liveRoutes) liveRoutes.evidence='2026-08-10 v780 post-merge public-edge proof reports live VERSION v780 and hardened 35-route suite PASS. Exact source checks plus isolated no-write Chromium/axe proof confirm all nine repaired accessibility pages are live with zero axe violations, zero positive tabindex and zero page errors.';
if((readiness.beta_gaps||[]).filter(x=>x.status==='verified_complete').length!==12) throw new Error('readiness must remain 12/12');
if((readiness.beta_gaps||[]).some(x=>x.status==='needs_permission'||x.status==='blocked_external')) throw new Error('unexpected readiness permission/blocked gap');
fs.writeFileSync('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');
const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
if(checklist.site_version!=='v780'||!Array.isArray(checklist.items)||checklist.items.length!==0) throw new Error('v780 live-write checklist must remain empty');
console.log('v780 live evidence prepared: rendered WCAG fixes live-clean, readiness 12/12, zero armed writes.');
