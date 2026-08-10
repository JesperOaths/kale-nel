#!/usr/bin/env node
import fs from 'node:fs';
const CURRENT='v785';
const TARGET='v786';
const read=p=>fs.readFileSync(p,'utf8');
const write=(p,s)=>fs.writeFileSync(p,s,'utf8');
function replaceOnce(path,from,to){const text=read(path);const count=text.split(from).length-1;if(count!==1)throw new Error(`${path}: expected exactly one owner, found ${count}`);write(path,text.replace(from,to));console.log(`${path}: patched exact owner`);}
if(read('VERSION').trim()!==CURRENT) throw new Error(`v786 builder requires ${CURRENT}`);
replaceOnce('gejast-mobile-route-fixes-v583.js','.wheel-box{width:min(96vw,460px) !important;margin-inline:auto !important;justify-self:center !important;}','.wheel-box{width:min(100%,460px) !important;max-width:100% !important;box-sizing:border-box !important;margin-inline:auto !important;justify-self:center !important;}');
const guard=`#!/usr/bin/env node
import fs from 'node:fs';
const version=fs.readFileSync('VERSION','utf8').trim();
const n=Number(version.match(/^v(\\d+)$/)?.[1]||0);
const route=fs.readFileSync('gejast-mobile-route-fixes-v583.js','utf8');
const rad=fs.readFileSync('rad.html','utf8');
const failures=[];
if(n<786) failures.push('v786 Rad live-overflow guard requires VERSION >= v786');
if(route.includes('.wheel-box{width:min(96vw,460px)')) failures.push('Rad mobile runtime must not size wheel-box from viewport width');
for(const marker of ['.wheel-box{width:min(100%,460px) !important;max-width:100% !important;box-sizing:border-box !important;','case \'rad.html\': patchRad(); break;']) if(!route.includes(marker)) failures.push('Rad mobile runtime marker missing: '+marker);
for(const marker of ['.layout{grid-template-columns:minmax(0,1fr)}','.panel{min-width:0}.wheel-box{width:min(100%,460px)}']) if(!rad.includes(marker)) failures.push('Rad page containment marker missing: '+marker);
for(const path of ['scripts/build-v786-rad-overflow-fix.mjs','scripts/prove-v786-rad-overflow.mjs','.github/workflows/v786-rad-overflow-builder.yml']) if(fs.existsSync(path)) failures.push('temporary v786 builder residue remains: '+path);
if(failures.length){console.error('v786 Rad live-overflow regression failed:');for(const f of failures)console.error('- '+f);process.exit(1);}
console.log('v786 Rad live-overflow regression PASS: Rad runtime uses container width, v785 local containment is preserved, and builder residue is absent.');
`;
write('check-rad-live-overflow-v786.mjs',guard);
const pkg=JSON.parse(read('package.json'));
if(!String(pkg.scripts['verify:static']).includes('check-rad-live-overflow-v786.mjs')) pkg.scripts['verify:static'] += ' && node check-rad-live-overflow-v786.mjs';
write('package.json',JSON.stringify(pkg,null,2)+'\n');
const checklist=JSON.parse(read('beta-live-write-checklist.json'));checklist.site_version=TARGET;write('beta-live-write-checklist.json',JSON.stringify(checklist,null,2)+'\n');
const readiness=JSON.parse(read('beta-readiness.json'));
readiness.site_version=`release candidate ${TARGET} / live ${CURRENT}`;
readiness.last_updated='2026-08-10';
readiness.deployment_identity=readiness.deployment_identity||{};
readiness.deployment_identity.live_version=CURRENT;
readiness.deployment_identity.frontend_release_merge='ae42b0bbe6efb3b15bd72e759008f9047a05a131';
readiness.deployment_identity.repository_head_at_audit='ae42b0bbe6efb3b15bd72e759008f9047a05a131';
readiness.deployment_identity.release_candidate_version=TARGET;
readiness.deployment_identity.note='2026-08-10 v785 deployment identity PASS but final freeze withheld: public VERSION v785, hardened 35-route live health, read-only beta surfaces and performance all passed; the 70-combination browser sweep passed 69/70 with zero serious/critical axe violations and isolated the sole remaining failure to Rad at 390px (420px document width). Targeted live geometry proved the Rad-only mobile runtime rule width:min(96vw,460px)!important overrides the v785 local containment. v786 replaces that viewport-sized override with container-bounded sizing. '+String(readiness.deployment_identity.note||'');
const staticIntegrity=(readiness.baseline_checks||[]).find(x=>x.id==='static_integrity');if(staticIntegrity&&!String(staticIntegrity.evidence).includes('v786 Rad')) staticIntegrity.evidence=String(staticIntegrity.evidence||'')+' v786 Rad live-overflow protects the shared mobile runtime from overriding container-bounded wheel sizing.';
write('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n');
write('VERSION',TARGET+'\n');
console.log('Prepared v786 Rad live-overflow release; run fix-version-drift.mjs next.');
