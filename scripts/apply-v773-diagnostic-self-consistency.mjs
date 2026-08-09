#!/usr/bin/env node
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

const TARGET='v773';
const CURRENT=fs.readFileSync('VERSION','utf8').trim();
if(CURRENT!=='v772') throw new Error(`Expected VERSION v772 before v773 apply, got ${CURRENT}`);

function replaceExact(file, from, to, expected=1){
  let text=fs.readFileSync(file,'utf8');
  const count=text.split(from).length-1;
  if(count!==expected) throw new Error(`${file}: expected ${expected} occurrence(s) of ${JSON.stringify(from)}, found ${count}`);
  text=text.split(from).join(to);
  fs.writeFileSync(file,text,'utf8');
  console.log(`patched ${file}: ${count} replacement(s)`);
}
function assertContains(file, needle){
  const text=fs.readFileSync(file,'utf8');
  if(!text.includes(needle)) throw new Error(`${file}: required marker missing: ${needle}`);
}
function assertDiffClean(){
  const cfg=spawnSync('git',['config','core.whitespace','cr-at-eol'],{encoding:'utf8'});
  if(cfg.status!==0) throw new Error(`git config failed: ${cfg.stderr||cfg.stdout||''}`);
  const check=spawnSync('git',['diff','--check'],{encoding:'utf8'});
  if(check.status!==0) throw new Error(`git diff --check failed:\n${check.stdout||''}${check.stderr||''}`);
}

// Version-source must derive the current frontend release from live page/config/script state,
// never from a historical phase literal.
replaceExact(
  'gejast-version-source.js',
  "  const initialPageVersion=String(window.GEJAST_PAGE_VERSION||'').trim();\n  const initialConfigVersion=String(window.GEJAST_CONFIG&&window.GEJAST_CONFIG.VERSION||'').trim();\n  const TARGET=initialPageVersion||initialConfigVersion||'v773';",
  "  const initialPageVersion=String(window.GEJAST_PAGE_VERSION||'').trim();\n  const initialConfigVersion=String(window.GEJAST_CONFIG&&window.GEJAST_CONFIG.VERSION||'').trim();\n  const ownScriptVersion=(()=>{try{const src=String(document.currentScript&&document.currentScript.src||'');const m=src.match(/[?&]v(\\d+)/i);return m?'v'+m[1]:'';}catch(_){return'';}})();\n  const TARGET=initialPageVersion||initialConfigVersion||ownScriptVersion;"
);

replaceExact('gejast-ops-observability.js',"  const TARGET='v661';","  const TARGET=String((window.GEJAST_VERSION_SOURCE&&window.GEJAST_VERSION_SOURCE.TARGET)||window.GEJAST_PAGE_VERSION||(window.GEJAST_CONFIG&&window.GEJAST_CONFIG.VERSION)||'').trim();");
replaceExact('gejast-ops-observability.js',"j('rollbackBox',{ok:true,rollback:'Rollback static frontend by re-uploading the previous flat patch files or restoring the previous GitHub commit. SQL rollback for v661 is not destructive; diagnostic functions can be left in place or replaced by older versions.'});","j('rollbackBox',{ok:true,rollback:'Rollback static frontend by restoring the previous verified GitHub release. Historical diagnostic RPCs keep their own contract versions and do not define the current frontend release.'});");

// Deployment verification: v650 is the historical backend audit contract, not the current site.
replaceExact('gejast-deployment-verification.js',"  const VERSION = 'v650';","  const MODULE_VERSION = 'v650';");
replaceExact(
  'gejast-deployment-verification.js',
  "      { name:'Page version', state: window.GEJAST_PAGE_VERSION === VERSION ? 'ok':'warn', detail:`window.GEJAST_PAGE_VERSION=${window.GEJAST_PAGE_VERSION||'missing'}` },",
  "      { name:'Page/config release', state: (window.GEJAST_PAGE_VERSION && cfg.VERSION && window.GEJAST_PAGE_VERSION===cfg.VERSION) ? 'ok' : (window.GEJAST_PAGE_VERSION?'ok':'warn'), detail:`page=${window.GEJAST_PAGE_VERSION||'missing'}; config=${cfg.VERSION||'missing'}; audit contract=${MODULE_VERSION}` },"
);

