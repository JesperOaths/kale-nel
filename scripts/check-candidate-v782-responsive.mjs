#!/usr/bin/env node
import assert from 'node:assert/strict';
import { chromium } from 'playwright';

const base=process.env.V782_CANDIDATE_BASE||'http://127.0.0.1:4173';
const browser=await chromium.launch({headless:true});
let blockedWrites=0;

async function makeContext(width,height){
  const context=await browser.newContext({viewport:{width,height},locale:'nl-NL'});
  await context.route('**/*',async route=>{
    const req=route.request();
    let url; try{url=new URL(req.url());}catch{return route.continue();}
    if(/\/gejast-home-gate\.js$/i.test(url.pathname)) return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={audit:true};"});
    if(/\/gejast-config\.js$/i.test(url.pathname)){
      const upstream=await route.fetch(); const body=await upstream.text();
      return route.fulfill({response:upstream,contentType:'application/javascript',body:`${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};`});
    }
    if(!['GET','HEAD'].includes(req.method())){blockedWrites++;return route.fulfill({status:200,contentType:'application/json',body:'[]'});}
    return route.continue();
  });
  return context;
}

async function load(path,width,height){
  const context=await makeContext(width,height); const page=await context.newPage(); const errors=[];
  page.on('pageerror',err=>errors.push(String(err?.message||err)));
  await page.goto(`${base}${path}?candidate_v782=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
  await page.waitForTimeout(1200);
  return {context,page,errors};
}

for(const [width,height] of [[768,1024],[1024,768],[1366,768]]){
  const {context,page,errors}=await load('/drinks.html',width,height);
  assert.equal(errors.filter(e=>/renderBars is not defined/i.test(e)).length,0,`Drinks must not throw missing renderBars at ${width}x${height}: ${errors.join(' | ')}`);
  const floatState=await page.evaluate(()=>{const box=document.getElementById('globalDrinksVerifyFloat');if(!box)return null;const btn=box.querySelector('button');if(btn)btn.focus();return {hidden:box.getAttribute('aria-hidden'),inert:box.hasAttribute('inert'),focused:document.activeElement===btn};});
  if(floatState){assert.equal(floatState.hidden,'true',`closed Drinks float must remain aria-hidden at ${width}`);assert.equal(floatState.inert,true,`closed Drinks float must remain inert at ${width}`);assert.equal(floatState.focused,false,`closed Drinks float descendant must not receive focus at ${width}`);}
  await context.close();
}

{
  const {context,page,errors}=await load('/klaverjas_online.html',1366,768);
  assert.equal(errors.length,0,`Klaverjas online candidate page errors: ${errors.join(' | ')}`);
  const geometry=await page.evaluate(()=>{const vw=innerWidth;const docWidth=Math.max(document.documentElement.scrollWidth,document.body.scrollWidth);const rect=id=>{const r=document.getElementById(id).getBoundingClientRect();return {left:r.left,right:r.right,width:r.width};};return {vw,docWidth,code:rect('codeInput'),join:rect('joinBtn')};});
  assert.ok(geometry.docWidth<=geometry.vw+4,`Klaverjas online must not overflow desktop viewport: ${geometry.docWidth} > ${geometry.vw}`);
  for(const [name,r] of Object.entries({code:geometry.code,join:geometry.join})) assert.ok(r.left>=-2&&r.right<=geometry.vw+2,`${name} must remain inside desktop viewport: ${JSON.stringify(r)}`);
  await context.close();
}

{
  const {context,page,errors}=await load('/',768,1024);
  assert.equal(errors.length,0,`Homepage candidate page errors: ${errors.join(' | ')}`);
  const geometry=await page.evaluate(()=>{const vw=innerWidth;const docWidth=Math.max(document.documentElement.scrollWidth,document.body.scrollWidth);const el=document.querySelector('.site-credit-watermark');const r=el?.getBoundingClientRect();return {vw,docWidth,watermark:r?{left:r.left,right:r.right,width:r.width}:null};});
  assert.ok(geometry.docWidth<=geometry.vw+4,`Homepage must not overflow tablet portrait: ${geometry.docWidth} > ${geometry.vw}`);
  if(geometry.watermark) assert.ok(geometry.watermark.left>=-2&&geometry.watermark.right<=geometry.vw+2,`Homepage watermark must stay within viewport: ${JSON.stringify(geometry.watermark)}`);
  await context.close();
}

{
  const {context,page}=await load('/boerenbridge.html',768,1024);
  const table=await page.evaluate(()=>{const el=document.getElementById('tableWrap');const s=getComputedStyle(el);return {clientWidth:el.clientWidth,scrollWidth:el.scrollWidth,overflowX:s.overflowX};});
  assert.ok(table.scrollWidth>=table.clientWidth,'Boerenbridge table geometry must remain valid');
  assert.equal(table.overflowX,'auto','Boerenbridge score table must retain intentional horizontal scrolling');
  await context.close();
}

assert.ok(blockedWrites>0,'candidate proof should demonstrate non-GET interception');
console.log(`V782_CANDIDATE_BROWSER=PASS blockedWrites=${blockedWrites}`);
await browser.close();
