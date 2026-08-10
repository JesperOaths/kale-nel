#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base=process.env.V783_CANDIDATE_BASE||'http://127.0.0.1:4173';
const browser=await chromium.launch({headless:true});
let blockedWrites=0;

async function checkAlias(path, expectedPath, queryChecks, width, height){
  const context=await browser.newContext({viewport:{width,height},locale:'nl-NL',serviceWorkers:'block'});
  const failedSameOrigin=[]; const pageErrors=[];
  await context.route('**/*',async route=>{
    const req=route.request(); let url; try{url=new URL(req.url());}catch{return route.continue();}
    if(/\/gejast-home-gate\.js$/i.test(url.pathname)) return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={audit:true};"});
    if(/\/gejast-config\.js$/i.test(url.pathname)){const upstream=await route.fetch();const body=await upstream.text();return route.fulfill({response:upstream,contentType:'application/javascript',body:`${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};`});}
    if(!['GET','HEAD'].includes(req.method())){blockedWrites++;return route.fulfill({status:200,contentType:'application/json',body:'[]'});}
    return route.continue();
  });
  const page=await context.newPage();
  page.on('pageerror',e=>pageErrors.push(String(e?.message||e)));
  page.on('requestfailed',req=>{try{const u=new URL(req.url());if(u.origin===new URL(base).origin&&['GET','HEAD'].includes(req.method()))failedSameOrigin.push(`${u.pathname}:${req.failure()?.errorText||'failed'}`);}catch{}});
  await page.goto(`${base}${path}`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(800);
  const finalUrl=new URL(page.url());
  assert.equal(finalUrl.pathname,expectedPath,`${path} must redirect to ${expectedPath}, got ${finalUrl.pathname}`);
  for(const [key,value] of Object.entries(queryChecks)) assert.equal(finalUrl.searchParams.get(key),value,`${path} must preserve ${key}=${value}`);
  assert.deepEqual(pageErrors,[],`${path} page errors: ${pageErrors.join(' | ')}`);
  assert.deepEqual(failedSameOrigin,[],`${path} must not abort same-origin resources: ${failedSameOrigin.join(' | ')}`);
  await context.close();
}

for(const [width,height] of [[390,844],[1366,768]]){
  await checkAlias('/score.html?audit_token=score783','/klaverjas_scorer_v596_repo_ready.html',{audit_token:'score783'},width,height);
  await checkAlias('/pikken_spectator.html?client_match_id=client783&match_ref=ref783&scope=family','/pikken_live.html',{client_match_id:'client783',match_ref:'ref783',scope:'family',spectator:'1'},width,height);
}
assert.ok(blockedWrites>0,'v783 candidate browser proof must demonstrate non-GET interception');
console.log(`V783_CANDIDATE_RUNTIME=PASS blockedWrites=${blockedWrites}`);
await browser.close();
