#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const BASE='https://kalenel.nl';
const stamp=Date.now();
async function fetchText(path){
  const r=await fetch(`${BASE}${path}${path.includes('?')?'&':'?'}proof=${stamp}`,{redirect:'follow',headers:{'cache-control':'no-cache','pragma':'no-cache'}});
  const text=await r.text();
  console.log(`SOURCE ${path}: HTTP ${r.status} -> ${r.url}`);
  assert.equal(r.status,200,`${path} must return 200`);
  return text;
}

assert.equal((await fetchText('/VERSION')).trim(),'v781','public VERSION must be v781');
const drinksSource=await fetchText('/drinks.html');
assert.match(drinksSource,/lastStatsLoadedAt=0,\s*statsLoadPromise=null,\s*statsLoadScheduled=false/);
assert.match(drinksSource,/id="speedTypeSelect"[^>]*min-height:44px[^>]*padding:11px 12px/i);
const floatSource=await fetchText('/drinks-verify-float.js');
assert.match(floatSource,/box\.setAttribute\('aria-hidden','true'\);\s*box\.setAttribute\('inert',''\);/);
assert.match(floatSource,/function showBox\(\)\{ const box = ensureBox\(\); box\.removeAttribute\('inert'\); box\.setAttribute\('aria-hidden','false'\);/);
assert.match(floatSource,/function hideBox\(\)\{[^}]*classList\.remove\('show'\); box\.setAttribute\('aria-hidden','true'\); box\.setAttribute\('inert',''\);/);
const beerSource=await fetchText('/beerpong.html');
for(const href of ['./beerpong_vault.html','./index.html']) assert.match(beerSource,new RegExp(`<a href="${href.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}" style="[^"]*display:inline-flex;[^"]*min-height:32px;[^"]*padding:4px 2px`));
for(const id of ['pussycupA','pussycupB']) assert.match(beerSource,new RegExp(`id="${id}"[^>]*style="[^"]*width:24px;height:24px;flex:0 0 auto`));

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,locale:'nl-NL'});
let blockedWrites=0,gateStubs=0,configOverrides=0;
await context.route('**/*',async route=>{
  const req=route.request(); const url=new URL(req.url());
  if(url.hostname==='kalenel.nl'&&/\/gejast-home-gate\.js$/i.test(url.pathname)){
    gateStubs++;
    return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={VERSION:'v781-live-mobile',audit:true};"});
  }
  if(url.hostname==='kalenel.nl'&&/\/gejast-config\.js$/i.test(url.pathname)){
    configOverrides++;
    const upstream=await route.fetch(); const body=await upstream.text();
    return route.fulfill({response:upstream,contentType:'application/javascript',body:`${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};`});
  }
  if(req.isNavigationRequest()&&url.hostname==='kalenel.nl'&&/\/login\.html$/i.test(url.pathname)) return route.abort('blockedbyclient');
  if(!['GET','HEAD'].includes(req.method())){blockedWrites++;return route.fulfill({status:200,contentType:'application/json',body:'[]'});}
  return route.continue();
});

async function open(path){
  const page=await context.newPage(); const errors=[]; page.on('pageerror',e=>errors.push(String(e.message||e)));
  const response=await page.goto(`${BASE}${path}?live_mobile=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(900);
  assert.equal(response?.status(),200,`${path} live HTTP must be 200`);
  assert.equal(new URL(page.url()).pathname,path,`${path} must remain rendered in isolated live mobile proof`);
  return {page,errors};
}

const drinks=await open('/drinks.html');
assert.ok(!drinks.errors.some(e=>/lastStatsLoadedAt|statsLoadPromise|statsLoadScheduled/.test(e)),`Drinks stats queue error remains live: ${drinks.errors.join(' | ')}`);
const speed=await drinks.page.locator('#speedTypeSelect').boundingBox();
assert.ok(speed&&speed.height>=44&&speed.width>=120,`live speedTypeSelect must be >=44px high; got ${JSON.stringify(speed)}`);
const float=drinks.page.locator('#globalDrinksVerifyFloat');
await float.waitFor({state:'attached',timeout:5000});
assert.equal(await float.getAttribute('aria-hidden'),'true');
assert.notEqual(await float.getAttribute('inert'),null);
const focusEscaped=await drinks.page.evaluate(()=>{const box=document.getElementById('globalDrinksVerifyFloat');const button=box?.querySelector('button');button?.focus();return !!box?.contains(document.activeElement);});
assert.equal(focusEscaped,false,'live inert off-canvas verification controls must not receive focus');
const overflow=await drinks.page.evaluate(()=>Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-innerWidth);
assert.ok(overflow<=4,`live Drinks document overflow must remain <=4px; got ${overflow}`);
await drinks.page.close();

const beer=await open('/beerpong.html');
for(const selector of ['a[href="./beerpong_vault.html"]','a[href="./index.html"]','#pussycupA','#pussycupB']){
  const box=await beer.page.locator(selector).first().boundingBox();
  assert.ok(box&&box.width>=24&&box.height>=24,`${selector} live target must be >=24x24; got ${JSON.stringify(box)}`);
}
assert.equal(beer.errors.length,0,`live Beerpong page errors: ${beer.errors.join(' | ')}`);
await beer.page.close();

await browser.close();
assert.ok(gateStubs>0,'live mobile proof expected auth-gate stubs');
assert.ok(configOverrides>0,'live mobile proof expected config overrides');
assert.ok(blockedWrites>0,'live mobile proof expected non-GET isolation');
console.log(`LIVE_V781_MOBILE_RUNTIME=PASS gateStubs=${gateStubs} configOverrides=${configOverrides} blockedWrites=${blockedWrites}`);
