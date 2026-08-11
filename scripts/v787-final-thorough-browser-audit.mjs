#!/usr/bin/env node
// Temporary PR-only final production audit. Every non-GET browser request is intercepted locally.
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { chromium, firefox, webkit } from 'playwright';

const require=createRequire(import.meta.url);
const axeSource=fs.readFileSync(require.resolve('axe-core/axe.min.js'),'utf8');
const base='https://kalenel.nl';
const engineName=process.env.AUDIT_ENGINE||'chromium';
const engines={chromium,firefox,webkit};
const engine=engines[engineName];
if(!engine) throw new Error(`Unknown AUDIT_ENGINE ${engineName}`);
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
const familyTargets=new Map([
  ['/familie/index.html',['/index.html','family']],
  ['/familie/login.html',['/login.html','family']],
  ['/familie/scorer.html',['/scorer.html','family']],
  ['/familie/leaderboard.html',['/leaderboard.html','family']]
]);
const clean=v=>String(v||'').replace(/\s+/g,' ').trim().slice(0,600);
const sameSite=url=>{try{return new URL(url).hostname==='kalenel.nl';}catch{return false;}};
const uniq=a=>[...new Set(a)];
let blockedNonGet=0;
const failures=[];
const rows=[];
const browser=await engine.launch({headless:true});

