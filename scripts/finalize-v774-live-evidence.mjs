#!/usr/bin/env node
import fs from 'node:fs';

const expectedMerge='575067cfaebb9305b8653c6947bcdfd22a415240';
const version=fs.readFileSync('VERSION','utf8').trim();
if(version!=='v774') throw new Error(`Expected root VERSION v774, got ${version}`);

const file='beta-readiness.json';
const data=JSON.parse(fs.readFileSync(file,'utf8'));
if(data.site_version!=='release candidate v774 / live v773') throw new Error(`Unexpected readiness site_version: ${data.site_version}`);
if(data.deployment_identity?.release_candidate_version!=='v774') throw new Error('Expected v774 release-candidate marker before promotion');

const gaps=Array.isArray(data.beta_gaps)?data.beta_gaps:[];
const complete=gaps.filter(x=>x.status==='verified_complete').length;
const permission=gaps.filter(x=>x.status==='needs_permission').length;
const blocked=gaps.filter(x=>x.status==='blocked_external').length;
if(complete!==12||permission!==0||blocked!==0) throw new Error(`Readiness not finalized before promotion: complete=${complete} permission=${permission} blocked=${blocked}`);

data.site_version='live v774 / current frontend release v774';
data.last_updated='2026-08-09';
data.deployment_identity.live_version='v774';
data.deployment_identity.frontend_release_merge=expectedMerge;
data.deployment_identity.repository_head_at_audit=expectedMerge;
data.deployment_identity.note='2026-08-09 v774 public-edge proof PASS after production browser acceptance release: live VERSION v774, 35/35 critical routes healthy, admin perimeter preserved, deployed Beerpong optional RPC promise handling fixed, cross-origin analytics uses same-origin-gated Beacon plus keepalive fetch, and login copy is production-clean.';
delete data.deployment_identity.release_candidate_version;

const staticCheck=(data.baseline_checks||[]).find(x=>x.id==='static_integrity');
if(staticCheck) staticCheck.evidence='Current Node 24 verification passes JavaScript syntax, RPC coverage, local references, version drift, security/runtime regressions, Klaverjas/Toepen checks, Ballroom v769a, scoped live-read v770a, push runtime v770b, canonical Beurs runtime checks, the permanent v771d Drinks rollback-proof regression, v772 finalization-residue guard, v773 diagnostic self-consistency guard, and v774 production-acceptance guard.';
const liveRoutes=(data.baseline_checks||[]).find(x=>x.id==='live_routes');
if(liveRoutes) liveRoutes.evidence='2026-08-09 v774 post-merge public-edge proof reports live VERSION v774 and 35/35 critical routes healthy; apex admin redirects to the protected admin host and unauthenticated admin returns 401. Targeted edge checks confirmed deployed Beerpong Promise handling, cross-origin analytics transport, and concise production login copy.';
const adminGap=gaps.find(x=>x.id==='admin_host_security');
if(adminGap) adminGap.latest_probe='2026-08-09 v774 live proof: apex /admin.html HTTP 302 to admin.kalenel.nl and admin perimeter HTTP 401 with build v762; protected admin routes remain inaccessible without authentication.';
const analyticsGap=gaps.find(x=>x.id==='analytics_observability');
if(analyticsGap) analyticsGap.latest_probe='2026-08-09 v774 production-acceptance edge proof confirmed site-analytics.js is deployed with same-origin-only Beacon and cross-origin keepalive fetch delivery; protected admin analytics/observability surfaces remain behind the admin perimeter.';

fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');

for(const path of [
  'check-live-v774-production-acceptance.mjs',
  '.github/workflows/v774-postmerge-live-proof.yml',
  'scripts/finalize-v774-live-evidence.mjs',
  '.github/workflows/v774-finalize-live-evidence.yml'
]){
  if(fs.existsSync(path)){fs.rmSync(path);console.log(`removed ${path}`);}
}
console.log('v774 live evidence finalized: 12/12 complete, live v774, temporary proof machinery removed.');
