#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE=process.env.GEJAST_LOCAL_BASE||'http://127.0.0.1:4173';
const routes=['/drinks_speed.html','/beerpong.html','/paardenrace.html','/paardenrace_live.html','/toepen.html','/rad.html','/despimarkt_create.html','/despimarkt_debts.html','/klaverjas_live.html'];
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},locale:'nl-NL'});
let blockedWrites=0;
await context.route('**/*',async route=>{
  const req=route.request();
  const url=new URL(req.url());
  if(url.hostname==='127.0.0.1' && /\/gejast-home-gate\.js$/i.test(url.pathname)) return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={VERSION:'v780-local-audit',audit:true};"});
  if(!['GET','HEAD'].includes(req.method())){blockedWrites++;return route.fulfill({status:200,contentType:'application/json',body:'[]'});}
  return route.continue();
});

const failures=[];
for(const path of routes){
  const page=await context.newPage();
  const pageErrors=[];page.on('pageerror',e=>pageErrors.push(String(e.message||e)));
  const response=await page.goto(`${BASE}${path}`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(600);
  assert.equal(response?.status(),200,`${path} local HTTP must be 200`);
  assert.equal(new URL(page.url()).pathname,path,`${path} must not redirect in isolated local audit`);
  const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
  const serious=axe.violations.filter(v=>['serious','critical'].includes(v.impact));
  const positive=await page.locator('[tabindex]').evaluateAll(els=>els.map(el=>Number(el.getAttribute('tabindex'))).filter(v=>v>0));
  if(serious.length||positive.length||pageErrors.length) failures.push({path,serious:serious.map(v=>({id:v.id,nodes:v.nodes.length})),positive:positive.length,pageErrors});
  console.log(`${path}: serious=${serious.length}; allAxe=${axe.violations.length}; positiveTab=${positive.length}; pageErrors=${pageErrors.length}`);
  await page.close();
}
await browser.close();
assert.ok(blockedWrites>0,'local audit expected to intercept inert non-GET requests as a no-write proof');
assert.deepEqual(failures,[],`v780 local rendered accessibility failures:\n${JSON.stringify(failures,null,2)}`);
console.log(`V780_LOCAL_RENDERED_A11Y=PASS routes=${routes.length} blockedNonGet=${blockedWrites}`);
