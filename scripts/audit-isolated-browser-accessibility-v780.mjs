#!/usr/bin/env node
import { chromium } from 'playwright';
import AxeBuilder from '@axe-core/playwright';

const BASE='https://kalenel.nl';
const routes=[
  '/drinks_add.html','/drinks_pending.html','/drinks_speed.html','/beerpong.html','/boerenbridge.html',
  '/pikken.html','/pikken_live.html','/paardenrace.html','/paardenrace_live.html','/toepen.html','/rad.html',
  '/scorer.html','/leaderboard.html','/despimarkt.html','/despimarkt_create.html','/despimarkt_debts.html',
  '/klaverjas_live.html','/klaverjas_online.html','/my_profile.html','/profiles.html'
];

const browser=await chromium.launch({headless:true});
const context=await browser.newContext({viewport:{width:390,height:844},locale:'nl-NL'});
let blockedWrites=0;
let gateStubs=0;
await context.route('**/*',async route=>{
  const req=route.request();
  const url=new URL(req.url());
  if(url.hostname==='kalenel.nl' && /\/gejast-home-gate\.js$/i.test(url.pathname)){
    gateStubs++;
    return route.fulfill({status:200,contentType:'application/javascript',body:"document.documentElement.classList.remove('gejast-auth-pending');document.documentElement.classList.add('gejast-auth-ready');window.GEJAST_HOME_GATE={VERSION:'v780-audit-stub',audit:true};"});
  }
  if(!['GET','HEAD'].includes(req.method())){
    blockedWrites++;
    return route.fulfill({status:200,contentType:'application/json',body:'[]'});
  }
  return route.continue();
});

const results=[];
const uniqueViolations=new Map();
for(const route of routes){
  const page=await context.newPage();
  const pageErrors=[];
  page.on('pageerror',e=>pageErrors.push(String(e.message||e)));
  try{
    const response=await page.goto(`${BASE}${route}?isolated_a11y=${Date.now()}`,{waitUntil:'domcontentloaded',timeout:30000});
    await page.waitForTimeout(900);
    const finalPath=new URL(page.url()).pathname;
    const status=response?.status()||0;
    const bodyVisible=await page.locator('body').evaluate(el=>getComputedStyle(el).visibility!=='hidden');
    const focusable=await page.locator('a[href],button,input:not([type="hidden"]),select,textarea,[role="link"],[tabindex]:not([tabindex="-1"])').evaluateAll(els=>els.filter(el=>{const s=getComputedStyle(el),r=el.getBoundingClientRect();return !el.disabled&&s.display!=='none'&&s.visibility!=='hidden'&&r.width>0&&r.height>0;}).length);
    const positiveTabindex=await page.locator('[tabindex]').evaluateAll(els=>els.map(el=>Number(el.getAttribute('tabindex'))).filter(v=>v>0));
    const badFocus=[];
    for(let i=0;i<Math.min(focusable+2,35);i++){
      await page.keyboard.press('Tab');
      const focus=await page.evaluate(()=>{const el=document.activeElement;if(!el)return null;const s=getComputedStyle(el),r=el.getBoundingClientRect();return {tag:el.tagName.toLowerCase(),id:el.id||'',label:(el.getAttribute('aria-label')||el.textContent||el.getAttribute('placeholder')||'').trim().slice(0,70),outline:s.outlineStyle,width:s.outlineWidth,shadow:s.boxShadow,visible:r.width>0&&r.height>0};});
      if(focus&&focus.tag!=='body'&&focus.visible&&focus.outline==='none'&&(focus.shadow==='none'||!focus.shadow)) badFocus.push(focus);
    }
    const axe=await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze();
    for(const v of axe.violations){const key=`${route}|${v.id}`;uniqueViolations.set(key,{route,id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.slice(0,4).map(n=>({target:n.target,summary:n.failureSummary}))});}
    const item={route,finalPath,status,bodyVisible,focusable,positiveTabindex:positiveTabindex.length,badFocus:badFocus.slice(0,6),axe:axe.violations.map(v=>({id:v.id,impact:v.impact,nodes:v.nodes.length})),pageErrors:pageErrors.slice(0,5)};
    results.push(item);
    console.log('PAGE '+JSON.stringify(item));
  }catch(e){const item={route,error:String(e.message||e)};results.push(item);console.log('PAGE '+JSON.stringify(item));}
  finally{await page.close();}
}
await browser.close();

const violations=[...uniqueViolations.values()];
const serious=violations.filter(v=>['serious','critical'].includes(v.impact));
const focusProblems=results.reduce((n,r)=>n+(r.badFocus?.length||0),0);
const positiveTabs=results.reduce((n,r)=>n+(r.positiveTabindex||0),0);
const hiddenBodies=results.filter(r=>r.bodyVisible===false).map(r=>r.route);
const unexpectedRedirects=results.filter(r=>r.finalPath&&r.finalPath!==r.route).map(r=>({route:r.route,finalPath:r.finalPath}));
console.log(`AUDITED_ROUTES=${routes.length}`);
console.log(`AUTH_GATE_STUBS=${gateStubs}`);
console.log(`BLOCKED_NON_GET_REQUESTS=${blockedWrites}`);
console.log(`AXE_UNIQUE_VIOLATIONS=${violations.length}`);
console.log(`AXE_SERIOUS_CRITICAL=${serious.length}`);
console.log(`FOCUS_WITHOUT_VISIBLE_INDICATOR=${focusProblems}`);
console.log(`POSITIVE_TABINDEX=${positiveTabs}`);
console.log(`HIDDEN_BODIES=${hiddenBodies.length}`);
console.log(`UNEXPECTED_REDIRECTS=${unexpectedRedirects.length}`);
for(const v of violations) console.log('AXE '+JSON.stringify(v));
console.log('SUMMARY='+JSON.stringify({routes:routes.length,gateStubs,blockedWrites,violations:violations.length,serious:serious.length,focusProblems,positiveTabs,hiddenBodies,unexpectedRedirects}));
