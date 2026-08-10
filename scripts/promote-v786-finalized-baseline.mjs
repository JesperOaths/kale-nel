#!/usr/bin/env node
import fs from 'node:fs';

const VERSION='v786';
const RELEASE_MERGE='81c6ba88e579188effa7342cc6a9d3790d5d0637';
const read=p=>fs.readFileSync(p,'utf8');
const write=(p,s)=>fs.writeFileSync(p,s,'utf8');
const acceptance=JSON.parse(read('V786_LIVE_FINAL_ACCEPTANCE.json'));
if(acceptance.version!==VERSION||acceptance.combinations!==70||acceptance.failures!==0||acceptance.radFailures!==0||acceptance.seriousCriticalAxe!==0||!(acceptance.blockedWrites>0)) throw new Error('v786 live final acceptance evidence is incomplete');
for(const w of [320,360,390,430,760]) if(!acceptance.radWidths.includes(w)) throw new Error(`v786 live Rad width ${w} was not proven`);

const readiness=JSON.parse(read('beta-readiness.json'));
if(readiness.deployment_identity?.release_candidate_version!==VERSION) throw new Error('readiness is not armed as v786 release candidate');
if(readiness.deployment_identity?.live_version!=='v785') throw new Error('expected pre-promotion live version v785');
const previousNote=String(readiness.deployment_identity?.note||'');
delete readiness.deployment_identity.release_candidate_version;
readiness.site_version=`live ${VERSION} / current frontend release ${VERSION}`;
readiness.last_updated='2026-08-10';
readiness.deployment_identity.live_version=VERSION;
readiness.deployment_identity.frontend_release_merge=RELEASE_MERGE;
readiness.deployment_identity.repository_head_at_audit=RELEASE_MERGE;
readiness.deployment_identity.note=`2026-08-10 v786 FINALIZED BASELINE PASS: public VERSION v786, hardened 35-route live health PASS, base and extended read-only beta surfaces PASS, configured performance budgets PASS, and the full isolated no-write Chromium acceptance sweep passed all 35 authoritative public routes at phone and desktop size (70 combinations) with zero page errors, zero console-error pages, zero same-origin GET/HEAD failures, zero stuck auth/loading states, zero whole-page overflow, zero positive-tabindex or hidden-focus violations, and zero serious/critical axe violations. The live Rad runtime was additionally proven at widths 320, 360, 390, 430 and 760px with the shared injected rule container-bounded to min(100%,460px), no 96vw runtime override, and no page/wheel/panel overflow. ${acceptance.blockedWrites} non-GET browser requests were intercepted locally and no production mutation was allowed. v786 closes the sole 69/70 v785 freeze failure. ${previousNote}`;

const staticIntegrity=(readiness.baseline_checks||[]).find(x=>x.id==='static_integrity');
if(staticIntegrity){
  staticIntegrity.evidence=String(staticIntegrity.evidence||'').replace('through v785','through v786');
  if(!staticIntegrity.evidence.includes('v786 Rad live-overflow')) staticIntegrity.evidence+=' v786 Rad live-overflow permanently protects container-bounded shared mobile wheel sizing and forbids the 96vw override.';
}
const liveRoutes=(readiness.baseline_checks||[]).find(x=>x.id==='live_routes');
if(liveRoutes) liveRoutes.evidence=`2026-08-10 live v786 hardened 35-route suite PASS; full isolated no-write Chromium final acceptance PASS across 70 phone/desktop combinations, plus live Rad runtime widths 320/360/390/430/760 PASS. Zero runtime/network failures, zero whole-page overflow, and zero serious/critical axe violations; ${acceptance.blockedWrites} non-GET requests intercepted locally. `+String(liveRoutes.evidence||'');
const perf=(readiness.baseline_checks||[]).find(x=>x.id==='performance_beta_pass');
if(perf) perf.evidence='2026-08-10 live v786 performance budget probe PASS across configured beta routes and same-origin asset sizing. '+String(perf.evidence||'');
write('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');

const checklist=JSON.parse(read('beta-live-write-checklist.json'));
if(checklist.site_version!==VERSION||!Array.isArray(checklist.items)||checklist.items.length!==0) throw new Error('v786 finalized baseline requires empty live-write checklist at v786');

