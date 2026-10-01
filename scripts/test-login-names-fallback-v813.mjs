#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source=fs.readFileSync('gejast-login-names-fallback.js','utf8');
const staticSource=fs.readFileSync('gejast-login-names-static.js','utf8');
const accountRuntime=fs.readFileSync('gejast-account-runtime.js','utf8');
const loginHtml=fs.readFileSync('login.html','utf8');
const siteVersion=fs.readFileSync('VERSION','utf8').trim();
const calls=[],cacheWrites=[],delayedTimers=[];
const fakeSetTimeout=(fn,ms)=>{delayedTimers.push({fn,ms:Number(ms)});return delayedTimers.length;};
const fakeClearTimeout=()=>{};

function response(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});}
const cfg={
  SUPABASE_URL:'https://example.supabase.co',
  SUPABASE_PUBLISHABLE_KEY:'publishable-test-key',
  async fetchScopedActivePlayerNames(){throw new Error('legacy loader must be replaced');},
  async getActivatedPlayerNamesForScope(){throw new Error('legacy loader must be replaced');},
  writeCachedLoginNames(names,scope){cacheWrites.push({names:[...names],scope});},
  readCachedLoginNames(){return [];}
};
const context={
  console,URL,URLSearchParams,Response,AbortController,setTimeout:fakeSetTimeout,clearTimeout:fakeClearTimeout,CustomEvent:class CustomEvent{constructor(type,init){this.type=type;this.detail=init?.detail;}},
  dispatchEvent(){return true;},
  GEJAST_CONFIG:cfg,
  location:{search:'?scope=family'},
  fetch:async(input,init={})=>{
    const url=String(input);calls.push({url,init});
    assert.doesNotMatch(url,/\/rest\/v1\/(?:allowed_usernames|rpc\/get_player_selector_source_v1)(?:[?#]|$)/i,'login surface must not use private/direct or expensive selector sources');
    if(url.includes('/rpc/get_login_active_names_v687')){
      const body=JSON.parse(init.body||'{}');assert.equal(body.site_scope_input,'family');
      return response([{display_name:' Familie B '},{public_display_name:'Familie A'},{display_name:'familie a'}]);
    }
    throw new Error('unexpected request '+url);
  }
};
context.window=context;context.globalThis=context;
vm.createContext(context);
new vm.Script(staticSource,{filename:'gejast-login-names-static.js'}).runInContext(context);
new vm.Script(source,{filename:'gejast-login-names-fallback.js'}).runInContext(context);

assert.equal(context.GEJAST_LOGIN_NAMES_FALLBACK?.source,'v817-html-static-first-delayed-active-name-rpc');
assert.equal(context.GEJAST_LOGIN_NAMES_FALLBACK?.staticSource,'gejast-login-names-static.js');
assert.match(source,/get_login_active_names_v687/);
assert.match(source,/2500/,'authoritative refresh must stay tightly bounded so login does not hang behind Supabase latency');
assert.doesNotMatch(source,/get_player_selector_source_v1/,'expensive selector scan must never be part of login name loading');
assert.match(source,/login_names_timeout/);
assert.equal(cfg.fetchScopedActivePlayerNames,context.GEJAST_LOGIN_NAMES_FALLBACK.load);
assert.equal(cfg.getActivatedPlayerNamesForScope,context.GEJAST_LOGIN_NAMES_FALLBACK.load);

const names=await context.GEJAST_LOGIN_NAMES_FALLBACK.load();
assert.deepEqual(Array.from(names),['Anouk','Emil','Gunnar','Lilian','Sierk'],'fresh browser must render the static last-known-good family names immediately');
assert.equal(calls.length,0,'static-first load must not hit Supabase during the critical selector render');
const refreshTimer=delayedTimers.find(x=>x.ms===3000);
assert.ok(refreshTimer,'static-first load must schedule one delayed authoritative refresh');
refreshTimer.fn();
for(let i=0;i<20&&calls.length<1;i++) await new Promise(resolve=>setImmediate(resolve));
assert.equal(calls.length,1,'delayed verification must make exactly one authoritative name request');
assert.equal(calls[0].init.method,'POST');
assert.equal(calls[0].init.headers.apikey,'publishable-test-key');
for(let i=0;i<20&&!cacheWrites.some(x=>x.scope==='family'&&x.names.join('|')==='Familie A|Familie B');i++) await new Promise(resolve=>setImmediate(resolve));
assert.ok(cacheWrites.some(x=>x.scope==='family'&&x.names.join('|')==='Familie A|Familie B'),'successful delayed live refresh must replace the last-known-good cache');

assert.match(staticSource,/friends:/);
assert.match(staticSource,/family:/);
assert.match(staticSource,/"Bruis"/);
assert.match(staticSource,/"Sierk"/);
assert.match(accountRuntime,/function staticLoginNames\(\)/,'login page runtime must read the verified static snapshot directly');
assert.match(accountRuntime,/function domSeedNames\(sel\)/,'login runtime must retain server-rendered option names even if deferred JS or Supabase is unavailable');
assert.match(accountRuntime,/seed = normalizeNames\(\[\.\.\.domSeed,\.\.\.cached,\.\.\.snapshot\]\)/,'login bootstrap must merge DOM options, cache and static snapshot synchronously');
assert.match(accountRuntime,/if\(clean\.length\)\{[\s\S]*?fillSelect\(sel,clean\)/,'live refresh may replace the dropdown only when it returns real names');
assert.match(accountRuntime,/else if\(seed\.length\)/,'an empty or slow live refresh must preserve the synchronous seed');
assert.ok(loginHtml.includes(`gejast-login-names-static.js?${siteVersion}&rev=20261001-login-resilience-r8`),'login must load the static name snapshot with site version + resilience revision');
assert.ok(loginHtml.includes(`gejast-login-names-fallback.js?${siteVersion}&rev=20261001-login-resilience-r8`),'login must load the single-RPC fallback with site version + resilience revision');
assert.ok(loginHtml.includes(`gejast-account-runtime.js?${siteVersion}&rev=20261001-login-resilience-r8`),'login must load the account runtime with site version + resilience revision');
assert.match(loginHtml,/window\.GEJAST_LOGIN_NAMES_STATIC=Object\.freeze\(/,'login HTML must contain an inline last-known-good name seed so the selector works even when Supabase or a deferred asset stalls');
assert.match(loginHtml,/data-login-scope="friends"/,'login HTML must contain literal friends options before JS runs');
assert.match(loginHtml,/data-login-scope="family"/,'login HTML must contain literal family options before JS runs');
assert.match(source,/get_login_active_names_v687'?,?\{site_scope_input:resolvedScope\},2500/,'live login-name verification must stay tightly bounded');
assert.match(source,/setTimeout\(function\(\)\{ authoritative\(resolvedScope\)\.catch\(function\(\)\{\}\); \},3000\)/,'live name verification must be delayed off first paint');
assert.match(loginHtml,/id="gejast-login-inline-seed"/,'login must synchronously populate the selector during HTML parsing rather than waiting for DOMContentLoaded');
assert.match(loginHtml,/sel\.dataset\.seedSource='html-static-active-names'/,'synchronous HTML selector seed must be observable for diagnostics');
for(const name of ['Bruis','Jesper','Sierk']) assert.ok(loginHtml.includes(`"${name}"`),`inline login seed missing representative name ${name}`);

console.log('RESULT=V817_LOGIN_NAMES_HTML_STATIC_FIRST_DELAYED_RPC_PASS');
