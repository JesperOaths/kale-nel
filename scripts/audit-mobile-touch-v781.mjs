#!/usr/bin/env node
import { chromium } from 'playwright';

const BASE='https://kalenel.nl';
const routes=[
  '/','/login.html','/request.html','/profiles.html','/drinks.html','/drinks_add.html','/drinks_pending.html','/drinks_speed.html',
  '/beerpong.html','/boerenbridge.html','/pikken.html','/pikken_live.html','/paardenrace.html','/paardenrace_live.html',
  '/toepen.html','/rad.html','/scorer.html','/leaderboard.html','/despimarkt.html','/despimarkt_create.html','/despimarkt_debts.html',
  '/klaverjas_live.html','/klaverjas_online.html','/my_profile.html'
];

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},deviceScaleFactor:1,isMobile:true,hasTouch:true,locale:'nl-NL'});
let blockedWrites=0,gateStubs=0,configOverrides=0,blockedLoginNavigations=0;
await context.route('**/*',async route=>{
  const req=route.request(); const url=new URL(req.url());
  if(req.isNavigationRequest()&&url.hostname==='kalenel.nl'&&/\/login\.html$/i.test(url.pathname)&&!req.url().includes('/login.html?mobile_audit=')){
    blockedLoginNavigations++;
    return route.abort('blockedbyclient');
  }
  if(url.hostname==='kalenel.nl'&&/\/gejast-home-gate\.js$/i.test(url.pathname)){
    gateStubs++;
    return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={VERSION:'v781-mobile-audit',audit:true};"});
  }
  if(url.hostname==='kalenel.nl'&&/\/gejast-config\.js$/i.test(url.pathname)){
    configOverrides++;
    const upstream=await route.fetch(); const body=await upstream.text();
    return route.fulfill({response:upstream,contentType:'application/javascript',body:`${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};`});
  }
  if(!['GET','HEAD'].includes(req.method())){blockedWrites++;return route.fulfill({status:200,contentType:'application/json',body:'[]'});}
  return route.continue();
});

const results=[];
for(const path of routes){
  const page=await context.newPage();
  const pageErrors=[]; page.on('pageerror',e=>pageErrors.push(String(e.message||e)));
  try{
    const response=await page.goto(`${BASE}${path}${path.includes('?')?'&':'?'}mobile_audit=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForTimeout(700);
    const metrics=await page.evaluate(()=>{
      const vw=window.innerWidth;
      const overflow=Math.max(document.documentElement.scrollWidth,document.body.scrollWidth)-vw;
      const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.disabled&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};
      const selector='a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[tabindex="0"]';
      const nodes=[...document.querySelectorAll(selector)].filter(visible);
      const offscreen=nodes.map(el=>{const r=el.getBoundingClientRect();return {tag:el.tagName.toLowerCase(),id:el.id||'',cls:String(el.className||'').slice(0,80),label:(el.getAttribute('aria-label')||el.textContent||el.getAttribute('placeholder')||'').trim().replace(/\s+/g,' ').slice(0,80),left:Math.round(r.left),right:Math.round(r.right),width:Math.round(r.width),height:Math.round(r.height)};}).filter(x=>x.left<-2||x.right>vw+2);
      const undersized=nodes.map(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return {tag:el.tagName.toLowerCase(),id:el.id||'',cls:String(el.className||'').slice(0,80),label:(el.getAttribute('aria-label')||el.textContent||el.getAttribute('placeholder')||'').trim().replace(/\s+/g,' ').slice(0,80),display:s.display,width:Math.round(r.width),height:Math.round(r.height)};}).filter(x=>x.display!=='inline'&&(x.width<24||x.height<24));
      const fixed=[...document.querySelectorAll('*')].filter(visible).map(el=>{const s=getComputedStyle(el);if(!['fixed','sticky'].includes(s.position))return null;const r=el.getBoundingClientRect();return {tag:el.tagName.toLowerCase(),id:el.id||'',cls:String(el.className||'').slice(0,80),position:s.position,left:Math.round(r.left),right:Math.round(r.right),top:Math.round(r.top),bottom:Math.round(r.bottom)};}).filter(Boolean).filter(x=>x.left<-2||x.right>vw+2);
      return {vw,scrollWidth:Math.max(document.documentElement.scrollWidth,document.body.scrollWidth),overflow,focusable:nodes.length,offscreen:offscreen.slice(0,12),undersized:undersized.slice(0,20),fixedOffscreen:fixed.slice(0,12)};
    });
    const item={path,status:response?.status()||0,finalPath:new URL(page.url()).pathname,...metrics,pageErrors:pageErrors.slice(0,5)};
    results.push(item); console.log('PAGE '+JSON.stringify(item));
  }catch(e){const item={path,error:String(e.message||e)};results.push(item);console.log('PAGE '+JSON.stringify(item));}
  finally{await page.close();}
}
await browser.close();

const overflowPages=results.filter(x=>(x.overflow||0)>4).map(x=>({path:x.path,overflow:x.overflow,offscreen:x.offscreen}));
const clippedControls=results.filter(x=>x.offscreen?.length).map(x=>({path:x.path,controls:x.offscreen}));
const undersized=results.filter(x=>x.undersized?.length).map(x=>({path:x.path,targets:x.undersized}));
const fixedOffscreen=results.filter(x=>x.fixedOffscreen?.length).map(x=>({path:x.path,elements:x.fixedOffscreen}));
const pageErrors=results.filter(x=>x.pageErrors?.length).map(x=>({path:x.path,errors:x.pageErrors}));
console.log(`AUDITED_ROUTES=${routes.length}`);
console.log(`AUTH_GATE_STUBS=${gateStubs}`);
console.log(`CONFIG_OVERRIDES=${configOverrides}`);
console.log(`BLOCKED_LOGIN_NAVIGATIONS=${blockedLoginNavigations}`);
console.log(`BLOCKED_NON_GET_REQUESTS=${blockedWrites}`);
console.log(`HORIZONTAL_OVERFLOW_PAGES=${overflowPages.length}`);
console.log(`OFFSCREEN_INTERACTIVE_PAGES=${clippedControls.length}`);
console.log(`UNDERSIZED_TARGET_PAGES=${undersized.length}`);
console.log(`FIXED_OFFSCREEN_PAGES=${fixedOffscreen.length}`);
console.log(`PAGE_ERROR_PAGES=${pageErrors.length}`);
for(const x of overflowPages) console.log('OVERFLOW '+JSON.stringify(x));
for(const x of clippedControls) console.log('OFFSCREEN '+JSON.stringify(x));
for(const x of undersized) console.log('UNDERSIZED '+JSON.stringify(x));
for(const x of fixedOffscreen) console.log('FIXED '+JSON.stringify(x));
for(const x of pageErrors) console.log('PAGEERROR '+JSON.stringify(x));
console.log('SUMMARY='+JSON.stringify({routes:routes.length,gateStubs,configOverrides,blockedLoginNavigations,blockedWrites,overflowPages:overflowPages.length,clippedControlPages:clippedControls.length,undersizedTargetPages:undersized.length,fixedOffscreenPages:fixedOffscreen.length,pageErrorPages:pageErrors.length}));
