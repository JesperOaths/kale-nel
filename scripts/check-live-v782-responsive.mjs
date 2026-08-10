#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base='https://kalenel.nl';
const proof=`proof=${Date.now()}`;
async function text(path){const r=await fetch(`${base}${path}?${proof}`,{headers:{'cache-control':'no-cache'}});assert.equal(r.status,200,`${path} HTTP ${r.status}`);return r.text();}

assert.equal((await text('/VERSION')).trim(),'v782','public VERSION must be v782');
const drinksSource=await text('/drinks.html');
assert.ok(drinksSource.includes('function renderBars('),'live Drinks must serve renderBars');
assert.ok(drinksSource.includes('Math.max(0,Math.min(100,(value/max)*100))'),'live Drinks must serve bounded bar widths');
const klaverjasSource=await text('/klaverjas_online.html');
assert.ok(klaverjasSource.includes('grid-column:1 / -1;min-width:0;grid-template-columns:360px'),'live Klaverjas must serve full-grid lobby fix');
const homeSource=await text('/index.html');
assert.ok(/body\s*\{[\s\S]*?display:\s*flex;[\s\S]*?flex-direction:\s*column;/.test(homeSource),'live homepage must serve vertical body flow');
const bridgeSource=await text('/boerenbridge.html');
assert.ok(/\.table-wrap\{[^}]*overflow-x:\s*auto/i.test(bridgeSource),'live Boerenbridge must preserve internal table scroll');

const browser=await chromium.launch({headless:true});
let blockedWrites=0;
async function makeContext(width,height){
  const context=await browser.newContext({viewport:{width,height},locale:'nl-NL'});
  await context.route('**/*',async route=>{
    const req=route.request(); let url; try{url=new URL(req.url());}catch{return route.continue();}
    if(url.hostname==='kalenel.nl'&&/\/gejast-home-gate\.js$/i.test(url.pathname)) return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={audit:true};"});
    if(url.hostname==='kalenel.nl'&&/\/gejast-config\.js$/i.test(url.pathname)){const upstream=await route.fetch();const body=await upstream.text();return route.fulfill({response:upstream,contentType:'application/javascript',body:`${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};`});}
    if(!['GET','HEAD'].includes(req.method())){blockedWrites++;return route.fulfill({status:200,contentType:'application/json',body:'[]'});}
    return route.continue();
  });
  return context;
}
async function load(path,width,height){const context=await makeContext(width,height);const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(String(e?.message||e)));await page.goto(`${base}${path}?live_v782=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});await page.waitForTimeout(1200);return{context,page,errors};}

for(const [width,height] of [[768,1024],[1024,768],[1366,768]]){
  const {context,page,errors}=await load('/drinks.html',width,height);
  assert.equal(errors.filter(e=>/renderBars is not defined/i.test(e)).length,0,`live Drinks missing-renderBars error at ${width}: ${errors.join(' | ')}`);
  const float=await page.evaluate(()=>{const b=document.getElementById('globalDrinksVerifyFloat');if(!b)return null;const btn=b.querySelector('button');if(btn)btn.focus();return{hidden:b.getAttribute('aria-hidden'),inert:b.hasAttribute('inert'),focused:document.activeElement===btn};});
  if(float){assert.equal(float.hidden,'true');assert.equal(float.inert,true);assert.equal(float.focused,false);}
  await context.close();
}
{
  const {context,page,errors}=await load('/klaverjas_online.html',1366,768);assert.equal(errors.length,0,`live Klaverjas errors: ${errors.join(' | ')}`);
  const g=await page.evaluate(()=>{const vw=innerWidth,dw=Math.max(document.documentElement.scrollWidth,document.body.scrollWidth);const rr=id=>{const r=document.getElementById(id).getBoundingClientRect();return{left:r.left,right:r.right};};return{vw,dw,code:rr('codeInput'),join:rr('joinBtn')};});
  assert.ok(g.dw<=g.vw+4,`live Klaverjas overflow ${g.dw}/${g.vw}`);for(const r of [g.code,g.join])assert.ok(r.left>=-2&&r.right<=g.vw+2,`live Klaverjas control offscreen ${JSON.stringify(r)}`);await context.close();
}
{
  const {context,page,errors}=await load('/',768,1024);assert.equal(errors.length,0,`live homepage errors: ${errors.join(' | ')}`);
  const g=await page.evaluate(()=>{const vw=innerWidth,dw=Math.max(document.documentElement.scrollWidth,document.body.scrollWidth);const r=document.querySelector('.site-credit-watermark')?.getBoundingClientRect();return{vw,dw,wm:r?{left:r.left,right:r.right}:null};});
  assert.ok(g.dw<=g.vw+4,`live homepage overflow ${g.dw}/${g.vw}`);if(g.wm)assert.ok(g.wm.left>=-2&&g.wm.right<=g.vw+2,`live watermark offscreen ${JSON.stringify(g.wm)}`);await context.close();
}
{
  const {context,page}=await load('/boerenbridge.html',768,1024);const t=await page.evaluate(()=>{const el=document.getElementById('tableWrap');return{client:el.clientWidth,scroll:el.scrollWidth,overflow:getComputedStyle(el).overflowX};});assert.equal(t.overflow,'auto');assert.ok(t.scroll>=t.client);await context.close();
}
assert.ok(blockedWrites>0,'live proof must demonstrate blocked non-GET traffic');
console.log(`LIVE_V782_RESPONSIVE=PASS blockedWrites=${blockedWrites}`);
await browser.close();
