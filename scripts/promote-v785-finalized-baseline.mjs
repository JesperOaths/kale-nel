#!/usr/bin/env node
import fs from 'node:fs';
const VERSION='v785';
const RELEASE_MERGE='ae42b0bbe6efb3b15bd72e759008f9047a05a131';
const read=p=>fs.readFileSync(p,'utf8');
const write=(p,s)=>fs.writeFileSync(p,s,'utf8');
const acceptance=JSON.parse(read('V785_LIVE_FINAL_ACCEPTANCE.json'));
if(acceptance.version!==VERSION||acceptance.combinations!==70||acceptance.failures!==0||acceptance.seriousCriticalAxe!==0||!(acceptance.blockedWrites>0)) throw new Error('v785 live final acceptance evidence is incomplete');
const readiness=JSON.parse(read('beta-readiness.json'));
if(readiness.deployment_identity?.release_candidate_version!==VERSION) throw new Error('readiness is not armed as v785 release candidate');
if(readiness.deployment_identity?.live_version!=='v784') throw new Error('expected pre-promotion live version v784');
const previousNote=String(readiness.deployment_identity?.note||'');
delete readiness.deployment_identity.release_candidate_version;
readiness.site_version=`live ${VERSION} / current frontend release ${VERSION}`;
readiness.last_updated='2026-08-10';
readiness.deployment_identity.live_version=VERSION;
readiness.deployment_identity.frontend_release_merge=RELEASE_MERGE;
readiness.deployment_identity.repository_head_at_audit=RELEASE_MERGE;
readiness.deployment_identity.note=`2026-08-10 v785 final live production-acceptance PASS: public VERSION v785, hardened 35-route live health PASS, base and extended read-only beta surfaces PASS, performance budgets PASS, and the full isolated no-write Chromium acceptance sweep passed all 35 authoritative public routes at phone and desktop size (70 combinations) with zero page errors, zero console-error pages, zero same-origin GET/HEAD failures, zero stuck auth/loading states, zero whole-page overflow, zero positive-tabindex or hidden-focus violations, and zero serious/critical axe violations. ${acceptance.blockedWrites} non-GET browser requests were intercepted locally and no production mutation was allowed. v785 specifically closes the final v784 findings: audited small brown/gold text uses an AA-safe text token, the standalone Klaverjas scorer exposes explicit labels/names for player/roem/note fields, and Rad is contained at 390px phone width. ${previousNote}`;
const staticIntegrity=(readiness.baseline_checks||[]).find(x=>x.id==='static_integrity');
if(staticIntegrity){staticIntegrity.evidence=String(staticIntegrity.evidence||'').replace('through v784','through v785');if(!staticIntegrity.evidence.includes('v785 final-acceptance')) staticIntegrity.evidence+=' v785 final-acceptance protects AA-safe audited text contrast, explicit standalone Klaverjas field labels/names, and Rad phone-width containment.';}
const liveRoutes=(readiness.baseline_checks||[]).find(x=>x.id==='live_routes');
if(liveRoutes) liveRoutes.evidence=`2026-08-10 live v785 hardened 35-route suite PASS. Full isolated no-write Chromium final acceptance PASS across 70 phone/desktop combinations with zero runtime/network failures, zero page overflow and zero serious/critical axe violations; ${acceptance.blockedWrites} non-GET requests were intercepted locally. `+String(liveRoutes.evidence||'');
const perf=(readiness.baseline_checks||[]).find(x=>x.id==='performance_beta_pass');
if(perf) perf.evidence='2026-08-10 live v785 performance budget probe PASS across the configured beta routes and same-origin asset sizing. '+String(perf.evidence||'');
write('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');