async function auditPage(path,viewportName,width,height,{focusedRad=false}={}){
  const context=await browser.newContext({viewport:{width,height},locale:'nl-NL',serviceWorkers:'block'});
  const page=await context.newPage();
  const pageErrors=[]; const consoleErrors=[]; const badSameOrigin=[]; const failedSameOrigin=[]; const blockedLogins=[]; const navs=[]; const wrongFamilyRequests=[];
  const initialPath=path;
  await context.route('**/*',async route=>{
    const req=route.request(); let url; try{url=new URL(req.url());}catch{return route.continue();}
    if(url.hostname==='kalenel.nl'&&url.pathname==='/favicon.ico') return route.fulfill({status:204,contentType:'image/x-icon',body:''});
    if(url.hostname==='kalenel.nl'&&familyTargets.has(initialPath)&&url.pathname.startsWith('/familie/')&&url.pathname!==initialPath) wrongFamilyRequests.push(`${req.method()} ${url.pathname}`);
    if(url.hostname==='kalenel.nl'&&/\/gejast-home-gate\.js$/i.test(url.pathname)){
      return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={audit:true};"});
    }
    if(url.hostname==='kalenel.nl'&&/\/gejast-config\.js$/i.test(url.pathname)){
      const upstream=await route.fetch(); const body=await upstream.text();
      return route.fulfill({response:upstream,contentType:'application/javascript',body:`${body}\n;window.GEJAST_CONFIG=window.GEJAST_CONFIG||{};window.GEJAST_CONFIG.requireMatchEntrySession=function(){return true;};window.GEJAST_CONFIG.ensurePlayerSessionOrRedirect=function(){return true;};`});
    }
    const loginNav=req.isNavigationRequest()&&url.hostname==='kalenel.nl'&&!['/login.html','/familie/login.html'].includes(initialPath)&&(/\/login\.html$/i.test(url.pathname)||url.pathname==='/login');
    if(loginNav){blockedLogins.push(url.pathname);return route.abort('aborted');}
    if(!['GET','HEAD'].includes(req.method())){blockedNonGet++;return route.fulfill({status:200,contentType:'application/json',body:'[]'});}
    return route.continue();
  });
  page.on('framenavigated',frame=>{if(frame===page.mainFrame())navs.push(frame.url());});
  page.on('pageerror',e=>pageErrors.push(clean(e?.stack||e?.message||e)));
  page.on('console',msg=>{if(msg.type()==='error')consoleErrors.push(clean(msg.text()));});
  page.on('response',res=>{const req=res.request();if(['GET','HEAD'].includes(req.method())&&sameSite(res.url())&&res.status()>=400)badSameOrigin.push(`${res.status()} ${new URL(res.url()).pathname}`);});
  page.on('requestfailed',req=>{
    if(!['GET','HEAD'].includes(req.method())||!sameSite(req.url()))return;
    const p=new URL(req.url()).pathname; const failure=clean(req.failure()?.errorText||'failed');
    if(blockedLogins.includes(p)&&/abort|cancel|NS_BINDING_ABORTED/i.test(failure))return;
    failedSameOrigin.push(`${p} :: ${failure}`);
  });

  let navigationError='';
  try{await page.goto(`${base}${path}?final_v787_audit=${Date.now()}-${Math.random().toString(36).slice(2)}`,{waitUntil:'domcontentloaded',timeout:30000});}
  catch(err){navigationError=clean(err?.message||err);}
  await page.waitForTimeout(focusedRad?1400:1000);

  let axeSeriousCritical=[]; let axeError='';
  try{
    await page.evaluate(axeSource);
    axeSeriousCritical=await page.evaluate(async()=>{
      const result=await window.axe.run(document,{runOnly:{type:'tag',values:['wcag2a','wcag2aa','wcag21a','wcag21aa']}});
      return result.violations.filter(v=>v.impact==='serious'||v.impact==='critical').map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length,help:v.help}));
    });
  }catch(e){axeError=clean(e?.message||e);}

  const state=await page.evaluate(()=>{
    const visible=(el)=>{const s=getComputedStyle(el);const r=el.getBoundingClientRect();return s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;};
    const positiveTab=[...document.querySelectorAll('[tabindex]')].filter(el=>Number(el.getAttribute('tabindex'))>0).map(el=>`${el.tagName.toLowerCase()}#${el.id||''}[tabindex=${el.getAttribute('tabindex')}]`).slice(0,20);
    const hiddenFocus=[...document.querySelectorAll('[aria-hidden="true"]:not([inert]) a[href],[aria-hidden="true"]:not([inert]) button,[aria-hidden="true"]:not([inert]) input,[aria-hidden="true"]:not([inert]) select,[aria-hidden="true"]:not([inert]) textarea,[aria-hidden="true"]:not([inert]) [tabindex]')]
      .filter(el=>!el.disabled&&el.tabIndex>=0&&visible(el)).map(el=>`${el.tagName.toLowerCase()}#${el.id||''}`).slice(0,20);
    const counts=new Map();
    for(const el of document.querySelectorAll('[id]')) counts.set(el.id,(counts.get(el.id)||0)+1);
    const duplicateDomIds=[...counts].filter(([,count])=>count>1).map(([id,count])=>`${id}:${count}`).slice(0,20);
    const docWidth=Math.max(document.documentElement.scrollWidth,document.body?.scrollWidth||0);
    return {
      url:location.href,
      title:document.title.trim(),
      bodyText:(document.body?.innerText||'').replace(/\s+/g,' ').trim().slice(0,220),
      authPending:document.documentElement.classList.contains('gejast-auth-pending')||document.body?.classList.contains('boot-pending'),
      docWidth,viewportWidth:innerWidth,
      positiveTab,hiddenFocus,duplicateDomIds,
      htmlOverflow:getComputedStyle(document.documentElement).overflowX,
      bodyOverflow:document.body?getComputedStyle(document.body).overflowX:'none'
    };
  }).catch(()=>({url:page.url(),title:'',bodyText:'',authPending:true,docWidth:99999,viewportWidth:width,positiveTab:['evaluation-failed'],hiddenFocus:['evaluation-failed'],duplicateDomIds:['evaluation-failed']}));

  const familyTarget=familyTargets.get(initialPath);
  let familyMismatch='';
  if(familyTarget){
    const [expectedPath,expectedScope]=familyTarget;
    const normalized=navs.map(u=>{try{return new URL(u);}catch{return null;}}).filter(Boolean);
    const firstCanonical=normalized.find(u=>u.hostname==='kalenel.nl'&&u.pathname!==initialPath);
    if(!firstCanonical||firstCanonical.pathname!==expectedPath||firstCanonical.searchParams.get('scope')!==expectedScope) familyMismatch=`expected first canonical ${expectedPath}?scope=${expectedScope}; navs=${normalized.map(u=>u.pathname+u.search).join(' -> ')}`;
  }

  const row={engine:engineName,viewport:viewportName,width,height,path,navigationError,pageErrors:uniq(pageErrors),consoleErrors:uniq(consoleErrors),badSameOrigin:uniq(badSameOrigin),failedSameOrigin:uniq(failedSameOrigin),axeSeriousCritical,axeError,familyMismatch,wrongFamilyRequests:uniq(wrongFamilyRequests),state};
  const failed=Boolean(row.navigationError||row.pageErrors.length||row.consoleErrors.length||row.badSameOrigin.length||row.failedSameOrigin.length||row.axeSeriousCritical.length||row.axeError||row.familyMismatch||row.wrongFamilyRequests.length||row.state.authPending||!row.state.title||!row.state.bodyText||row.state.docWidth>row.state.viewportWidth+4||row.state.positiveTab.length||row.state.hiddenFocus.length||row.state.duplicateDomIds.length||!sameSite(row.state.url));
  rows.push(row);
  if(failed){failures.push(row);console.log('FINAL_BROWSER_FAIL '+JSON.stringify(row));}
  await context.close();
}

for(const [viewportName,width,height] of viewports){for(const path of routes) await auditPage(path,viewportName,width,height);}
for(const width of [320,360,430,760]) await auditPage('/rad.html',`rad-${width}`,width,width<700?844:900,{focusedRad:true});
await browser.close();

const normalCombinations=viewports.length*routes.length;
const summary={engine:engineName,normalCombinations,focusedRadWidths:4,totalRenders:rows.length,failures:failures.length,blockedNonGet,seriousCriticalAxe:rows.reduce((n,r)=>n+r.axeSeriousCritical.length,0)};
console.log('FINAL_BROWSER_SUMMARY '+JSON.stringify(summary));
if(blockedNonGet===0) throw new Error(`${engineName} audit did not demonstrate local interception of non-GET traffic`);
if(failures.length)process.exit(1);
console.log(`FINAL_BROWSER_AUDIT=PASS engine=${engineName} renders=${rows.length} blockedNonGet=${blockedNonGet}`);
