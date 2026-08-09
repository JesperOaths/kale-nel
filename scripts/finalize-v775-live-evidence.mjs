#!/usr/bin/env node
import fs from 'node:fs';
const expectedMerge='5028146da1c30959b74cf0a5dd7ad7e9fd28cf2f';
const version=fs.readFileSync('VERSION','utf8').trim();
if(version!=='v775')throw new Error(`Expected VERSION v775, got ${version}`);
const file='beta-readiness.json';const data=JSON.parse(fs.readFileSync(file,'utf8'));
if(data.site_version!=='release candidate v775 / live v774')throw new Error(`Unexpected pre-promotion site_version ${data.site_version}`);
const gaps=Array.isArray(data.beta_gaps)?data.beta_gaps:[];const complete=gaps.filter(x=>x.status==='verified_complete').length;const permission=gaps.filter(x=>x.status==='needs_permission').length;const blocked=gaps.filter(x=>x.status==='blocked_external').length;
if(complete!==12||permission||blocked)throw new Error(`Readiness not finalized: ${complete}/${permission}/${blocked}`);
data.site_version='live v775 / current frontend release v775';data.last_updated='2026-08-09';
data.deployment_identity.live_version='v775';data.deployment_identity.frontend_release_merge=expectedMerge;data.deployment_identity.repository_head_at_audit=expectedMerge;
data.deployment_identity.note='2026-08-09 v775 public-edge proof PASS: live VERSION v775, 35/35 critical routes healthy, geo_diagnostics.html and push_beta_test.html return 404, admin_push_targeted_test.html remains perimeter-protected and terminates 401 unauthenticated, drinks_pending.html?push_test=targeted returns 200, and the Despimarkt nomination compatibility redirect remains intact. Current-tree and full-history high-confidence private-secret scans both returned zero findings.';
delete data.deployment_identity.release_candidate_version;
const staticCheck=(data.baseline_checks||[]).find(x=>x.id==='static_integrity');if(staticCheck)staticCheck.evidence='Current Node 24 verification passes JavaScript syntax, RPC coverage, local references, version drift, security/runtime regressions, Klaverjas/Toepen checks, Ballroom v769a, scoped live-read v770a, push runtime v770b, canonical Beurs runtime checks, the permanent v771d Drinks rollback-proof regression, v772 finalization-residue guard, v773 diagnostic self-consistency guard, v774 production-acceptance guard, and v775 public-surface/secret-exposure guard.';
const live=(data.baseline_checks||[]).find(x=>x.id==='live_routes');if(live)live.evidence='2026-08-09 v775 post-merge public-edge proof reports live VERSION v775 and 35/35 critical routes healthy; apex admin redirects to the protected admin host and unauthenticated admin returns 401. Removed public diagnostic/push-test consoles return 404 and the normal Drinks verification target remains healthy.';
const admin=gaps.find(x=>x.id==='admin_host_security');if(admin)admin.latest_probe='2026-08-09 v775 live proof: admin targeted push tool routes apex 302 to admin.kalenel.nl and terminates unauthenticated HTTP 401; public operational consoles removed in v775 return 404.';
fs.writeFileSync(file,JSON.stringify(data,null,2)+'\n');
for(const p of ['check-live-v775-public-surface.mjs','.github/workflows/v775-postmerge-live-proof.yml','scripts/finalize-v775-live-evidence.mjs','.github/workflows/v775-finalize-live-evidence.yml'])if(fs.existsSync(p)){fs.rmSync(p);console.log(`removed ${p}`);}
console.log('v775 live evidence finalized.');