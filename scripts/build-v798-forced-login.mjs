#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';

const VERSION='v798';
fs.writeFileSync('VERSION',VERSION+'\n');

fs.writeFileSync('gejast-auth-gate.js',`(function(){
  'use strict';
  const root=document.documentElement;
  const SESSION_KEY='jas_session_token_v11';
  const LEGACY_SESSION_KEY='jas_session_token_v10';
  const ACTIVITY_KEY='jas_last_activity_at_v1';
  const CONFIG_SRC='/gejast-config.js?v798';
  root.setAttribute('data-gejast-auth-state','checking');
  root.style.setProperty('visibility','hidden','important');

  function requestedScope(){
    try{
      const params=new URLSearchParams(location.search||'');
      const explicit=String(params.get('scope')||'').toLowerCase();
      if(explicit==='family'||explicit==='familie') return 'family';
      if(/^\\/familie(?:\\/|\\.html|$)/i.test(location.pathname||'')) return 'family';
    }catch(_){ }
    return 'friends';
  }
  function loginTarget(){
    return '/login.html'+(requestedScope()==='family'?'?scope=family':'');
  }
  function readToken(){
    try{return String(localStorage.getItem(SESSION_KEY)||localStorage.getItem(LEGACY_SESSION_KEY)||'').trim();}
    catch(_){return '';}
  }
  function clearSession(){
    try{localStorage.removeItem(SESSION_KEY);localStorage.removeItem(LEGACY_SESSION_KEY);localStorage.removeItem(ACTIVITY_KEY);}catch(_){ }
  }
  function deny({clear=false}={}){
    if(clear) clearSession();
    root.setAttribute('data-gejast-auth-state','denied');
    location.replace(loginTarget());
  }
  function reveal(){
    try{localStorage.setItem(ACTIVITY_KEY,String(Date.now()));}catch(_){ }
    root.setAttribute('data-gejast-auth-state','authenticated');
    root.style.removeProperty('visibility');
  }
  function loadConfig(){
    if(window.GEJAST_CONFIG?.SUPABASE_URL&&window.GEJAST_CONFIG?.SUPABASE_PUBLISHABLE_KEY) return Promise.resolve(window.GEJAST_CONFIG);
    return new Promise((resolve,reject)=>{
      const existing=[...document.scripts].find(s=>/\\/gejast-config\\.js(?:[?#]|$)/.test(s.src||''));
      const script=existing||document.createElement('script');
      let settled=false;
      const done=()=>{
        if(settled) return;
        if(window.GEJAST_CONFIG?.SUPABASE_URL&&window.GEJAST_CONFIG?.SUPABASE_PUBLISHABLE_KEY){settled=true;resolve(window.GEJAST_CONFIG);}
      };
      const fail=()=>{if(!settled){settled=true;reject(new Error('auth_config_unavailable'));}};
      script.addEventListener('load',done,{once:true});
      script.addEventListener('error',fail,{once:true});
      if(!existing){script.src=CONFIG_SRC;script.async=false;(document.head||document.documentElement).appendChild(script);}
      queueMicrotask(done);
      setTimeout(fail,8000);
    });
  }
  async function validate(token){
    const cfg=await loadConfig();
    const url=String(cfg.SUPABASE_URL||'').replace(/\\/+$/,'')+'/rest/v1/rpc/account_public_state_v687';
    const key=String(cfg.SUPABASE_PUBLISHABLE_KEY||'').trim();
    if(!url||!key) throw new Error('auth_config_invalid');
    const controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),8000);
    try{
      const response=await fetch(url,{
        method:'POST',
        headers:{'Content-Type':'application/json',Accept:'application/json',apikey:key,Authorization:'Bearer '+key},
        body:JSON.stringify({session_token:token,session_token_input:token,site_scope_input:requestedScope()}),
        signal:controller.signal,
        cache:'no-store'
      });
      if(!response.ok) throw new Error('auth_rpc_http_'+response.status);
      const data=await response.json();
      return data&&data.ok===true;
    }finally{clearTimeout(timeout);}
  }

  const token=readToken();
  if(!token){deny();return;}
  window.GEJAST_AUTH_GATE=validate(token).then(ok=>{if(ok)reveal();else deny({clear:true});return ok;}).catch(()=>{deny();return false;});
})();
`);

