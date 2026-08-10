#!/usr/bin/env node
import { chromium } from 'playwright';
const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:1366,height:768},locale:'nl-NL'});
let blockedWrites=0;
await context.route('**/*',async route=>{
  const req=route.request(); const url=new URL(req.url());
  if(url.hostname==='kalenel.nl'&&/\/gejast-home-gate\.js$/i.test(url.pathname)) return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={audit:true};"});
  if(url.hostname==='kalenel.nl'&&/\/gejast-config\.js$/i.test(url.pathname)){ const upstream=await route.fetch(); const body=await upstream.text(); return route.fulfill({response:upstream,contentType:'application/javascript',body:`${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};`}); }
  if(!['GET','HEAD'].includes(req.method())){ blockedWrites++; return route.fulfill({status:200,contentType:'application/json',body:'[]'}); }
  return route.continue();
});
async function inspect(path,width,height){
  const page=await context.newPage(); await page.setViewportSize({width,height});
  await page.goto(`https://kalenel.nl${path}?v782_debug=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000}); await page.waitForTimeout(800);
  const out=await page.evaluate(()=>{
    const vw=innerWidth;
    const all=[...document.querySelectorAll('body *')].map(el=>{const r=el.getBoundingClientRect();const s=getComputedStyle(el);return {tag:el.tagName.toLowerCase(),id:el.id||'',cls:String(el.className||'').slice(0,100),left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width),display:s.display,position:s.position,overflowX:s.overflowX,minWidth:s.minWidth,maxWidth:s.maxWidth,transform:s.transform,ariaHidden:el.getAttribute('aria-hidden'),inert:el.hasAttribute('inert')};});
    const offenders=all.filter(x=>x.width>0&&x.right>vw+2&&x.position!=='fixed'&&!x.inert&&x.ariaHidden!=='true').sort((a,b)=>b.right-a.right).slice(0,25);
    const ids={}; for(const id of ['lobbyHome','codeInput','joinBtn','globalDrinksVerifyFloat']){const el=document.getElementById(id); if(el){const r=el.getBoundingClientRect();const s=getComputedStyle(el);ids[id]={left:r.left,right:r.right,width:r.width,display:s.display,gridTemplateColumns:s.gridTemplateColumns,minWidth:s.minWidth,maxWidth:s.maxWidth,overflowX:s.overflowX};}}
    const shells=[...document.querySelectorAll('.wrap,.shell,.lobby-home,.home-panel')].map(el=>{const r=el.getBoundingClientRect();const s=getComputedStyle(el);return {tag:el.tagName.toLowerCase(),cls:String(el.className||''),left:r.left,right:r.right,width:r.width,minWidth:s.minWidth,maxWidth:s.maxWidth,gridTemplateColumns:s.gridTemplateColumns,overflowX:s.overflowX};});
    return {vw,docWidth:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),offenders,ids,shells};
  });
  console.log(`DEBUG ${path} ${width}x${height} `+JSON.stringify(out)); await page.close();
}
await inspect('/klaverjas_online.html',1366,768);
await inspect('/',768,1024);
console.log(`BLOCKED_WRITES=${blockedWrites}`);
await browser.close();
