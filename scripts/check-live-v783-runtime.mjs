#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base='https://kalenel.nl';
const proof=`proof=${Date.now()}`;
async function text(path){const r=await fetch(`${base}${path}?${proof}`,{headers:{'cache-control':'no-cache'}});assert.equal(r.status,200,`${path} HTTP ${r.status}`);return r.text();}
assert.equal((await text('/VERSION')).trim(),'v783','public VERSION must be v783');
const score=await text('/score.html');
const spectator=await text('/pikken_spectator.html');
for(const [label,src] of [['score',score],['Pikken spectator',spectator]]){
  assert.ok(!/<script\s+src=/i.test(src),`${label} live alias must not load external scripts`);
  assert.ok(!/<link[^>]+rel=["'](?:stylesheet|preload|modulepreload)["']/i.test(src),`${label} live alias must not preload assets`);
}
assert.ok(score.includes("./klaverjas_scorer_v596_repo_ready.html"),'live score target missing');
assert.ok(spectator.includes("./pikken_live.html"),'live Pikken spectator target missing');

const browser=await chromium.launch({headless:true});
async function checkAlias(path,expectedPath,checks,width,height){
  const context=await browser.newContext({viewport:{width,height},serviceWorkers:'block'});const page=await context.newPage();let captured='';const failed=[];const errors=[];let writes=0;
  await context.route('**/*',async route=>{const req=route.request();let u;try{u=new URL(req.url());}catch{return route.continue();}if(req.isNavigationRequest()&&u.hostname==='kalenel.nl'&&u.pathname===expectedPath){captured=u.toString();return route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><title>captured</title>'});}if(!['GET','HEAD'].includes(req.method())){writes++;return route.fulfill({status:200,contentType:'application/json',body:'[]'});}return route.continue();});
  page.on('pageerror',e=>errors.push(String(e?.message||e)));page.on('requestfailed',req=>{try{const u=new URL(req.url());if(u.hostname==='kalenel.nl'&&['GET','HEAD'].includes(req.method()))failed.push(`${u.pathname}:${req.failure()?.errorText||'failed'}`);}catch{}});
  await page.goto(`${base}${path}`,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForTimeout(300);
  assert.ok(captured,`${path} did not initiate ${expectedPath}`);const u=new URL(captured);for(const [k,v] of Object.entries(checks))assert.equal(u.searchParams.get(k),v,`${path} lost ${k}`);assert.deepEqual(errors,[],`${path} page errors: ${errors.join(' | ')}`);assert.deepEqual(failed,[],`${path} same-origin aborts: ${failed.join(' | ')}`);assert.equal(writes,0,`${path} redirect alias must not attempt writes`);await context.close();
}
for(const [w,h] of [[390,844],[1366,768]]){
  await checkAlias('/score.html?audit_token=live783','/klaverjas_scorer_v596_repo_ready.html',{audit_token:'live783'},w,h);
  await checkAlias('/pikken_spectator.html?client_match_id=client783&match_ref=ref783&scope=family','/pikken_live.html',{client_match_id:'client783',match_ref:'ref783',scope:'family',spectator:'1'},w,h);
}
await browser.close();
console.log('LIVE_V783_RUNTIME=PASS redirects=4 abortedSameOrigin=0 writes=0');
