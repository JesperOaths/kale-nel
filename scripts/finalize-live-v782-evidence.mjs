#!/usr/bin/env node
import fs from 'node:fs';

const releaseMerge='0d980b234469576b77573fb7b9a069d0379e399c';
const version=fs.readFileSync('VERSION','utf8').trim();
if(version!=='v782') throw new Error(`expected v782, got ${version}`);
const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
if(readiness.deployment_identity?.release_candidate_version!=='v782') throw new Error('expected v782 release-candidate marker');
readiness.site_version='live v782 / current frontend release v782';
readiness.last_updated='2026-08-10';
readiness.deployment_identity.live_version='v782';
readiness.deployment_identity.frontend_release_merge=releaseMerge;
readiness.deployment_identity.repository_head_at_audit=releaseMerge;
delete readiness.deployment_identity.release_candidate_version;
readiness.deployment_identity.note='2026-08-10 v782 post-merge public-edge proof PASS: public VERSION v782 and hardened 35-route live suite PASS. Exact served source contains the restored Drinks renderBars display renderer with bounded widths, the full-grid Klaverjas online lobby repair, the vertical homepage body flow, and preserved Boerenbridge internal table scrolling. Isolated no-write responsive Chromium confirmed no missing-renderBars page error at 768/1024/1366 widths, no Klaverjas desktop document overflow with room-code controls inside the 1366px viewport, and no homepage tablet-portrait overflow with the watermark inside 768px. All non-GET browser traffic was intercepted locally. The prior isolated no-write live mobile Chromium proof remains preserved: no Drinks stats-queue ReferenceError, >=44px Drinks selector, inert/non-focusable hidden verification float, and >=24px scoped Beerpong targets. The 70/70 naming closure and v779 keyboard baseline remain preserved, and the v780 live Chromium/axe proof remains preserved with zero axe violations on the nine repaired pages. Infrastructure-only v775b public-header code remains merged but not live pending authenticated Cloudflare deployment.';
const staticCheck=(readiness.baseline_checks||[]).find(x=>x.id==='static_integrity');
if(staticCheck) staticCheck.evidence='Current Node 24 verification passes all existing frontend/backend/security/accessibility regressions through v782. The accessibility naming backlog remains closed 70/70: 58 static controls are protected by v777 and 12 runtime-generated controls by v778; v779 keyboard/focus remains protected; v780 rendered Chromium/axe proof remains preserved with zero axe violations on the nine repaired pages. v781 protects declared Drinks stats-queue state, mobile-sized Drinks/Beerpong targets and the aria-hidden/inert off-canvas verification-float lifecycle. v782 protects the bounded/escaped Drinks bar renderer, responsive homepage/Klaverjas layout owners and intentional Boerenbridge table scrolling.';
const liveRoutes=(readiness.baseline_checks||[]).find(x=>x.id==='live_routes');
if(liveRoutes) liveRoutes.evidence='2026-08-10 v782 post-merge public-edge proof reports live VERSION v782 and hardened 35-route suite PASS. Isolated no-write responsive Chromium confirms the three v782 owners are live-clean: Drinks no missing-renderBars runtime error, Klaverjas desktop room controls remain on-screen without document overflow, and the 768px homepage stays within the viewport. The prior isolated no-write mobile Chromium proof remains preserved with the hidden verification float inert/non-focusable and scoped v781 touch targets intact.';
if((readiness.beta_gaps||[]).filter(x=>x.status==='verified_complete').length!==12) throw new Error('readiness must remain 12/12');
if((readiness.beta_gaps||[]).some(x=>x.status==='needs_permission'||x.status==='blocked_external')) throw new Error('unexpected readiness permission/blocked gap');
fs.writeFileSync('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');
const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
if(checklist.site_version!=='v782'||!Array.isArray(checklist.items)||checklist.items.length!==0) throw new Error('v782 live-write checklist must remain empty');
console.log('v782 live evidence prepared: responsive/runtime proof live-clean, readiness 12/12, zero armed writes.');