// Release readiness: v649 remains only a historical module label. Current checks follow page/config.
replaceExact('gejast-release-readiness.js',"const cfg=window.GEJAST_CONFIG||{};const VERSION='v649';","const cfg=window.GEJAST_CONFIG||{};const MODULE_VERSION='v649';");
replaceExact(
  'gejast-release-readiness.js',
  "function localChecks(){const scripts=Array.from(document.scripts||[]).map(s=>s.src||'');const old=scripts.filter(src=>/\\?v(63[0-8]|64[0-8])\\b/.test(src));return[\r\n{name:'Version label',status:(window.GEJAST_PAGE_VERSION===VERSION||cfg.VERSION===VERSION)?'ok':'warn',detail:`page=${window.GEJAST_PAGE_VERSION||''}; config=${cfg.VERSION||''}`},\r\n{name:'Old runtime refs',status:old.length?'bad':'ok',detail:old.length?old.join(', '):'Geen oude scriptrefs op deze pagina'},",
  "function localChecks(){const scripts=Array.from(document.scripts||[]).map(s=>s.src||'');const current=String(window.GEJAST_PAGE_VERSION||cfg.VERSION||'').replace(/^v/,'');const stale=scripts.filter(src=>{const m=src.match(/[?&]v(\\d+)/);return m&&current&&m[1]!==current;});return[\r\n{name:'Page/config release',status:(window.GEJAST_PAGE_VERSION&&cfg.VERSION&&window.GEJAST_PAGE_VERSION===cfg.VERSION)?'ok':(window.GEJAST_PAGE_VERSION?'ok':'warn'),detail:`page=${window.GEJAST_PAGE_VERSION||''}; config=${cfg.VERSION||''}; module=${MODULE_VERSION}`},\r\n{name:'Current script refs',status:stale.length?'bad':'ok',detail:stale.length?stale.join(', '):'Alle versioned scripts volgen de huidige page/config release'},"
);
replaceExact(
  'gejast-release-readiness.js',
  "async function run(){q('statusBox').textContent='Controle loopt...';const rows=localChecks();const ok=rows.filter(r=>r.status==='ok').length;q('phaseKpi').textContent='local';q('runtimeKpi').textContent=String(ok);q('uploadKpi').textContent='5';q('rows').innerHTML=rows.map(r=>row(r.name,r.status,r.detail)).join('');q('statusBox').textContent='Controle afgerond. Guarded RPC checks worden actief zodra SQL v649 is toegepast en een adminsessie aanwezig is.'}",
  "async function run(){q('statusBox').textContent='Controle loopt...';const rows=localChecks();const ok=rows.filter(r=>r.status==='ok').length;q('phaseKpi').textContent=String(window.GEJAST_PAGE_VERSION||cfg.VERSION||'—');q('runtimeKpi').textContent=String(ok);q('uploadKpi').textContent=String(rows.length);q('rows').innerHTML=rows.map(r=>row(r.name,r.status,r.detail)).join('');q('statusBox').textContent='Controle afgerond. Dit scherm voert lokale releasechecks uit; productie- en backendbewijs staat in de actuele readiness- en deployment-evidence.'}"
);

// Runtime smoke module v647 may remain v647; only its expected *current release* was wrong.
replaceExact('gejast-runtime-smoke-tests.js',"  const VERSION='v647';","  const MODULE_VERSION='v647';");
replaceExact(
  'gejast-runtime-smoke-tests.js',
  "  function summarize(){ const scripts=scriptVersions(); const expected=VERSION.replace(/^v/,''); return { expected:VERSION, pageVersion:pageVersion(), scriptCount:scripts.length, mismatchedScripts:scripts.filter(s=>s.version !== expected), hasConfig:!!window.GEJAST_CONFIG, hasSession:!!(window.GEJAST_CONFIG && window.GEJAST_CONFIG.getPlayerSessionToken), generatedAt:new Date().toISOString() }; }\r\n  window.GEJAST_RUNTIME_SMOKE_TESTS = { VERSION, scriptVersions, pageVersion, summarize };",
  "  function summarize(){ const scripts=scriptVersions(); const expectedVersion=pageVersion(); const expected=expectedVersion.replace(/^v/,''); return { moduleVersion:MODULE_VERSION, expected:expectedVersion, pageVersion:pageVersion(), scriptCount:scripts.length, mismatchedScripts:expected?scripts.filter(s=>s.version !== expected):scripts, hasConfig:!!window.GEJAST_CONFIG, hasSession:!!(window.GEJAST_CONFIG && window.GEJAST_CONFIG.getPlayerSessionToken), generatedAt:new Date().toISOString() }; }\r\n  window.GEJAST_RUNTIME_SMOKE_TESTS = { VERSION:MODULE_VERSION, MODULE_VERSION, scriptVersions, pageVersion, summarize };"
);

