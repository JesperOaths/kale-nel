#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
const version=fs.readFileSync('VERSION','utf8').trim();
const current=Number((version.match(/\d+/)||['0'])[0]);
assert.ok(current>=798,'v798 forced-login contract requires VERSION v798 or newer');
const gate=fs.readFileSync('gejast-auth-gate.js','utf8');
for(const required of ["root.style.setProperty('visibility','hidden','important')",'account_public_state_v687',"data-gejast-auth-state','checking'","data-gejast-auth-state','authenticated'",'location.replace(loginTarget())',"session_token_input:token","site_scope_input:requestedScope()"]){assert(gate.includes(required),`auth gate missing required fail-closed owner: ${required}`);}
assert(!gate.includes('/rest/v1/rpc/get_public_state'),'forced-login security boundary must not depend on stale get_public_state alias');
const runtime=fs.readFileSync('gejast-account-runtime.js','utf8');
const target=runtime.match(/function loginReturnTarget\(\)\{[\s\S]*?\n  \}/)?.[0]||'';
assert(target.includes("'./index.html'"),'successful login must land on main index');
assert(target.includes("'./index.html?scope=family'"),'family login must land on scoped main index');
assert(!target.includes('return_to'),'successful login must not deep-link around the main page');
const ignoredDirs=new Set(['.git','node_modules','dist','build','.next','.vercel','coverage','tmp','temp','patch_bundles','repo','mnt','cloudflare']);
const authPublic=new Set(['login.html','request.html','activate.html']);
const intentionalPublic=new Set(['shop/index.html']);
const redirectOnly=new Set(['score.html','pikken_spectator.html','klaverjas_live_v596.html','familie/index.html','familie/login.html','familie/scorer.html','familie/leaderboard.html','familie/player.html']);
function walk(dir,out=[]){for(const ent of fs.readdirSync(dir,{withFileTypes:true})){if(ent.isDirectory()){if(!ignoredDirs.has(ent.name))walk(path.join(dir,ent.name),out);}else if(ent.name.toLowerCase().endsWith('.html'))out.push(path.join(dir,ent.name));}return out;}
function rel(file){return path.relative(process.cwd(),file).replaceAll('\\','/');}
function separatelyProtected(r){const base=path.basename(r).toLowerCase();return base==='admin.html'||base.startsWith('admin_')||base.startsWith('admin-')||r.startsWith('admin/')||r.startsWith('security/')||r.startsWith('parfum/');}
const securityIndex='security/index.html';
assert.ok(fs.existsSync(securityIndex),'private security surface missing');
const securityBody=fs.readFileSync(securityIndex,'utf8');
assert(!securityBody.includes('/gejast-auth-gate.js?'),'security perimeter must not depend on player-session gate');
for(const required of ['Private security login','/security/auth/login','/security/auth/logout','/api/status']) assert(securityBody.includes(required),`security perimeter missing independent auth contract: ${required}`);
assert(securityBody.includes("fetch(`/security/${camera}/api/status`"),'security perimeter must status-check the selected protected camera source');
assert(securityBody.includes("api('new','/api/status')")&&securityBody.includes("api('s3','/api/status')"),'security live view must status-check both protected camera sources');
const perfumeIndex='parfum/index.html';
assert.ok(fs.existsSync(perfumeIndex),'private perfume surface missing');
const perfumeBody=fs.readFileSync(perfumeIndex,'utf8');
assert(!perfumeBody.includes('/gejast-auth-gate.js?'),'perfume admin surface must not depend on player-session gate');
for(const required of ["rpc('admin_login'",'/rest/v1/rpc/${name}','/functions/v1/perfume-dashboard','admin_session_token','Authenticator code']) assert(perfumeBody.includes(required),`perfume perimeter missing independent admin auth contract: ${required}`);
assert(perfumeBody.includes("credentials:'omit'"),'perfume browser requests must not inherit ambient credential cookies');
assert(!/service[_-]?role/i.test(perfumeBody),'perfume browser surface must never contain a service-role credential');
const shopIndex='shop/index.html';
assert.ok(fs.existsSync(shopIndex),'public Bruis shop surface missing');
const shopBody=fs.readFileSync(shopIndex,'utf8');
assert(!shopBody.includes('/gejast-auth-gate.js?'),'public Bruis shop must not inherit the private player-session gate');
assert(!/service[_-]?role/i.test(shopBody),'public Bruis shop must never contain a service-role credential');
assert(!/admin_session_token/i.test(shopBody),'public Bruis shop must never contain an admin-session credential');
const missing=[]; const leaked=[]; const publicGateLeaks=[]; let protectedCount=0;
for(const file of walk(process.cwd())){
  const r=rel(file);const body=fs.readFileSync(file,'utf8');
  if(authPublic.has(r)){if(body.includes('/gejast-auth-gate.js?'))leaked.push(r);continue;}
  if(intentionalPublic.has(r)){if(body.includes('/gejast-auth-gate.js?'))publicGateLeaks.push(r);continue;}
  if(redirectOnly.has(r)){
    if(body.includes('/gejast-auth-gate.js?')) leaked.push(r);
    assert(/location\.replace\(/.test(body),`runtime-light alias must immediately hand off to a canonical protected/auth page: ${r}`);
    continue;
  }
  if(separatelyProtected(r))continue;
  protectedCount++;
  if(!/<head(?:\s[^>]*)?><script src="\/gejast-auth-gate\.js\?v\d+"><\/script>/i.test(body))missing.push(r);
}
assert(protectedCount>=40,`protected publication inventory unexpectedly small: ${protectedCount}`);
assert.deepEqual(missing,[],`published pages missing forced-login gate:\n${missing.join('\n')}`);
assert.deepEqual(leaked,[],`auth-entry/redirect-only pages must not bootstrap the player gate:\n${leaked.join('\n')}`);
assert.deepEqual(publicGateLeaks,[],`intentional public commerce pages must remain outside the private player-session gate:\n${publicGateLeaks.join('\n')}`);
for(const r of ['index.html','home.html','toepen.html','boerenbridge.html','beerpong.html','pikken.html','paardenrace.html','klaverjas_online.html','rad.html'])assert(fs.readFileSync(r,'utf8').includes('/gejast-auth-gate.js?'),`representative protected page lacks gate: ${r}`);
console.log('v798 forced-login publication boundary ok; gated app pages=',protectedCount,'runtime-light aliases=',redirectOnly.size,'intentional_public_commerce=',intentionalPublic.size,'separate_security_perimeter=1','separate_perfume_admin_perimeter=1');
