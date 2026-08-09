#!/usr/bin/env node
import fs from 'node:fs';

const failures=[];
const version=fs.readFileSync('VERSION','utf8').trim();
const versionNumber=Number((version.match(/v(\d+)/i)||[])[1]||0);
if(versionNumber<773) failures.push('diagnostic self-consistency guard requires VERSION >= v773, got '+version);
function text(file){return fs.readFileSync(file,'utf8');}
const home=text('home.html');
if(home.includes("want='v757'")) failures.push('home.html still pins obsolete v757 cache bust');
if(!home.includes("var want=String(window.GEJAST_PAGE_VERSION||'').trim();if(!want)return;")) failures.push('home.html must derive __bust target from page release');
const source=text('gejast-version-source.js');
if(/const TARGET=['"]v\d+/.test(source)) failures.push('version-source must not hard-code current frontend target');
if(/TARGET_NUM=\d+/.test(source)) failures.push('version-source must derive target number');
if(!source.includes('ownScriptVersion')) failures.push('version-source must fall back to its current cache-busted script release');
if(!source.includes('deployedReleaseSignals')) failures.push('version-source deployment scan must inspect release signals only');
const ops=text('gejast-ops-observability.js');
if(ops.includes("const TARGET='v661'")) failures.push('ops observability still pins v661 as current frontend');
if(!ops.includes('Historical diagnostic RPCs keep their own contract versions')) failures.push('ops observability rollback note must distinguish historical RPC contracts from current frontend release');
const deploy=text('gejast-deployment-verification.js');
if(deploy.includes("const VERSION = 'v650'")) failures.push('deployment verification still treats v650 as current frontend');
if(!deploy.includes("const MODULE_VERSION = 'v650'")) failures.push('deployment verification must retain v650 only as module/audit contract label');
if(!deploy.includes("name:'Page/config release'")) failures.push('deployment verification must compare current page/config release instead of module version');
const readiness=text('gejast-release-readiness.js');
if(readiness.includes("const VERSION='v649'")) failures.push('release readiness still treats v649 as current frontend');
if(!readiness.includes("const MODULE_VERSION='v649'")) failures.push('release readiness must retain v649 only as module label');
if(readiness.includes('zodra SQL v649 is toegepast')) failures.push('release readiness still gives obsolete SQL-v649 instruction');
if(!readiness.includes('productie- en backendbewijs staat in de actuele readiness- en deployment-evidence')) failures.push('release readiness must point operators to current evidence instead of old SQL phase instructions');
const smoke=text('gejast-runtime-smoke-tests.js');
if(smoke.includes("const VERSION='v647'")) failures.push('runtime smoke still treats v647 as current frontend');
if(!smoke.includes("const MODULE_VERSION='v647'")) failures.push('runtime smoke must retain v647 only as module label');
if(!smoke.includes('const expectedVersion=pageVersion()')) failures.push('runtime smoke must derive expected script release from current page/config state');
for(const [file,marker] of [['admin_game_group_a_health.html','live proof needed'],['admin_drinks_push_health.html','mobile proof required'],['admin_drinks_push_health.html','Verificatie vereist echte iPhone/Android/browser test.'],['admin_deployment_verification.html','v650 control surface'],['admin_release_readiness.html','v649 post-upload control surface'],['gejast-game-phase-bridge.js','Run de v661 SQL in Supabase.'],['gejast-drinks-push-bridge.js','Run de v661 SQL in Supabase.']]) if(text(file).includes(marker)) failures.push(file+' still contains stale marker: '+marker);
if(!text('admin_drinks_push_health.html').includes('production proof complete')) failures.push('Drinks/push health page must state completed production proof');
if(!text('admin_game_group_a_health.html').includes('save proof complete')) failures.push('game group A health page must state completed save proof');
if(!text('gejast-game-phase-bridge.js').includes('Controleer de bestaande v661 read-contract/RPC-beschikbaarheid en de gekozen scope.')) failures.push('game phase bridge must use current troubleshooting guidance');
if(!text('gejast-drinks-push-bridge.js').includes('Controleer de bestaande read-contracts, sessie/context en gekozen scope.')) failures.push('Drinks/push bridge must use current troubleshooting guidance');
if(!text('gejast-account-runtime.js').includes("const VERSION = 'v690'")) failures.push('account runtime v690 module contract was changed unexpectedly');
if(!text('gejast-home-profile-runtime.js').includes("const VERSION = 'v687'")) failures.push('home/profile runtime v687 module contract was changed unexpectedly');
if(failures.length){console.error('Diagnostic self-consistency v773 FAILED');failures.forEach(f=>console.error('- '+f));process.exit(1);}
console.log('Diagnostic self-consistency v773 PASS: v773+ releases preserve dynamic current-release diagnostics and distinct historical module/RPC versions.');