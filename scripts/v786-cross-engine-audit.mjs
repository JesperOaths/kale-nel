#!/usr/bin/env node
// Temporary PR-only cross-engine audit; no product behavior is modified.
import { firefox, webkit } from 'playwright';

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
const engines=[['firefox',firefox],['webkit',webkit]];
const clean=v=>String(v||'').replace(/\s+/g,' ').trim().slice(0,500);
const sameSite=url=>{try{return new URL(url).hostname==='kalenel.nl';}catch{return false;}};
let blockedWrites=0;
const failures=[];

for(const [engineName,engine] of engines){
  const browser=await engine.launch({headless:true});
  for(const [viewportName,width,height] of viewports){
    for(const path of routes){
      const context=await browser.newContext({viewport:{width,height},locale:'nl-NL',serviceWorkers:'block'});
      const page=await context.newPage();
      const pageErrors=[]; const consoleErrors=[]; const badSameOrigin=[]; const failedSameOrigin=[]; const blockedLogins=[];

      await context.route('**/*',async route=>{
        const req=route.request(); let url; try{url=new URL(req.url());}catch{return route.continue();}
        if(url.hostname==='kalenel.nl'&&/\/gejast-home-gate\.js$/i.test(url.pathname)){
          return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={audit:true};"});
        }
        if(url.hostname==='kalenel.nl'&&/\/gejast-config\.js$/i.test(url.pathname)){
          const upstream=await route.fetch(); const body=await upstream.text();
          return route.fulfill({response:upstream,contentType:'application/javascript',body:`${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};`});
        }
        if(req.isNavigationRequest()&&url.hostname==='kalenel.nl'&&path!=='/login.html'&&path!=='/familie/login.html'&&(/\/login\.html$/i.test(url.pathname)||url.pathname==='/login')){
          blockedLogins.push(url.pathname); return route.abort('aborted');
        }
        if(!['GET','HEAD'].includes(req.method())){
          blockedWrites++; return route.fulfill({status:200,contentType:'application/json',body:'[]'});
        }
        return route.continue();
      });

      page.on('pageerror',e=>pageErrors.push(clean(e?.stack||e?.message||e)));
      page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(clean(msg.text()));});
      page.on('response',res=>{const req=res.request();if(['GET','HEAD'].includes(req.method())&&sameSite(res.url())&&res.status()>=400)badSameOrigin.push(`${res.status()} ${new URL(res.url()).pathname}`);});
      page.on('requestfailed',req=>{
        if(!['GET','HEAD'].includes(req.method())||!sameSite(req.url()))return;
        const p=new URL(req.url()).pathname; const failure=clean(req.failure()?.errorText||'failed');
        if(blockedLogins.includes(p)&&/abort/i.test(failure))return;
        failedSameOrigin.push(`${p} :: ${failure}`);
      });

      let navigationError='';
      try{await page.goto(`${base}${path}?cross_engine=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});}
      catch(err){navigationError=clean(err?.message||err);}
      await page.waitForTimeout(900);

      const state=await page.evaluate(()=>({
        url:location.href,
        title:document.title.trim(),
        bodyText:(document.body?.innerText||'').trim().slice(0,180),
        authPending:document.documentElement.classList.contains('gejast-auth-pending')||document.body?.classList.contains('boot-pending'),
        docWidth:Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth||0),
        viewportWidth:innerWidth
      })).catch(()=>({url:page.url(),title:'',bodyText:'',authPending:true,docWidth:99999,viewportWidth:width}));

      const row={engine:engineName,viewport:viewportName,path,navigationError,pageErrors:[...new Set(pageErrors)],consoleErrors:[...new Set(consoleErrors)],badSameOrigin:[...new Set(badSameOrigin)],failedSameOrigin:[...new Set(failedSameOrigin)],state};
      const failed=row.navigationError||row.pageErrors.length||row.consoleErrors.length||row.badSameOrigin.length||row.failedSameOrigin.length||row.state.authPending||!row.state.title||!row.state.bodyText||row.state.docWidth>row.state.viewportWidth+4;
      if(failed){failures.push(row);console.log('CROSS_ENGINE_FAIL '+JSON.stringify(row));}
      await context.close();
    }
  }
  await browser.close();
}

const combinations=engines.length*viewports.length*routes.length;
console.log(`CROSS_ENGINE_SUMMARY combinations=${combinations} failures=${failures.length} blockedWrites=${blockedWrites}`);
if(blockedWrites===0)throw new Error('cross-engine audit did not demonstrate local write interception');
if(failures.length)process.exit(1);
console.log(`CROSS_ENGINE_COMPAT=PASS combinations=${combinations} blockedWrites=${blockedWrites}`);
