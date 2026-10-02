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
const intentionalPublic=new Set(['shop/index.html','c720p-drive-oauth/index.html','c720p-drive-oauth/privacy.html','oauth/inbox-triage/index.html','oauth/inbox-triage/privacy.html','oauth/inbox-triage/terms.html','oauth/inbox-triage/data-deletion.html','oauth/inbox-triage/support.html','inbox-triage/index.html','inbox-triage/privacy.html']);
function isIntentionalPublic(r){return intentionalPublic.has(r)||r.startsWith('league/');}
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
assert(securityBody.includes("api('new','/api/status')"),'security live view must status-check the active S9+ protected camera source');
assert(!securityBody.includes("api('s3','/api/status')"),'retired S3 must not be polled by the live security view');
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
const leagueIndex='league/index.html';
assert.ok(fs.existsSync(leagueIndex),'public League surface missing');
const leagueBody=fs.readFileSync(leagueIndex,'utf8');
assert(!leagueBody.includes('/gejast-auth-gate.js?')&&!leagueBody.includes('/gejast-home-gate.js?')&&!leagueBody.includes('requireMatchEntrySession'),'public League surface must not inherit Kalenel player-session gating');
assert(leagueBody.includes('index,follow'),'public League surface must remain indexable/followable');
const worker=fs.readFileSync('cloudflare/workers/admin-gate/src/worker.js','utf8');
assert(worker.includes("function isLeaguePublicPath(pathname)"),'Cloudflare perimeter must explicitly recognize League as public');
assert(worker.includes("if (isLeaguePublicPath(url.pathname))"),'League public bypass must execute before generic protected/public routing');
assert(worker.indexOf("if (isLeaguePublicPath(url.pathname))") < worker.indexOf("if (!isProtectedPublicPath(url.pathname))"),'League public bypass must precede generic protected/public routing');
assert(worker.includes("PUBLIC_AUTH_ENTRY_DOCUMENTS"),'login/home/request/activate documents must have explicit fresh public bootstrap handling');
assert(worker.includes("'Cache-Control', 'no-store, max-age=0, must-revalidate'"),'fresh public bootstrap documents must bypass stale edge/browser HTML caches');
assert(worker.includes("method: request.method")&&worker.includes("redirect: 'manual'"),'public bootstrap origin requests must be rebuilt bodyless instead of cloning an incoming request stream');
assert(!worker.includes("const originRequest = new Request(originUrl.toString(), request);"),'public bootstrap helper must not reuse the incoming Request ReadableStream');
assert(worker.includes("request.method === 'HEAD' ? null : response.body"),'HEAD bootstrap responses must stay bodyless while GET forwards the origin stream once');
assert(worker.includes("const PUBLIC_AUTH_ORIGIN_BUILD = '20261002-login-static-r16'"),'login bootstrap must have an independent public cache identity');
assert(worker.includes("const PUBLIC_SHOP_ORIGIN_BUILD = '20261002-shop-static-r12'"),'shop bootstrap must retain its independent public cache identity');
assert(worker.includes("const PUBLIC_LEAGUE_ORIGIN_BUILD = '20261002-league-public-r2'"),'League bootstrap must have an independent public cache identity');
assert(worker.includes("cacheBustValue = ADMIN_BUILD"),'public origin helper must accept an explicit cache-bust value');
assert(worker.includes("cacheBustValue: PUBLIC_LEAGUE_ORIGIN_BUILD"),'League document refresh must not inherit the admin build identity');
assert(worker.includes("cacheBustValue: isShopDocument ? PUBLIC_SHOP_ORIGIN_BUILD : PUBLIC_AUTH_ORIGIN_BUILD"),'shop/login document refreshes must use their own public build identities');
assert(worker.includes("return new Response(response.body"),'public no-store responses must forward the untouched origin stream once');
const missing=[]; const leaked=[]; const publicGateLeaks=[]; let protectedCount=0;
for(const file of walk(process.cwd())){
  const r=rel(file);const body=fs.readFileSync(file,'utf8');
  if(authPublic.has(r)){if(body.includes('/gejast-auth-gate.js?'))leaked.push(r);continue;}
  if(isIntentionalPublic(r)){if(body.includes('/gejast-auth-gate.js?'))publicGateLeaks.push(r);continue;}
  if(redirectOnly.has(r)){
    if(body.includes('/gejast-auth-gate.js?')) leaked.push(r);
    assert(/location\.replace\(/.test(body),`runtime-light alias must immediately hand off to a canonical protected/auth page: ${r}`);
    continue;
  }
  if(separatelyProtected(r))continue;
  protectedCount++;
  if(!/<head(?:\s[^>]*)?>\s*<script src="\/gejast-auth-gate\.js\?v\d+"><\/script>/i.test(body))missing.push(r);
}
assert(protectedCount>=40,`protected publication inventory unexpectedly small: ${protectedCount}`);
assert.deepEqual(missing,[],`published pages missing forced-login gate:\n${missing.join('\n')}`);
assert.deepEqual(leaked,[],`auth-entry/redirect-only pages must not bootstrap the player gate:\n${leaked.join('\n')}`);
assert.deepEqual(publicGateLeaks,[],`intentional public pages must remain outside the private player-session gate:\n${publicGateLeaks.join('\n')}`);
for(const r of ['index.html','home.html','toepen.html','boerenbridge.html','beerpong.html','pikken.html','paardenrace.html','klaverjas_online.html','rad.html'])assert(fs.readFileSync(r,'utf8').includes('/gejast-auth-gate.js?'),`representative protected page lacks gate: ${r}`);
console.log('v798 forced-login publication boundary ok; gated app pages=',protectedCount,'runtime-light aliases=',redirectOnly.size,'intentional_public=',intentionalPublic.size,'separate_security_perimeter=1','separate_perfume_admin_perimeter=1');
