#!/usr/bin/env node

const baseUrl=process.env.GEJAST_LIVE_BASE_URL||'https://kalenel.nl';
const timeoutMs=Number(process.env.GEJAST_SMOKE_TIMEOUT_MS||15000);
const waitSeconds=Math.max(0,Number(process.env.GEJAST_DEPLOY_WAIT_SECONDS||120));
const cacheBuster=`${Date.now()}-${Math.random().toString(36).slice(2)}`;
const failures=[];

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}
function makeUrl(path){const u=new URL(path,baseUrl);u.searchParams.set('cb',cacheBuster);return u.toString();}
async function get(path){const c=new AbortController();const t=setTimeout(()=>c.abort(),timeoutMs);try{return await fetch(makeUrl(path),{cache:'no-store',redirect:'manual',signal:c.signal});}finally{clearTimeout(t);}}
async function text(path){const res=await get(path);const body=await res.text();console.log(`${path} HTTP ${res.status}; bytes=${body.length}`);if(!res.ok)failures.push(`${path} expected HTTP 200, got ${res.status}`);return body;}

const deadline=Date.now()+waitSeconds*1000;
let live='';
do{
  try{const res=await get('/VERSION');live=(await res.text()).trim();console.log(`/VERSION HTTP ${res.status}; body=${JSON.stringify(live)}`);if(res.ok&&live==='v773')break;}catch(e){console.warn(String(e&&e.message||e));}
  if(Date.now()>=deadline)break;
  await sleep(5000);
}while(true);
if(live!=='v773')failures.push(`/VERSION expected v773, got ${JSON.stringify(live||'(empty)')}`);

const home=await text('/home.html');
if(!home.includes("GEJAST_PAGE_VERSION='v773'"))failures.push('home.html missing v773 page marker');
if(home.includes("want='v757'"))failures.push('home.html still serves obsolete v757 __bust target');
if(!home.includes("var want=String(window.GEJAST_PAGE_VERSION||'').trim();if(!want)return;"))failures.push('home.html missing dynamic page-release cache bust');

const source=await text('/gejast-version-source.js');
if(source.includes("const TARGET='v661'"))failures.push('version-source still pins v661');
if(/TARGET_NUM=\d+/.test(source))failures.push('version-source still hard-codes target number');
if(!source.includes('ownScriptVersion'))failures.push('version-source missing cache-busted current-script fallback');
if(!source.includes('deployedReleaseSignals'))failures.push('version-source missing release-signal-only deployed scan');

const ops=await text('/gejast-ops-observability.js');
if(ops.includes("const TARGET='v661'"))failures.push('ops observability still pins v661 as current release');
if(!ops.includes('Historical diagnostic RPCs keep their own contract versions'))failures.push('ops observability missing truthful historical-contract guidance');

const deploy=await text('/gejast-deployment-verification.js');
if(deploy.includes("const VERSION = 'v650'"))failures.push('deployment verifier still treats v650 as current release');
if(!deploy.includes("const MODULE_VERSION = 'v650'"))failures.push('deployment verifier missing historical module label');
if(!deploy.includes("name:'Page/config release'"))failures.push('deployment verifier missing current page/config release check');

const ready=await text('/gejast-release-readiness.js');
if(ready.includes("const VERSION='v649'"))failures.push('release readiness still treats v649 as current release');
if(!ready.includes("const MODULE_VERSION='v649'"))failures.push('release readiness missing historical module label');
if(ready.includes('zodra SQL v649 is toegepast'))failures.push('release readiness still serves obsolete v649 SQL guidance');

const smoke=await text('/gejast-runtime-smoke-tests.js');
if(smoke.includes("const VERSION='v647'"))failures.push('runtime smoke still treats v647 as current release');
if(!smoke.includes("const MODULE_VERSION='v647'"))failures.push('runtime smoke missing historical module identity');
if(!smoke.includes('const expectedVersion=pageVersion()'))failures.push('runtime smoke missing current release expectation');

const drinks=await text('/gejast-drinks-push-bridge.js');
if(drinks.includes('Run de v661 SQL in Supabase.'))failures.push('Drinks/push bridge still serves obsolete SQL instruction');
const games=await text('/gejast-game-phase-bridge.js');
if(games.includes('Run de v661 SQL in Supabase.'))failures.push('game phase bridge still serves obsolete SQL instruction');

if(failures.length){console.error(`v773 public diagnostic edge proof FAILED (${failures.length})`);failures.forEach(f=>console.error('- '+f));process.exit(1);}
console.log('v773 public diagnostic edge proof PASS: current release logic and truthful diagnostic assets are deployed on the public edge.');