const ignoredDirs=new Set(['.git','node_modules','dist','build','.next','.vercel','coverage','tmp','temp','patch_bundles','repo','mnt','cloudflare']);
const publicAuth=new Set(['login.html','request.html','activate.html']);
function walk(dir,out=[]){
  for(const ent of fs.readdirSync(dir,{withFileTypes:true})){
    if(ent.isDirectory()){
      if(!ignoredDirs.has(ent.name)) walk(path.join(dir,ent.name),out);
    }else if(ent.name.toLowerCase().endsWith('.html')) out.push(path.join(dir,ent.name));
  }
  return out;
}
function norm(file){return path.relative(process.cwd(),file).replaceAll('\\','/');}
function adminOwned(rel){
  const base=path.basename(rel).toLowerCase();
  return base==='admin.html'||base.startsWith('admin_')||base.startsWith('admin-')||rel.startsWith('admin/');
}
let injected=0;
for(const file of walk(process.cwd())){
  const rel=norm(file);
  if(publicAuth.has(rel)||adminOwned(rel)) continue;
  let text=fs.readFileSync(file,'utf8');
  if(text.includes('/gejast-auth-gate.js?')) continue;
  const marker='<script src="/gejast-auth-gate.js?v798"></script>';
  const next=text.replace(/<head(\s[^>]*)?>/i,m=>m+marker);
  if(next===text) throw new Error('Cannot inject auth gate into '+rel);
  fs.writeFileSync(file,next);
  injected++;
}
if(injected<40) throw new Error('Unexpectedly small protected HTML inventory: '+injected);
console.log('Injected forced-login gate into',injected,'HTML pages.');

let runtime=fs.readFileSync('gejast-account-runtime.js','utf8');
const targetRx=/function loginReturnTarget\(\)\{[\s\S]*?\n  \}/;
if(!targetRx.test(runtime)) throw new Error('loginReturnTarget owner not found');
runtime=runtime.replace(targetRx,`function loginReturnTarget(){
    try{
      const scope=String(new URLSearchParams(location.search||'').get('scope')||'').toLowerCase();
      return scope==='family'||scope==='familie'?'./index.html?scope=family':'./index.html';
    }catch(_){return './index.html';}
  }`);
fs.writeFileSync('gejast-account-runtime.js',runtime);

const beta=JSON.parse(fs.readFileSync('beta-readiness.json','utf8'));
beta.site_version='release candidate v798 / live v797'; beta.last_updated='2026-08-16';
if(beta.deployment_identity){beta.deployment_identity.live_version='v797';beta.deployment_identity.release_candidate_version='v798';}
fs.writeFileSync('beta-readiness.json',JSON.stringify(beta,null,2)+'\n');
const gameplay=JSON.parse(fs.readFileSync('gameplay-acceptance.json','utf8'));
gameplay.site_version='v798'; gameplay.last_updated='2026-08-16';
fs.writeFileSync('gameplay-acceptance.json',JSON.stringify(gameplay,null,2)+'\n');
const checklist=JSON.parse(fs.readFileSync('beta-live-write-checklist.json','utf8'));
checklist.site_version='v798'; fs.writeFileSync('beta-live-write-checklist.json',JSON.stringify(checklist,null,2)+'\n');
const cert=JSON.parse(fs.readFileSync('release-certification.json','utf8'));
cert.current_version='v798'; cert.status='REVALIDATION_REQUIRED'; cert.current_audit_issue=153;
cert.reason='v798 reinstates a fail-closed player forced-login boundary across every published non-admin, non-account-entry HTML page. Protected UI stays hidden until account_public_state_v687 proves an unexpired scoped player session; missing/invalid sessions redirect to canonical login, and successful login always lands on the main index page. Exact-main live auth and gameplay revalidation is required before PASS.';
fs.writeFileSync('release-certification.json',JSON.stringify(cert,null,2)+'\n');