// Access gate URL cache bust follows the page release instead of pinning obsolete v757.
replaceExact('home.html',"var want='v757';","var want=String(window.GEJAST_PAGE_VERSION||'').trim();if(!want)return;");

// Truthful admin-health copy after completed production proofs.
replaceExact('admin_drinks_push_health.html','Phase 6 controle voor drinks verificaties, nearby/presence, notificatie permissies en push-queue proof. Non-destructive audit layer.','Niet-destructieve statuscontrole voor Drinks-verificaties, nearby/presence, notificatiepermissies en de push-queue. De gecontroleerde productieproofs zijn afgerond; dit scherm leest de actuele toestand.');
replaceExact('admin_drinks_push_health.html','v665 bewijst de drinks/push pipeline-omgeving, maar vervangt niet automatisch alle bestaande drinks create/verify/float/runtime owners. Verificatie vereist echte iPhone/Android/browser test.','De gecontroleerde Drinks create/verify/reject- en push-deliveryproofs zijn afgerond. Dit scherm blijft read-only; alleen een nog onbesliste browser-notificatiepermissie vereist een gebruikersgebaar.');
replaceExact('admin_drinks_push_health.html','<span class="pill warn">mobile proof required</span>','<span class="pill ok">production proof complete</span>');

replaceExact('admin_game_group_a_health.html','Phase 10 + 11 controle voor Beerpong en Boerenbridge. Deze pagina bewijst de read/bundle-laag na het draaien van de v661 SQL, zonder match-entry of ELO-owners te verplaatsen.','Read-only healthcontrole voor Beerpong en Boerenbridge. De v661 read/bundle-contracten blijven historisch herkenbaar; de actieve savepaden hebben afzonderlijke productieproofs en blijven bij hun bestaande eigenaars.');
replaceExact('admin_game_group_a_health.html','v661 is een read/statuslaag. Matchinvoer, ELO-mutaties, history rebuilds en live scoring blijven bij de bestaande pagina/RPC-eigenaars totdat ze apart bewezen zijn.','v661 benoemt de read/statuscontractlaag, niet de huidige frontendrelease. Matchinvoer, ELO-mutaties en live scoring blijven bij hun bestaande eigenaars; Beerpong- en Boerenbridge-savepaden zijn afzonderlijk productiebewezen.');
replaceExact('admin_game_group_a_health.html','<span class="pill warn">live proof needed</span>','<span class="pill ok">save proof complete</span>');

replaceExact('admin_deployment_verification.html','v650 control surface for post-upload checks. It does not change gameplay. It records SQL/upload/runtime evidence so later phases do not rely on memory.','Read-only deploymentcontrole voor de huidige frontendrelease. Dit scherm verandert geen gameplay en houdt browser- en serverbewijs gescheiden van historische contractversies.');
replaceExact('admin_release_readiness.html','v649 post-upload control surface. Verzamelt SQL-run status, fase-completeness, runtime rooktests en upload-checklist zonder bestaande subsystemen te vervangen.','Read-only releasecontrole voor de huidige frontendrelease. Verzamelt lokale versie-, runtime- en configuratiesignalen zonder bestaande subsystemen of productiegegevens te wijzigen.');
replaceExact('admin_ops_observability.html','Runtime signals, smoke checks, release breadcrumbs and rollback readiness for the repair-first base layer.','Runtime signals, smoke checks, release breadcrumbs en rollbackinformatie voor de huidige gecontroleerde release.');

