#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE=process.env.GEJAST_LOCAL_BASE||'http://127.0.0.1:4173';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'nl-NL'});
let blockedWrites=0,gateStubs=0,configOverrides=0;
await context.route('**/*',async route=>{
  const req=route.request(); const url=new URL(req.url());
  if(/\/gejast-home-gate\.js$/i.test(url.pathname)){
    gateStubs++;
    return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={VERSION:'v781-local-mobile',audit:true};"});
  }
  if(/\/gejast-config\.js$/i.test(url.pathname)&&['127.0.0.1','localhost'].includes(url.hostname)){
    configOverrides++;
    const upstream=await route.fetch(); const body=await upstream.text();
    return route.fulfill({response:upstream,contentType:'application/javascript',body:`${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};`});
  }
  if(req.isNavigationRequest()&&/\/login\.html$/i.test(url.pathname)&&['127.0.0.1','localhost'].includes(url.hostname)) return route.abort('blockedbyclient');
  if(!['GET','HEAD'].includes(req.method())){blockedWrites++;return route.fulfill({status:200,contentType:'application/json',body:'[]'});}
  return route.continue();
});

async function open(path){
  const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(String(e.message||e)));
  const response=await page.goto(`${BASE}${path}`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(900);
  assert.equal(response?.status(),200,`${path} local HTTP must be 200`);
  assert.equal(new URL(page.url()).pathname,path,`${path} must remain rendered in isolated local mobile proof`);
  return {page,errors};
}

const drinks=await open('/drinks.html');
assert.ok(!drinks.errors.some(e=>/lastStatsLoadedAt|statsLoadPromise|statsLoadScheduled/.test(e)),`Drinks stats queue still throws: ${drinks.errors.join(' | ')}`);
const speed=await drinks.page.locator('#speedTypeSelect').boundingBox();
assert.ok(speed&&speed.height>=44&&speed.width>=120,`speedTypeSelect must be >=44px high and usable width; got ${JSON.stringify(speed)}`);
const float=drinks.page.locator('#globalDrinksVerifyFloat');
await float.waitFor({state:'attached',timeout:5000});
assert.equal(await float.getAttribute('aria-hidden'),'true','closed verification float must be aria-hidden');
assert.notEqual(await float.getAttribute('inert'),null,'closed verification float must be inert');
const focusEscaped=await drinks.page.evaluate(()=>{const box=document.getElementById('globalDrinksVerifyFloat');const button=box?.querySelector('button');button?.focus();return !!box?.contains(document.activeElement);});
assert.equal(focusEscaped,false,'inert off-canvas verification controls must not receive programmatic focus');
const docOverflow=await drinks.page.evaluate(()=>Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth);
assert.ok(docOverflow<=4,`drinks page must not gain horizontal overflow; got ${docOverflow}`);
await drinks.page.close();

const beer=await open('/beerpong.html');
for(const selector of ['a[href="./beerpong_vault.html"]','a[href="./index.html"]','#pussycupA','#pussycupB']){
  const box=await beer.page.locator(selector).first().boundingBox();
  assert.ok(box&&box.width>=24&&box.height>=24,`${selector} must have >=24x24 target; got ${JSON.stringify(box)}`);
}
assert.equal(beer.errors.length,0,`Beerpong mobile proof page errors: ${beer.errors.join(' | ')}`);
await beer.page.close();

const root=await open('/');
const rootFloat=root.page.locator('#globalDrinksVerifyFloat');
if(await rootFloat.count()){
  assert.equal(await rootFloat.getAttribute('aria-hidden'),'true','root verification float must be aria-hidden when closed');
  assert.notEqual(await rootFloat.getAttribute('inert'),null,'root verification float must be inert when closed');
}
await root.page.close();

await browser.close();
assert.ok(gateStubs>0,'mobile proof expected home-gate stubs');
assert.ok(configOverrides>0,'mobile proof expected local config overrides');
assert.ok(blockedWrites>0,'mobile proof expected non-GET interception');
console.log(`V781_LOCAL_MOBILE=PASS gateStubs=${gateStubs} configOverrides=${configOverrides} blockedWrites=${blockedWrites}`);