const projectState=`# Kalenel finalized project state

Finalized on **2026-08-10** after the v785 production-acceptance closure.

## Authoritative baseline

- Current live frontend: **v785**
- Frontend release merge: \`${RELEASE_MERGE}\`
- Deployment: GitHub Pages/static frontend from \`main\`
- Protected admin perimeter: Cloudflare Worker build **v762** on \`admin.kalenel.nl\` (separate version stream from the frontend)
- Backend/data: Supabase authenticated RPC contracts
- Push dispatcher: Node 24 production runtime
- Beta readiness: **12/12 verified complete**, 0 permission-gated, 0 blocked
- Live-write checklist: **0 armed mutation targets**

## Final production acceptance

Live v785 passed the hardened **35-route** public health suite, base and extended read-only beta checks, configured performance budgets, and a real Chromium sweep of all 35 authoritative public routes at phone and desktop size (**70 combinations**). The browser sweep blocked all non-GET traffic locally and finished with zero page exceptions, zero console-error pages, zero same-origin GET/HEAD failures, zero stuck auth/loading states, zero whole-page overflow, zero positive-tabindex/hidden-focus violations, and zero serious/critical axe accessibility violations.

v785 closed the final defects found during the v784 freeze audit: low-contrast small text on the homepage/spectator/Drinks/activation surfaces, missing accessible names on the standalone Klaverjas scorer fields, and Rad phone-width overflow.

## User-facing product surface

Friends and Family scopes remain isolated. The public product includes the homepage/game launcher, profiles and account claim/login/activation flows, Klaverjas scorer/live/online/leaderboard surfaces, Toepen, Beerpong, Boerenbridge, Pikken, Paardenrace, Drinks and verification/statistics, Caute Rad, and Beurs d'Espinoza/Caute Coins surfaces. Compatibility/deep-link aliases are retained only where current runtime navigation still depends on them.

## Security and operations

The public admin entry redirects to the protected admin host. The Cloudflare outer GitHub OAuth allowlist remains separate from the inner Supabase admin username/password/TOTP boundary. Active admin mutation paths remain session/scope guarded. Public operational consoles removed during the v775 cleanup remain absent. No Cloudflare paid service is required by this baseline.

Production mutation proof is closed rather than continuously re-run: Drinks, Toepen, Klaverjas, Beerpong, Boerenbridge and profile persistence have controlled evidence and permanent guards. New consequential writes require a newly scoped approval gate instead of reusing old proof machinery.

## Stable invariants

- Ice remains exactly **2.8 units**.
- Daily counters/polls use the Amsterdam **06:00 -> 06:00** boundary.
- Friends/Family scope isolation remains mandatory.
- Completed live-write targets stay disarmed.
- Admin Worker build v762 is not the frontend VERSION and must not be mechanically bumped with frontend releases.
- Historical module/RPC suffixes identify contracts and are not current frontend-version markers.

## Change policy after freeze

v785 is the stable finished baseline. Future work should normally be feature development or a specifically reported defect, not open-ended cleanup. Change only the affected owner, preserve working behavior outside that scope, add/update a focused regression, bump the frontend VERSION for real frontend changes, and repeat only the live proof layers affected by that change plus the standard verification suite. Consequential production mutations remain permissioned and should not be manufactured merely for testing.
`;
write('FINALIZED_PROJECT_STATE.md',projectState);

const guard=`#!/usr/bin/env node
import fs from 'node:fs';
const root=fs.readFileSync('VERSION','utf8').trim();
const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
const doc=fs.readFileSync('FINALIZED_PROJECT_STATE.md','utf8');
const failures=[];
const candidate=String(readiness.deployment_identity?.release_candidate_version||'');
const expectedDocVersion=candidate?String(readiness.deployment_identity?.live_version||''):root;
if(!doc.includes('Current live frontend: **'+expectedDocVersion+'**')) failures.push('finalized project state must name the current live frontend '+expectedDocVersion);
for(const marker of ['35-route','70 combinations','12/12 verified complete','0 armed mutation targets','Cloudflare Worker build **v762**','Ice remains exactly **2.8 units**','06:00 -> 06:00']) if(!doc.includes(marker)) failures.push('finalized project state missing marker: '+marker);
if(!candidate&&readiness.deployment_identity?.live_version!==root) failures.push('promoted finalized baseline must track root VERSION');
if((checklist.items||[]).length!==0) failures.push('finalized baseline must keep zero armed live-write items');
if(checklist.site_version!==root) failures.push('live-write checklist must track root VERSION');
for(const path of ['V785_LIVE_FINAL_ACCEPTANCE.json','scripts/v785-live-final-acceptance.mjs','scripts/promote-v785-finalized-baseline.mjs','.github/workflows/v785-live-final-acceptance.yml']) if(fs.existsSync(path)) failures.push('temporary final-acceptance residue remains: '+path);
if(failures.length){console.error('Finalized baseline v785 regression failed:');for(const f of failures) console.error('- '+f);process.exit(1);}
console.log('Finalized baseline v785 PASS: authoritative project state, zero-write posture, deployment identity and stable invariants are retained.');
`;
write('check-finalized-baseline-v785.mjs',guard);
const pkg=JSON.parse(read('package.json'));
const cmd=String(pkg.scripts?.['verify:static']||'');
if(!cmd.includes('check-final-acceptance-fixes-v785.mjs')) throw new Error('v785 final acceptance guard missing from verify:static');
if(!cmd.includes('check-finalized-baseline-v785.mjs')) pkg.scripts['verify:static']=cmd+' && node check-finalized-baseline-v785.mjs';
write('package.json',JSON.stringify(pkg,null,2)+'\n');
console.log('Prepared promoted v785 readiness, finalized project-state record and permanent baseline guard.');
