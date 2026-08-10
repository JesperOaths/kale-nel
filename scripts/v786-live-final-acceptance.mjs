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
const clean=v=>String(v||'').replace(/\s+/g,' ').trim().slice(0,500);
const sameSite=url=>{try{return new URL(url).hostname==='kalenel.nl';}catch{return false;}};

async function prepareContext(path,width,height){
  const context=await browser.newContext({viewport:{width,height},locale:'nl-NL',serviceWorkers:'block'});
  const page=await context.newPage();
  const pageErrors=[];const consoleErrors=[];const badSameOrigin=[];const failedSameOrigin=[];const blockedLogins=[];
  await context.route('**/*',async route=>{
    const req=route.request();let url;try{url=new URL(req.url());}catch{return route.continue();}
    if(url.hostname==='kalenel.nl'&&/\/gejast-home-gate\.js$/i.test(url.pathname)){
      return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={audit:true};"});
    }
    if(url.hostname==='kalenel.nl'&&/\/gejast-config\.js$/i.test(url.pathname)){
      const upstream=await route.fetch();const body=await upstream.text();
      return route.fulfill({response:upstream,contentType:'application/javascript',body:`${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};`});
    }
    if(req.isNavigationRequest()&&url.hostname==='kalenel.nl'&&path!=='/login.html'&&path!=='/familie/login.html'&&(/\/login\.html$/i.test(url.pathname)||url.pathname==='/login')){
      blockedLogins.push(url.pathname);return route.abort('aborted');
    }
    if(!['GET','HEAD'].includes(req.method())){blockedWrites++;return route.fulfill({status:200,contentType:'application/json',body:'[]'});}
    return route.continue();
  });
  page.on('pageerror',e=>pageErrors.push(clean(e?.stack||e?.message||e)));
  page.on('console',msg=>{if(msg.type()==='error'){const loc=msg.location();consoleErrors.push(clean(`${msg.text()}${loc?.url?` @ ${loc.url}:${loc.lineNumber||0}`:''}`));}});
  page.on('response',res=>{const req=res.request();if(['GET','HEAD'].includes(req.method())&&sameSite(res.url())&&res.status()>=400)badSameOrigin.push(`${res.status()} ${new URL(res.url()).pathname}`);});
  page.on('requestfailed',req=>{if(!['GET','HEAD'].includes(req.method())||!sameSite(req.url()))return;const p=new URL(req.url()).pathname;const failure=clean(req.failure()?.errorText||'failed');if(blockedLogins.includes(p)&&/aborted/i.test(failure))return;failedSameOrigin.push(`${p} :: ${failure}`);});
  return {context,page,pageErrors,consoleErrors,badSameOrigin,failedSameOrigin};
}

