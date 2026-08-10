#!/usr/bin/env node
import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},locale:'nl-NL',serviceWorkers:'block'});
const page=await context.newPage();
let blockedWrites=0;
await context.route('**/*',async route=>{
  const req=route.request();
  let url;try{url=new URL(req.url());}catch{return route.continue();}
  if(url.hostname==='kalenel.nl'&&/\/gejast-home-gate\.js$/i.test(url.pathname)) return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={audit:true};"});
  if(url.hostname==='kalenel.nl'&&/\/gejast-config\.js$/i.test(url.pathname)){
    const upstream=await route.fetch();const body=await upstream.text();
    return route.fulfill({response:upstream,contentType:'application/javascript',body:`${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};`});
  }
  if(!['GET','HEAD'].includes(req.method())){blockedWrites++;return route.fulfill({status:200,contentType:'application/json',body:'[]'});}
  return route.continue();
});
await page.goto(`https://kalenel.nl/rad.html?v785_rad_diag=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
await page.waitForTimeout(1500);
const result=await page.evaluate(()=>{
  const vw=innerWidth;
  const docWidth=Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth||0);
  const nodes=[...document.querySelectorAll('body *')].map((el)=>{
    const r=el.getBoundingClientRect();const s=getComputedStyle(el);
    return {tag:el.tagName.toLowerCase(),id:el.id||'',cls:String(el.className||'').slice(0,160),text:(el.textContent||'').replace(/\s+/g,' ').trim().slice(0,120),left:Math.round(r.left*10)/10,right:Math.round(r.right*10)/10,width:Math.round(r.width*10)/10,position:s.position,display:s.display,overflowX:s.overflowX,minWidth:s.minWidth,maxWidth:s.maxWidth,whiteSpace:s.whiteSpace,transform:s.transform};
  }).filter(x=>x.right>vw+1||x.left<-1).sort((a,b)=>Math.max(b.right-vw,-b.left)-Math.max(a.right-vw,-a.left));
  return {vw,docWidth,bodyWidth:document.body?.getBoundingClientRect().width,htmlWidth:document.documentElement.getBoundingClientRect().width,nodes:nodes.slice(0,60)};
});
console.log('RAD_LIVE_OVERFLOW_DIAGNOSTIC='+JSON.stringify({blockedWrites,...result},null,2));
await browser.close();
if(blockedWrites===0) throw new Error('write interception was not exercised');
