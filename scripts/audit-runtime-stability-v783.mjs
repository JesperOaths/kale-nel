#!/usr/bin/env node
import { chromium } from 'playwright';

const base='https://kalenel.nl';
const routes=[
  '/', '/index.html', '/scorer.html', '/score.html', '/klaverjas_scorer_v596_repo_ready.html',
  '/klaverjas_live.html', '/klaverjas_online.html', '/toepen.html', '/beerpong.html', '/boerenbridge.html',
  '/boerenbridge_live.html', '/pikken.html', '/pikken_live.html', '/pikken_spectator.html', '/paardenrace.html',
  '/paardenrace_live.html', '/paardenrace_spectator.html', '/drinks.html', '/drinks_add.html', '/drinks_pending.html',
  '/drinks_history.html', '/drinks_speed.html', '/despimarkt.html', '/beurs.html', '/rad.html', '/profiles.html',
  '/my_profile.html', '/login.html', '/request.html', '/activate.html', '/familie.html', '/familie/index.html',
  '/familie/login.html', '/familie/scorer.html', '/familie/leaderboard.html'
];
const viewports=[['phone',390,844],['desktop',1366,768]];
const browser=await chromium.launch({headless:true});
let blockedWrites=0;
const results=[];

const sameSite=(url)=>{try{return new URL(url).hostname==='kalenel.nl';}catch{return false;}};
const clean=(value)=>String(value||'').replace(/\s+/g,' ').trim().slice(0,500);

async function auditOne(path,label,width,height){
  const context=await browser.newContext({viewport:{width,height},locale:'nl-NL',serviceWorkers:'block'});
  const page=await context.newPage();
  const pageErrors=[];
  const consoleErrors=[];
  const badSameOrigin=[];
  const failedSameOrigin=[];
  const blockedLoginNavigations=[];

  await context.route('**/*',async route=>{
    const req=route.request();
    let url; try{url=new URL(req.url());}catch{return route.continue();}
    const pathname=url.pathname;
    if(url.hostname==='kalenel.nl'&&/\/gejast-home-gate\.js$/i.test(pathname)){
      return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={audit:true};"});
    }
    if(url.hostname==='kalenel.nl'&&/\/gejast-config\.js$/i.test(pathname)){
      const upstream=await route.fetch(); const body=await upstream.text();
      return route.fulfill({response:upstream,contentType:'application/javascript',body:`${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};`});
    }
    if(req.isNavigationRequest()&&url.hostname==='kalenel.nl'&&path!=='/login.html'&&path!=='/familie/login.html'&&(/\/login\.html$/i.test(pathname)||pathname==='/login')){
      blockedLoginNavigations.push(pathname);
      return route.abort('aborted');
    }
    if(!['GET','HEAD'].includes(req.method())){
      blockedWrites++;
      return route.fulfill({status:200,contentType:'application/json',body:'[]'});
    }
    return route.continue();
  });

  page.on('pageerror',err=>pageErrors.push(clean(err?.stack||err?.message||err)));
  page.on('console',msg=>{
    if(msg.type()!=='error') return;
    const loc=msg.location();
    consoleErrors.push(clean(`${msg.text()}${loc?.url?` @ ${loc.url}:${loc.lineNumber||0}`:''}`));
  });
  page.on('response',res=>{
    const req=res.request();
    if(['GET','HEAD'].includes(req.method())&&sameSite(res.url())&&res.status()>=400){
      badSameOrigin.push(`${res.status()} ${new URL(res.url()).pathname}`);
    }
  });
  page.on('requestfailed',req=>{
    if(!['GET','HEAD'].includes(req.method())||!sameSite(req.url())) return;
    const p=new URL(req.url()).pathname;
    const failure=clean(req.failure()?.errorText||'failed');
    if(blockedLoginNavigations.includes(p)&&/aborted/i.test(failure)) return;
    failedSameOrigin.push(`${p} :: ${failure}`);
  });

  let navigationError='';
  try{
    await page.goto(`${base}${path}?v783_audit=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
  }catch(err){
    navigationError=clean(err?.message||err);
  }
  await page.waitForTimeout(1200);
  const rendered=await page.evaluate(()=>({
    url:location.href,
    title:document.title,
    bodyText:(document.body?.innerText||'').trim().slice(0,160),
    authPending:document.documentElement.classList.contains('gejast-auth-pending')||document.body?.classList.contains('boot-pending'),
    bodyDisplay:getComputedStyle(document.body).display,
    bodyVisibility:getComputedStyle(document.body).visibility,
    bodyOpacity:getComputedStyle(document.body).opacity
  })).catch(()=>({url:page.url(),title:'',bodyText:'',authPending:true,bodyDisplay:'',bodyVisibility:'',bodyOpacity:''}));

  const row={path,viewport:label,navigationError,pageErrors:[...new Set(pageErrors)],consoleErrors:[...new Set(consoleErrors)],badSameOrigin:[...new Set(badSameOrigin)],failedSameOrigin:[...new Set(failedSameOrigin)],blockedLoginNavigations:[...new Set(blockedLoginNavigations)],rendered};
  results.push(row);
  console.log(`RUNTIME ${label} ${path} ${JSON.stringify(row)}`);
  await context.close();
}

for(const [label,width,height] of viewports){
  for(const path of routes) await auditOne(path,label,width,height);
}
await browser.close();

const interesting=results.filter(r=>r.navigationError||r.pageErrors.length||r.badSameOrigin.length||r.failedSameOrigin.length||r.rendered.authPending||!r.rendered.bodyText);
const consoleOnly=results.filter(r=>!interesting.includes(r)&&r.consoleErrors.length);
const summary={combinations:results.length,interesting:interesting.length,consoleOnly:consoleOnly.length,blockedWrites,byPath:{}};
for(const r of interesting){
  summary.byPath[r.path]??=[];
  summary.byPath[r.path].push({viewport:r.viewport,navigationError:r.navigationError,pageErrors:r.pageErrors,badSameOrigin:r.badSameOrigin,failedSameOrigin:r.failedSameOrigin,authPending:r.rendered.authPending,emptyBody:!r.rendered.bodyText});
}
console.log('RUNTIME_AUDIT_SUMMARY='+JSON.stringify(summary));
console.log('RUNTIME_CONSOLE_ONLY='+JSON.stringify(consoleOnly.map(r=>({path:r.path,viewport:r.viewport,consoleErrors:r.consoleErrors}))));
if(blockedWrites===0) throw new Error('runtime audit did not demonstrate write interception');
