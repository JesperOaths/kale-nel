#!/usr/bin/env node
import fs from 'node:fs';

const releaseMerge='0157d4bf8be15fbf2a1042df9e40eccc2d7578b1';
const version=fs.readFileSync('VERSION','utf8').trim();
if(version!=='v781') throw new Error(`expected v781, got ${version}`);
const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
if(readiness.deployment_identity?.release_candidate_version!=='v781') throw new Error('expected v781 release-candidate marker');
readiness.site_version='live v781 / current frontend release v781';
readiness.last_updated='2026-08-10';
readiness.deployment_identity.live_version='v781';
readiness.deployment_identity.frontend_release_merge=releaseMerge;
readiness.deployment_identity.repository_head_at_audit=releaseMerge;
delete readiness.deployment_identity.release_candidate_version;
readiness.deployment_identity.note='2026-08-10 v781 post-merge public-edge proof PASS: public VERSION v781, hardened 35-route live suite PASS, exact served source contains the Drinks stats-queue declarations, 44px speed selector, hidden verification-float aria-hidden/inert lifecycle and scoped Beerpong touch-target sizing. An isolated no-write live mobile Chromium proof at 390x844 confirmed no Drinks stats-queue ReferenceError, speed selector >=44px high, hidden verification-float controls cannot receive focus, Drinks document horizontal overflow remains within tolerance, and both Beerpong links plus Pussycup checkboxes meet the >=24px target baseline. All non-GET browser traffic was intercepted locally. The 70/70 naming closure and v779 keyboard baseline remain preserved, and the v780 live Chromium/axe proof remains preserved with zero axe violations on the nine repaired pages. Infrastructure-only v775b public-header code remains merged but not live pending authenticated Cloudflare deployment.';
const staticCheck=(readiness.baseline_checks||[]).find(x=>x.id==='static_integrity');
if(staticCheck) staticCheck.evidence='Current Node 24 verification passes all existing frontend/backend/security/accessibility regressions through v781. The accessibility naming backlog remains closed 70/70: 58 static controls are protected by v777 and 12 runtime-generated controls by v778; v779 keyboard/focus remains protected; v780 rendered Chromium/axe proof remains preserved with zero axe violations on the nine repaired pages. v781 protects declared Drinks stats-queue state, mobile-sized Drinks/Beerpong targets and the aria-hidden/inert off-canvas verification-float lifecycle.';
const liveRoutes=(readiness.baseline_checks||[]).find(x=>x.id==='live_routes');
if(liveRoutes) liveRoutes.evidence='2026-08-10 v781 post-merge public-edge proof reports live VERSION v781 and hardened 35-route suite PASS. Exact source plus isolated no-write mobile Chromium proof confirm the Drinks runtime error is gone, the speed selector and Beerpong controls meet scoped touch-size baselines, the hidden verification float is inert/non-focusable, and no new Drinks horizontal document overflow is present.';
if((readiness.beta_gaps||[]).filter(x=>x.status==='verified_complete').length!==12) throw new Error('readiness must remain 12/12');
if((readiness.beta_gaps||[]).some(x=>x.status==='needs_permission'||x.status==='blocked_external')) throw new Error('unexpected readiness permission/blocked gap');
fs.writeFileSync('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');
const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
if(checklist.site_version!=='v781'||!Array.isArray(checklist.items)||checklist.items.length!==0) throw new Error('v781 live-write checklist must remain empty');
console.log('v781 live evidence prepared: mobile/runtime proof live-clean, readiness 12/12, zero armed writes.');