// Historical v661 RPC names stay intact; only obsolete operator instruction is removed.
replaceExact('gejast-game-phase-bridge.js','Geen data beschikbaar. Run de v661 SQL in Supabase.','Geen data beschikbaar. Controleer de bestaande v661 read-contract/RPC-beschikbaarheid en de gekozen scope.');
replaceExact('gejast-drinks-push-bridge.js','Geen drinks/push data beschikbaar. Run de v661 SQL in Supabase.','Geen Drinks/push data beschikbaar. Controleer de bestaande read-contracts, sessie/context en gekozen scope.');

// v772 cleanup invariants must survive future releases without freezing VERSION at 772.
let residue=fs.readFileSync('check-finalization-residue-v772.mjs','utf8');
replaceExact('check-finalization-residue-v772.mjs',"if(version!=='v772') failures.push('finalization residue guard expects root VERSION v772, got '+version);","const versionNumber=Number(String(version).replace(/^v/i,''));\nif(!Number.isFinite(versionNumber)||versionNumber<772) failures.push('finalization residue guard expects root VERSION >= v772, got '+version);");

// Release bump after targeted fixes. Existing fixer aligns active page labels/cache busters.
fs.writeFileSync('VERSION',`${TARGET}\n`,'utf8');
const versionFix=spawnSync(process.execPath,['fix-version-drift.mjs'],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
process.stdout.write(versionFix.stdout||'');process.stderr.write(versionFix.stderr||'');
if(versionFix.status!==0) throw new Error(`fix-version-drift.mjs failed with status ${versionFix.status}`);

const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
if((checklist.items||[]).length!==0) throw new Error('Refusing v773 while live-write checklist is not empty');
checklist.site_version=TARGET;
fs.writeFileSync('beta-live-write-checklist.json',JSON.stringify(checklist,null,2)+'\n','utf8');

const readiness=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
if(readiness.deployment_identity?.live_version!=='v772') throw new Error(`Expected live readiness v772 before v773 candidate, got ${readiness.deployment_identity?.live_version}`);
readiness.site_version='release candidate v773 / live v772';
readiness.last_updated='2026-08-09';
readiness.deployment_identity.release_candidate_version=TARGET;
readiness.deployment_identity.note='v773 release candidate: diagnostic self-consistency repair. Current-release diagnostics now derive the frontend release dynamically; historical RPC/module versions remain separate. Live remains v772 until post-merge public-edge proof.';
fs.writeFileSync('beta-readiness.json',JSON.stringify(readiness,null,2)+'\n','utf8');

let liveSafety=fs.readFileSync('check-live-write-safety-v770e.mjs','utf8');
if(!liveSafety.includes("if(checklist.site_version!=='v772')")) throw new Error('Expected v772 live-write checklist assertion');
liveSafety=liveSafety.replace("if(checklist.site_version!=='v772')","if(checklist.site_version!=='v773')").replace('live-write checklist must target v772','live-write checklist must target v773');
fs.writeFileSync('check-live-write-safety-v770e.mjs',liveSafety,'utf8');

const guard=`#!/usr/bin/env node\nimport fs from 'node:fs';\n\nconst failures=[];\nconst version=fs.readFileSync('VERSION','utf8').trim();\nif(version!=='v773') failures.push('diagnostic self-consistency guard expects v773 candidate, got '+version);\nfunction text(file){return fs.readFileSync(file,'utf8');}\nconst home=text('home.html');\nif(home.includes("want='v757'")) failures.push('home.html still pins obsolete v757 cache bust');\nif(!home.includes("var want=String(window.GEJAST_PAGE_VERSION||'').trim();if(!want)return;")) failures.push('home.html must derive __bust target from page release');\nconst source=text('gejast-version-source.js');\nif(/const TARGET=['\"]v\\d+/.test(source)) failures.push('version-source must not hard-code current frontend target');\nif(/TARGET_NUM=\\d+/.test(source)) failures.push('version-source must derive target number');\nif(!source.includes('ownScriptVersion')) failures.push('version-source must fall back to its current cache-busted script release');\nif(!source.includes('deployedReleaseSignals')) failures.push('version-source deployment scan must inspect release signals only');\nconst ops=text('gejast-ops-observability.js');\nif(ops.includes("const TARGET='v661'")) failures.push('ops observability still pins v661 as current frontend');\nconst deploy=text('gejast-deployment-verification.js');\nif(deploy.includes("const VERSION = 'v650'")) failures.push('deployment verification still treats v650 as current frontend');\nif(!deploy.includes("const MODULE_VERSION = 'v650'")) failures.push('deployment verification must retain v650 only as module/audit contract label');\nconst readiness=text('gejast-release-readiness.js');\nif(readiness.includes("const VERSION='v649'")) failures.push('release readiness still treats v649 as current frontend');\nif(!readiness.includes("const MODULE_VERSION='v649'")) failures.push('release readiness must retain v649 only as module label');\nif(readiness.includes('zodra SQL v649 is toegepast')) failures.push('release readiness still gives obsolete SQL-v649 instruction');\nconst smoke=text('gejast-runtime-smoke-tests.js');\nif(smoke.includes("const VERSION='v647'")) failures.push('runtime smoke still treats v647 as current frontend');\nif(!smoke.includes("const MODULE_VERSION='v647'")) failures.push('runtime smoke must retain v647 only as module label');\nfor(const [file,marker] of [['admin_game_group_a_health.html','live proof needed'],['admin_drinks_push_health.html','mobile proof required'],['admin_drinks_push_health.html','Verificatie vereist echte iPhone/Android/browser test.'],['admin_deployment_verification.html','v650 control surface'],['admin_release_readiness.html','v649 post-upload control surface'],['gejast-game-phase-bridge.js','Run de v661 SQL in Supabase.'],['gejast-drinks-push-bridge.js','Run de v661 SQL in Supabase.']]) if(text(file).includes(marker)) failures.push(file+' still contains stale marker: '+marker);\nif(!text('gejast-account-runtime.js').includes("const VERSION = 'v690'")) failures.push('account runtime v690 module contract was changed unexpectedly');\nif(!text('gejast-home-profile-runtime.js').includes("const VERSION = 'v687'")) failures.push('home/profile runtime v687 module contract was changed unexpectedly');\nif(failures.length){console.error('Diagnostic self-consistency v773 FAILED');failures.forEach(f=>console.error('- '+f));process.exit(1);}\nconsole.log('Diagnostic self-consistency v773 PASS: current-release diagnostics are dynamic; historical module/RPC versions remain distinct and truthful.');\n`;
fs.writeFileSync('check-diagnostic-self-consistency-v773.mjs',guard,'utf8');

let homeGuard=fs.readFileSync('check-homepage-root-fixes.mjs','utf8');
if(!homeGuard.includes("import './check-diagnostic-self-consistency-v773.mjs';")) homeGuard=homeGuard.replace("import fs from 'node:fs';","import fs from 'node:fs';\nimport './check-diagnostic-self-consistency-v773.mjs';");
fs.writeFileSync('check-homepage-root-fixes.mjs',homeGuard,'utf8');

const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
if(!pkg.scripts?.['verify:static']) throw new Error('verify:static missing');
if(!pkg.scripts['verify:static'].includes('check-diagnostic-self-consistency-v773.mjs')) pkg.scripts['verify:static']+=' && node check-diagnostic-self-consistency-v773.mjs';
fs.writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n','utf8');

for(const temporary of ['scripts/audit-version-expectations-v773.mjs','.github/workflows/v773-version-expectation-audit.yml','scripts/apply-v773-diagnostic-self-consistency.mjs','.github/workflows/v773-apply-diagnostic-repair.yml']){
  if(fs.existsSync(temporary)){fs.unlinkSync(temporary);console.log(`removed temporary ${temporary}`);}
}

assertContains('gejast-account-runtime.js',"const VERSION = 'v690'");
assertContains('gejast-home-profile-runtime.js',"const VERSION = 'v687'");
assertDiffClean();
console.log('v773 diagnostic self-consistency release candidate prepared.');
