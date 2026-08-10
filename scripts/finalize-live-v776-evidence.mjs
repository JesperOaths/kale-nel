#!/usr/bin/env node
import fs from 'node:fs';

const releaseMerge='2799733f4e83bb54b91c2c42799d3f81fca6e6e1';
const version=fs.readFileSync('VERSION','utf8').trim();
if(version!=='v776') throw new Error(`expected root v776, got ${version}`);

const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
if(readiness.deployment_identity?.release_candidate_version!=='v776') throw new Error('expected v776 release-candidate marker before promotion');
readiness.site_version='live v776 / current frontend release v776';
readiness.last_updated='2026-08-10';
readiness.deployment_identity.live_version='v776';
readiness.deployment_identity.frontend_release_merge=releaseMerge;
readiness.deployment_identity.repository_head_at_audit=releaseMerge;
delete readiness.deployment_identity.release_candidate_version;
readiness.deployment_identity.note='2026-08-10 v776 post-merge public-edge proof PASS: public VERSION v776, the hardened 35-route live suite passed, login/request/activation serve programmatically associated labels plus polite live-status markup and preserved autocomplete semantics, account pages no longer expose v680/mailqueue/device/browser implementation language, the Klaverjas leaderboard serves the finished ELO description, and automatic Despimarkt no longer exposes Phase 13 copy. Infrastructure-only v775b public-header code remains merged but not live until authenticated Cloudflare Worker deployment becomes available.';
const liveRoutes=(readiness.baseline_checks||[]).find(x=>x.id==='live_routes');
if(liveRoutes) liveRoutes.evidence='2026-08-10 v776 post-merge public-edge proof reports live VERSION v776 and the hardened 35-route suite PASS. Exact edge assertions also confirm the v776 account accessibility/copy fixes, finished Klaverjas leaderboard description and finished automatic Despimarkt copy are being served.';

const gaps=readiness.beta_gaps||[];
if(gaps.filter(x=>x.status==='verified_complete').length!==12) throw new Error('readiness must remain 12/12 complete');
if(gaps.some(x=>x.status==='needs_permission'||x.status==='blocked_external')) throw new Error('readiness unexpectedly contains permission/blocked gaps');
fs.writeFileSync('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');

const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
if(checklist.site_version!=='v776'||!Array.isArray(checklist.items)||checklist.items.length!==0) throw new Error('live-write checklist must remain v776 and empty');

console.log('v776 readiness promotion prepared: live v776, 12/12 complete, zero armed live writes.');
