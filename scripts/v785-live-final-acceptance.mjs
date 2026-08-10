#!/usr/bin/env node
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium } from 'playwright';
const require=createRequire(import.meta.url);
const axeSource=fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
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
const rows=[];
const clean=v=>String(v||'').replace(/\s+/g,' ').trim().slice(0,500);
const sameSite=url=>{try{return new URL(url).hostname==='kalenel.nl';}catch{return false;}};

async function audit(path,label,width,height){
  const context=await browser.newContext({viewport:{width,height},locale:'nl-NL',serviceWorkers:'block'});
  const page=await context.newPage();
  const pageErrors=[];const consoleErrors=[];const badSameOrigin=[];const failedSameOrigin=[];const blockedLogins=[];
  await context.route('**/*',async route=>{
    const req=route.request();let url;try{url=new URL(req.url());}catch{return route.continue();}
    if(url.hostname==='kalenel.nl'&&/\/gejast-home-gate\.js$/i.test(url.pathname))return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={audit:true};"});
    if(url.hostname==='kalenel.nl'&&/\/gejast-config\.js$/i.test(url.pathname)){
      const upstream=await route.fetch();const body=await upstream.text();
      return route.fulfill({response:upstream,contentType:'application/javascript',body:`${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};`});
    }
    if(req.isNavigationRequest()&&url.hostname==='kalenel.nl'&&path!=='/login.html'&&path!=='/familie/login.html'&&(/\/login\.html$/i.test(url.pathname)||url.pathname==='/login')){blockedLogins.push(url.pathname);return route.abort('aborted');}
    if(!['GET','HEAD'].includes(req.method())){blockedWrites++;return route.fulfill({status:200,contentType:'application/json',body:'[]'});}
    return route.continue();
  });
  page.on('pageerror',e=>pageErrors.push(clean(e?.stack||e?.message||e)));
  page.on('console',msg=>{if(msg.type()==='error'){const loc=msg.location();consoleErrors.push(clean(`${msg.text()}${loc?.url?` @ ${loc.url}:${loc.lineNumber||0}`:''}`));}});
  page.on('response',res=>{const req=res.request();if(['GET','HEAD'].includes(req.method())&&sameSite(res.url())&&res.status()>=400)badSameOrigin.push(`${res.status()} ${new URL(res.url()).pathname}`);});
  page.on('requestfailed',req=>{if(!['GET','HEAD'].includes(req.method())||!sameSite(req.url()))return;const p=new URL(req.url()).pathname;const failure=clean(req.failure()?.errorText||'failed');if(blockedLogins.includes(p)&&/aborted/i.test(failure))return;failedSameOrigin.push(`${p} :: ${failure}`);});
  let navigationError='';
  try{await page.goto(`${base}${path}?v785_final=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});}catch(err){navigationError=clean(err?.message||err);}
  await page.waitForTimeout(1200);
  const state=await page.evaluate(()=>{
    const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0;};
    const focusables=[...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(visible);
    const hiddenFocusable=[...document.querySelectorAll('[aria-hidden="true"]')].flatMap(root=>[...root.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(visible).filter(el=>!el.disabled&&Number(el.getAttribute('tabindex')||0)>=0&&!root.hasAttribute('inert'))).length;
    return{
      url:location.href,title:document.title.trim(),bodyText:(document.body?.innerText||'').trim().slice(0,180),
      authPending:document.documentElement.classList.contains('gejast-auth-pending')||document.body?.classList.contains('boot-pending'),
      docWidth:Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth||0),viewportWidth:innerWidth,
      positiveTabindex:focusables.filter(el=>Number(el.getAttribute('tabindex'))>0).length,
      hiddenFocusable,
      busyVisible:[...document.querySelectorAll('[aria-busy="true"]')].filter(visible).length
    };
  }).catch(()=>({url:page.url(),title:'',bodyText:'',authPending:true,docWidth:99999,viewportWidth:width,positiveTabindex:0,hiddenFocusable:0,busyVisible:0}));
  let axe=[];
  if(!navigationError&&state.bodyText){
    try{
      await page.addScriptTag({content:axeSource});
      const out=await page.evaluate(async()=>await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']},resultTypes:['violations']}));
      axe=out.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length,help:v.help}));
    }catch(err){axe=[{id:'axe-run-failed',impact:'critical',nodes:1,help:clean(err?.message||err)}];}
  }
  const row={path,viewport:label,navigationError,pageErrors:[...new Set(pageErrors)],consoleErrors:[...new Set(consoleErrors)],badSameOrigin:[...new Set(badSameOrigin)],failedSameOrigin:[...new Set(failedSameOrigin)],state,axe};
  rows.push(row);
  console.log(`FINAL ${label} ${path} errors=${row.pageErrors.length+row.consoleErrors.length+row.badSameOrigin.length+row.failedSameOrigin.length} axe=${axe.length} width=${state.docWidth}/${state.viewportWidth}`);
  await context.close();
}

for(const [label,w,h] of viewports)for(const route of routes)await audit(route,label,w,h);
await browser.close();
const failures=rows.filter(r=>r.navigationError||r.pageErrors.length||r.consoleErrors.length||r.badSameOrigin.length||r.failedSameOrigin.length||r.state.authPending||!r.state.title||!r.state.bodyText||r.state.docWidth>r.state.viewportWidth+4||r.state.positiveTabindex||r.state.hiddenFocusable||r.state.busyVisible||r.axe.length);
const summary={version:'v785',combinations:rows.length,failures:failures.length,blockedWrites,seriousCriticalAxe:failures.reduce((n,r)=>n+r.axe.length,0),details:failures};
fs.writeFileSync('V785_LIVE_FINAL_ACCEPTANCE.json',JSON.stringify(summary,null,2)+'\n');
console.log('V785_LIVE_FINAL_ACCEPTANCE='+JSON.stringify({combinations:rows.length,failures:failures.length,blockedWrites,seriousCriticalAxe:summary.seriousCriticalAxe}));
if(blockedWrites===0)throw new Error('final browser audit did not demonstrate write interception');
if(failures.length){console.error(`v785 final browser acceptance found ${failures.length} failing combinations.`);process.exit(1);}
console.log(`V785_FINAL_BROWSER_ACCEPTANCE=PASS combinations=${rows.length} blockedWrites=${blockedWrites} seriousCriticalAxe=0`);