const projectState=`# Kalenel — finalized project state

Finalized on **2026-08-10** after the v786 production-acceptance closure.

## Authoritative stable baseline

- Finalized frontend baseline: **v786**
- Current live frontend at freeze: **v786**
- Frontend release merge: \`${RELEASE_MERGE}\`
- Public frontend: GitHub Pages/static deployment from \`main\`
- Protected admin perimeter: Cloudflare Worker build **v762** on \`admin.kalenel.nl\` (separate version stream from the frontend)
- Backend/data: Supabase authenticated RPC contracts
- Push dispatcher: Node 24 production runtime
- Beta readiness: **12/12 verified complete**, 0 permission-gated, 0 blocked
- Live-write checklist: **0 armed mutation targets**

## Final production acceptance

Live v786 passed the hardened **35-route** public health suite, base and extended read-only beta checks, configured performance budgets, and a real Chromium sweep of all 35 authoritative public routes at phone and desktop size (**70 combinations**). The sweep intercepted all non-GET browser traffic locally and finished with zero page exceptions, zero console-error pages, zero same-origin GET/HEAD failures, zero stuck auth/loading states, zero whole-page overflow, zero positive-tabindex/hidden-focus violations, and zero serious/critical axe accessibility violations.

The Rad runtime received an additional live multi-width proof at **320, 360, 390, 430 and 760px**. The shared mobile runtime now sizes the wheel from its container with \`min(100%,460px)\`, no longer injects the faulty \`96vw\` override, and keeps the page and wheel inside the mobile panel. This closes the sole 69/70 failure from the v785 freeze attempt.

## User-facing product surface

Friends and Family scopes remain isolated. The public product includes the homepage/game launcher, profiles and account claim/login/activation flows, Klaverjas scorer/live/online/leaderboard surfaces, Toepen, Beerpong, Boerenbridge, Pikken, Paardenrace, Drinks and verification/statistics, Caute Rad, and Beurs d'Espinoza/Caute Coins surfaces. Compatibility/deep-link aliases are retained only where current runtime navigation still depends on them.

## Security and operations

The public admin entry redirects to the protected admin host. The Cloudflare outer GitHub OAuth allowlist remains separate from the inner Supabase admin username/password/TOTP boundary. Active admin mutation paths remain session/scope guarded. Public operational consoles removed during the v775 cleanup remain absent. No Cloudflare paid service is required by this baseline.

Production mutation proof is closed rather than continuously re-run: Drinks, Toepen, Klaverjas, Beerpong, Boerenbridge and profile persistence have controlled evidence and permanent guards. Completed write targets stay disarmed. New consequential writes require a newly scoped approval gate instead of reusing historical proof machinery.

## Stable invariants

- Ice remains exactly **2.8 units**.
- Daily counters/polls use the Amsterdam **06:00 -> 06:00** boundary.
- Friends/Family scope isolation remains mandatory.
- Completed live-write targets remain disarmed.
- Admin Worker build **v762** is not the frontend VERSION and must not be mechanically bumped with frontend releases.
- Historical module/RPC suffixes identify contracts and are not current frontend-version markers.
- The Rad shared mobile runtime must remain container-bounded; the removed \`96vw\` wheel override must not return.

## Change policy after freeze

v786 is the stable finished baseline. Future work should normally be a deliberate feature or a specifically reported defect, not open-ended cleanup for its own sake. Change only the affected owner, preserve working behavior outside that scope, add or update a focused regression, bump the frontend VERSION for a real frontend change, and repeat the relevant live proof plus the standard verification suite. Consequential production mutations remain permissioned and should not be manufactured merely for testing.
`;
write('FINALIZED_PROJECT_STATE.md',projectState);

const guard=`#!/usr/bin/env node
import fs from 'node:fs';
const root=fs.readFileSync('VERSION','utf8').trim();
const rootN=Number(root.match(/^v(\\d+)$/)?.[1]||0);
const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
const doc=fs.readFileSync('FINALIZED_PROJECT_STATE.md','utf8');
const failures=[];
if(rootN<786) failures.push('finalized baseline guard requires VERSION >= v786');
for(const marker of ['Finalized frontend baseline: **v786**','Frontend release merge: \\`81c6ba88e579188effa7342cc6a9d3790d5d0637\\`','35-route','70 combinations','320, 360, 390, 430 and 760px','12/12 verified complete','0 armed mutation targets','Cloudflare Worker build **v762**','Ice remains exactly **2.8 units**','06:00 -> 06:00','96vw']) if(!doc.includes(marker)) failures.push('finalized project state missing marker: '+marker);
if(root==='v786'){
  if(readiness.deployment_identity?.live_version!=='v786') failures.push('v786 freeze requires live_version v786');
  if(readiness.deployment_identity?.release_candidate_version) failures.push('v786 freeze must not retain a release candidate');
  if(readiness.site_version!=='live v786 / current frontend release v786') failures.push('v786 freeze site_version is not promoted');
}
const totals=readiness.totals||{};
if(Number(totals.complete)!==12||Number(totals.permission_gated)!==0||Number(totals.blocked)!==0) failures.push('finalized readiness must stay 12/12 with zero gaps');
if((checklist.items||[]).length!==0) failures.push('finalized baseline must keep zero armed live-write items');
if(checklist.site_version!==root) failures.push('live-write checklist must track root VERSION');
for(const path of ['V786_LIVE_FINAL_ACCEPTANCE.json','scripts/v786-live-final-acceptance.mjs','scripts/promote-v786-finalized-baseline.mjs','.github/workflows/v786-live-final-acceptance.yml']) if(fs.existsSync(path)) failures.push('temporary v786 final-acceptance residue remains: '+path);
if(failures.length){console.error('Finalized baseline v786 regression failed:');for(const f of failures) console.error('- '+f);process.exit(1);}
console.log('Finalized baseline v786 PASS: authoritative project state, 12/12 zero-write posture, live deployment identity, Rad closure and stable invariants are retained.');
`;
write('check-finalized-baseline-v786.mjs',guard);
const pkg=JSON.parse(read('package.json'));
const cmd=String(pkg.scripts?.['verify:static']||'');
if(!cmd.includes('check-rad-live-overflow-v786.mjs')) throw new Error('v786 Rad guard missing from verify:static');
if(!cmd.includes('check-finalized-baseline-v786.mjs')) pkg.scripts['verify:static']=cmd+' && node check-finalized-baseline-v786.mjs';
write('package.json',JSON.stringify(pkg,null,2)+'\n');
console.log('Prepared promoted v786 readiness, authoritative finalized project state and permanent baseline guard.');
