#!/usr/bin/env node
import { chromium } from 'playwright';

const BASE='https://kalenel.nl';
const routes=[
  '/','/login.html','/request.html','/profiles.html','/drinks.html','/drinks_add.html','/drinks_pending.html','/drinks_speed.html',
  '/beerpong.html','/boerenbridge.html','/pikken.html','/pikken_live.html','/paardenrace.html','/paardenrace_live.html',
  '/toepen.html','/rad.html','/scorer.html','/leaderboard.html','/despimarkt.html','/despimarkt_create.html','/klaverjas_live.html','/klaverjas_online.html','/my_profile.html'
];
const viewports=[
  {name:'tablet-portrait',width:768,height:1024},
  {name:'tablet-landscape',width:1024,height:768},
  {name:'desktop',width:1366,height:768}
];

const browser=await chromium.launch({headless:true});
let blockedWrites=0, gateStubs=0, configOverrides=0, blockedLoginNavigations=0;
const all=[];

for(const vp of viewports){
  const context=await browser.newContext({viewport:{width:vp.width,height:vp.height},locale:'nl-NL'});
  await context.route('**/*',async route=>{
    const req=route.request(); const url=new URL(req.url());
    if(req.isNavigationRequest()&&url.hostname==='kalenel.nl'&&/\/login\.html$/i.test(url.pathname)&&!req.url().includes('/login.html?responsive_audit=')){
      blockedLoginNavigations++;
      return route.abort('blockedbyclient');
    }
    if(url.hostname==='kalenel.nl'&&/\/gejast-home-gate\.js$/i.test(url.pathname)){
      gateStubs++;
      return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={VERSION:'v782-responsive-audit',audit:true};"});
    }
    if(url.hostname==='kalenel.nl'&&/\/gejast-config\.js$/i.test(url.pathname)){
      configOverrides++;
      const upstream=await route.fetch(); const body=await upstream.text();
      return route.fulfill({response:upstream,contentType:'application/javascript',body:`${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};`});
    }
    if(!['GET','HEAD'].includes(req.method())){
      blockedWrites++;
      return route.fulfill({status:200,contentType:'application/json',body:'[]'});
    }
    return route.continue();
  });

  for(const path of routes){
    const page=await context.newPage();
    const pageErrors=[]; page.on('pageerror',e=>pageErrors.push(String(e.message||e)));
    try{
      const response=await page.goto(`${BASE}${path}${path.includes('?')?'&':'?'}responsive_audit=${vp.name}-${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
      await page.waitForTimeout(700);
      const metrics=await page.evaluate(()=>{
        const vw=innerWidth;
        const selector='a[href],button,input:not([type="hidden"]),select,textarea,[role="button"],[role="link"],[tabindex="0"]';
        const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.disabled&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};
        const nodes=[...document.querySelectorAll(selector)].filter(visible);
        const label=el=>(el.getAttribute('aria-label')||el.textContent||el.getAttribute('placeholder')||'').trim().replace(/\s+/g,' ').slice(0,80);
        const scrollAncestor=el=>{
          for(let p=el.parentElement;p;p=p.parentElement){
            const s=getComputedStyle(p);
            if(['auto','scroll'].includes(s.overflowX)&&p.scrollWidth>p.clientWidth+2) return {tag:p.tagName.toLowerCase(),id:p.id||'',cls:String(p.className||'').slice(0,80),clientWidth:p.clientWidth,scrollWidth:p.scrollWidth};
          }
          return null;
        };
        const hiddenClipAncestor=el=>{
          const r=el.getBoundingClientRect();
          for(let p=el.parentElement;p&&p!==document.body;p=p.parentElement){
            const s=getComputedStyle(p);
            if(['hidden','clip'].includes(s.overflowX)||['hidden','clip'].includes(s.overflow)){
              const pr=p.getBoundingClientRect();
              if(r.left<pr.left-2||r.right>pr.right+2) return {tag:p.tagName.toLowerCase(),id:p.id||'',cls:String(p.className||'').slice(0,80),left:Math.round(pr.left),right:Math.round(pr.right)};
            }
          }
          return null;
        };
        const interactive=nodes.map(el=>{const r=el.getBoundingClientRect();const sc=scrollAncestor(el);const clip=hiddenClipAncestor(el);return {tag:el.tagName.toLowerCase(),id:el.id||'',cls:String(el.className||'').slice(0,80),label:label(el),left:Math.round(r.left),right:Math.round(r.right),top:Math.round(r.top),bottom:Math.round(r.bottom),width:Math.round(r.width),height:Math.round(r.height),scrollAncestor:sc,hiddenClip:clip};});
        const offscreen=interactive.filter(x=>x.left<-2||x.right>vw+2);
        const uncontainedOffscreen=offscreen.filter(x=>!x.scrollAncestor);
        const intentionalScroll=offscreen.filter(x=>!!x.scrollAncestor);
        const clipped=interactive.filter(x=>!!x.hiddenClip);
        const fixedOffscreen=[...document.querySelectorAll('*')].filter(visible).map(el=>{const s=getComputedStyle(el);if(!['fixed','sticky'].includes(s.position))return null;const r=el.getBoundingClientRect();return {tag:el.tagName.toLowerCase(),id:el.id||'',cls:String(el.className||'').slice(0,80),position:s.position,left:Math.round(r.left),right:Math.round(r.right),top:Math.round(r.top),bottom:Math.round(r.bottom)};}).filter(Boolean).filter(x=>x.left<-2||x.right>vw+2);
        const docWidth=Math.max(document.documentElement.scrollWidth,document.body.scrollWidth);
        return {vw,docWidth,documentOverflow:docWidth-vw,focusable:nodes.length,uncontainedOffscreen:uncontainedOffscreen.slice(0,12),intentionalScroll:intentionalScroll.slice(0,12),clipped:clipped.slice(0,12),fixedOffscreen:fixedOffscreen.slice(0,12)};
      });
      const item={viewport:vp.name,path,status:response?.status()||0,finalPath:new URL(page.url()).pathname,...metrics,pageErrors:pageErrors.slice(0,5)};
      all.push(item); console.log('PAGE '+JSON.stringify(item));
    }catch(e){const item={viewport:vp.name,path,error:String(e.message||e)};all.push(item);console.log('PAGE '+JSON.stringify(item));}
    finally{await page.close();}
  }
  await context.close();
}
await browser.close();

const overflow=all.filter(x=>(x.documentOverflow||0)>4).map(x=>({viewport:x.viewport,path:x.path,overflow:x.documentOverflow}));
const offscreen=all.filter(x=>x.uncontainedOffscreen?.length).map(x=>({viewport:x.viewport,path:x.path,controls:x.uncontainedOffscreen}));
const clipped=all.filter(x=>x.clipped?.length).map(x=>({viewport:x.viewport,path:x.path,controls:x.clipped}));
const fixed=all.filter(x=>x.fixedOffscreen?.length).map(x=>({viewport:x.viewport,path:x.path,elements:x.fixedOffscreen}));
const errors=all.filter(x=>x.pageErrors?.length).map(x=>({viewport:x.viewport,path:x.path,errors:x.pageErrors}));
const intentional=all.filter(x=>x.intentionalScroll?.length).map(x=>({viewport:x.viewport,path:x.path,count:x.intentionalScroll.length,samples:x.intentionalScroll.slice(0,4)}));
console.log(`AUDITED_PAGE_VIEWPORTS=${all.length}`);
console.log(`AUTH_GATE_STUBS=${gateStubs}`);
console.log(`CONFIG_OVERRIDES=${configOverrides}`);
console.log(`BLOCKED_LOGIN_NAVIGATIONS=${blockedLoginNavigations}`);
console.log(`BLOCKED_NON_GET_REQUESTS=${blockedWrites}`);
console.log(`DOCUMENT_OVERFLOW_CASES=${overflow.length}`);
console.log(`UNCONTAINED_OFFSCREEN_CASES=${offscreen.length}`);
console.log(`HIDDEN_CLIP_CASES=${clipped.length}`);
console.log(`FIXED_STICKY_OFFSCREEN_CASES=${fixed.length}`);
console.log(`PAGE_ERROR_CASES=${errors.length}`);
console.log(`INTENTIONAL_SCROLL_CASES=${intentional.length}`);
for(const x of overflow) console.log('OVERFLOW '+JSON.stringify(x));
for(const x of offscreen) console.log('OFFSCREEN '+JSON.stringify(x));
for(const x of clipped) console.log('CLIPPED '+JSON.stringify(x));
for(const x of fixed) console.log('FIXED '+JSON.stringify(x));
for(const x of errors) console.log('PAGEERROR '+JSON.stringify(x));
for(const x of intentional) console.log('INTENTIONAL '+JSON.stringify(x));
console.log('SUMMARY='+JSON.stringify({pageViewports:all.length,gateStubs,configOverrides,blockedLoginNavigations,blockedWrites,documentOverflow:overflow.length,uncontainedOffscreen:offscreen.length,hiddenClip:clipped.length,fixedOffscreen:fixed.length,pageErrors:errors.length,intentionalScroll:intentional.length}));