async function audit(path,label,width,height,{axe=true}={}){
  const t=await prepareContext(path,width,height);
  let navigationError='';
  try{await t.page.goto(`${base}${path}?v786_final=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});}catch(err){navigationError=clean(err?.message||err);}
  await t.page.waitForTimeout(1200);
  const state=await t.page.evaluate(()=>{
    const visible=el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&Number(s.opacity)!==0&&r.width>0&&r.height>0;};
    const focusables=[...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(visible);
    const hiddenFocusable=[...document.querySelectorAll('[aria-hidden="true"]')].flatMap(root=>[...root.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].filter(visible).filter(el=>!el.disabled&&Number(el.getAttribute('tabindex')||0)>=0&&!root.hasAttribute('inert'))).length;
    const wheel=document.querySelector('.wheel-box');const panel=wheel?.closest('.panel');const runtimeStyle=document.getElementById('gejast-mobile-rad-v583');const wr=wheel?.getBoundingClientRect();const pr=panel?.getBoundingClientRect();
    return{
      url:location.href,title:document.title.trim(),bodyText:(document.body?.innerText||'').trim().slice(0,180),
      authPending:document.documentElement.classList.contains('gejast-auth-pending')||document.body?.classList.contains('boot-pending'),
      docWidth:Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth||0),viewportWidth:innerWidth,
      positiveTabindex:focusables.filter(el=>Number(el.getAttribute('tabindex'))>0).length,hiddenFocusable,
      busyVisible:[...document.querySelectorAll('[aria-busy="true"]')].filter(visible).length,
      rad:pathFromLocation()==='rad.html'?{wheelLeft:wr?.left??null,wheelRight:wr?.right??null,panelRight:pr?.right??null,runtimeStyleInjected:!!runtimeStyle,runtimeStyleText:runtimeStyle?.textContent||''}:null
    };
    function pathFromLocation(){return (location.pathname.split('/').pop()||'').toLowerCase();}
  }).catch(()=>({url:t.page.url(),title:'',bodyText:'',authPending:true,docWidth:99999,viewportWidth:width,positiveTabindex:0,hiddenFocusable:0,busyVisible:0,rad:null}));
  let axeViolations=[];
  if(axe&&!navigationError&&state.bodyText){
    try{await t.page.addScriptTag({content:axeSource});const out=await t.page.evaluate(async()=>await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']},resultTypes:['violations']}));axeViolations=out.violations.filter(v=>['serious','critical'].includes(v.impact)).map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length,help:v.help}));}
    catch(err){axeViolations=[{id:'axe-run-failed',impact:'critical',nodes:1,help:clean(err?.message||err)}];}
  }
  const row={path,viewport:label,width,navigationError,pageErrors:[...new Set(t.pageErrors)],consoleErrors:[...new Set(t.consoleErrors)],badSameOrigin:[...new Set(t.badSameOrigin)],failedSameOrigin:[...new Set(t.failedSameOrigin)],state,axe:axeViolations};
  console.log(`FINAL ${label} ${path} errors=${row.pageErrors.length+row.consoleErrors.length+row.badSameOrigin.length+row.failedSameOrigin.length} axe=${axeViolations.length} width=${state.docWidth}/${state.viewportWidth}`);
  await t.context.close();
  return row;
}

const mainRows=[];
for(const [label,w,h] of viewports) for(const route of routes) mainRows.push(await audit(route,label,w,h,{axe:true}));
const rowFails=r=>r.navigationError||r.pageErrors.length||r.consoleErrors.length||r.badSameOrigin.length||r.failedSameOrigin.length||r.state.authPending||!r.state.title||!r.state.bodyText||r.state.docWidth>r.state.viewportWidth+4||r.state.positiveTabindex||r.state.hiddenFocusable||r.state.busyVisible||r.axe.length;
const mainFailures=mainRows.filter(rowFails);

const radRows=[];
const existingRad390=mainRows.find(r=>r.path==='/rad.html'&&r.viewport==='phone');
if(existingRad390) radRows.push(existingRad390);
for(const width of [320,360,430,760]) radRows.push(await audit('/rad.html',`rad-${width}`,width,844,{axe:false}));
const radFailures=radRows.filter(r=>{
  const rad=r.state.rad;
  return r.navigationError||r.pageErrors.length||r.consoleErrors.length||r.badSameOrigin.length||r.failedSameOrigin.length||r.state.authPending||r.state.docWidth>r.state.viewportWidth+4||!rad||rad.wheelRight==null||rad.panelRight==null||rad.wheelRight>r.state.viewportWidth+1||rad.wheelRight>rad.panelRight+1||!rad.runtimeStyleInjected||!/width:min\(100%,460px\)\s*!important/.test(rad.runtimeStyleText)||/96vw/.test(rad.runtimeStyleText);
});

await browser.close();
const seriousCriticalAxe=mainRows.reduce((n,r)=>n+r.axe.length,0);
const summary={version:'v786',combinations:mainRows.length,failures:mainFailures.length,radWidths:radRows.map(r=>r.width),radFailures:radFailures.length,blockedWrites,seriousCriticalAxe,details:{main:mainFailures,rad:radFailures}};
fs.writeFileSync('V786_LIVE_FINAL_ACCEPTANCE.json',JSON.stringify(summary,null,2)+'\n');
console.log('V786_LIVE_FINAL_ACCEPTANCE='+JSON.stringify({combinations:summary.combinations,failures:summary.failures,radWidths:summary.radWidths,radFailures:summary.radFailures,blockedWrites,seriousCriticalAxe}));
if(blockedWrites===0) throw new Error('final browser audit did not demonstrate non-GET interception');
if(mainFailures.length||radFailures.length){console.error(`v786 final acceptance failed: main=${mainFailures.length}, rad=${radFailures.length}`);process.exit(1);}
console.log(`V786_FINAL_BROWSER_ACCEPTANCE=PASS combinations=${mainRows.length} radWidths=${radRows.map(r=>r.width).join(',')} blockedWrites=${blockedWrites} seriousCriticalAxe=0`);