fs.writeFileSync('check-v798-forced-login-gate.mjs',`#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const version=fs.readFileSync('VERSION','utf8').trim();
const current=Number((version.match(/\\d+/)||['0'])[0]);
assert.ok(current>=798,'v798 forced-login contract requires VERSION v798 or newer');
const gate=fs.readFileSync('gejast-auth-gate.js','utf8');
for(const required of ["root.style.setProperty('visibility','hidden','important')",'account_public_state_v687',"data-gejast-auth-state','checking'","data-gejast-auth-state','authenticated'",'location.replace(loginTarget())',"session_token_input:token","site_scope_input:requestedScope()"]){assert(gate.includes(required),\`auth gate missing required fail-closed owner: \${required}\`);}
assert(!gate.includes('/rest/v1/rpc/get_public_state'),'forced-login security boundary must not depend on stale get_public_state alias');
const runtime=fs.readFileSync('gejast-account-runtime.js','utf8');
const target=runtime.match(/function loginReturnTarget\\(\\)\\{[\\s\\S]*?\\n  \\}/)?.[0]||'';
assert(target.includes("'./index.html'"),'successful login must land on main index');
assert(target.includes("'./index.html?scope=family'"),'family login must land on scoped main index');
assert(!target.includes('return_to'),'successful login must not deep-link around the main page');
const ignoredDirs=new Set(['.git','node_modules','dist','build','.next','.vercel','coverage','tmp','temp','patch_bundles','repo','mnt','cloudflare']);
const authPublic=new Set(['login.html','request.html','activate.html']);
function walk(dir,out=[]){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){if(ent.isDirectory()){if(!ignoredDirs.has(ent.name))walk(path.join(dir,ent.name),out);}else if(ent.name.toLowerCase().endsWith('.html'))out.push(path.join(dir,ent.name));}return out;}
function rel(file){return path.relative(process.cwd(),file).replaceAll('\\\\','/');}
function adminOwned(r){const base=path.basename(r).toLowerCase();return base==='admin.html'||base.startsWith('admin_')||base.startsWith('admin-')||r.startsWith('admin/');}
const missing=[]; const leaked=[]; let protectedCount=0;
for(const file of walk(process.cwd())){const r=rel(file);const body=fs.readFileSync(file,'utf8');if(authPublic.has(r)){if(body.includes('/gejast-auth-gate.js?'))leaked.push(r);continue;}if(adminOwned(r))continue;protectedCount++;if(!/<head(?:\\s[^>]*)?><script src="\\/gejast-auth-gate\\.js\\?v\\d+"><\\/script>/i.test(body))missing.push(r);}
assert(protectedCount>=40,\`protected publication inventory unexpectedly small: \${protectedCount}\`);
assert.deepEqual(missing,[],\`published pages missing forced-login gate:\\n\${missing.join('\\n')}\`);
assert.deepEqual(leaked,[],\`account-entry pages must remain reachable while logged out:\\n\${leaked.join('\\n')}\`);
for(const r of ['index.html','home.html','toepen.html','boerenbridge.html','beerpong.html','pikken.html','paardenrace.html','klaverjas_online.html','rad.html'])assert(fs.readFileSync(r,'utf8').includes('/gejast-auth-gate.js?'),\`representative protected page lacks gate: \${r}\`);
console.log('v798 forced-login publication boundary ok; protected pages=',protectedCount);
`);

const pkg=JSON.parse(fs.readFileSync('package.json','utf8'));
const marker='node check-v797-watermark-separator-hardening.mjs';
const next='node check-v798-forced-login-gate.mjs';
if(!pkg.scripts['verify:static'].includes(next)){
  if(!pkg.scripts['verify:static'].includes(marker)) throw new Error('v797 verification marker missing');
  pkg.scripts['verify:static']=pkg.scripts['verify:static'].replace(marker,marker+' && '+next);
}
fs.writeFileSync('package.json',JSON.stringify(pkg,null,2)+'\n');

console.log('v798 build prepared. Run node fix-version-drift.mjs before commit.');
