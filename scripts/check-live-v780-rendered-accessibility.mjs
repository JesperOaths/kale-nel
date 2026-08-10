#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE='https://kalenel.nl';
const stamp=Date.now();
async function fetchText(path){
  const r=await fetch(`${BASE}${path}${path.includes('?')?'&':'?'}proof=${stamp}`,{redirect:'follow',headers:{'cache-control':'no-cache','pragma':'no-cache'}});
  const text=await r.text();
  console.log(`SOURCE ${path}: HTTP ${r.status} -> ${r.url}`);
  assert.equal(r.status,200,`${path} must return 200`);
  return text;
}

assert.equal((await fetchText('/VERSION')).trim(),'v780','public VERSION must be v780');

const sourceChecks={
  '/drinks_speed.html':['#7a705a'],
  '/beerpong.html':['#7a6f5d'],
  '/paardenrace.html':['#7a705a'],
  '/paardenrace_live.html':['#7a705a','<section class="drawer" id="mobileDrawer" aria-hidden="true" inert>','removeAttribute(\'inert\')','setAttribute(\'inert\', \'\')'],
  '/toepen.html':['#7a705a'],
  '/rad.html':['<div class="legend" id="legendBox" tabindex="0" aria-label="Segmenten van het rad"></div>'],
  '/despimarkt-theme.css':['#7a705a'],
  '/klaverjas_live.html':['#7a705a']
};
for(const [path,markers] of Object.entries(sourceChecks)){
  const text=await fetchText(path);
  for(const marker of markers) assert.ok(text.includes(marker),`${path} missing live v780 marker ${marker}`);
  assert.ok(!text.includes('#8a7a55'),`${path} must not serve old #8a7a55`);
}
assert.ok(!(await fetchText('/beerpong.html')).includes('#8a7f6b'),'Beerpong must not serve old #8a7f6b');

const routes=['/drinks_speed.html','/beerpong.html','/paardenrace.html','/paardenrace_live.html','/toepen.html','/rad.html','/despimarkt_create.html','/despimarkt_debts.html','/klaverjas_live.html'];
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},locale:'nl-NL'});
let blockedWrites=0, gateStubs=0, configOverrides=0, blockedLoginNavigations=0;
await context.route('**/*',async route=>{
  const req=route.request();
  const url=new URL(req.url());
  if(req.isNavigationRequest() && /\/login\.html$/i.test(url.pathname) && url.hostname==='kalenel.nl'){
    blockedLoginNavigations++;
    return route.abort('blockedbyclient');
  }
  if(url.hostname==='kalenel.nl' && /\/gejast-home-gate\.js$/i.test(url.pathname)){
    gateStubs++;
    return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={VERSION:'v780-live-audit',audit:true};"});
  }
  if(url.hostname==='kalenel.nl' && /\/gejast-config\.js$/i.test(url.pathname)){
    configOverrides++;
    const upstream=await route.fetch();
    const body=await upstream.text();
    return route.fulfill({response:upstream,contentType:'application/javascript',body:`${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};`});
  }
  if(!['GET','HEAD'].includes(req.method())){
    blockedWrites++;
    return route.fulfill({status:200,contentType:'application/json',body:'[]'});
  }
  return route.continue();
});

const failures=[];
for(const path of routes){
  const page=await context.newPage();
  const pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(String(e.message||e)));
  const response=await page.goto(`${BASE}${path}?live_a11y=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(700);
  assert.equal(response?.status(),200,`${path} live browser HTTP must be 200`);
  assert.equal(new URL(page.url()).pathname,path,`${path} must remain rendered in isolated live audit`);
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  const serious=axe.violations.filter(v=>['serious','critical'].includes(v.impact));
  const positive=await page.locator('[tabindex]').evaluateAll(els=>els.map(el=>Number(el.getAttribute('tabindex'))).filter(v=>v>0));
  if(serious.length||axe.violations.length||positive.length||pageErrors.length) failures.push({path,axe:axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length})),positive:positive.length,pageErrors});
  console.log(`BROWSER ${path}: serious=${serious.length}; allAxe=${axe.violations.length}; positiveTab=${positive.length}; pageErrors=${pageErrors.length}`);
  await page.close();
}
await browser.close();
assert.ok(gateStubs>0,'live audit must stub the auth gate locally');
assert.ok(configOverrides>0,'live audit must override session redirect helpers locally');
assert.ok(blockedWrites>0,'live audit must prove non-GET traffic was intercepted');
assert.deepEqual(failures,[],`live v780 rendered accessibility failures:\n${JSON.stringify(failures,null,2)}`);
console.log(`LIVE_V780_RENDERED_A11Y=PASS routes=${routes.length} gateStubs=${gateStubs} configOverrides=${configOverrides} blockedLoginNavigations=${blockedLoginNavigations} blockedNonGet=${blockedWrites}`);
